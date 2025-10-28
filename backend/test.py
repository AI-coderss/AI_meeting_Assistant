# CRITICAL: eventlet.monkey_patch() MUST be first, before ANY other imports
import eventlet
eventlet.monkey_patch()

import logging
import os
import base64
import io
import threading
import time
import numpy as np
import torch
import soundfile as sf
from flask import Flask, request
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from dotenv import load_dotenv
import redis
from openai import OpenAI

# ------------------------
# Logging Configuration
# ------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ------------------------
# Load Environment Variables
# ------------------------
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
HF_TOKEN = os.getenv("HF_TOKEN")
REDIS_URL = os.getenv(
    "REDIS_URL",
    "redis://default:ASFVAAImcDJjZjIwOWEzNTkxZmQ0MTQ1OGY1ODBiM2ZhNWE1MDkzY3AyODUzMw@relevant-stingray-8533.upstash.io:6379"
)

# ------------------------
# Initialize Redis
# ------------------------
try:
    r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    r.ping()
    message_queue = REDIS_URL
    logger.info("✅ Redis connected, using message queue")
except Exception as e:
    r = None
    message_queue = None
    logger.warning(f"⚠️ Redis not available: {e}, running without message queue")

# ------------------------
# Flask App Setup
# ------------------------
app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
CORS(app, resources={r"/*": {"origins": "*"}})

# ------------------------
# SocketIO Setup
# ------------------------
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

# ------------------------
# Global Variables
# ------------------------
speaker_counter = 0
participants = []
current_time = 0.0
buffer_start_time = 0.0
audio_buffer = []
speakers_list = []

# ------------------------
# OpenAI Client
# ------------------------
client = OpenAI(api_key=OPENAI_API_KEY)

# ------------------------
# Pyannote Speaker Diarization Pipeline
# ------------------------
try:
    from pyannote.audio import Pipeline
    diarizer = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        use_auth_token=HF_TOKEN
    )
    diarization_available = True
    logger.info("✅ Pyannote speaker diarization pipeline loaded")
except Exception as e:
    diarizer = None
    diarization_available = False
    logger.warning(f"⚠️ Failed to load pyannote pipeline: {e}")

# ------------------------
# Helper Functions
# ------------------------
def diarize_audio():
    """Background worker for speaker diarization."""
    global audio_buffer, speakers_list, buffer_start_time, participants
    if not audio_buffer or not diarization_available:
        return

    try:
        full_audio = b''.join(audio_buffer)
        audio_np = np.frombuffer(full_audio, dtype=np.int16).astype(np.float32) / 32768.0

        temp_path = "temp_audio.wav"
        sf.write(temp_path, audio_np, 16000)

        diarization = diarizer(temp_path)
        speakers_list.clear()

        for segment, _, speaker_label in diarization.itertracks(yield_label=True):
            start = segment.start + buffer_start_time
            end = segment.end + buffer_start_time
            if participants and len(participants) > int(speaker_label.split('_')[-1]) - 1:
                speaker_name = participants[int(speaker_label.split('_')[-1]) - 1]
            else:
                speaker_name = speaker_label
            speakers_list.append((start, end, speaker_name))

        # Emit diarization to frontend
        socketio.emit('diarization', {
            'segments': [{'start': s, 'end': e, 'speaker': sp} for s, e, sp in speakers_list]
        })

        if os.path.exists(temp_path):
            os.remove(temp_path)
        audio_buffer.clear()

    except Exception as e:
        logger.error(f"❌ Diarization error: {e}", exc_info=True)

def get_speaker_at_timestamp(timestamp):
    """Return speaker at given timestamp or fallback."""
    global speakers_list, participants, speaker_counter
    if not speakers_list:
        if participants:
            speaker_name = participants[speaker_counter % len(participants)]
            speaker_counter += 1
            return speaker_name
        return "Unknown Speaker"

    closest_segment = None
    min_distance = float('inf')
    for start, end, speaker in speakers_list:
        if start <= timestamp <= end:
            return speaker
        distance = min(abs(timestamp - start), abs(timestamp - end))
        if distance < min_distance:
            min_distance = distance
            closest_segment = (start, end, speaker)

    if closest_segment and min_distance < 2.0:
        return closest_segment[2]

    if participants:
        speaker_name = participants[speaker_counter % len(participants)]
        speaker_counter += 1
        return speaker_name

    return "Unknown Speaker"

# ------------------------
# SocketIO Events
# ------------------------
@app.route('/')
def index():
    return "Socket.IO server with Whisper transcription and Pyannote diarization running!"

@socketio.on('connect')
def handle_connect():
    client_id = request.sid
    logger.info(f'✅ Client connected: {client_id}')
    emit('connected', {'status': 'Connected to transcription server'})

@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    """Process incoming audio chunks for transcription and diarization."""
    global current_time, buffer_start_time, audio_buffer, participants, speaker_counter
    try:
        audio_data = data.get('audio')
        participants_data = data.get('participants', [])

        if participants_data:
            participants[:] = [p.get('name', f'Participant {i+1}') for i, p in enumerate(participants_data)]

        if not audio_data:
            emit('error', {'error': 'No audio data received'})
            return

        # Decode base64 audio
        audio_bytes = base64.b64decode(audio_data.split(',')[1] if ',' in audio_data else audio_data)

        if len(audio_bytes) < 500:
            logger.warning("⚠️ Audio chunk too small, skipping")
            return

        chunk_duration = len(audio_bytes) / 2 / 16000.0
        if not audio_buffer:
            buffer_start_time = current_time
        audio_buffer.append(audio_bytes)

        # Whisper transcription
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
            speaker_name = get_speaker_at_timestamp(current_time)

            socketio.emit('transcript', {
                'text': transcript,
                'speaker': speaker_name,
                'is_final': True,
                'language': 'en',
                'timestamp': current_time
            })
        current_time += chunk_duration

    except Exception as e:
        logger.error(f"❌ Audio chunk processing error: {e}", exc_info=True)
        emit('error', {'error': f'Processing error: {str(e)}'})

@socketio.on('disconnect')
def handle_disconnect():
    client_id = request.sid
    logger.info(f'🔌 Client disconnected: {client_id}')

# ------------------------
# Background Diarization Worker
# ------------------------
def diarization_worker():
    while True:
        time.sleep(2)
        diarize_audio()

# ------------------------
# Main
# ------------------------
if __name__ == '__main__':
    # threading.Thread(target=diarization_worker, daemon=True).start()
    port = int(os.environ.get("PORT", 5000))
    logger.info("🤖 Using OpenAI Whisper API for transcription")
    logger.info("👥 Speaker identification enabled")
    print(f"🚀 Listening on 0.0.0.0:{port}")
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
