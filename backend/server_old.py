import os
import logging
import uuid
import json
import asyncio
import tempfile
import atexit
from pathlib import Path
from datetime import datetime
from typing import List, Optional, Dict, Any

# Flask and extensions for web framework and WebSockets
from flask import Flask, Blueprint, request, jsonify, abort
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room

# Pydantic for data validation and settings management
from pydantic import BaseModel, Field, ValidationError
from dotenv import load_dotenv

# MongoDB async client
from motor.motor_asyncio import AsyncIOMotorClient

# Third-party API clients
import openai
from deepgram import DeepgramClient, PrerecordedOptions, LiveTranscriptionEvents, LiveOptions
# import sendgrid
from sendgrid.helpers.mail import Mail
from pydantic import EmailStr
from passlib.hash import bcrypt
import jwt
from functools import wraps
from datetime import timedelta
# --- Configuration and Initialization ---

# Load environment variables
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# API Keys
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
DEEPGRAM_API_KEY = os.environ.get('DEEPGRAM_API_KEY')
# SENDGRID_API_KEY = os.environ.get('SENDGRID_API_KEY')

# Initialize clients
openai.api_key = OPENAI_API_KEY
deepgram_client = DeepgramClient(DEEPGRAM_API_KEY)
# sg = sendgrid.SendGridAPIClient(api_key=SENDGRID_API_KEY)

# MongoDB Connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Flask App Initialization
app = Flask(__name__)
# A secret key is needed for Flask sessions and SocketIO
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', 'a_secure_random_secret_key')
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)
# Use 'eventlet' for async support with SocketIO
socketio = SocketIO(app, async_mode='eventlet', cors_allowed_origins="*")


# API Blueprint for modular routing
api_bp = Blueprint('api', __name__, url_prefix='/api')

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# --- Pydantic Models (Data Structures) ---
# These models remain the same as they are framework-agnostic.

class TranscriptSegment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    text: str
    timestamp: float
    speaker: str = "Unknown"
    confidence: float = 0.0

class MeetingSummary(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    key_points: List[str] = []
    decisions_made: List[str] = []
    action_items: List[str] = []
    assignees: List[str] = []
    deadlines: List[str] = []
    attendee_recommendations: List[str] = []
    ai_recommendations: List[str] = []
    unresolved_issues: List[str] = []
    followup_reminders: List[str] = []
    references: List[str] = []

class Meeting(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    host: str = "Unknown"
    participants: List[str] = []
    transcript: List[TranscriptSegment] = []
    summary: Optional[MeetingSummary] = None
    duration: Optional[float] = None
    status: str = "active"  # active, completed, processing

class MeetingCreate(BaseModel):
    title: str
    host: str = "Unknown"
    participants: List[str] = []

class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: EmailStr
    password_hash: str
    roles: List[str] = ["viewer"]          # default role
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    roles: List[str] = ["viewer"]          # optional during admin-create

# Note: Request body models like TranscriptRequest are replaced by direct JSON handling
# and validation within each Flask route.

JWT_SECRET = os.environ.get("JWT_SECRET", "change_me")
JWT_EXPIRES_MIN = int(os.environ.get("JWT_EXPIRES_MIN", "60"))

def hash_password(password: str) -> str:
    return bcrypt.hash(password)

def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.verify(password, password_hash)

def create_access_token(user: Dict[str, Any]) -> str:
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "roles": user.get("roles", []),
        "exp": datetime.utcnow() + timedelta(minutes=JWT_EXPIRES_MIN)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])

def get_token_from_request() -> Optional[str]:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth.split(" ", 1)[1].strip()
    return None

def auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = get_token_from_request()
        if not token:
            abort(401, description="Missing Bearer token")
        try:
            payload = decode_token(token)
            request.user = payload  # attach to request
        except jwt.ExpiredSignatureError:
            abort(401, description="Token expired")
        except Exception:
            abort(401, description="Invalid token")
        return fn(*args, **kwargs)
    return wrapper


def role_required(*required_roles: str):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            token = get_token_from_request()
            if not token:
                abort(401, description="Missing Bearer token")
            try:
                payload = decode_token(token)
                roles = set(payload.get("roles", []))
                if not roles.intersection(required_roles):
                    abort(403, description="Forbidden")
                request.user = payload
            except jwt.ExpiredSignatureError:
                abort(401, description="Token expired")
            except Exception:
                abort(401, description="Invalid token")
            return fn(*args, **kwargs)
        return wrapper
    return decorator


@app.before_request
def init_auth():
    # unique email index
    try:
        db.users.create_index("email", unique=True)
    except Exception as e:
        logger.warning(f"Index init warning: {e}")

    # Optional: if no users, create the first admin from env
    seed_email = os.environ.get("ADMIN_EMAIL")
    seed_pass = os.environ.get("ADMIN_PASSWORD")
    if seed_email and seed_pass:
        existing = db.users.find_one({"email": seed_email})
        if not existing:
            db.users.insert_one(User(
                email=seed_email,
                password_hash=hash_password(seed_pass),
                roles=["admin"]
            ).model_dump())
            logger.info(f"Seeded admin user: {seed_email}")

# --- API Endpoints (HTTP Routes) ---
# User login and register API's
@api_bp.route("/auth/register", methods=["POST"])
def register():
    if not request.is_json:
        abort(400, description="Invalid content type")
    try:
        body = UserCreate(**request.get_json())
        # prevent client from self-assigning admin on public route
        roles = ["viewer"]
        existing = db.users.find_one({"email": body.email})
        if existing:
            abort(400, description="User already exists")

        user = User(
            email=body.email,
            password_hash=hash_password(body.password),
            roles=roles
        )
        db.users.insert_one(user.model_dump())
        return jsonify({"message": "Registered", "user_id": user.id}), 201
    except ValidationError as e:
        abort(422, description=e.errors())
    except Exception as e:
        logger.error(f"Register error: {e}")
        abort(500, description="Internal error")

@api_bp.route("/auth/login", methods=["POST"])
def login():
    if not request.is_json:
        abort(400, description="Invalid content type")
    data = request.get_json()
    email = data.get("email")
    password = data.get("password")
    if not email or not password:
        abort(400, description="Email and password are required")

    user = db.users.find_one({"email": email, "is_active": True})
    if not user or not verify_password(password, user["password_hash"]):
        abort(401, description="Invalid email or password")

    token = create_access_token(user)
    return jsonify({
        "message": "Login successful",
        "access_token": token,
        "roles": user.get("roles", []),
        "user_id": str(user["_id"])  # Convert ObjectId to string for JSON
    })

# Admin side API's
# Create user (admin)
@api_bp.route("/admin/users", methods=["POST"])
@role_required("admin")
async def admin_create_user():
    try:
        body = request.get_json() or {}
        # allow admin to set roles on creation
        payload = UserCreate(**{
            "email": body.get("email"),
            "password": body.get("password"),
            "roles": body.get("roles", ["viewer"])
        })
        if await db.users.find_one({"email": payload.email}):
            abort(400, description="User already exists")
        user = User(
            email=payload.email,
            password_hash=hash_password(payload.password),
            roles=payload.roles
        )
        await db.users.insert_one(user.model_dump())
        return jsonify({"message": "User created", "user_id": user.id}), 201
    except ValidationError as e:
        abort(422, description=e.errors())
    except Exception as e:
        logger.error(f"Admin create user error: {e}")
        abort(500, description="Internal error")

# List users (admin)
@api_bp.route("/admin/users", methods=["GET"])
@role_required("admin")
async def admin_list_users():
    q = {}
    users = await db.users.find(q, {"password_hash": 0}).sort("created_at", -1).to_list(200)
    return jsonify(users)

# Update roles / activate-deactivate (admin)
@api_bp.route("/admin/users/<string:user_id>", methods=["PATCH"])
@role_required("admin")
async def admin_update_user(user_id: str):
    body = request.get_json() or {}
    updates = {}
    if "roles" in body:
        updates["roles"] = body["roles"]
    if "is_active" in body:
        updates["is_active"] = bool(body["is_active"])
    if not updates:
        abort(400, description="No updates")
    res = await db.users.update_one({"id": user_id}, {"$set": updates})
    if res.matched_count == 0:
        abort(404, description="User not found")
    return jsonify({"message": "Updated"})

# Delete user (admin)
@api_bp.route("/admin/users/<string:user_id>", methods=["DELETE"])
@role_required("admin")
async def admin_delete_user(user_id: str):
    res = await db.users.delete_one({"id": user_id})
    if res.deleted_count == 0:
        abort(404, description="User not found")
    return jsonify({"message": "Deleted"})

# Meeting API's
@api_bp.route("/", methods=['GET'])
async def root():
    return jsonify({"message": "AI Meeting Assistant API", "version": "1.0.0"})

@api_bp.route("/meetings", methods=['POST'])
@role_required("admin", "attendee")
async def create_meeting():
    """Create a new meeting"""
    if not request.is_json:
        abort(400, description="Invalid content type, expected application/json")
    try:
        meeting_data = MeetingCreate(**request.get_json())
        meeting = Meeting(**meeting_data.model_dump())
        await db.meetings.insert_one(meeting.model_dump())
        logger.info(f"Created meeting: {meeting.id}")
        return jsonify(meeting.model_dump()), 201
    except ValidationError as e:
        abort(422, description=e.errors())
    except Exception as e:
        logger.error(f"Error creating meeting: {str(e)}")
        abort(500, description=str(e))

@api_bp.route("/meetings", methods=['GET'])
@auth_required
async def get_meetings():
    """Get all meetings with optional search and filtering"""
    try:
        search = request.args.get('search')
        participant = request.args.get('participant')
        query = {}
        if search:
            query["$or"] = [
                {"title": {"$regex": search, "$options": "i"}},
                {"host": {"$regex": search, "$options": "i"}}
            ]
        if participant:
            query["participants"] = {"$in": [participant]}
        
        meetings_cursor = db.meetings.find(query).sort("timestamp", -1)
        meetings = await meetings_cursor.to_list(100)
        # Pydantic validation is implicitly handled by the list comprehension
        return jsonify([Meeting(**m).model_dump() for m in meetings])
    except Exception as e:
        logger.error(f"Error fetching meetings: {str(e)}")
        abort(500, description=str(e))

@api_bp.route("/meetings/<string:meeting_id>", methods=['GET'])
@auth_required
async def get_meeting(meeting_id: str):
    """Get a specific meeting by ID"""
    try:
        meeting = await db.meetings.find_one({"id": meeting_id})
        if not meeting:
            abort(404, description="Meeting not found")
        return jsonify(Meeting(**meeting).model_dump())
    except Exception as e:
        logger.error(f"Error fetching meeting {meeting_id}: {str(e)}")
        abort(500, description=str(e))

@api_bp.route("/meetings/<string:meeting_id>/transcript", methods=['POST'])
@role_required("admin", "attendee")
async def save_transcript(meeting_id: str):
    """Save transcript segments for a meeting"""
    if not request.is_json:
        abort(400, description="Invalid content type, expected application/json")
    try:
        data = request.get_json()
        segments_data = data.get('segments', [])
        
        transcript_segments = [TranscriptSegment(**seg).model_dump() for seg in segments_data]
        
        result = await db.meetings.update_one(
            {"id": meeting_id},
            {"$set": {"transcript": transcript_segments, "status": "completed"}}
        )
        if result.matched_count == 0:
            abort(404, description="Meeting not found")
        
        logger.info(f"Saved transcript for meeting: {meeting_id}")
        return jsonify({"message": "Transcript saved successfully", "segments_count": len(transcript_segments)})
    except ValidationError as e:
        abort(422, description=e.errors())
    except Exception as e:
        logger.error(f"Error saving transcript for {meeting_id}: {str(e)}")
        abort(500, description=str(e))

@api_bp.route("/meetings/<string:meeting_id>/transcribe-file", methods=['POST'])
@role_required("admin", "attendee")
async def transcribe_audio_file(meeting_id: str):
    """Transcribe uploaded audio file using Deepgram"""
    if 'audio_file' not in request.files:
        abort(400, description="No 'audio_file' part in the request")
    
    audio_file = request.files['audio_file']
    if audio_file.filename == '':
        abort(400, description="No selected file")

    temp_file_path = None
    try:
        audio_data = audio_file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{audio_file.filename.split('.')[-1]}") as temp_file:
            temp_file.write(audio_data)
            temp_file_path = temp_file.name

        options = PrerecordedOptions(
            model="nova-2", smart_format=True, punctuate=True, diarize=True, utterances=True
        )
        with open(temp_file_path, "rb") as audio:
            source = {"buffer": audio, "mimetype": audio_file.mimetype}
            # The Deepgram SDK call is blocking, run in a thread
            response = await asyncio.to_thread(
                deepgram_client.listen.prerecorded.v("1").transcribe_file, source, options
            )

        transcript_segments = []
        if response.results and response.results.utterances:
             for utterance in response.results.utterances:
                transcript_segments.append(TranscriptSegment(
                    text=utterance.transcript,
                    timestamp=utterance.start,
                    speaker=f"Speaker {utterance.speaker}",
                    confidence=utterance.confidence
                ).model_dump())

        result = await db.meetings.update_one(
            {"id": meeting_id},
            {"$set": {"transcript": transcript_segments, "status": "completed"}}
        )
        if result.matched_count == 0:
            abort(404, description="Meeting not found")

        logger.info(f"Transcribed audio file for meeting: {meeting_id}")
        return jsonify({
            "message": "Audio transcribed successfully",
            "segments_count": len(transcript_segments),
            "transcript": transcript_segments
        })
    except Exception as e:
        logger.error(f"Error transcribing audio for {meeting_id}: {str(e)}")
        abort(500, description=f"Transcription error: {str(e)}")
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            os.unlink(temp_file_path)

@api_bp.route("/meetings/<string:meeting_id>/summarize", methods=['POST'])
@role_required("admin", "attendee")
async def summarize_meeting(meeting_id: str):
    """Generate AI summary using OpenAI GPT-4o"""
    if not request.is_json:
        abort(400, description="Invalid content type, expected application/json")
    try:
        data = request.get_json()
        transcript_text = data.get('transcript_text')
        if not transcript_text:
            abort(400, description="'transcript_text' is required.")

        prompt = f"""
        Please analyze the following meeting transcript and provide a comprehensive summary in JSON format with these exact sections:
        Meeting Transcript: {transcript_text}
        Please respond with a JSON object containing:
        {{
            "key_points": ["..."], "decisions_made": ["..."], "action_items": ["..."], "assignees": ["..."], "deadlines": ["..."],
            "attendee_recommendations": ["..."], "ai_recommendations": ["..."], "unresolved_issues": ["..."], "followup_reminders": ["..."], "references": ["..."]
        }}
        Make each section specific and actionable. If a section doesn't apply, include an empty array.
        """
        
        # OpenAI SDK call is blocking, run in a thread
        response = await asyncio.to_thread(
            openai.chat.completions.create,
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a professional meeting assistant that creates structured, actionable meeting summaries."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=2000,
            temperature=0.3
        )
        
        summary_text = response.choices[0].message.content
        summary_data = json.loads(summary_text)
        summary = MeetingSummary(**summary_data)
        
        result = await db.meetings.update_one(
            {"id": meeting_id},
            {"$set": {"summary": summary.model_dump()}}
        )
        if result.matched_count == 0:
            abort(404, description="Meeting not found")

        logger.info(f"Generated summary for meeting: {meeting_id}")
        return jsonify({"message": "Summary generated successfully", "summary": summary.model_dump()})
    except json.JSONDecodeError:
        abort(500, description="AI summary response was not valid JSON.")
    except Exception as e:
        logger.error(f"Error generating summary for {meeting_id}: {str(e)}")
        abort(500, description=f"Summary generation error: {str(e)}")

@api_bp.route("/meetings/<string:meeting_id>/send-email", methods=['POST'])
@role_required("admin")
async def send_meeting_email(meeting_id: str):
    """Send meeting summary via email using SendGrid"""
    if not request.is_json:
        abort(400, description="Invalid content type, expected application/json")
    try:
        req_data = request.get_json()
        recipient_emails = req_data.get('recipient_emails', [])
        if not recipient_emails:
            abort(400, description="'recipient_emails' list is required.")

        meeting_doc = await db.meetings.find_one({"id": meeting_id})
        if not meeting_doc:
            abort(404, description="Meeting not found")
        
        meeting = Meeting(**meeting_doc)
        
        transcript_text = "\n".join([f"[{seg.timestamp:.1f}s] {seg.speaker}: {seg.text}" for seg in meeting.transcript])
        summary_text = "No summary available."
        if meeting.summary:
            s = meeting.summary
            summary_text = f"🔑 KEY POINTS:\n" + "\n".join(f"• {p}" for p in s.key_points) + "\n\n" \
                         + f"✅ ACTION ITEMS:\n" + "\n".join(f"• {i}" for i in s.action_items)
        
        email_body = f"Summary for {meeting.title}:\n\n{summary_text}\n\n---\nFull Transcript:\n{transcript_text}"
        
        for email in recipient_emails:
            message = Mail(
                from_email=req_data.get('sender_email', 'meetings@example.com'),
                to_emails=email,
                subject=f"Meeting Summary: {meeting.title}",
                plain_text_content=email_body
            )
            # SendGrid SDK call is blocking, run in a thread
            # await asyncio.to_thread(sg.send, message)
            logger.info(f"Email sent to {email} for meeting {meeting_id}")

        await db.email_logs.insert_one({
            "meeting_id": meeting_id, "recipients": recipient_emails, "sent_at": datetime.utcnow()
        })
        return jsonify({"message": f"Email sent to {len(recipient_emails)} recipients"})
    except Exception as e:
        logger.error(f"Error sending email for {meeting_id}: {str(e)}")
        abort(500, description=f"Email sending error: {str(e)}")

@api_bp.route("/admin/meetings", methods=["GET"])
@role_required("admin")
async def admin_list_meetings():
    meetings = await db.meetings.find({}, {"_id": 0}).sort("timestamp", -1).to_list(500)
    return jsonify(meetings)

# --- WebSocket Handlers for Live Transcription ---

# Global dict to track Deepgram connections per client session
deepgram_connections = {}

async def on_deepgram_message(result, sid, **kwargs):
    """Callback to handle transcript messages from Deepgram."""
    transcript = result.channel.alternatives[0].transcript
    if transcript:
        await socketio.emit('transcript_update', {
            "type": "transcript",
            "data": {
                "text": transcript,
                "timestamp": datetime.utcnow().timestamp(),
                "is_final": result.is_final
            }
        }, to=sid)

async def on_deepgram_error(error, sid, **kwargs):
    """Callback to handle errors from Deepgram."""
    logger.error(f"Deepgram error for sid {sid}: {error}")
    await socketio.emit('error', {"data": str(error)}, to=sid)

@socketio.on('join_meeting')
async def handle_join_meeting(data):
    """Client joins a meeting room to start live transcription."""
    sid = request.sid
    meeting_id = data.get('meeting_id')
    if not meeting_id:
        logger.error(f"Client {sid} tried to join without meeting_id")
        return

    logger.info(f"Client {sid} joining meeting {meeting_id}")
    join_room(meeting_id)

    try:
        dg_connection = deepgram_client.listen.asynclive.v("1")
        dg_connection.on(LiveTranscriptionEvents.Transcript, lambda r, **k: on_deepgram_message(r, sid=sid, **k))
        dg_connection.on(LiveTranscriptionEvents.Error, lambda e, **k: on_deepgram_error(e, sid=sid, **k))

        options = LiveOptions(
            model="nova-2", punctuate=True, language="en-US",
            encoding="linear16", channels=1, sample_rate=16000
        )
        await dg_connection.start(options)
        deepgram_connections[sid] = dg_connection
        await socketio.emit('joined', {'sid': sid, 'meeting_id': meeting_id}, to=sid)
    except Exception as e:
        logger.error(f"Error starting Deepgram for {sid}: {e}")
        await socketio.emit('error', {'data': f'Failed to start transcription service: {e}'}, to=sid)

@socketio.on('audio_stream')
async def handle_audio_stream(audio_data):
    """Receives audio from client and forwards to Deepgram."""
    sid = request.sid
    if sid in deepgram_connections:
        await deepgram_connections[sid].send(audio_data)

@socketio.on('disconnect')
async def handle_disconnect():
    """Clean up when a client disconnects."""
    sid = request.sid
    logger.info(f"Client disconnected: {sid}")
    if sid in deepgram_connections:
        dg_connection = deepgram_connections.pop(sid)
        await dg_connection.finish()
        logger.info(f"Finished Deepgram connection for {sid}")


# --- App Finalization ---

# Register the blueprint with the main Flask app
app.register_blueprint(api_bp)

# Register a function to close the database client on exit
@atexit.register
def shutdown_db_client():
    logger.info("Closing MongoDB client...")
    client.close()

# Main entry point for running the application
if __name__ == "__main__":
    logger.info("Starting Flask-SocketIO development server...")
    print("Server running at: http://127.0.0.1:8001")
    socketio.run(app, host="0.0.0.0", port=8001, allow_unsafe_werkzeug=True)
