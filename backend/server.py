import os
import logging
import uuid
import json
import tempfile
import atexit
from pathlib import Path
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from functools import wraps

# Flask and extensions
from flask import Flask, Blueprint, request, jsonify, abort
from flask_cors import CORS, cross_origin
from flask_socketio import SocketIO, join_room, leave_room

# Pydantic
from pydantic import BaseModel, Field, ValidationError, EmailStr

# MongoDB (PYMONGO SYNC)
from pymongo import MongoClient, ASCENDING, DESCENDING

# Auth deps
from passlib.hash import bcrypt
import jwt

# Third-party clients you already use
import openai
from deepgram import DeepgramClient, PrerecordedOptions, LiveTranscriptionEvents, LiveOptions
# from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

# ---------- Configuration ----------

ROOT_DIR = Path(__file__).parent
from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY")
JWT_SECRET = os.environ.get("JWT_SECRET", "change_me_in_prod")
JWT_EXPIRES_MIN = int(os.environ.get("JWT_EXPIRES_MIN", "120"))

openai.api_key = OPENAI_API_KEY
deepgram_client = DeepgramClient(DEEPGRAM_API_KEY)

# MongoDB SYNC client
mongo_url = os.environ["MONGO_URL"]
client = MongoClient(mongo_url)
db = client[os.environ["DB_NAME"]]
users_collection = db["users"]

# Flask
app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "a_secure_random_secret_key")

# CORS for API + SocketIO
CORS(
    app,
    resources={r"/*": {"origins": ["http://localhost:3001", "http://127.0.0.1:3001", "*"]}},
    supports_credentials=True,
)
socketio = SocketIO(app, async_mode="eventlet", cors_allowed_origins="*")  # keep your original

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------- Models ----------

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

# Auth models
class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: EmailStr
    password_hash: str
    roles: List[str] = ["viewer"]
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)

class UserCreate(BaseModel):
    email: EmailStr
    password: str

# ---------- Auth helpers (SYNC) ----------

def hash_password(pw: str) -> str:
    return bcrypt.hash(pw)

def verify_password(pw: str, pw_hash: str) -> bool:
    return bcrypt.verify(pw, pw_hash)

def create_access_token(user: Dict[str, Any]) -> str:
    payload = {
        "sub": user.get("id") or user.get("_id") or user.get("email"),
        "email": user["email"],
        "roles": user.get("roles", []),
        "exp": datetime.utcnow() + timedelta(minutes=JWT_EXPIRES_MIN),
        "iat": datetime.utcnow(),
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
            request.user = payload
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

# ---------- Init: indexes + seed admin (SYNC, once) ----------

def init_db_once():
    # unique email index
    try:
        db.users.create_index([("email", ASCENDING)], unique=True)
    except Exception as e:
        logger.warning(f"Index create warning: {e}")

    # Seed admin (optional)
    seed_email = os.environ.get("ADMIN_EMAIL")
    seed_pass = os.environ.get("ADMIN_PASSWORD")
    if seed_email and seed_pass:
        existing = db.users.find_one({"email": seed_email})
        if not existing:
            u = User(
                email=seed_email,
                password_hash=hash_password(seed_pass),
                roles=["admin"]
            )
            db.users.insert_one(u.model_dump())
            logger.info(f"Seeded admin user: {seed_email}")

# Run once at import time
init_db_once()

# ---------- API Blueprint ----------

api_bp = Blueprint("api", __name__, url_prefix="/api")

@api_bp.route("/", methods=["GET"])
def root():
    return jsonify({"message": "AI Meeting Assistant API", "version": "1.0.0"})

# ---- Auth routes (SYNC with PyMongo) ----

@api_bp.route("/auth/register", methods=["POST"])
def register():
    if not request.is_json:
        return jsonify({"success": False, "message": "Invalid content type"}), 400

    try:
        body = UserCreate(**request.get_json())
        roles = ["viewer"]

        existing = users_collection.find_one({"email": body.email})
        if existing:
            return jsonify({"success": False, "message": "User already exists"}), 400

        user = User(
            email=body.email,
            password_hash=hash_password(body.password),
            roles=roles
        )
        users_collection.insert_one(user.model_dump())

        return jsonify({"success": True, "message": "Registered successfully", "user_id": user.id}), 201

    except ValidationError as e:
        return jsonify({"success": False, "message": str(e)}), 422
    except Exception as e:
        logger.error(f"Register error: {e}")
        return jsonify({"success": False, "message": "Internal error"}), 500

@api_bp.route("/auth/login", methods=["POST", "OPTIONS"])
@cross_origin()
def login():
    if request.method == "OPTIONS":
        return ("", 204)

    if not request.is_json:
        return jsonify({"success": False, "message": "Invalid content type"}), 400

    data = request.get_json()
    email = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify({"success": False, "message": "Email and password are required"}), 400

    user = db.users.find_one({"email": email, "is_active": True})
    if not user:
        return jsonify({"success": False, "message": "Email not found or inactive"}), 401

    if not verify_password(password, user["password_hash"]):
        return jsonify({"success": False, "message": "Invalid password"}), 401

    # Ensure user ID exists
    if "id" not in user:
        user["id"] = str(user.get("_id", "")) or str(uuid.uuid4())

    token = create_access_token(user)
    return jsonify({
        "success": True,
        "message": "Login successful",
        "access_token": token,
        "roles": user.get("roles", []),
        "user_id": user["id"]
    }), 200

# ---- Admin endpoints ----
@api_bp.route("/users", methods=["GET"])
@auth_required
@role_required("admin")
def list_users():
    users = list(db.users.find({}, {"password_hash": 0}))
    # ensure JSON-serializable
    for u in users:
        u["_id"] = str(u.get("_id"))
    return jsonify(users)

@api_bp.route("/users", methods=["POST"])
@auth_required
@role_required("admin")
def create_user_admin():
    if not request.is_json:
        abort(400, description="Invalid content type")
    try:
        body = request.get_json()
        email = body.get("email")
        password = body.get("password")
        roles = body.get("roles", ["viewer"])
        if not email or not password:
            abort(400, description="email and password required")
        if db.users.find_one({"email": email}):
            abort(400, description="User already exists")
        user = User(email=email, password_hash=hash_password(password), roles=roles)
        db.users.insert_one(user.model_dump())
        return jsonify({"message": "User created", "user_id": user.id}), 201
    except Exception as e:
        logger.error(f"Admin create user error: {e}")
        abort(500, description="Internal error")

@api_bp.route("/users/<user_id>/roles", methods=["PUT"])
@auth_required
@role_required("admin")
def update_user_roles(user_id: str):
    if not request.is_json:
        abort(400, description="Invalid content type")
    roles = request.get_json().get("roles", [])
    if not isinstance(roles, list):
        abort(400, description="roles must be a list")
    res = db.users.update_one({"id": user_id}, {"$set": {"roles": roles}})
    if res.matched_count == 0:
        abort(404, description="User not found")
    return jsonify({"message": "Roles updated"})

# ---- Meeting endpoints (SYNC) ----

@api_bp.route("/meetings", methods=['POST'])
@auth_required
def create_meeting():
    if not request.is_json:
        abort(400, description="Invalid content type, expected application/json")
    try:
        meeting_data = MeetingCreate(**request.get_json())
        meeting = Meeting(**meeting_data.model_dump())
        db.meetings.insert_one(meeting.model_dump())
        logger.info(f"Created meeting: {meeting.id}")
        return jsonify(meeting.model_dump()), 201
    except ValidationError as e:
        abort(422, description=e.errors())
    except Exception as e:
        logger.error(f"Error creating meeting: {str(e)}")
        abort(500, description=str(e))

@api_bp.route("/meetings", methods=['GET'])
@auth_required
def get_meetings():
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
        cur = db.meetings.find(query).sort("timestamp", DESCENDING).limit(100)
        meetings = list(cur)
        return jsonify([Meeting(**m).model_dump() for m in meetings])
    except Exception as e:
        logger.error(f"Error fetching meetings: {str(e)}")
        abort(500, description=str(e))

@api_bp.route("/meetings/<string:meeting_id>", methods=['GET'])
@auth_required
def get_meeting(meeting_id: str):
    try:
        meeting = db.meetings.find_one({"id": meeting_id})
        if not meeting:
            abort(404, description="Meeting not found")
        return jsonify(Meeting(**meeting).model_dump())
    except Exception as e:
        logger.error(f"Error fetching meeting {meeting_id}: {str(e)}")
        abort(500, description=str(e))

@api_bp.route("/meetings/<string:meeting_id>/transcript", methods=['POST'])
@auth_required
def save_transcript(meeting_id: str):
    if not request.is_json:
        abort(400, description="Invalid content type, expected application/json")
    try:
        data = request.get_json()
        segments_data = data.get('segments', [])
        transcript_segments = [TranscriptSegment(**seg).model_dump() for seg in segments_data]
        result = db.meetings.update_one(
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
@auth_required
def transcribe_audio_file(meeting_id: str):
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
            # Deepgram SDK call is blocking; call directly in this sync handler
            response = deepgram_client.listen.prerecorded.v("1").transcribe_file(source, options)

        transcript_segments = []
        if response.results and response.results.utterances:
            for utterance in response.results.utterances:
                transcript_segments.append(TranscriptSegment(
                    text=utterance.transcript,
                    timestamp=utterance.start,
                    speaker=f"Speaker {utterance.speaker}",
                    confidence=utterance.confidence
                ).model_dump())

        result = db.meetings.update_one(
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
@auth_required
def summarize_meeting(meeting_id: str):
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

        # Blocking OpenAI call (sync)
        response = openai.chat.completions.create(
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

        result = db.meetings.update_one(
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
@auth_required
def send_meeting_email(meeting_id: str):
    if not request.is_json:
        abort(400, description="Invalid content type, expected application/json")
    try:
        req_data = request.get_json()
        recipient_emails = req_data.get('recipient_emails', [])
        if not recipient_emails:
            abort(400, description="'recipient_emails' list is required.")

        meeting_doc = db.meetings.find_one({"id": meeting_id})
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
            # If SendGrid client used:
            # sg = SendGridAPIClient(api_key=os.environ.get("SENDGRID_API_KEY"))
            # sg.send(message)
            logger.info(f"Email (simulated) sent to {email} for meeting {meeting_id}")

        db.email_logs.insert_one({
            "meeting_id": meeting_id, "recipients": recipient_emails, "sent_at": datetime.utcnow()
        })
        return jsonify({"message": f"Email sent to {len(recipient_emails)} recipients"})
    except Exception as e:
        logger.error(f"Error sending email for {meeting_id}: {str(e)}")
        abort(500, description=f"Email sending error: {str(e)}")

# ---------- Socket.IO (SYNC style) ----------

deepgram_connections = {}

def on_deepgram_message(result, sid, **kwargs):
    transcript = result.channel.alternatives[0].transcript
    if transcript:
        socketio.emit('transcript_update', {
            "type": "transcript",
            "data": {
                "text": transcript,
                "timestamp": datetime.utcnow().timestamp(),
                "is_final": result.is_final
            }
        }, to=sid)

def on_deepgram_error(error, sid, **kwargs):
    logger.error(f"Deepgram error for sid {sid}: {error}")
    socketio.emit('error', {"data": str(error)}, to=sid)

@socketio.on('join_meeting')
def handle_join_meeting(data):
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
        # Start is async in SDK; start in a background thread so we don't block
        import threading
        def _start():
            socketio.emit('joined', {'sid': sid, 'meeting_id': meeting_id}, to=sid)
            # Fire and forget
            import asyncio
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(dg_connection.start(options))
        threading.Thread(target=_start, daemon=True).start()

        deepgram_connections[sid] = dg_connection
    except Exception as e:
        logger.error(f"Error starting Deepgram for {sid}: {e}")
        socketio.emit('error', {'data': f'Failed to start transcription service: {e}'}, to=sid)

@socketio.on('audio_stream')
def handle_audio_stream(audio_data):
    sid = request.sid
    if sid in deepgram_connections:
        # send() is async; send from background thread/loop
        import threading, asyncio
        def _send():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(deepgram_connections[sid].send(audio_data))
        threading.Thread(target=_send, daemon=True).start()

#live streaming APIs
@socketio.on('connect', namespace='/api/meetings/<meeting_id>/live-transcribe')
def live_transcribe_connect(meeting_id):
    join_room(meeting_id)
    logger.info(f"Live transcribe client connected for meeting {meeting_id}")

@socketio.on('audio_stream', namespace='/api/meetings/<meeting_id>/live-transcribe')
def live_transcribe_audio(audio_data, meeting_id):
    if request.sid in deepgram_connections:
        import threading, asyncio
        def _send():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(deepgram_connections[request.sid].send(audio_data))
        threading.Thread(target=_send, daemon=True).start()

@socketio.on('disconnect', namespace='/api/meetings/<meeting_id>/live-transcribe')
def live_transcribe_disconnect(meeting_id):
    sid = request.sid
    logger.info(f"Live transcribe client disconnected for meeting {meeting_id}")
    if sid in deepgram_connections:
        import threading, asyncio
        dg_connection = deepgram_connections.pop(sid)
        def _finish():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(dg_connection.finish())
        threading.Thread(target=_finish, daemon=True).start()

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    logger.info(f"Client disconnected: {sid}")
    if sid in deepgram_connections:
        dg_connection = deepgram_connections.pop(sid)
        import threading, asyncio
        def _finish():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(dg_connection.finish())
        threading.Thread(target=_finish, daemon=True).start()
        logger.info(f"Finished Deepgram connection for {sid}")

# ---------- App wiring ----------

app.register_blueprint(api_bp)

@atexit.register
def shutdown_db_client():
    logger.info("Closing MongoDB client...")
    client.close()

if __name__ == "__main__":
    logger.info("Starting Flask-SocketIO development server...")
    print("Server running at: http://127.0.0.1:8001")
    socketio.run(app, host="0.0.0.0", port=8001, allow_unsafe_werkzeug=True)
