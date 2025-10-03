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
import subprocess
from io import BytesIO

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

def detect_audio_format(audio_bytes):
    """Simple audio format detection based on magic bytes"""
    if len(audio_bytes) < 4:
        return "audio/webm"
    
    # Check for WebM (starts with 0x1A45DFA3)
    if audio_bytes[0:4] == b'\x1a\x45\xdf\xa3':
        return "audio/webm"
    # Check for OGG (starts with OggS)
    elif audio_bytes[0:4] == b'OggS':
        return "audio/ogg"
    # Check for WAV (starts with RIFF)
    elif audio_bytes[0:4] == b'RIFF':
        return "audio/wav"
    # Check for MP3 (starts with ID3)
    elif audio_bytes[0:3] == b'ID3':
        return "audio/mpeg"
    else:
        return "audio/webm"  # Default assumption

def get_file_extension(mime_type):
    """Map MIME type to file extension"""
    mime_to_ext = {
        'audio/webm': '.webm',
        'audio/ogg': '.ogg',
        'audio/wav': '.wav',
        'audio/mpeg': '.mp3',
        'audio/flac': '.flac',
        'audio/mp4': '.m4a',
        'audio/x-wav': '.wav'
    }
    return mime_to_ext.get(mime_type, '.webm')

def convert_webm_to_wav(webm_data):
    """Convert WebM/Opus to WAV format using ffmpeg"""
    try:
        # Create temporary files
        with NamedTemporaryFile(suffix='.webm', delete=False) as webm_file:
            webm_file.write(webm_data)
            webm_path = webm_file.name
        
        wav_path = webm_path.replace('.webm', '.wav')
        
        # Convert using ffmpeg
        cmd = [
            'ffmpeg', '-i', webm_path,
            '-acodec', 'pcm_s16le',  # 16-bit PCM
            '-ac', '1',              # Mono
            '-ar', '16000',          # 16kHz sample rate
            '-y',                    # Overwrite output
            wav_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        # Clean up webm file
        try:
            os.unlink(webm_path)
        except:
            pass
        
        if result.returncode == 0:
            # Read the converted WAV file
            with open(wav_path, 'rb') as wav_file:
                wav_data = wav_file.read()
            
            # Clean up WAV file
            try:
                os.unlink(wav_path)
            except:
                pass
            
            logger.info(f"✅ Successfully converted WebM to WAV: {len(webm_data)} -> {len(wav_data)} bytes")
            return wav_data
        else:
            logger.error(f"❌ FFmpeg conversion failed: {result.stderr}")
            return webm_data  # Fallback to original data
            
    except Exception as e:
        logger.error(f"❌ WebM to WAV conversion error: {str(e)}")
        return webm_data  # Fallback to original data

def convert_audio_to_wav(input_path, output_path):
    """Convert any audio format to WAV using ffmpeg"""
    try:
        cmd = [
            'ffmpeg', '-i', input_path,
            '-acodec', 'pcm_s16le',  # 16-bit PCM
            '-ac', '1',              # Mono
            '-ar', '16000',          # 16kHz sample rate
            '-y',                    # Overwrite output
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            logger.info(f"✅ Successfully converted audio to WAV")
            return True
        else:
            logger.error(f"❌ FFmpeg conversion failed: {result.stderr}")
            return False
    except Exception as e:
        logger.error(f"❌ Conversion error: {str(e)}")
        return False

def transcribe_audio_with_openai(audio_bytes, language=None):
    """Transcribe audio using OpenAI API with proper format handling"""
    try:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)
        
        # Convert WebM to WAV for better compatibility
        mime_type = detect_audio_format(audio_bytes)
        if mime_type == 'audio/webm':
            logger.info("🔄 Converting WebM to WAV for better compatibility...")
            audio_bytes = convert_webm_to_wav(audio_bytes)
            mime_type = 'audio/wav'
        
        # Create audio file with correct extension
        audio_file = BytesIO(audio_bytes)
        if mime_type == 'audio/wav':
            audio_file.name = "audio.wav"
        elif mime_type == 'audio/webm':
            audio_file.name = "audio.webm"
        elif mime_type == 'audio/mpeg':
            audio_file.name = "audio.mp3"
        else:
            audio_file.name = "audio.ogg"
        
        logger.info(f"📤 Sending to OpenAI: {len(audio_bytes)} bytes as {audio_file.name}")
        
        transcript = client.audio.transcriptions.create(
            model=TRANSCRIBE_MODEL,
            file=audio_file,
            language=language,
            response_format="text"
        )
        return transcript
        
    except Exception as e:
        logger.error(f"❌ OpenAI transcription error: {str(e)}")
        return ""

def transcribe_audio_direct(file_path: str, language: str = None, translate: bool = False) -> dict:
    """Transcribe audio directly without conversion - let OpenAI handle format detection"""
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
            
            file_size = os.path.getsize(file_path)
            logger.info(f"📤 Sending to OpenAI: {file_size} bytes")
            
            response = requests.post(url, headers=headers, files=files, data=data, timeout=30)
            
            if response.status_code == 200:
                result = response.json()
                text = result.get("text", "").strip()
                logger.info(f"✅ Transcription successful: '{text}'")
                return {"text": text}
            else:
                logger.error(f"❌ OpenAI API error: {response.status_code} - {response.text}")
                return {"text": ""}
                
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        return {"text": ""}

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
        
        # Validate data structure
        if not isinstance(data, dict):
            logger.error(f"❌ Invalid data type: {type(data)}")
            emit('error', {'error': 'Invalid data format - expected dict'})
            with processing_lock:
                processing_clients.discard(client_id)
            return
        
        # Extract audio data
        audio_data = data.get('audio') or data.get('data')
        
        if audio_data is None:
            logger.error("❌ No audio data in payload")
            emit('error', {'error': 'No audio data received'})
            with processing_lock:
                processing_clients.discard(client_id)
            return
        
        # Handle base64 decoding
        audio_bytes = None
        if isinstance(audio_data, str):
            if audio_data.startswith('data:audio'):
                try:
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

        # Try the new OpenAI client method first (with WebM conversion)
        try:
            from openai import OpenAI
            client = OpenAI(api_key=OPENAI_API_KEY)
            
            logger.info("🔄 Using new OpenAI client with format conversion...")
            transcript_text = transcribe_audio_with_openai(audio_bytes, language=None)
            
        except ImportError:
            logger.warning("⚠️ OpenAI package not available, falling back to requests method")
            # Fallback to the original method
            mime_type = detect_audio_format(audio_bytes)
            file_extension = get_file_extension(mime_type)
            
            # Save with correct extension
            with NamedTemporaryFile(delete=False, suffix=file_extension) as temp_audio:
                temp_audio.write(audio_bytes)
                temp_audio.flush()
                temp_path = temp_audio.name
                
                logger.info(f"💾 Saved temp file: {temp_path} ({len(audio_bytes)} bytes, {mime_type})")

                try:
                    # Try direct transcription first (WebM is supported by OpenAI)
                    logger.info(f"📝 Starting transcription...")
                    result = transcribe_audio_direct(temp_path, language=None, translate=False)
                    transcript_text = result.get("text", "").strip()
                    
                    if not transcript_text:
                        logger.info("🔄 Direct transcription failed, trying with language detection...")
                        # If direct fails, try with language detection
                        logger.info(f"🌍 Detecting language...")
                        detected_language = detect_language(temp_path)
                        logger.info(f"🌍 Detected language: {detected_language}")
                        
                        result = transcribe_audio_direct(temp_path, language=detected_language, translate=False)
                        transcript_text = result.get("text", "").strip()
                
                finally:
                    # Always clean up the temporary file
                    try:
                        os.unlink(temp_path)
                    except Exception as e:
                        logger.warning(f"Could not delete temp file: {e}")

        logger.info(f"📝 Transcription result: '{transcript_text if transcript_text else '(empty)'}'")

        # Send response
        emit('transcript', {
            'text': transcript_text,
            'language': 'en',  # Default for now
            'ai_response': ''  # Empty - no AI response
        })
        
        if transcript_text:
            logger.info(f"✅ Successfully processed audio for {client_id}")
        else:
            logger.info("📝 No transcript text, sent empty response")

    except Exception as e:
        logger.error(f"❌ Audio chunk processing error: {str(e)}", exc_info=True)
        emit('error', {'error': f'Processing error: {str(e)}'})
        emit('transcript', {
            'text': '',
            'language': 'en',
            'ai_response': ''
        })
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