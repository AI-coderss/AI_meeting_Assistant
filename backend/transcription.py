# CRITICAL: eventlet.monkey_patch() MUST be first, before ANY other imports
import eventlet
eventlet.monkey_patch()

# Now safe to import everything else
import os
import base64
import requests
import logging
import json
from datetime import datetime
from tempfile import NamedTemporaryFile
from flask import Flask, request
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from dotenv import load_dotenv
import redis
import threading

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
TRANSCRIBE_MODEL = "whisper-1"
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

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

# Redis helper functions
def add_client(client_id):
    if r:
        try:
            r.hset("connected_clients", client_id, json.dumps({
                'connected_at': datetime.utcnow().isoformat(),
                'status': 'connected'
            }))
        except:
            pass

def remove_client(client_id):
    if r:
        try:
            r.hdel("connected_clients", client_id)
        except:
            pass

# Thread-safe processing state
processing_lock = threading.Lock()
processing_clients = set()

# Rate limiting
last_request_time = {}
MIN_REQUEST_INTERVAL = 0.5

def detect_language(audio_file_path: str) -> str:
    """Detect language from audio - returns 'en' on any error"""
    try:
        url = "https://api.openai.com/v1/audio/transcriptions"
        headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
        
        with open(audio_file_path, "rb") as audio_file:
            files = {"file": audio_file}
            data = {
                "model": TRANSCRIBE_MODEL, 
                "response_format": "verbose_json"
            }
            
            response = requests.post(url, headers=headers, files=files, data=data, timeout=30)
            
            if response.status_code == 200:
                result = response.json()
                language = result.get("language", "en")
                # Ensure ISO-639-1 format (2-letter code)
                if len(language) > 2:
                    # Map common full names to codes
                    lang_map = {
                        "english": "en",
                        "arabic": "ar",
                        "spanish": "es",
                        "french": "fr",
                        "german": "de"
                    }
                    language = lang_map.get(language.lower(), "en")
                logger.info(f"✅ Auto-detected language: {language}")
                return language
            else:
                logger.warning(f"Language detection failed: {response.status_code}, defaulting to 'en'")
                return "en"
                
    except Exception as e:
        logger.error(f"Language detection error: {str(e)}")
        return "en"

def transcribe_audio(file_path: str, language: str = None, translate: bool = False) -> dict:
    """Transcribe audio - returns dict with text key, never raises"""
    try:
        url = "https://api.openai.com/v1/audio/transcriptions"
        headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
        
        with open(file_path, "rb") as audio_file:
            files = {"file": audio_file}
            data = {"model": TRANSCRIBE_MODEL}
            if language:
                data["language"] = language
            if translate:
                data["prompt"] = "Translate to English"
            
            response = requests.post(url, headers=headers, files=files, data=data, timeout=30)
            
            if response.status_code == 200:
                result = response.json()
                return {"text": result.get("text", "")}
            else:
                logger.error(f"OpenAI API error: {response.status_code} - {response.text}")
                return {"text": ""}
                
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        return {"text": ""}

def get_ai_response(transcript: str, language: str) -> str:
    """Get AI response - returns empty string on error"""
    try:
        prompts = {
            'en': "You are a helpful assistant. Respond naturally and helpfully in English to the following:",
            'ar': "أنت مساعد مفيد. رد بطريقة طبيعية ومفيدة باللغة العربية على ما يلي:"
        }
        prompt = prompts.get(language, prompts['en'])
        
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json"
        }
        data = {
            "model": "gpt-4o",
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": transcript}
            ],
            "max_tokens": 150
        }
        
        response = requests.post(url, headers=headers, json=data, timeout=30)
        
        if response.status_code == 200:
            result = response.json()
            return result['choices'][0]['message']['content']
        else:
            logger.error(f"OpenAI Chat API error: {response.status_code}")
            return ""
            
    except Exception as e:
        logger.error(f"AI response error: {str(e)}")
        return ""

@socketio.on('start_audio')
def handle_start_audio(data):
    try:
        if not data or 'audio_length' not in data:
            emit('error', {'error': 'Missing audio length in start_audio message'})
            return
        emit('ready', {'status': 'Ready for audio chunks'})
    except Exception as e:
        logger.error(f"Start audio handling error: {str(e)}")
        emit('error', {'error': f'Start audio error: {str(e)}'})

@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    client_id = request.sid
    
    # Thread-safe recursion prevention
    with processing_lock:
        if client_id in processing_clients:
            logger.warning(f"⚠️ Client {client_id} already processing, skipping chunk")
            return
        processing_clients.add(client_id)
    
    try:
        current_time = datetime.now().timestamp()
        
        # Rate limiting
        if client_id in last_request_time:
            time_since_last = current_time - last_request_time[client_id]
            if time_since_last < MIN_REQUEST_INTERVAL:
                logger.warning(f"⚠️ Rate limit exceeded for client {client_id}")
                with processing_lock:
                    processing_clients.discard(client_id)
                return
        
        last_request_time[client_id] = current_time
        logger.info(f"🎯 Processing audio_chunk from {client_id}")
        logger.info(f"📦 Received data type: {type(data)}")
        
        # CRITICAL: Validate data structure
        if not isinstance(data, dict):
            logger.error(f"❌ Invalid data type: {type(data)}")
            emit('error', {'error': 'Invalid data format - expected dict'})
            with processing_lock:
                processing_clients.discard(client_id)
            return
        
        logger.info(f"📦 Data keys: {list(data.keys())}")
        
        # Extract audio data with validation
        audio_data = data.get('audio') or data.get('data')
        
        # CRITICAL: Check if audio_data is actually data, not a type
        if audio_data is None:
            logger.error("❌ No audio data in payload")
            emit('error', {'error': 'No audio data received'})
            with processing_lock:
                processing_clients.discard(client_id)
            return
        
        # Log the actual type we received
        logger.info(f"📦 Audio data type: {type(audio_data).__name__}")
        logger.info(f"📦 Audio data length: {len(audio_data) if isinstance(audio_data, (str, bytes)) else 'N/A'}")
        
        # Reject if it's not a string or bytes
        if not isinstance(audio_data, (str, bytes)):
            logger.error(f"❌ Audio data is type {type(audio_data).__name__}, expected str or bytes")
            emit('error', {'error': f'Invalid audio data type: {type(audio_data).__name__}'})
            with processing_lock:
                processing_clients.discard(client_id)
            return

        translate = data.get('translate', False)

        # Handle base64 decoding for string data
        if isinstance(audio_data, str):
            if audio_data.startswith('data:audio'):
                try:
                    # Extract base64 part after comma
                    base64_data = audio_data.split(',', 1)[1]
                    audio_bytes = base64.b64decode(base64_data)
                    logger.info(f"✅ Decoded base64 audio: {len(audio_bytes)} bytes")
                except Exception as e:
                    logger.error(f"❌ Base64 decode error: {str(e)}")
                    emit('error', {'error': f'Invalid audio format: {str(e)}'})
                    with processing_lock:
                        processing_clients.discard(client_id)
                    return
            else:
                # Try to decode as raw base64
                try:
                    audio_bytes = base64.b64decode(audio_data)
                    logger.info(f"✅ Decoded raw base64: {len(audio_bytes)} bytes")
                except Exception as e:
                    logger.error(f"❌ Not valid base64: {str(e)}")
                    emit('error', {'error': f'Audio data is not valid base64'})
                    with processing_lock:
                        processing_clients.discard(client_id)
                    return
        else:
            audio_bytes = audio_data
            logger.info(f"✅ Using raw bytes: {len(audio_bytes)} bytes")

        # Validate audio size
        if len(audio_bytes) < 100:
            logger.error(f"❌ Audio too small: {len(audio_bytes)} bytes")
            emit('error', {'error': f'Audio data too small: {len(audio_bytes)} bytes'})
            with processing_lock:
                processing_clients.discard(client_id)
            return

        # Process audio with temporary file
        with NamedTemporaryFile(delete=True, suffix=".ogg") as temp_audio:  # Changed from .webm to .ogg
            temp_audio.write(audio_bytes)
            temp_audio.flush()
            
            logger.info(f"💾 Saved temp file: {temp_audio.name} ({len(audio_bytes)} bytes)")

            # Detect language
            logger.info(f"🌍 Detecting language...")
            detected_language = detect_language(temp_audio.name)
            logger.info(f"🌍 Detected language: {detected_language}")

            # Transcribe
            logger.info(f"📝 Starting transcription...")
            result = transcribe_audio(temp_audio.name, language=detected_language, translate=translate)
            transcript_text = result.get("text", "").strip()
            logger.info(f"📝 Transcription result: '{transcript_text[:100] if transcript_text else '(empty)'}...'")

            if not transcript_text:
                logger.info("📝 No transcript text, sending empty response")
                emit('transcript', {
                    'text': '', 
                    'language': detected_language, 
                    'ai_response': ''
                })
                with processing_lock:
                    processing_clients.discard(client_id)
                return

            # AI response disabled - only showing transcription
            logger.info(f"✅ Transcription complete - sending to client")

            # Send successful response (no AI response)
            emit('transcript', {
                'text': transcript_text,
                'language': detected_language,
                'ai_response': ''  # Empty - no AI response
            })
            logger.info(f"✅ Successfully processed audio for {client_id}")

    except Exception as e:
        logger.error(f"❌ Audio chunk processing error: {str(e)}", exc_info=True)
        emit('error', {'error': f'Processing error: {str(e)}'})
    finally:
        # Always remove from processing set
        with processing_lock:
            processing_clients.discard(client_id)

@socketio.on('connect')
def handle_connect():
    client_id = request.sid
    add_client(client_id)
    logger.info(f'✅ Client connected: {client_id}')
    emit('connected', {'status': 'Connected to transcription server'})

@socketio.on('disconnect')
def handle_disconnect():
    try:
        client_id = request.sid
        remove_client(client_id)
        
        # Clean up
        with processing_lock:
            processing_clients.discard(client_id)
        
        if client_id in last_request_time:
            del last_request_time[client_id]
        
        logger.info(f'🔌 Client disconnected: {client_id}')
    except RuntimeError:
        # If request context is not available, just log
        logger.info('🔌 Client disconnected (no context available)')

@socketio.on_error_default
def default_error_handler(e):
    logger.error(f'❌ Socket error: {e}', exc_info=True)
    emit('error', {'error': str(e)})

if __name__ == '__main__':
    logger.info("🚀 Starting Socket.IO server on port 5001...")
    socketio.run(app, host='0.0.0.0', port=5001, debug=False)