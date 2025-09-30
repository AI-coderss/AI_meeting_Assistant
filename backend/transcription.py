# ---------------------------------
# eventlet must be first
import eventlet
eventlet.monkey_patch()
# ---------------------------------

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

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
TRANSCRIBE_MODEL = "gpt-4o-transcribe"
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Initialize Redis
r = redis.Redis.from_url(REDIS_URL, decode_responses=True)

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
    max_http_buffer_size=int(2e8),  # 200 MB
    logger=True,
    engineio_logger=True,
    message_queue=REDIS_URL,
    engineio_options={
        'cors_allowed_origins': '*',
        'cors_credentials': False
    }
)

# Redis helper functions
def add_client(client_id):
    r.hset("connected_clients", client_id, json.dumps({
        'connected_at': datetime.utcnow().isoformat(),
        'status': 'connected'
    }))

def remove_client(client_id):
    r.hdel("connected_clients", client_id)

def get_all_clients():
    clients = r.hgetall("connected_clients")
    return {k: json.loads(v) for k, v in clients.items()}

# ---------------------------------
# OpenAI transcription & AI response
# ---------------------------------
def detect_language(audio_file_path: str) -> str:
    try:
        url = "https://api.openai.com/v1/audio/transcriptions"
        headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
        with open(audio_file_path, "rb") as audio_file:
            files = {"file": audio_file}
            data = {"model": TRANSCRIBE_MODEL, "response_format": "verbose_json"}
            response = requests.post(url, headers=headers, files=files, data=data, timeout=30)
            if response.status_code != 200:
                logger.error(f"OpenAI API error: {response.status_code} - {response.text}")
                return None
            result = response.json()
            return result.get("language", "en")
    except Exception as e:
        logger.error(f"Language detection error: {str(e)}")
        return None

def transcribe_audio(file_path: str, language: str = None, translate: bool = False):
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
            if response.status_code != 200:
                logger.error(f"OpenAI API error: {response.status_code} - {response.text}")
                raise Exception(f"OpenAI API error: {response.status_code}")
            return response.json()
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        raise

def get_ai_response(transcript: str, language: str) -> str:
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
            "model": "gpt-3.5-turbo",
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": transcript}
            ],
            "max_tokens": 150
        }
        response = requests.post(url, headers=headers, json=data, timeout=30)
        if response.status_code != 200:
            logger.error(f"OpenAI Chat API error: {response.status_code} - {response.text}")
            raise Exception(f"OpenAI Chat API error: {response.status_code}")
        result = response.json()
        return result['choices'][0]['message']['content']
    except Exception as e:
        logger.error(f"AI response error: {str(e)}")
        raise

# ---------------------------------
# SocketIO events
# ---------------------------------
@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    try:
        client_id = request.sid
        if client_id not in get_all_clients():
            emit('error', {'error': 'Client not properly connected'})
            return

        if not data.get('audio'):
            emit('error', {'error': 'No audio data received'})
            return

        audio_data = data['audio']
        translate = data.get('translate', False)

        # Decode base64 audio
        if isinstance(audio_data, str) and audio_data.startswith('data:audio'):
            audio_bytes = base64.b64decode(audio_data.split(',')[1])
        else:
            audio_bytes = audio_data

        if len(audio_bytes) < 100:
            emit('error', {'error': 'Audio data too small'})
            return

        with NamedTemporaryFile(delete=True, suffix=".webm") as temp_audio:
            temp_audio.write(audio_bytes)
            temp_audio.flush()

            detected_language = detect_language(temp_audio.name)
            logger.info(f"Detected language: {detected_language}")

            try:
                result = transcribe_audio(temp_audio.name, language=None, translate=translate)
                transcript_text = result.get("text", "").strip()
            except Exception as e:
                emit('error', {'error': f'Transcription failed: {str(e)}'})
                return

            if not transcript_text:
                emit('transcript', {'text': '', 'language': detected_language, 'ai_response': ''})
                return

            ai_response = ""
            if detected_language and transcript_text:
                try:
                    ai_response = get_ai_response(transcript_text, detected_language)
                except Exception as e:
                    logger.error(f"AI response generation failed: {e}")
                    ai_response = "I understand, but I'm having trouble responding right now."

            emit('transcript', {
                'text': transcript_text,
                'language': detected_language,
                'ai_response': ai_response
            })

    except Exception as e:
        logger.error(f"Audio chunk processing error: {str(e)}")
        emit('error', {'error': f'Processing error: {str(e)}'})

@socketio.on('connect')
def handle_connect():
    client_id = request.sid
    add_client(client_id)
    logger.info(f'✅ Client connected: {client_id}')
    emit('connected', {'status': 'Connected to transcription server'})

@socketio.on('disconnect')
def handle_disconnect(sid=None):
    client_id = request.sid if sid is None else sid
    remove_client(client_id)


@socketio.on_error_default
def default_error_handler(e):
    logger.error(f'❌ Socket error: {e}')
    emit('error', {'error': str(e)})

# ---------------------------------
# Run server
# ---------------------------------
if __name__ == '__main__':
    logger.info("🚀 Starting Socket.IO server on port 5000...")
    socketio.run(app, host='0.0.0.0', port=5000, debug=False)
