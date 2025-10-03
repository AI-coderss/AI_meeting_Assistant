# # CRITICAL: eventlet.monkey_patch() MUST be first, before ANY other imports
# import eventlet
# eventlet.monkey_patch()

# # Now safe to import everything else
# import os
# import base64
# import logging
# import json
# from datetime import datetime
# from flask import Flask, request
# from flask_socketio import SocketIO, emit
# from flask_cors import CORS
# from dotenv import load_dotenv
# import redis
# import threading
# from io import BytesIO
# import subprocess
# import tempfile
# from openai import OpenAI  # IMPORT AT TOP LEVEL

# # Configure logging
# logging.basicConfig(level=logging.INFO)
# logger = logging.getLogger(__name__)

# # Load environment variables
# load_dotenv()
# OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
# TRANSCRIBE_MODEL = "whisper-1"
# REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# # Initialize OpenAI client globally
# openai_client = OpenAI(api_key=OPENAI_API_KEY)

# # Initialize Redis
# try:
#     r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
#     r.ping()
#     message_queue = REDIS_URL
#     logger.info("Redis connected, using message queue")
# except Exception as e:
#     message_queue = None
#     r = None
#     logger.warning(f"Redis not available: {e}, running without message queue")

# # Flask app
# app = Flask(__name__)
# app.config['SECRET_KEY'] = 'secret!'
# CORS(app, resources={r"/*": {"origins": "*"}})

# # SocketIO
# socketio = SocketIO(
#     app,
#     cors_allowed_origins="*",
#     async_mode='eventlet',
#     ping_timeout=120,
#     ping_interval=30,
#     max_http_buffer_size=int(2e8),
#     logger=True,
#     engineio_logger=True,
#     message_queue=message_queue,
#     engineio_options={
#         'ping_timeout': 120,
#         'ping_interval': 30,
#         'cors_allowed_origins': '*',
#         'cors_credentials': False
#     }
# )

# # Thread-safe processing state
# processing_lock = threading.Lock()
# processing_clients = set()

# # Rate limiting - REDUCED for faster response
# last_request_time = {}
# MIN_REQUEST_INTERVAL = 0.5  # Reduced from 1.0 to 0.5 seconds

# def get_language_name(lang_code):
#     """Get human-readable language name from code"""
#     lang_map = {
#         'en': 'English',
#         'ar': 'Arabic',
#         'ko': 'Korean',
#         'fr': 'French',
#         'de': 'German',
#         'es': 'Spanish',
#         'it': 'Italian',
#         'pt': 'Portuguese',
#         'ru': 'Russian',
#         'ja': 'Japanese',
#         'zh': 'Chinese',
#         # Add more as needed
#     }
#     return lang_map.get(lang_code, lang_code.upper())

# def convert_webm_to_wav(webm_bytes):
#     """Convert WebM bytes to WAV bytes using ffmpeg"""
#     try:
#         with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as webm_file:
#             webm_file.write(webm_bytes)
#             webm_path = webm_file.name

#         wav_path = webm_path.replace('.webm', '.wav')

#         cmd = [
#             'ffmpeg',
#             '-f', 'webm',
#             '-i', webm_path,
#             '-acodec', 'pcm_s16le',
#             '-ac', '1',
#             '-ar', '16000',
#             '-y',
#             wav_path
#         ]

#         result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)  # Reduced timeout

#         if result.returncode == 0 and os.path.exists(wav_path):
#             with open(wav_path, 'rb') as wav_file:
#                 wav_data = wav_file.read()

#             os.unlink(wav_path)
#             os.unlink(webm_path)

#             logger.info(f"✅ Converted WebM to WAV: {len(webm_bytes)} -> {len(wav_data)} bytes")
#             return wav_data
#         else:
#             logger.error(f"❌ FFmpeg conversion failed: {result.stderr}")
#             os.unlink(webm_path)
#             return webm_bytes

#     except Exception as e:
#         logger.error(f"❌ Conversion error: {str(e)}")
#         return webm_bytes

# def transcribe_audio_direct(audio_bytes):
#     """Direct transcription using OpenAI Whisper"""
#     try:
#         # Convert WebM to WAV for better OpenAI compatibility
#         converted_bytes = convert_webm_to_wav(audio_bytes)

#         # Create audio file from converted bytes
#         audio_file = BytesIO(converted_bytes)
#         audio_file.name = "audio.wav"

#         logger.info(f"📤 Sending to OpenAI Whisper: {len(converted_bytes)} bytes as WAV")
        
#         # Use verbose_json to get language detection
#         audio_file.seek(0)
#         transcript_response = openai_client.audio.transcriptions.create(
#             model=TRANSCRIBE_MODEL,
#             file=audio_file,
#             response_format="verbose_json",
#             temperature=0.0
#         )

#         transcript_text = transcript_response.text.strip()
#         detected_language = transcript_response.language or "en"
#         logger.info(f"📝 Transcription: '{transcript_text}' in {detected_language}")

#         return transcript_text, detected_language
        
#     except Exception as e:
#         logger.error(f"❌ Transcription error: {str(e)}")
#         return "", "en"

# @socketio.on('connect')
# def handle_connect():
#     client_id = request.sid
#     logger.info(f'✅ Client connected: {client_id}')
#     emit('connected', {'status': 'Connected to transcription server'})

# @socketio.on('audio_chunk')
# def handle_audio_chunk(data):
#     client_id = request.sid
    
#     # Thread-safe recursion prevention
#     with processing_lock:
#         if client_id in processing_clients:
#             logger.warning(f"⚠️ Client {client_id} already processing, skipping chunk")
#             return
#         processing_clients.add(client_id)
    
#     try:
#         current_time = datetime.now().timestamp()
        
#         # Rate limiting - less restrictive
#         if client_id in last_request_time:
#             time_since_last = current_time - last_request_time[client_id]
#             if time_since_last < MIN_REQUEST_INTERVAL:
#                 logger.warning(f"⚠️ Rate limit exceeded for client {client_id}, skipping")
#                 with processing_lock:
#                     processing_clients.discard(client_id)
#                 return
        
#         last_request_time[client_id] = current_time
        
#         # Extract audio data
#         audio_data = data.get('audio')
        
#         if audio_data is None:
#             logger.error("❌ No audio data in payload")
#             emit('error', {'error': 'No audio data received'})
#             with processing_lock:
#                 processing_clients.discard(client_id)
#             return
        
#         # Handle base64 decoding
#         audio_bytes = None
#         if isinstance(audio_data, str):
#             if audio_data.startswith('data:audio'):
#                 try:
#                     header, base64_data = audio_data.split(',', 1)
#                     audio_bytes = base64.b64decode(base64_data)
#                     logger.info(f"✅ Decoded base64 audio: {len(audio_bytes)} bytes")
#                 except Exception as e:
#                     logger.error(f"❌ Base64 decode error: {str(e)}")
#                     emit('error', {'error': f'Invalid audio format: {str(e)}'})
#                     with processing_lock:
#                         processing_clients.discard(client_id)
#                     return
#             else:
#                 try:
#                     audio_bytes = base64.b64decode(audio_data)
#                     logger.info(f"✅ Decoded raw base64: {len(audio_bytes)} bytes")
#                 except Exception as e:
#                     logger.error(f"❌ Not valid base64: {str(e)}")
#                     emit('error', {'error': f'Audio data is not valid base64'})
#                     with processing_lock:
#                         processing_clients.discard(client_id)
#                     return
#         else:
#             logger.error("❌ Audio data is not a string")
#             emit('error', {'error': 'Audio data must be base64 string'})
#             with processing_lock:
#                 processing_clients.discard(client_id)
#             return

#         # Reduced minimum audio size for faster response
#         if len(audio_bytes) < 500:  # Reduced from 1000
#             logger.warning(f"⚠️ Audio chunk too small: {len(audio_bytes)} bytes, skipping")
#             with processing_lock:
#                 processing_clients.discard(client_id)
#             return

#         logger.info(f"🎵 Starting transcription for {len(audio_bytes)} bytes...")
        
#         # Direct transcription
#         transcript_text, detected_language = transcribe_audio_direct(audio_bytes)

#         # Only process English and Arabic
#         if detected_language not in ['en', 'ar']:
#             logger.info(f"⚠️ Unsupported language detected: {detected_language}, skipping")
#             with processing_lock:
#                 processing_clients.discard(client_id)
#             return

#         # Generate AI response based on language
#         ai_response = transcript_text if transcript_text else ""

#         # Send response immediately
#         if transcript_text and transcript_text.strip():
#             logger.info(f"✅ Sending transcript: '{transcript_text}'")

#             emit('transcript', {
#                 'text': transcript_text,
#                 'language': detected_language,
#                 'language_name': 'English' if detected_language == 'en' else 'Arabic',
#                 'ai_response': ai_response
#             })

#             logger.info(f"🎉 Successfully sent transcript in {detected_language}")
#         else:
#             logger.warning("⚠️ Empty transcription received from OpenAI")
#             emit('transcript', {
#                 'text': '',
#                 'language': detected_language,
#                 'language_name': 'English' if detected_language == 'en' else 'Arabic',
#                 'ai_response': ''
#             })

#     except Exception as e:
#         logger.error(f"❌ Audio chunk processing error: {str(e)}", exc_info=True)
#         emit('error', {'error': f'Processing error: {str(e)}'})
#     finally:
#         # Always remove from processing set
#         with processing_lock:
#             processing_clients.discard(client_id)

# @socketio.on('disconnect')
# def handle_disconnect():
#     client_id = request.sid
#     logger.info(f'🔌 Client disconnected: {client_id}')

# if __name__ == '__main__':
#     logger.info("🚀 Starting Socket.IO server on port 5001...")
#     logger.info("🌍 Supported languages: English (en) and Arabic (ar)")
#     logger.info("💡 Optimized for real-time transcription")
#     socketio.run(app, host='0.0.0.0', port=5001, debug=True)

# CRITICAL: eventlet.monkey_patch() MUST be first, before ANY other imports
import eventlet
eventlet.monkey_patch()

# Now safe to import everything else
import os
import base64
import logging
import json
from datetime import datetime
from flask import Flask, request
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from dotenv import load_dotenv
import redis
import threading
from io import BytesIO
import subprocess
import tempfile
from openai import OpenAI  # IMPORT AT TOP LEVEL

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
TRANSCRIBE_MODEL = "whisper-1"
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Initialize OpenAI client globally
openai_client = OpenAI(api_key=OPENAI_API_KEY)

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

# Thread-safe processing state
processing_lock = threading.Lock()
processing_clients = set()

# Rate limiting - REDUCED for faster response
last_request_time = {}
MIN_REQUEST_INTERVAL = 0.3  # Further reduced from 0.5 to 0.3 seconds

def get_language_name(lang_code):
    """Get human-readable language name from code"""
    lang_map = {
        'en': 'English',
        'ar': 'Arabic',
    }
    return lang_map.get(lang_code, lang_code.upper())

def normalize_language_code(lang_input):
    """Normalize language code from various OpenAI responses"""
    if not lang_input:
        return "en"
    
    lang_str = str(lang_input).lower().strip()
    
    # Map full names to codes
    name_to_code = {
        'english': 'en',
        'arabic': 'ar', 
    }
    
    # If it's a full name, convert to code
    if lang_str in name_to_code:
        return name_to_code[lang_str]
    
    # If it's already a code, return it
    if lang_str in name_to_code.values():
        return lang_str
    
    # Default to English
    return "en"

def detect_audio_format(audio_bytes):
    """Detect the actual audio format from bytes"""
    if not audio_bytes or len(audio_bytes) < 4:
        return "unknown", "Too small to detect"
    
    # Check common audio file signatures
    signatures = {
        b'RIFF': 'wav',
        b'\xff\xfb': 'mp3',
        b'\xff\xf3': 'mp3', 
        b'\xff\xf2': 'mp3',
        b'OggS': 'ogg',
        b'fLaC': 'flac',
        b'\x1aE\xdf\xa3': 'webm',  # WebM/Matroska
        b'ftyp': 'mp4',  # MP4/M4A
        b'\x00\x00\x00\x18ftyp': 'mp4',
        b'\x00\x00\x00\x20ftyp': 'mp4',
        b'ID3': 'mp3',  # ID3 tag MP3
    }
    
    for signature, format_type in signatures.items():
        if audio_bytes.startswith(signature):
            return format_type, f"Detected {format_type.upper()} format"
    
    # Check for Opus in Ogg (common in WebRTC)
    if len(audio_bytes) > 40:
        # Look for OpusHead in bytes (common in WebRTC audio)
        if b'OpusHead' in audio_bytes[:100]:
            return 'opus', "Detected Opus audio in Ogg container"
        # Check for raw Opus without container
        if audio_bytes[:8] == b'OpusHead':
            return 'opus', "Detected raw Opus audio"
    
    return "unknown", "Unknown format - may be raw PCM or corrupted"

def validate_audio_data(audio_bytes):
    """Validate audio data before processing"""
    if not audio_bytes:
        return False, "No audio data"
    
    if len(audio_bytes) < 500:  # Reduced minimum size for faster response
        return False, f"Audio too small: {len(audio_bytes)} bytes"
    
    detected_format, format_info = detect_audio_format(audio_bytes)
    logger.info(f"🔍 Format detection: {format_info}")
    
    if detected_format == "unknown":
        return True, "Unknown format, will attempt processing"
    
    return True, f"Valid {detected_format.upper()} format"

def convert_audio_to_wav(audio_bytes):
    """Convert any audio format to WAV using ffmpeg"""
    try:
        # Validate input
        if not audio_bytes or len(audio_bytes) < 500:
            logger.warning("⚠️ Audio data too small or empty for conversion")
            return audio_bytes

        detected_format, format_info = detect_audio_format(audio_bytes)
        
        with tempfile.NamedTemporaryFile(suffix=f'.{detected_format if detected_format != "unknown" else "audio"}', delete=False) as input_file:
            input_file.write(audio_bytes)
            input_path = input_file.name

        wav_path = input_path.replace(f'.{detected_format}', '.wav') if detected_format != "unknown" else input_path + '.wav'

        # Try different ffmpeg approaches based on detected format
        commands = []
        
        if detected_format == "webm":
            commands = [
                # Try as WebM
                ['ffmpeg', '-f', 'webm', '-i', input_path, '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', '-y', wav_path],
                # Try as Matroska
                ['ffmpeg', '-f', 'matroska', '-i', input_path, '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', '-y', wav_path],
            ]
        elif detected_format == "opus":
            commands = [
                # Try as Opus in Ogg
                ['ffmpeg', '-f', 'ogg', '-i', input_path, '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', '-y', wav_path],
                # Try raw Opus
                ['ffmpeg', '-f', 'opus', '-i', input_path, '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', '-y', wav_path],
            ]
        else:
            # Generic conversion for unknown formats
            commands = [
                ['ffmpeg', '-i', input_path, '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', '-y', wav_path],
                ['ffmpeg', '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', input_path, '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', '-y', wav_path],
            ]

        for i, cmd in enumerate(commands):
            try:
                logger.info(f"🔄 Trying conversion approach {i+1}: {' '.join(cmd)}")
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=8)  # Reduced timeout
                
                if result.returncode == 0 and os.path.exists(wav_path):
                    with open(wav_path, 'rb') as wav_file:
                        wav_data = wav_file.read()
                    
                    # Cleanup
                    os.unlink(wav_path)
                    os.unlink(input_path)
                    
                    if len(wav_data) > 500:  # Reduced minimum WAV size
                        logger.info(f"✅ Converted audio to WAV: {len(audio_bytes)} -> {len(wav_data)} bytes")
                        return wav_data
                    else:
                        logger.warning(f"⚠️ Converted WAV file too small: {len(wav_data)} bytes")
                else:
                    if i == len(commands) - 1:  # Only log last attempt fully
                        logger.warning(f"⚠️ Conversion approach {i+1} failed: {result.stderr[:200]}...")
                    
            except subprocess.TimeoutExpired:
                logger.warning(f"⚠️ Conversion approach {i+1} timed out")
                continue
            except Exception as e:
                logger.warning(f"⚠️ Conversion approach {i+1} error: {e}")
                continue

        # If all conversions fail, return original but log the issue
        logger.warning(f"⚠️ All conversion attempts failed for {detected_format} format, using original")
        os.unlink(input_path)
        return audio_bytes

    except Exception as e:
        logger.error(f"❌ Conversion error: {str(e)}")
        # Cleanup on error
        try:
            if 'input_path' in locals() and os.path.exists(input_path):
                os.unlink(input_path)
            if 'wav_path' in locals() and os.path.exists(wav_path):
                os.unlink(wav_path)
        except:
            pass
        return audio_bytes

def transcribe_audio_direct(audio_bytes):
    """Direct transcription using OpenAI Whisper with better format handling"""
    try:
        # Always try to convert to WAV first for maximum compatibility
        converted_bytes = convert_audio_to_wav(audio_bytes)
        
        # Determine what we're sending to OpenAI
        detected_format, format_info = detect_audio_format(converted_bytes)
        
        if detected_format == "wav":
            # We have a proper WAV file
            audio_file = BytesIO(converted_bytes)
            audio_file.name = "audio.wav"
            logger.info(f"📤 Sending WAV to OpenAI: {len(converted_bytes)} bytes")
        else:
            # Conversion failed, try original with detected format
            audio_file = BytesIO(converted_bytes)
            extension = detected_format if detected_format != "unknown" else "webm"
            audio_file.name = f"audio.{extension}"
            logger.info(f"📤 Sending {extension.upper()} to OpenAI: {len(converted_bytes)} bytes")

        # Try transcription
        try:
            audio_file.seek(0)
            transcript_response = openai_client.audio.transcriptions.create(
                model=TRANSCRIBE_MODEL,
                file=audio_file,
                response_format="verbose_json",
                temperature=0.0
            )
            
            transcript_text = transcript_response.text.strip() if transcript_response.text else ""
            
            # Normalize language code - handle both "en" and "english" responses
            raw_language = getattr(transcript_response, 'language', None)
            detected_language = normalize_language_code(raw_language)
            
            if transcript_text:
                logger.info(f"📝 Transcription: '{transcript_text}' (raw language: {raw_language}, normalized: {detected_language})")
                return transcript_text, detected_language
            else:
                logger.warning("⚠️ Empty transcription received")
                return "", detected_language
                
        except Exception as api_error:
            logger.error(f"❌ OpenAI API error: {api_error}")
            return "", "en"
        
    except Exception as e:
        logger.error(f"❌ Transcription error: {str(e)}")
        return "", "en"

@socketio.on('connect')
def handle_connect():
    client_id = request.sid
    logger.info(f'✅ Client connected: {client_id}')
    emit('connected', {'status': 'Connected to transcription server'})

@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    client_id = request.sid
    
    # Faster thread-safe recursion prevention with timeout
    import time
    start_time = time.time()
    acquired_lock = False
    
    while time.time() - start_time < 0.5:  # 500ms timeout
        with processing_lock:
            if client_id not in processing_clients:
                processing_clients.add(client_id)
                acquired_lock = True
                break
        time.sleep(0.01)  # Small delay before retry
    
    if not acquired_lock:
        logger.warning(f"⚠️ Client {client_id} already processing, skipping chunk")
        return
    
    try:
        current_time = datetime.now().timestamp()
        
        # Less restrictive rate limiting
        if client_id in last_request_time:
            time_since_last = current_time - last_request_time[client_id]
            if time_since_last < MIN_REQUEST_INTERVAL:
                logger.debug(f"📊 Rate limit exceeded for client {client_id}, skipping")
                with processing_lock:
                    processing_clients.discard(client_id)
                return
        
        last_request_time[client_id] = current_time
        
        # Extract audio data
        audio_data = data.get('audio')
        
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
                    header, base64_data = audio_data.split(',', 1)
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
            logger.error("❌ Audio data is not a string")
            emit('error', {'error': 'Audio data must be base64 string'})
            with processing_lock:
                processing_clients.discard(client_id)
            return

        # Validate audio data
        is_valid, validation_msg = validate_audio_data(audio_bytes)
        if not is_valid:
            logger.error(f"❌ Invalid audio data: {validation_msg}")
            emit('error', {'error': f'Invalid audio data: {validation_msg}'})
            with processing_lock:
                processing_clients.discard(client_id)
            return

        logger.info(f"✅ Audio validation: {validation_msg}")

        # Minimum audio size check
        if len(audio_bytes) < 500:
            logger.warning(f"⚠️ Audio chunk too small: {len(audio_bytes)} bytes, skipping")
            with processing_lock:
                processing_clients.discard(client_id)
            return

        logger.info(f"🎵 Starting transcription for {len(audio_bytes)} bytes...")
        
        # Direct transcription
        transcript_text, detected_language = transcribe_audio_direct(audio_bytes)

        # Only process English and Arabic (with normalized codes)
        if detected_language not in ['en', 'ar']:
            logger.info(f"⚠️ Unsupported language detected: {detected_language}, skipping")
            with processing_lock:
                processing_clients.discard(client_id)
            return

        # Send response immediately
        if transcript_text and transcript_text.strip():
            logger.info(f"✅ Sending transcript: '{transcript_text}'")

            emit('transcript', {
                'text': transcript_text,
                'language': detected_language,
                'language_name': get_language_name(detected_language),
                'ai_response': transcript_text  # Echo the transcription for now
            })

            logger.info(f"🎉 Successfully sent transcript in {detected_language}")
        else:
            logger.warning("⚠️ Empty transcription received from OpenAI")
            emit('transcript', {
                'text': '',
                'language': detected_language,
                'language_name': get_language_name(detected_language),
                'ai_response': ''
            })

    except Exception as e:
        logger.error(f"❌ Audio chunk processing error: {str(e)}", exc_info=True)
        emit('error', {'error': f'Processing error: {str(e)}'})
    finally:
        # Always remove from processing set
        with processing_lock:
            processing_clients.discard(client_id)

@socketio.on('disconnect')
def handle_disconnect():
    client_id = request.sid
    logger.info(f'🔌 Client disconnected: {client_id}')

if __name__ == '__main__':
    logger.info("🚀 Starting Socket.IO server on port 5001...")
    logger.info("🌍 Supported languages: English (en) and Arabic (ar)")
    logger.info("💡 Optimized for real-time transcription")
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)