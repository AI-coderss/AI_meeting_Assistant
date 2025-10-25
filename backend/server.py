import eventlet
eventlet.monkey_patch()
import os
import uuid
import json
import tempfile
import atexit
from pathlib import Path
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import List, Optional, Dict, Any
from functools import wraps
import logging
import base64
# Flask and extensions
from flask import Flask, Blueprint, request, jsonify, abort
from flask_cors import CORS, cross_origin
from flask_socketio import SocketIO, join_room, leave_room, emit
from google_calendar_service import GoogleCalendarService
# Pydantic
from pydantic import BaseModel, Field, ValidationError, EmailStr

# MongoDB (PYMONGO SYNC)
from pymongo import MongoClient, ASCENDING, DESCENDING

# Auth deps
from passlib.hash import bcrypt
import jwt

# Third-party clients you already use
import openai
from deepgram import DeepgramClient
from google.cloud import speech
import threading
import asyncio
import requests
from sendgrid.helpers.mail import Mail
# from google_speech import google_bp
from apscheduler.schedulers.background import BackgroundScheduler

from dotenv import load_dotenv
import redis
from pyannote.audio import Pipeline
import numpy as np
import io
from openai import OpenAI

# ---------- Configuration ----------

ROOT_DIR = Path(__file__).parent
from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY")
JWT_SECRET = os.environ.get("JWT_SECRET", "change_me_in_prod")
JWT_EXPIRES_MIN = int(os.environ.get("JWT_EXPIRES_MIN", "120"))

openai.api_key = OPENAI_API_KEY
deepgram_client = DeepgramClient(api_key=DEEPGRAM_API_KEY)
# MongoDB SYNC client
mongo_url = os.environ["MONGO_URL"]
client = MongoClient(mongo_url)
db = client[os.environ["DB_NAME"]]
users_collection = db["users"]

# Flask
app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "a_secure_random_secret_key")
# app.register_blueprint(google_bp)
# CORS for API + SocketIO
CORS(
    app,
    resources={r"/*": {"origins": ["http://localhost:3000", 'https://9a86c1d2a8db.ngrok-free.app',"http://127.0.0.1:3001", "*"]}},
    supports_credentials=True,
)
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")  # keep your original

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

@api_bp.route("/users/<user_id>/status", methods=["PUT"])
@auth_required
@role_required("admin")
def update_user_status(user_id: str):
    if not request.is_json:
        abort(400, description="Invalid content type")

    is_active = request.get_json().get("is_active")
    if not isinstance(is_active, bool):
        abort(400, description="is_active must be a boolean")

    res = db.users.update_one({"id": user_id}, {"$set": {"is_active": is_active}})
    if res.matched_count == 0:
        abort(404, description="User not found")

    return jsonify({"message": f"User {'activated' if is_active else 'deactivated'}"})

@api_bp.route("/users/<user_id>", methods=["DELETE"])
@auth_required
@role_required("admin")
def delete_user(user_id: str):
    res = db.users.delete_one({"id": user_id})
    if res.deleted_count == 0:
        abort(404, description="User not found")
    return jsonify({"message": "User deleted"})

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

@api_bp.route("/meetings/<meeting_id>", methods=["PUT"])
@auth_required
def update_meeting(meeting_id):
    if not request.is_json:
        abort(400, description="Invalid content type, expected application/json")

    try:
        data = request.get_json()
        transcript = data.get("transcript")

        if transcript is None:
            abort(400, description="Missing 'transcript' field in request body")

        # Update the meeting in the database
        result = db.meetings.update_one(
            {"id": meeting_id},
            {"$set": {"transcript": transcript}}
        )

        if result.matched_count == 0:
            abort(404, description=f"Meeting with ID {meeting_id} not found")

        updated_meeting = db.meetings.find_one({"_id": meeting_id})
        logger.info(f"✅ Updated meeting {meeting_id} with transcript")

        return jsonify(updated_meeting), 200

    except Exception as e:
        logger.error(f"❌ Error updating meeting {meeting_id}: {str(e)}")
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

@api_bp.route("/meetings/host/<host_name>", methods=['GET'])
@auth_required
def get_meetings_by_host(host_name):
    try:
        search = request.args.get('search')
        participant = request.args.get('participant')

        # Always filter by host
        query = {"host": {"$regex": host_name, "$options": "i"}}

        # Add search within this host’s meetings
        if search:
            query["$or"] = [
                {"title": {"$regex": search, "$options": "i"}},
                {"summary": {"$regex": search, "$options": "i"}}
            ]

        # Add participant filter
        if participant:
            query["participants"] = {"$in": [participant]}

        cur = db.meetings.find(query).sort("timestamp", DESCENDING).limit(100)
        meetings = list(cur)
        return jsonify([Meeting(**m).model_dump() for m in meetings])

    except Exception as e:
        logger.error(f"Error fetching meetings by host: {str(e)}")
        abort(500, description=str(e))

@api_bp.route("/meetings/<string:meeting_id>", methods=['DELETE'])
@auth_required
def delete_meeting(meeting_id: str):
    try:
        result = db.meetings.delete_one({"id": meeting_id})

        if result.deleted_count == 0:
            abort(404, description="Meeting not found")

        return jsonify({"message": f"Meeting {meeting_id} deleted successfully"})
    except Exception as e:
        logger.error(f"Error deleting meeting {meeting_id}: {str(e)}")
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

        # NEW DEEPGRAM SYNTAX
        with open(temp_file_path, "rb") as audio:
            buffer_data = audio.read()

        options = {
            "model": "nova-2",
            "smart_format": True,
            "punctuate": True,
            "diarize": True,
            "utterances": True
        }

        response = deepgram_client.transcribe(
            {"buffer": buffer_data, "mimetype": audio_file.mimetype},
            options
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
        Please analyze the following meeting transcript and provide a structured JSON summary with exactly these keys:
        {{
            "key_points": ["..."],
            "decisions_made": ["..."],
            "action_items": ["..."],
            "assignees": ["..."],
            "deadlines": ["..."],
            "attendee_recommendations": ["..."],
            "ai_recommendations": ["..."],
            "unresolved_issues": ["..."],
            "followup_reminders": ["..."],
            "references": ["..."]
        }}

        Meeting Transcript:
        {transcript_text}

        ⚠️ Important: ONLY return valid JSON. No extra text or explanations.
        """

        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a JSON-only responder. Always return strictly valid JSON."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=2000,
            temperature=0.3
        )

        summary_text = response.choices[0].message.content.strip()

        # 🛠️ Clean up if wrapped in ```json fences
        if summary_text.startswith("```"):
            summary_text = summary_text.strip("`")
            summary_text = summary_text.replace("json\n", "").replace("json", "")

        # Try parsing JSON
        try:
            summary_data = json.loads(summary_text)
        except json.JSONDecodeError:
            # Last resort: extract JSON object with regex
            import re
            match = re.search(r"\{.*\}", summary_text, re.DOTALL)
            if match:
                summary_data = json.loads(match.group())
            else:
                abort(500, description="AI summary response was not valid JSON.")

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


@app.route("/transcribe", methods=["POST"])
def transcribe_audio():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]

    url = "https://api.openai.com/v1/audio/transcriptions"
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    files = {"file": (file.filename, file.read(), file.content_type)}
    data = {"model": "gpt-4o-transcribe"}  # or "whisper-1"

    try:
        resp = requests.post(url, headers=headers, files=files, data=data)
        resp.raise_for_status()
        transcription = resp.json()

        # Extract text safely
        text = transcription.get("text", "")

        return jsonify({
            "text": text,
            "timestamp": datetime.datetime.utcnow().isoformat()  # ✅ add timestamp
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
@app.route("/api/deepgram-token", methods=["GET"])
def get_deepgram_token():
    """
    Returns a short-lived Deepgram token for WebSocket authentication.
    """
    if not DEEPGRAM_API_KEY:
        return jsonify({"error": "Deepgram API key not set"}), 500

    try:
        projectId = "9cd2b509-71dd-45bd-85b4-88791a52dec9"
        url = f"https://api.deepgram.com/v1/projects/{projectId}/tokens"  

        headers = {
            "Authorization": f"Token {DEEPGRAM_API_KEY}",
            "Content-Type": "application/json"
        }

        # you can also send scopes in body if you want to restrict
        resp = requests.post(url, headers=headers, json={"scopes": ["listen:stream"]})
        resp.raise_for_status()

        data = resp.json()
        token = data.get("token")
        if not token:
            return jsonify({"error": "Failed to get token"}), 500
        return jsonify({"token": token})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    
# ---------- Socket.IO (SYNC style) ----------

deepgram_connections = {}
speaker_counter = {}

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
    import threading, asyncio
    sid = request.sid
    meeting_id = data.get('meeting_id')
    sample_rate = int(data.get('sample_rate') or 48000)  # fallback

    if not meeting_id:
        logger.error(f"Client {sid} tried to join without meeting_id")
        return

    logger.info(f"Client {sid} joining meeting {meeting_id} (sample_rate={sample_rate})")
    join_room(meeting_id)

    try:
        dg_connection = deepgram_client.listen.v("1")

        async def handle_open():
            logger.info(f"[Deepgram] Connection opened for {sid}")

        async def handle_close():
            logger.info(f"[Deepgram] Connection closed for {sid}")

        async def handle_transcript(result):
            try:
                logger.debug(f"[Deepgram] Raw transcript event: {result}")

                # result is a dict
                channel = result.get("channel", {})
                alternatives = channel.get("alternatives", [])
                if alternatives:
                    text = alternatives[0].get("transcript", "")
                    is_final = result.get("is_final", False)

                    if text:
                        logger.info(f"[Deepgram] Transcript for {sid}: {text} (final={is_final})")
                        socketio.emit(
                            "transcript_update",
                            {"text": text, "is_final": is_final},
                            room=sid
                        )
            except Exception as e:
                logger.exception(f"Transcript parse error for {sid}: {e}")

        async def handle_error(error):
            logger.error(f"[Deepgram] Error for {sid}: {error}")

        dg_connection.on("open", handle_open)
        dg_connection.on("close", handle_close)
        dg_connection.on("transcription", handle_transcript)
        dg_connection.on("error", handle_error)

        options = {
            "model": "nova-2",
            "punctuate": True,
            "language": "en-US",
            "encoding": "linear16",
            "channels": 1,
            "sample_rate": sample_rate,
            "interim_results": True
        }

        def _start(loop):
            try:
                socketio.emit('joined', {'sid': sid, 'meeting_id': meeting_id}, to=sid)
                logger.info(f"🔄 Starting Deepgram connection for {sid} in meeting {meeting_id}")
                asyncio.set_event_loop(loop)
                loop.run_until_complete(dg_connection.start(options))
            except Exception as e:
                logger.error(f"❌ Deepgram start failed for {sid}: {e}")
                socketio.emit('error', {'data': f'Failed to start transcription: {e}'}, to=sid)

        loop = asyncio.new_event_loop()
        thread = threading.Thread(target=_start, args=(loop,), daemon=True)
        thread.start()

        deepgram_connections[sid] = {"conn": dg_connection, "loop": loop, "thread": thread}

    except Exception as e:
        logger.error(f"❌ Error preparing Deepgram for {sid}: {e}")
        socketio.emit('error', {'data': f'Failed to initialize transcription service: {e}'}, to=sid)

@socketio.on('audio_stream')
def handle_audio_stream(payload):
    import base64
    import asyncio
    sid = request.sid
    if sid not in deepgram_connections:
        logger.warning(f"Received audio from {sid}, but no active Deepgram connection")
        return

    conn_info = deepgram_connections[sid]
    dg_connection = conn_info["conn"]
    loop = conn_info["loop"]

    try:
        audio_bytes = None
        if isinstance(payload, dict) and 'audio' in payload:
            # Check if the audio data contains a data URL prefix
            audio_data = payload['audio']
            if ',' in audio_data:
                # Remove the data URL prefix if present
                _, audio_data = audio_data.split(',', 1)
            audio_bytes = base64.b64decode(audio_data)
        elif isinstance(payload, (bytes, bytearray)):
            audio_bytes = bytes(payload)

        if not audio_bytes:
            logger.warning(f"Unexpected audio payload type from {sid}: {type(payload)}")
            return

        logger.info(
                f"➡️ Forwarding {len(audio_bytes)} bytes to Deepgram "
                f"for sid {sid} | sample: {audio_bytes[:10]}"
            )
        asyncio.run_coroutine_threadsafe(dg_connection.send(audio_bytes), loop)
    except Exception as e:
        logger.error(f"❌ Failed to send audio chunk for {sid}: {e}")


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

@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    import base64
    sid = request.sid

    audio_b64 = data.get('audio')
    if audio_b64:
        try:
            # decode
            if ',' in audio_b64:
                # Remove the data URL prefix if present
                _, encoded = audio_b64.split(',', 1)
            else:
                encoded = audio_b64
            audio_data = base64.b64decode(encoded)
            if len(audio_data) > 1000:
                # save to temp
                mime_type = data.get('mimeType', 'audio/webm')
                suffix = '.ogg' if 'ogg' in mime_type else '.webm'
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                    f.write(audio_data)
                    temp_path = f.name

                try:
                    logger.info(f"Processing audio chunk for {sid}, size: {len(audio_data)}")
                    # transcribe using Google Speech-to-Text
                    client = speech.SpeechClient()
                    encoding = speech.RecognitionConfig.AudioEncoding.WEBM_OPUS if 'webm' in mime_type else speech.RecognitionConfig.AudioEncoding.OGG_OPUS
                    config = speech.RecognitionConfig(
                        encoding=encoding,
                        sample_rate_hertz=16000,
                        language_code="en-US",
                    )
                    audio = speech.RecognitionAudio(content=audio_data)
                    response = client.recognize(config=config, audio=audio)

                    text = ""
                    if response.results:
                        text = response.results[0].alternatives[0].transcript
                        language = "en"  # Google returns language_code, but for simplicity

                    logger.info(f"Transcription result for {sid}: text='{text}', language='{language}'")
                    if text and text.strip():
                        logger.info(f"Emitting text for {sid}: '{text}'")
                        speaker = "Speaker 1"

                        # Generate AI response
                        # Removed AI response generation as per user request
                        socketio.emit('transcript', {
                            'text': text,
                            'language': language,
                            'speaker': speaker
                        }, to=sid)

                except Exception as e:
                    logger.error(f"Transcription error for {sid}: {e}")
                finally:
                    try:
                        os.unlink(temp_path)
                    except:
                        pass

        except Exception as e:
            logger.error(f"Audio chunk processing error for {sid}: {e}")

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    logger.info(f"Client disconnected: {sid}")
    if sid in deepgram_connections:
        conn_info = deepgram_connections.pop(sid)
        dg_connection = conn_info["conn"]
        loop = conn_info["loop"]

        def _finish():
            try:
                asyncio.set_event_loop(loop)
                loop.run_until_complete(dg_connection.finish())
                logger.info(f"Finished Deepgram connection for {sid}")
            except Exception as e:
                logger.error(f"❌ Error finishing Deepgram connection for {sid}: {e}")

        threading.Thread(target=_finish, daemon=True).start()

    if sid in speaker_counter:
        del speaker_counter[sid]

@app.route("/api/save_medical_meeting", methods=["POST"])
def save_medical_meeting():
    """
    Save medical meeting form data to MongoDB
    """
    try:
        data = request.get_json()

        required_fields = ["meeting_title", "meeting_type", "meeting_time", "host_email", "participants"]
        missing = [f for f in required_fields if f not in data or not data[f]]
        if missing:
            return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

        # Convert meeting_time to a datetime object
        try:
            meeting_time = datetime.fromisoformat(data["meeting_time"])
        except Exception:
            return jsonify({"error": "Invalid meeting_time format. Must be ISO 8601."}), 400

        # Build the document
        meeting_doc = {
            "meeting_title": data["meeting_title"],
            "meeting_type": data["meeting_type"],
            "meeting_time": meeting_time,
            "host_email": data["host_email"],
            "participants": data["participants"],  # list of dicts
            "created_at": datetime.utcnow()
        }

        # Insert into new collection
        result = db["medical_meetings"].insert_one(meeting_doc)

        return jsonify({
            "message": "Medical meeting saved successfully",
            "meeting_id": str(result.inserted_id)
        }), 201

    except Exception as e:
        logger.error(f"Error saving medical meeting: {e}")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/api/get_medical_meetings", methods=["GET"])
def get_medical_meetings():
    """
    Return all medical meetings sorted by meeting_time (upcoming first)
    """
    try:
        meetings = list(
            db["medical_meetings"].find({}, {"_id": 0}).sort("meeting_time", 1)
        )
        return jsonify(meetings), 200
    except Exception as e:
        print("Error fetching meetings:", e)
        return jsonify({"error": str(e)}), 500

# @app.route("/api/get_medical_meetings")
# def get_meetings():
#     meetings = [
#         {
#             "meeting_title": "Test Meeting Now",
#             "meeting_time": (datetime.utcnow() + timedelta(minutes=1)).strftime("%a, %d %b %Y %H:%M:%S GMT"),
#             "host_email": "host@example.com",
#             "participants": [{"email": "p1@example.com"}, {"email": "p2@example.com"}],
#         }
#     ]
#     return jsonify(meetings)

notified_meetings = set()

def meeting_reminder_cron():
    global notified_meetings
    try:
        res = requests.get("http://127.0.0.1:8001/api/get_medical_meetings")
        meetings = res.json()
        now = datetime.utcnow()

        for m in meetings:
            try:
                meeting_time = parsedate_to_datetime(m["meeting_time"])  # aware
                now = datetime.now(timezone.utc)  # make aware in UTC
                diff_minutes = (meeting_time - now).total_seconds() / 60

                meeting_id = m.get("meeting_title") + str(meeting_time)
                if 59 <= diff_minutes <= 60 and meeting_id not in notified_meetings:
                # if 0 <= diff_minutes <= 2 and meeting_id not in notified_meetings:  # test for meetings within next 2 minutes
                    webhook_url = "https://n8n-latest-h3pu.onrender.com/webhook/13ed840c-a10f-4a27-8e1e-9eb1283353b3"
                    requests.post(webhook_url, json={"meeting": m})
                    notified_meetings.add(meeting_id)
                    print(f"Webhook called for: {m['meeting_title']}")
            except Exception as e:
                print("Error parsing meeting time:", e)

    except Exception as e:
        print("Error in cron job:", e)

# ---------------- Scheduler ----------------
scheduler = BackgroundScheduler()
scheduler.add_job(func=meeting_reminder_cron, trigger="interval", minutes=1)
scheduler.start()

# ---------- App wiring ----------

app.register_blueprint(api_bp)

@atexit.register
def shutdown_db_client():
    logger.info("Closing MongoDB client...")
    client.close()




# @app.route('/api/schedule_meeting', methods=['POST'])
# def schedule_meeting():
#     data = request.get_json()
#     required_fields = ['name', 'email', 'demo_date', 'timezone', 'duration_minutes']
#     missing_fields = [field for field in required_fields if field not in data]
#     if missing_fields:
#         return jsonify({'error': f'Missing required fields: {", ".join(missing_fields)}'}), 400

#     try:
#         # Parse demo_date as datetime object
#         demo_date = datetime.datetime.fromisoformat(data['demo_date'])
#     except Exception as e:
#         return jsonify({'error': 'Invalid demo_date format. Use ISO 8601 format.'}), 400

#     # Create a simple demo_booking object as a dict
#     demo_booking = type('DemoBooking', (), {})()
#     demo_booking.name = data['name']
#     demo_booking.email = data['email']
#     demo_booking.demo_date = demo_date
#     demo_booking.timezone = data['timezone']
#     demo_booking.duration_minutes = int(data['duration_minutes'])
#     demo_booking.company = data.get('company')
#     demo_booking.phone = data.get('phone')
#     demo_booking.message = data.get('message')
#     demo_booking.id = data.get('id', 1)  # fallback id for requestId in event

#     calendar_service = GoogleCalendarService()
#     event_info = calendar_service.create_demo_event(demo_booking)

#     if event_info is None:
#         return jsonify({'error': 'Failed to create calendar event'}), 500

#     return jsonify({
#         'event_id': event_info['event_id'],
#         'meet_link': event_info['meet_link'],
#         'calendar_link': event_info['calendar_link']
#     })

# @app.route('/api/schedule_meeting', methods=['POST'])
# def schedule_meeting():
#     data = request.get_json()
#     required_fields = ['name', 'email', 'demo_date', 'duration_minutes']
#     missing_fields = [field for field in required_fields if field not in data]
#     if missing_fields:
#         return jsonify({'error': f'Missing required fields: {", ".join(missing_fields)}'}), 400

#     try:
#         iso_str = data['demo_date'].strip()
#         demo_date_utc = datetime.fromisoformat(iso_str)
#         if demo_date_utc.tzinfo is None:
#             demo_date_utc = demo_date_utc.replace(tzinfo=timezone.utc)
#     except ValueError:
#         # Try adding UTC timezone if parsing failed due to missing timezone
#         try:
#             if not iso_str.endswith("+00:00") and not iso_str.endswith("Z"):
#                 iso_str += "+00:00"
#             elif iso_str.endswith("Z"):
#                 iso_str = iso_str[:-1] + "+00:00"
#             demo_date_utc = datetime.fromisoformat(iso_str)
#             if demo_date_utc.tzinfo is None:
#                 demo_date_utc = demo_date_utc.replace(tzinfo=timezone.utc)
#         except Exception:
#             return jsonify({'error': 'Invalid demo_date format. Use ISO 8601 format like 2025-10-03T05:13:00.000Z'}), 400
#     except Exception:
#         return jsonify({'error': 'Invalid demo_date format. Use ISO 8601 format like 2025-10-03T05:13:00.000Z'}), 400

#     # Create a simple demo_booking object
#     demo_booking = type('DemoBooking', (), {})()
#     demo_booking.name = data['name']
#     demo_booking.email = data['email']
#     demo_booking.demo_date = demo_date_utc  # store UTC datetime
#     demo_booking.duration_minutes = int(data['duration_minutes'])
#     demo_booking.company = data.get('company')
#     demo_booking.phone = data.get('phone')
#     demo_booking.message = data.get('message')
#     demo_booking.id = data.get('id', 1)

#     calendar_service = GoogleCalendarService()
#     event_info = calendar_service.create_demo_event(demo_booking)

#     if event_info is None:
#         return jsonify({'error': 'Failed to create calendar event'}), 500

#     return jsonify({
#         'event_id': event_info['event_id'],
#         'meet_link': event_info['meet_link'],
#         'calendar_link': event_info['calendar_link']
#     })



@app.get("/")
async def test_home():
    return {"message": "Hello, world!"}






# Qustion
# - There is two .env file ?
    # - One is inside the ROOT_DIR or at current file location of trascription.py file



# load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
HF_TOKEN = os.getenv("HF_TOKEN")
# REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
REDIS_URL = os.getenv("REDIS_URL", "redis://default:ASFVAAImcDJjZjIwOWEzNTkxZmQ0MTQ1OGY1ODBiM2ZhNWE1MDkzY3AyODUzMw@relevant-stingray-8533.upstash.io:6379")

# Initialize Redis
try:
    r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    r.ping()
    message_queue = REDIS_URL
    logger.info("Redis connected, using message queue")
except Exception as e:
    message_queue = None
    r = None
    logger.warning(f"Redis not available: {e}, running without message queue")

# CORS(app, resources={r"/*": {"origins": "*"}})

# SocketIO
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='eventlet',
    ping_timeout=120,
    ping_interval=30,
    max_http_buffer_size=int(2e8),
    logger=True,
    engineio_logger=True,
    message_queue=message_queue,
    engineio_options={
        'ping_timeout': 120,
        'ping_interval': 30,
        'cors_allowed_origins': '*',
        'cors_credentials': False
    }
)

# Global variables
speaker_counter = 0
participants = []
current_time = 0.0
buffer_start_time = 0.0

# Audio buffer for diarization
audio_buffer = []
speakers_list = []  # List of (start, end, speaker)

# OpenAI client
client = OpenAI()

# Initialize pyannote speaker diarization pipeline
try:
    from pyannote.audio import Pipeline

    # Initialize the pipeline with Hugging Face token
    diarizer = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=HF_TOKEN)
    diarization_available = True
    logger.info("✅ Pyannote speaker diarization pipeline loaded")
except Exception as e:
    logger.warning(f"❌ Failed to load pyannote diarization pipeline: {e}")
    diarizer = None
    diarization_available = False

def diarize_audio():
    global audio_buffer, speakers_list, buffer_start_time, participants
    if not audio_buffer or not diarization_available:
        return

    try:
        print("\n🎯 Starting diarization process...")
        print(f"📋 Current participants: {participants}")
        
        # Concatenate audio bytes
        full_audio = b''.join(audio_buffer)
        # Convert to numpy array (assume PCM16, 16kHz)
        audio_np = np.frombuffer(full_audio, dtype=np.int16).astype(np.float32) / 32768.0
        print(f"🎤 Processing audio chunk of length: {len(audio_np)} samples")
        
        # Save temporary WAV file for NeMo
        import soundfile as sf
        temp_path = "temp_audio.wav"
        sf.write(temp_path, audio_np, 16000)
        print("💾 Temporary audio file saved for processing")
        
        # Run diarization
        print("🔍 Running pyannote speaker diarization...")
        diarization = diarizer(temp_path)
        print("✅ Diarization completed")

        # Extract speaker segments
        speakers_list = []
        for segment, _, speaker_label in diarization.itertracks(yield_label=True):
            start = segment.start
            end = segment.end
            # Adjust to absolute time
            start += buffer_start_time
            end += buffer_start_time
            # Map speaker label to participant name if available
            if participants and len(participants) > int(speaker_label.split('_')[-1]) - 1:
                speaker_name = participants[int(speaker_label.split('_')[-1]) - 1]
                print(f"🎯 Mapped speaker {speaker_label} to participant: {speaker_name}")
            else:
                speaker_name = speaker_label
                print(f"👤 Using label: {speaker_name}")
            speakers_list.append((start, end, speaker_name))
            print(f"⏱️  Added segment: {start:.2f}s - {end:.2f}s -> {speaker_name}")
        
        # Sort segments by start time
        speakers_list.sort(key=lambda x: x[0])
        print(f"\n📊 Total speaker segments identified: {len(speakers_list)}")
        for start, end, speaker in speakers_list[:3]:  # Show first 3 segments
            print(f"   {speaker}: {start:.2f}s - {end:.2f}s")
        if len(speakers_list) > 3:
            print(f"   ... and {len(speakers_list) - 3} more segments")
        
        logger.info(f"✅ Diarized {len(speakers_list)} speaker segments")

        # Emit diarization segments to frontend
        socketio.emit('diarization', {
            'segments': [{'start': start, 'end': end, 'speaker': speaker} for start, end, speaker in speakers_list]
        })
        print("📤 Emitted diarization segments to frontend")

        # Clean up temp file
        import os
        if os.path.exists(temp_path):
            os.remove(temp_path)
        print("🧹 Cleaned up temporary files")
        # Clear buffer after diarization
        audio_buffer.clear()
    except Exception as e:
        logger.error(f"❌ Diarization error: {e}")
        print(f"\n❌ Error during diarization: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        print("📜 Check logs for detailed error information")

def get_speaker_at_timestamp(timestamp):
    global speakers_list, participants, speaker_counter
    if not speakers_list:
        if participants:
            # If no diarization result yet but we have participants,
            # rotate through participants
            speaker_name = participants[speaker_counter % len(participants)]
            speaker_counter += 1
            return speaker_name
        return "Unknown Speaker"
        
    # Find the closest speaker segment
    closest_segment = None
    min_distance = float('inf')
    
    for start, end, speaker in speakers_list:
        if start <= timestamp <= end:
            return speaker
        
        # Calculate distance to segment
        distance = min(abs(timestamp - start), abs(timestamp - end))
        if distance < min_distance:
            min_distance = distance
            closest_segment = (start, end, speaker)
    
    # If we found a close segment within 2 seconds, use that speaker
    if closest_segment and min_distance < 2.0:
        return closest_segment[2]
        
    # Fallback to participant rotation if available
    if participants:
        speaker_name = participants[speaker_counter % len(participants)]
        speaker_counter += 1
        return speaker_name
        
    return "Unknown Speaker"

@socketio.on('connect')
def handle_connect():
    client_id = request.sid
    logger.info(f'✅ Client connected: {client_id}')
    emit('connected', {'status': 'Connected to OpenAI Realtime transcription server'})

@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    global current_time, buffer_start_time, audio_buffer, participants, speaker_counter
    client_id = request.sid

    try:
        # Extract audio data
        audio_data = data.get('audio')
        participants_data = data.get('participants', [])
        
        if participants_data:
            global participants
            participants = [p.get('name', f'Participant {i+1}') for i, p in enumerate(participants_data)]
        
        if audio_data is None:
            logger.error("❌ No audio data in payload")
            emit('error', {'error': 'No audio data received'})
            return
        
        # Handle base64 decoding
        audio_bytes = None
        if isinstance(audio_data, str):
            if audio_data.startswith('data:audio'):
                header, base64_data = audio_data.split(',', 1)
                audio_bytes = base64.b64decode(base64_data)
            else:
                audio_bytes = base64.b64decode(audio_data)
        else:
            logger.error("❌ Audio data is not a string")
            emit('error', {'error': 'Audio data must be base64 string'})
            return

        if len(audio_bytes) < 500:
            logger.warning(f"⚠️ Audio chunk too small: {len(audio_bytes)} bytes, skipping")
            return

        logger.info(f"🎵 Processing audio chunk: {len(audio_bytes)} bytes")

        # Calculate chunk duration (PCM16 16kHz)
        chunk_duration = len(audio_bytes) / 2 / 16000.0

        # Set buffer start time if buffer is empty
        if not audio_buffer:
            buffer_start_time = current_time

        # Append to buffer for diarization
        audio_buffer.append(audio_bytes)

        # Transcribe with Whisper
        try:
            # Create WAV from PCM16 16kHz mono
            wav_header = (
                b'RIFF' +
                (len(audio_bytes) + 36).to_bytes(4, 'little') +
                b'WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data' +
                len(audio_bytes).to_bytes(4, 'little')
            )
            wav_data = wav_header + audio_bytes

            with io.BytesIO(wav_data) as audio_file:
                audio_file.name = "audio.wav"
                result = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    response_format="json"
                )
                transcript = result.text.strip()
                # Detect language from text (simple check for Arabic)
                import re
                if re.search(r'[\u0600-\u06FF]', transcript):
                    detected_language = "ar"
                else:
                    detected_language = "en"

            if transcript:
                # Assign speaker
                speaker_name = get_speaker_at_timestamp(current_time)
                if speaker_name == "Unknown Speaker" and participants:
                    speaker_name = participants[speaker_counter % len(participants)]
                    speaker_counter += 1

                # Send to frontend
                socketio.emit('transcript', {
                    'text': transcript,
                    'speaker': speaker_name,
                    'is_final': True,
                    'language': 'en',
                    'timestamp': current_time
                })
                logger.info(f"📝 Transcribed: {transcript}")
        except Exception as e:
            logger.error(f"❌ Whisper transcription error: {e}")

        # Update current time after processing chunk
        current_time += chunk_duration

    except Exception as e:
        logger.error(f"❌ Audio chunk processing error: {str(e)}", exc_info=True)
        emit('error', {'error': f'Processing error: {str(e)}'})

@socketio.on('disconnect')
def handle_disconnect():
    client_id = request.sid
    logger.info(f'🔌 Client disconnected: {client_id}')



if __name__ == "__main__":
    import threading
    import time
    import os
    def diarization_worker():
        while True:
            time.sleep(2)
            diarize_audio()

    threading.Thread(target=diarization_worker, daemon=True).start()
    # port =int(os.environ.get("PORT", 0000))
    # logger.info(f"🚀 Starting Socket.IO server on 0.0.0.0:{port}")
    logger.info("🤖 Using OpenAI Whisper API for transcription")
    logger.info("👥 Speaker identification enabled")

    print(f"Render PORT variable: {os.environ.get('PORT')}")

    logger.info("Starting Flask-SocketIO development server...")
    print("Server running at: http://127.0.0.1:10000")
    socketio.run(app, host="0.0.0.0", port=10000, debug = False, allow_unsafe_werkzeug=True)
    