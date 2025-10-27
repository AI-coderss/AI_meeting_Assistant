# CRITICAL: eventlet.monkey_patch() MUST be first, before ANY other imports
import eventlet
eventlet.monkey_patch()

import logging
import os
import base64
from flask import Flask, request
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from dotenv import load_dotenv
import redis
from pyannote.audio import Pipeline
import torch
import numpy as np
import io
from openai import OpenAI

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()
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

# Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
CORS(app, resources={r"/*": {"origins": "*"}})

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

    
if __name__ == '__main__':
    import threading, time, os

    def diarization_worker():
        while True:
            time.sleep(2)
            diarize_audio()

    threading.Thread(target=diarization_worker, daemon=True).start()

    port = int(os.environ.get("PORT", 5000))
    # logger.info(f"🚀 Starting Socket.IO server on 0.0.0.0:{port}")
    logger.info("🤖 Using OpenAI Whisper API for transcription")
    logger.info("👥 Speaker identification enabled")
    import sys
    print(f"🚀 Listening on 0.0.0.0:{port}")
    sys.stdout.flush()
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)