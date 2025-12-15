import os
import logging
import uuid
import json
import tempfile
import atexit
from pathlib import Path
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import List, Optional, Dict, Any,Union
from functools import wraps
import logging
import base64
# from pyannote.audio import Pipeline
# import torch
# Flask and extensions
from flask import Flask, Blueprint, request, jsonify, abort, stream_with_context
from werkzeug.utils import secure_filename
from flask_cors import CORS, cross_origin
# from flask_socketio import SocketIO, join_room, leave_room
# Pydantic
from pydantic import BaseModel, Field, ValidationError, EmailStr
from pydub import AudioSegment
import math
import subprocess
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


class ActionItem(BaseModel):
    task: str
    owner: Optional[str] = None
    due_date: Optional[str] = None
    note: Optional[str] = None
    completed: bool = False   # ✅ add this for checkbox state


class MeetingSummary(BaseModel):
    summary: str = ""
    key_points: List[str] = []
    action_items: List[ActionItem] = []
    decisions_made: List[str] = []


class Meeting(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    host: str = "Unknown"
    participants: List[str] = []
    transcript: List[TranscriptSegment] = []
    summary: MeetingSummary = Field(default_factory=MeetingSummary)
    duration: Optional[float] = None
    status: str = "active"


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

@api_bp.route("/meetings/<meeting_id>/action-items", methods=["PUT", "PATCH"])
@auth_required
def update_action_items(meeting_id):
    if not request.is_json:
        abort(400, description="Invalid content type, expected application/json")

    try:
        data = request.get_json()
        action_items = data.get("action_items")

        if action_items is None:
            abort(400, description="'action_items' field required")

        # ✅ Normalize items into full ActionItem format
        normalized_items = []
        for item in action_items:
            if isinstance(item, dict):
                normalized_items.append({
                    "task": item.get("task", ""),
                    "owner": item.get("owner"),
                    "due_date": item.get("due_date"),
                    "note": item.get("note"),
                    "completed": item.get("completed", False)
                })
            else:
                # old format: string-only items
                normalized_items.append({
                    "task": str(item),
                    "owner": None,
                    "due_date": None,
                    "note": None,
                    "completed": False
                })

        result = db.meetings.update_one(
            {"id": meeting_id},
            {"$set": {"summary.action_items": normalized_items}}
        )

        if result.matched_count == 0:
            abort(404, description=f"Meeting with ID {meeting_id} not found")

        updated_meeting = db.meetings.find_one({"id": meeting_id})

        return Response(dumps(updated_meeting), mimetype="application/json")

    except Exception as e:
        logger.error(f"❌ Error updating action items for meeting {meeting_id}: {str(e)}")
        abort(500, description=str(e))


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

@api_bp.route("/meetings/all", methods=["GET"])
@auth_required
def get_all_meetings():
    try:
        cur = db.meetings.find().sort("timestamp", DESCENDING)
        meetings = list(cur)
        return jsonify([Meeting(**m).model_dump() for m in meetings])
    except Exception as e:
        logger.error(f"Error fetching ALL meetings: {str(e)}")
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
        except:
            return jsonify({"error": "Invalid meeting_time format. Must be ISO 8601."}), 400

        # ✅ Validate agenda structure
        agenda_items = []
        for a in data["agenda"]:
            if "item" not in a or not a["item"].strip():
                return jsonify({"error": "Agenda item text required"}), 400

            if "speaker_email" not in a or not a["speaker_email"]:
                return jsonify({"error": "Speaker email required"}), 400

            if "time_offset" not in a or not isinstance(a["time_offset"], int):
                return jsonify({"error": "time_offset must be integer"}), 400

            # ✅ NEW: Capture speaker_name (optional but included if sent)
            speaker_name = a.get("speaker_name", "")

            # Calculate actual scheduled time
            agenda_start_time = meeting_time + timedelta(minutes=a["time_offset"])

            agenda_items.append({
                "item": a["item"].strip(),
                "speaker_email": a["speaker_email"],
                "speaker_name": speaker_name,   # ✅ Added here
                "time_offset": a["time_offset"],
                "scheduled_time": agenda_start_time
            })

        meeting_doc = {
            "meeting_title": data["meeting_title"],
            "meeting_type": data["meeting_type"],
            "meeting_time": meeting_time,
            "host_email": data["host_email"],
            "participants": data["participants"],
            "agenda": agenda_items,
            "created_at": datetime.utcnow()
        }

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
        except:
            print("❌ Failed to parse participants JSON")
            participants = []

        # 1️⃣ SAVE AUDIO
        upload_dir = "uploads"
        os.makedirs(upload_dir, exist_ok=True)
        audio_path = os.path.join(upload_dir, secure_filename(audio.filename))

        print("💾 Saving audio to:", audio_path)
        with open(audio_path, "wb") as f:
            import shutil
            shutil.copyfileobj(audio.stream, f)

        print("✅ Audio saved")

        # 2️⃣ COMPRESS AUDIO USING FFMPEG
        compressed_path = audio_path + "_compressed.mp3"
        print("🎧 Compressing audio...")

        try:
            subprocess.run([
                "ffmpeg", "-y",
                "-i", audio_path,
                "-vn",
                "-ac", "1",
                "-ar", "16000",
                "-b:a", "32k",
                compressed_path
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

            print("✅ Compression complete")
            audio_path = compressed_path

        except Exception as e:
            print("❌ Compression failed, using original audio:", e)

        # 3️⃣ LOAD AUDIO WITH PYDUB — REAL DURATION!
        audio_seg = AudioSegment.from_file(audio_path)
        audio_duration_sec = len(audio_seg) / 1000
        print(f"⏱ Actual duration: {audio_duration_sec:.2f} seconds")

        # For short recordings (< 4 min), don’t chunk
        if audio_duration_sec <= 240:
            print("⏳ Audio < 4 min → Using single chunk")
            chunk_paths = [audio_path]

        else:
            # 4️⃣ SAFE CHUNKING USING PYDUB
            print("🔪 Creating safe chunks (no silent segments)...")

            chunk_paths = []
            chunk_dir = os.path.join(upload_dir, "chunks")
            os.makedirs(chunk_dir, exist_ok=True)
            chunk_len_ms = 5 * 60 * 1000  # 5 minutes

            for idx in range(0, len(audio_seg), chunk_len_ms):
                chunk = audio_seg[idx : idx + chunk_len_ms]

                # Skip silence or tiny chunks
                if chunk.duration_seconds < 1 or chunk.dBFS < -40:
                    print("⏩ Skipping silent/empty chunk")
                    continue

                chunk_path = os.path.join(chunk_dir, f"chunk_{len(chunk_paths):03d}.mp3")
                chunk.export(chunk_path, format="mp3")
                chunk_paths.append(chunk_path)

        print(f"✅ Kept {len(chunk_paths)} valid chunks")

        if not chunk_paths:
            return jsonify({"error": "All chunks silent or empty"}), 500

        # 5️⃣ TRANSCRIBE + SUMMARIZE EACH CHUNK
        full_transcript = ""
        chunk_summaries = []

        for i, chunk in enumerate(chunk_paths):
            print(f"🎤 Transcribing chunk {i+1}/{len(chunk_paths)}: {chunk}")

            with open(chunk, "rb") as f:
                whisper_res = client.audio.transcriptions.create(
                    model="gpt-4o-transcribe",
                    file=f
                )

            chunk_text = whisper_res.text.strip()
            print(f"✅ Chunk {i+1} transcription length: {len(chunk_text)}")

            if len(chunk_text) < 5:
                print("⏩ Skipping empty transcription")
                continue

            full_transcript += "\n" + chunk_text

            # Summarize chunk safely
            print(f"🧠 Summarizing chunk {i+1}/{len(chunk_paths)}")

            res = client.chat.completions.create(
                model="gpt-5.1",
                messages=[
                    {
                        "role": "system",
                        "content": "Summarize strictly based on text only. Do not add anything not present."
                    },
                    {
                        "role": "user",
                        "content": f"Summarize this meeting segment:\n\n{chunk_text}"
                    }
                ]
            )

            chunk_summaries.append(res.choices[0].message.content)

        print("✅ All chunks processed")

        # 6️⃣ FINAL SUMMARY
        print("🤖 Creating final combined summary...")

        final_res = client.chat.completions.create(
            model="gpt-5.1",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a strict meeting summarizer. "
                        "Do NOT hallucinate. Only use information from the transcript."
                    )
                },
                {
                    "role": "user",
                    "content": (
                        "📌 IMPORTANT INSTRUCTIONS\n"
                        "- Return ONLY valid JSON\n"
                        "- No markdown, no backticks\n"
                        "- Follow schema strictly\n\n"
                        "{\n"
                        "  \"overview\": \"<4–7 sentence summary>\",\n"
                        "  \"action_items\": [\n"
                        "    {\"task\": \"\", \"owner\": \"\", \"due_date\": null, \"note\": \"\"}\n"
                        "  ],\n"
                        "  \"insights\": [\"\"],\n"
                        "  \"outline\": [\n"
                        "    {\"heading\": \"\", \"points\": [\"\", \"\", \"\"]}\n"
                        "  ]\n"
                        "}\n\n"
                        "Return ONLY valid JSON.\n\n"
                        "FULL TRANSCRIPT:\n"
                        + "\n".join(chunk_summaries)
                    )
                }
            ]
        )

        cleaned = (
            final_res.choices[0].message.content
            .replace("```json", "")
            .replace("```", "")
            .strip()
        )

        try:
            summary_data = json.loads(cleaned)
            print("✅ Final JSON parsed successfully")
        except:
            print("❌ Invalid JSON from GPT")
            summary_data = {"summary": "Invalid JSON", "raw_output": cleaned}

        summary_data["transcript"] = full_transcript

        print("✅ Returning response")
        return jsonify(summary_data)

    except Exception as e:
        print("🔥 UNHANDLED ERROR:", str(e))
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
- If any part of the transcript is in a non-English language, translate ONLY that text into English.
- Translation must preserve the meaning exactly and must NOT add extra details.
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
            model="gpt-5.1",
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

@app.route("/api/rtc-connect", methods=["POST"])
def rtc_connect():
    try:
        req = request.get_json()
        sdp_offer = req.get("sdp")
        meeting_context = req.get("meetingContext")

        if not sdp_offer:
            return jsonify({"error": "Missing SDP"}), 400

        # -------------------------
        # SYSTEM PROMPT
        # -------------------------
        system_prompt = f"""
        You are an AI Meeting Co-Pilot. As your mode of communication, you must always respond and communicate strictly in English, regardless of the language the user uses.

        IMPORTANT:
        - Welcome and Introduction: Greet the user and introduce yourself as their AI Meeting Co-Pilot.
        - Only speak in English. 
        - When calling set_field for the meeting time, ALWAYS output time in 24-hour format (HH:MM).
        - NEVER output AM/PM.
        - For datetime-local fields, the correct format is YYYY-MM-DDTHH:MM.
        - If user only provides time, output just HH:MM.
        - If user provides date and time together, output full datetime format.
        - Options for meeting type are [Consultation, Case Discussion,Follow-up,Team Meeting,Training Session]. Dont add anything other than this. 
        - Always keep your responses clear, concise, and helpful, and remember to stick to English in all replies.

        ======================
        MEETING CONTEXT (IMPORTANT)
        ======================
        The user is currently viewing or interacting with the following meeting:

        {meeting_context}

        You MUST use this meeting context when responding.

        If the user asks questions about:
        - transcript
        - summary
        - key points
        - action items
        - decisions
        - participants
        - agenda
        - metadata (title, host, time)

        then you MUST extract information strictly from **meeting_context**.

        If a detail does not exist in the context, say:
        “I could not find that information in the loaded meeting. Please check the Meeting History page.”

        Do NOT hallucinate missing details.
        Do NOT invent participants, decisions, or transcript lines.

        Your tasks:
        Scheduling New Meetings: Guide the user through scheduling a meeting. Ask them for details such as the meeting title, date and time, participants' names, emails, their positions, and the agenda.

        Summarizing Meetings: Offer to summarize the content of current or previous meetings. Use Meeting Context for this case

        Sharing Meeting Content: Help share meeting notes or summaries with other users as needed.

        Available tools:
        - set_meeting_title
        - set_meeting_type
        - set_meeting_datetime
        - add_participant
        - submit_meeting
        - remove_participant
        - add_agenda_item
        - delete_agenda_item
        - set_participant_field
        """

        # -------------------------
        # MEETING TOOLS
        # -------------------------
        tools = [
        {
        "type": "function",
        "name": "set_meeting_title",
        "description": "Set the meeting title field",
        "parameters": {
            "type": "object",
            "properties": {
            "value": { "type": "string" }
            },
            "required": ["value"]
        }
        },
        {
        "type": "function",
        "name": "set_meeting_type",
        "description": "Set the meeting type field",
        "parameters": {
            "type": "object",
            "properties": {
            "value": { "type": "string" }
            },
            "required": ["value"]
        }
        },
        {
        "type": "function",
        "name": "set_meeting_datetime",
        "description": "Set the meeting datetime-local field (YYYY-MM-DDTHH:MM)",
        "parameters": {
            "type": "object",
            "properties": {
            "value": { "type": "string" }
            },
            "required": ["value"]
        }
        },
        {
        "type": "function",
        "name": "add_participant",
        "description": "Add a new participant to the meeting",
        "parameters": {
            "type": "object",
            "properties": {
            "name": { "type": "string" },
            "email": { "type": "string" },
            "role": { "type": "string" }
            },
            "required": ["name", "email", "role"]
        }
        },
        {
        "type": "function",
        "name": "remove_participant",
        "description": "Remove an existing participant",
        "parameters": {
            "type": "object",
            "properties": {
            "index": { "type": "number" }
            },
            "required": ["index"]
        }
        },
        { "type": "function", "name": "set_participant_field", "description": "Set participant name/email/role", "parameters": { "type": "object", "properties": { "index": {"type": "number"}, "field": {"type": "string"}, "value": {"type": "string"} }, "required": ["index", "field", "value"] } },
        {
        "type": "function",
        "name": "add_agenda_item",
        "description": "Add a medical agenda item. Requires meeting date/time and at least 1 participant.",
        "parameters": {
            "type": "object",
            "properties": {
            "item": { "type": "string" },
            "minutes_into_meeting": { "type": "number" },
            "assigned_to": { "type": "string" }
            },
            "required": ["item", "minutes_into_meeting", "assigned_to"]
        }
        },
        {
        "type": "function",
        "name": "delete_agenda_item",
        "description": "Delete one agenda item",
        "parameters": {
            "type": "object",
            "properties": {
            "index": { "type": "number" }
            },
            "required": ["index"]
        }
        },
        {
            "type": "function",
            "name": "submit_meeting",
            "description": "Submit the entire meeting form",
            "parameters": {"type": "object", "properties": {}}
        }
    ]

        # -------------------------
        # CREATE SESSION (REST)
        # -------------------------
        session_payload = {
            "model": "gpt-4o-realtime-preview",
            "voice": "alloy",
            "instructions": system_prompt,
            "tools": tools,
            "tool_choice": "auto"
        }

        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json"
        }

        session_resp = requests.post(
            "https://api.openai.com/v1/realtime/sessions",
            headers=headers,
            json=session_payload,
            timeout=30
        )

        if not session_resp.ok:
            return jsonify({"error": "Failed to create realtime session"}), 500

        session_json = session_resp.json()
        ephemeral_token = session_json["client_secret"]["value"]

        # -------------------------
        # EXCHANGE SDP (REST)
        # -------------------------
        sdp_headers = {
            "Authorization": f"Bearer {ephemeral_token}",
            "Content-Type": "application/sdp"
        }

        answer = requests.post(
            "https://api.openai.com/v1/realtime",
            headers=sdp_headers,
            params={"model": "gpt-4o-realtime-preview", "voice": "alloy"},
            data=sdp_offer,
            timeout=60
        )

        if not answer.ok:
            return jsonify({"error": "SDP exchange failed"}), 500

        return Response(answer.content, mimetype="application/sdp")

    except Exception as e:
        print("RTC Error:", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/chat", methods=["POST"])
def chat_mode():
    data = request.json
    user_message = data.get("message", "")
    form_data = data.get("formData", {})
    meeting_context = data.get("meetingContext")
    today = datetime.now().strftime("%Y-%m-%d")
    now = datetime.now()
    current_year = now.year
    system_prompt = f"""
You are an AI Meeting Co-Pilot. Always reply in English.

======================
MEETING CONTEXT (IMPORTANT)
======================
The user is currently viewing or interacting with the following meeting:

{meeting_context}

You MUST use this meeting context when responding.

If the user asks questions about:
- transcript
- summary
- key points
- action items
- decisions
- participants
- agenda
- metadata (title, host, time)

then you MUST extract information strictly from **meeting_context**.

If a detail does not exist in the context, say:
“I could not find that information in the loaded meeting. Please check the Meeting History page.”

Do NOT hallucinate missing details.
Do NOT invent participants, decisions, or transcript lines.

======================
DATE HANDLING RULES
======================
Current Date Information:
- Today's date is {today}.
- The current year is {current_year}.
- If the user gives a date without a year, assume they mean {current_year}.
- Interpret “today”, “tomorrow”, “next Monday”, etc. relative to {today}.

======================
TIME FORMAT RULES
======================
- Always output time in 24-hour format (HH:MM).
- Never use AM/PM.
- Datetime-local fields must be formatted as YYYY-MM-DDTHH:MM.
- If the user only gives time → output HH:MM.
- If the user gives date + time → output full datetime.

======================
MEETING TYPE RULES
======================
Meeting type must be EXACTLY one of:
[Consultation, Case Discussion, Follow-up, Team Meeting, Training Session]

Never output anything outside this list.

======================
BEHAVIORAL INSTRUCTIONS
======================

1. **Scheduling New Meetings**
   - Guide the user through scheduling.
   - Ask for missing details: title, type, date/time, participants, emails, roles, agenda.
   - When the user provides required details, call the appropriate tool.

2. **Meeting Q&A**
   - When the user asks about the loaded meeting, answer using ONLY the meeting context.
   - You may extract, summarize, reformat, or clarify information from the context.

3. **Summarizing Meetings**
   - Provide bullet-point summaries, action items, insights, or transcript-derived answers.

4. **Sharing or Rewriting Content**
   - Rewrite summaries, improve clarity, answer questions about decisions, topics, or transcript.
   - Never add information not present in meeting_context.

======================
TOOL CALL RULES
======================
- When calling a tool, you MUST also generate a natural-language assistant message.
- Never return only a tool call.
- Never return an empty assistant message.
- Example: “Sure, I’ve scheduled the meeting for 2025-12-05 at 14:00.”

======================
RESPONSE FORMATTING RULES (VERY IMPORTANT)
======================
Always format your responses cleanly and professionally:

- Use paragraphs with spacing.
- Use bullet points for lists.
- Use numbered steps for processes.
- Use headers for sections.
- Add blank lines between sections.
- Never output long walls of text.
- Always keep structure clean, readable, and well-spaced.

Example formatting:

**Summary**
Here is the main explanation.

**Key Points**
- Point one  
- Point two  

**Steps**
1. Step one  
2. Step two  

Apply this style to ALL replies.

======================
AVAILABLE TOOLS
======================
- set_meeting_title
- set_meeting_type
- set_meeting_datetime
- add_participant
- remove_participant
- set_participant_field
- add_agenda_item
- delete_agenda_item
- submit_meeting
"""

    if not user_message:
        return jsonify({"error": "Message is required"}), 400

    def event_stream():
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        tool_call = None

        with client.responses.stream(
            model="gpt-5.1",
            instructions=(
                "When you call a tool, you MUST also output an assistant message. "
                "Never return only a tool call. "
                "Never return an empty assistant message."
            ),
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            tools= [
        {
        "type": "function",
        "name": "set_meeting_title",
        "description": "Set the meeting title field",
        "parameters": {
            "type": "object",
            "properties": {
            "value": { "type": "string" }
            },
            "required": ["value"]
        }
        },
        {
        "type": "function",
        "name": "set_meeting_type",
        "description": "Set the meeting type field",
        "parameters": {
            "type": "object",
            "properties": {
            "value": { "type": "string" }
            },
            "required": ["value"]
        }
        },
        {
        "type": "function",
        "name": "set_meeting_datetime",
        "description": "Set the meeting datetime-local field (YYYY-MM-DDTHH:MM)",
        "parameters": {
            "type": "object",
            "properties": {
            "value": { "type": "string" }
            },
            "required": ["value"]
        }
        },
        {
        "type": "function",
        "name": "add_participant",
        "description": "Add a new participant to the meeting",
        "parameters": {
            "type": "object",
            "properties": {
            "name": { "type": "string" },
            "email": { "type": "string" },
            "role": { "type": "string" }
            },
            "required": ["name", "email", "role"]
        }
        },
        {
        "type": "function",
        "name": "remove_participant",
        "description": "Remove an existing participant",
        "parameters": {
            "type": "object",
            "properties": {
            "index": { "type": "number" }
            },
            "required": ["index"]
        }
        },
        { "type": "function", "name": "set_participant_field", "description": "Set participant name/email/role", "parameters": { "type": "object", "properties": { "index": {"type": "number"}, "field": {"type": "string"}, "value": {"type": "string"} }, "required": ["index", "field", "value"] } },
        {
        "type": "function",
        "name": "add_agenda_item",
        "description": "Add a medical agenda item. Requires meeting date/time and at least 1 participant.",
        "parameters": {
            "type": "object",
            "properties": {
            "item": { "type": "string" },
            "minutes_into_meeting": { "type": "number" },
            "assigned_to": { "type": "string" }
            },
            "required": ["item", "minutes_into_meeting", "assigned_to"]
        }
        },
        {
        "type": "function",
        "name": "delete_agenda_item",
        "description": "Delete one agenda item",
        "parameters": {
            "type": "object",
            "properties": {
            "index": { "type": "number" }
            },
            "required": ["index"]
        }
        },
        {
            "type": "function",
            "name": "submit_meeting",
            "description": "Submit the entire meeting form",
            "parameters": {"type": "object", "properties": {}}
        }
    ],
            tool_choice="auto",
        ) as stream:

            for event in stream:

                # 🔹 Text token
                if event.type == "response.output_text.delta":
                    yield f"data: {json.dumps({'type': 'text', 'delta': event.delta})}\n\n"

                # 🔹 Tool call created
                elif (
                    event.type == "response.output_item.added"
                    and event.item.type == "function_call"
                ):
                    tool_call = {"name": event.item.name, "args": ""}

                # 🔹 Tool args streaming
                elif event.type == "response.function_call_arguments.delta":
                    tool_call["args"] += event.delta

                # 🔹 Tool call completed
                elif event.type == "response.function_call_arguments.done":
                    yield f"data: {json.dumps({'type': 'tool', 'tool': tool_call})}\n\n"

            # 🔹 Final signal
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        },
    )


@app.get("/")
async def test_home():
    return {"message": "Hello, world!"}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))  # Default to 5000 if not set

    logger.info("Starting Flask development server...")
    print(f"Server running at: https://ai-meeting-assistant-backend-suu9.onrender.com (Port: {port})")

    app.run(host="0.0.0.0", port=port, debug=True)
