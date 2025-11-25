import os
import logging
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
# from pyannote.audio import Pipeline
# import torch
# Flask and extensions
from flask import Flask, Blueprint, request, jsonify, abort
from werkzeug.utils import secure_filename
from flask_cors import CORS, cross_origin
# from flask_socketio import SocketIO, join_room, leave_room
# Pydantic
from pydantic import BaseModel, Field, ValidationError, EmailStr

# MongoDB (PYMONGO SYNC)
from pymongo import MongoClient, ASCENDING, DESCENDING

# Auth deps
from passlib.hash import bcrypt
import jwt

# Third-party clients you already use
import openai
from openai import OpenAI
from deepgram import DeepgramClient
from google.cloud import speech
import threading
import asyncio
import requests
from bson.json_util import dumps
from flask import Response
from sendgrid.helpers.mail import Mail
# from google_speech import google_bp
from apscheduler.schedulers.background import BackgroundScheduler

# ---------- Configuration ----------

ROOT_DIR = Path(__file__).parent
from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY")
JWT_SECRET = os.environ.get("JWT_SECRET", "change_me_in_prod")
JWT_EXPIRES_MIN = int(os.environ.get("JWT_EXPIRES_MIN", "120"))
HF_TOKEN = os.getenv("HF_TOKEN")

openai.api_key = OPENAI_API_KEY
deepgram_client = DeepgramClient(api_key=DEEPGRAM_API_KEY)
# MongoDB SYNC client
mongo_url = os.environ["MONGO_URL"]
client = MongoClient(mongo_url)
db = client[os.environ["DB_NAME"]]
users_collection = db["users"]

# DIARIZATION_PIPELINE = Pipeline.from_pretrained(
#     "pyannote/speaker-diarization@2.1",
#     use_auth_token=HF_TOKEN
# )

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
# socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")  # keep your original

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------- Models ----------
class TranscriptSegment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    speaker: str = "Unknown"
    text: str


class MeetingSummary(BaseModel):
    summary: str = ""
    key_points: List[str] = []
    action_items: List[str] = []
    decisions_made: List[str] = []


class Meeting(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    host: str = "Unknown"
    participants: List[str] = []
    transcript: List[TranscriptSegment] = []
    summary: Optional[MeetingSummary] = Field(default_factory=MeetingSummary)
    duration: Optional[float] = None
    status: str = "active"  # active, completed, processing

class MeetingCreate(BaseModel):
    title: str
    host: str = "Unknown"
    participants: List[str] = []

# Auth models
class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: EmailStr
    password_hash: str
    roles: List[str] = ["viewer"]
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)

class UserCreate(BaseModel):
    name: str
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
            name=body.name,
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
        "user_id": user["id"],
        "name": user.get("name", "")
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

        transcript = data.get("transcript", [])
        summary_data = data.get("summary", "")

        summary_obj = {
            "summary": summary_data if isinstance(summary_data, str) else summary_data.get("summary", ""),
            "key_points": data.get("key_points", []),
            "action_items": data.get("action_items", []),
            "decisions_made": data.get("decisions_made", [])
        }

        if not transcript:
            abort(400, description="Missing 'transcript' field in request body")

        result = db.meetings.update_one(
            {"id": meeting_id},
            {"$set": {"transcript": transcript, "summary": summary_obj}}
        )

        if result.matched_count == 0:
            abort(404, description=f"Meeting with ID {meeting_id} not found")

        updated_meeting = db.meetings.find_one({"id": meeting_id})

        return Response(dumps(updated_meeting), mimetype="application/json")

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

        # MAIN FILTER:
        # 1. Host matches
        # 2. OR participants array contains the email
        query = {
            "$or": [
                {"host": {"$regex": host_name, "$options": "i"}},
                {"participants": {"$elemMatch": {"$regex": host_name, "$options": "i"}}}
            ]
        }

        # SEARCH FILTER (applies on top of the above)
        if search:
            query.setdefault("$and", []).append({
                "$or": [
                    {"title": {"$regex": search, "$options": "i"}},
                    {"summary": {"$regex": search, "$options": "i"}}
                ]
            })

        # PARTICIPANT FILTER (email string inside array)
        if participant:
            query.setdefault("$and", []).append({
                "participants": {"$elemMatch": {"$regex": participant, "$options": "i"}}
            })

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

#save meeting when scheduling
@app.route("/api/save_medical_meeting", methods=["POST"])
def save_medical_meeting():
    """
    Save medical meeting form data to MongoDB
    """
    try:
        data = request.get_json()

        # Include agenda as required
        required_fields = [
            "meeting_title",
            "meeting_type",
            "meeting_time",
            "host_email",
            "participants",
            "agenda" 
        ]

        missing = [f for f in required_fields if f not in data or not data[f]]
        if missing:
            return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

        # Validate meeting time
        try:
            meeting_time = datetime.fromisoformat(data["meeting_time"])
        except Exception:
            return jsonify({"error": "Invalid meeting_time format. Must be ISO 8601."}), 400

        # Build the meeting document
        meeting_doc = {
            "meeting_title": data["meeting_title"],
            "meeting_type": data["meeting_type"],
            "meeting_time": meeting_time,
            "host_email": data["host_email"],
            "participants": data["participants"],   
            "agenda": data["agenda"],              
            "created_at": datetime.utcnow()
        }

        # Insert into MongoDB
        result = db["medical_meetings"].insert_one(meeting_doc)

        return jsonify({
            "message": "Medical meeting saved successfully",
            "meeting_id": str(result.inserted_id)
        }), 201

    except Exception as e:
        logger.error(f"Error saving medical meeting: {e}")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/api/get_user_medical_meetings", methods=["GET"])
def get_user_medical_meetings():
    """
    Return medical meetings only for a specific user.
    Expected query param: ?email=user@example.com
    """
    try:
        email = request.args.get("email")

        if not email:
            return jsonify({"error": "Email query param is required"}), 400

        # Filter by created_by field
        meetings = list(
            db["medical_meetings"]
            .find({"host_email": email}, {"_id": 0})
            .sort("meeting_time", 1)
        )

        return jsonify(meetings), 200

    except Exception as e:
        print("Error fetching user meetings:", e)
        return jsonify({"error": str(e)}), 500


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

notified_meetings = set()

def meeting_reminder_cron():
    global notified_meetings
    try:
        res = requests.get("https://ai-meeting-assistant-backend-suu9.onrender.com/api/get_medical_meetings")
        meetings = res.json()
        now = datetime.utcnow()

        for m in meetings:
            try:
                meeting_time = parsedate_to_datetime(m["meeting_time"])  # aware
                now = datetime.now(timezone.utc)  # make aware in UTC
                diff_minutes = (meeting_time - now).total_seconds() / 60

                meeting_id = m.get("meeting_title") + str(meeting_time)
                if 9 <= diff_minutes <= 10 and meeting_id not in notified_meetings:
                # if 0 <= diff_minutes <= 2 and meeting_id not in notified_meetings:  # test for meetings within next 2 minutes
                    webhook_url = "https://n8n-latest-h3pu.onrender.com/webhook/5d86f865-1eab-41e6-bab0-bd8f26d36cf1"
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

# Initialize the new OpenAI client (v1.x+)
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
@app.route("/api/process-meeting", methods=["POST"])
def process_meeting():
    print("✅ /api/process-meeting CALLED")

    try:
        # 0️⃣ GET AUDIO FILE
        audio = request.files.get("audio_data")
        print("📥 Received audio:", audio.filename if audio else "None")

        if not audio:
            print("❌ No audio_data in request")
            return jsonify({"error": "No audio_data file found in request"}), 400

        participants_raw = request.form.get("participants", "[]")
        print("👥 Raw participants:", participants_raw)

        try:
            participants = json.loads(participants_raw)
        except Exception as e:
            print("❌ Failed to parse participants JSON:", e)
            participants = []

        # Save audio
        upload_dir = "uploads"
        os.makedirs(upload_dir, exist_ok=True)
        audio_path = os.path.join(upload_dir, secure_filename(audio.filename))

        print("💾 Saving audio to:", audio_path)

        with open(audio_path, "wb") as f:
            import shutil
            shutil.copyfileobj(audio.stream, f)

        print("✅ Audio saved")

        # 1️⃣ Send to external transcriber API
        transcribe_url = "https://test-medic-transcriber-latest.onrender.com/transcribe"
        print("🌐 Sending to transcriber API:", transcribe_url)

        try:
            with open(audio_path, "rb") as f:
                external_res = requests.post(
                    transcribe_url,
                    files={"audio_data": (audio.filename, f, audio.mimetype)},
                    timeout=600
                )
        except Exception as e:
            print("❌ Transcriber request ERROR:", type(e).__name__, str(e))
            raise

        print("🔁 Transcriber status:", external_res.status_code)

        if external_res.status_code != 200:
            print("❌ Transcriber returned:", external_res.text[:500])
            return jsonify({"error": "Transcription API failed", "details": external_res.text}), 500

        try:
            transcript_json = external_res.json()
            print("✅ Transcriber JSON received")
        except Exception as e:
            print("❌ Failed to parse transcriber JSON:", e)
            print("RAW RESPONSE:", external_res.text[:500])
            raise

        transcript = (
            transcript_json.get("transcript")
            or transcript_json.get("text")
            or transcript_json.get("full_transcript")
            or ""
        )

        print("📝 Transcript length:", len(transcript))

        if not transcript.strip():
            print("❌ Empty transcript returned")
            return jsonify({"error": "Transcription returned empty text"}), 500

        # 4️⃣ GPT SUMMARY
        print("🤖 Sending transcript to GPT...")

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": f"... transcript length {len(transcript)} ..."}]
        )

        print("✅ GPT response received")

        cleaned = (
            response.choices[0].message.content
            .replace("```json", "")
            .replace("```", "")
            .strip()
        )

        try:
            summary_data = json.loads(cleaned)
            print("✅ JSON parsed successfully")
        except Exception as e:
            print("❌ JSON parsing failed:", e)
            print("RAW GPT OUTPUT:", cleaned[:500])
            summary_data = {"summary": "GPT returned invalid JSON", "raw_output": cleaned}

        summary_data["transcript"] = transcript

        print("✅ Returning response")

        try: os.remove(audio_path)
        except: pass

        return jsonify(summary_data)

    except Exception as e:
        print("🔥 UNHANDLED ERROR:", type(e).__name__, str(e))
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route("/api/structured-transcript", methods=["POST"])
def structured_transcript():
    try:
        data = request.json
        transcript = data.get("transcript", "")
        participants = data.get("participants", [])

        if not transcript:
            return jsonify({"error": "Transcript missing"}), 400

        participant_context = "\n".join(
            [f"- {p.get('name')} ({p.get('role')})" for p in participants]
        )

        prompt = f"""
You are an expert meeting transcriber.

Your task:
- Read the participants list.
- Read the transcript lines.
- Assign the correct speaker to every line.
- Clean grammar ONLY if needed for clarity.
- DO NOT add, remove, or hallucinate content.
- DO NOT include timestamps.
- DO NOT summarize.
- DO NOT return any markdown.

Participants:
{participant_context}

Transcript:
{transcript}

You MUST return ONLY valid JSON in this EXACT format:
{{
  "structured_transcript": [
    {{
      "speaker": "<speaker name exactly>",
      "text": "<what the speaker said>"
    }}
  ]
}}
RULES:
- Always use the keys: speaker, text
- NEVER use keys like line, speech, or dialog
- NEVER include trailing spaces in keys or values
- NEVER wrap JSON in ```json
- NEVER add comments or explanations
- MUST be valid JSON parseable by Python

Return ONLY the JSON object defined above.
"""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}]
        )

        cleaned = (
            response.choices[0].message.content
            .replace("```json","")
            .replace("```","")
            .strip()
        )

        try:
            result = json.loads(cleaned)
        except:
            return jsonify({
                "error": "GPT returned invalid JSON",
                "raw_output": cleaned
            }), 500

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/")
async def test_home():
    return {"message": "Hello, world!"}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))  # Default to 5000 if not set

    logger.info("Starting Flask development server...")
    print(f"Server running at: https://ai-meeting-assistant-backend-suu9.onrender.com (Port: {port})")

    app.run(host="0.0.0.0", port=port, debug=True)
