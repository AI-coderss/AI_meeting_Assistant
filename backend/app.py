import os
import json
import threading
import queue
from flask import Flask, request
from flask_sock import Sock
from google.cloud import speech
import time
import logging
import os
import tempfile
from google.cloud import speech

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Set Google credentials
# os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = r"D:\AI_meeting_Assistant\backend\meeting-assitent-doctor-4ba8ba3fe3f2.json"
# os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = r"E:\Medical Report\AI_meeting_Assistant\backend\meeting-assitent-doctor-7fca1bd4dcde.json"

# google_creds = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

# if google_creds:
#     # Write to a temp file
#     tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
#     tmp.write(google_creds.encode())
#     tmp.flush()
#     os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = tmp.name

# Initialize SpeechClient
client = speech.SpeechClient()



app = Flask(__name__)
sock = Sock(app)

# Language mapping
LANGUAGE_MAP = {
    'ar': 'ar-SA',
    'english': 'en-US',
    'french': 'fr-FR',
    'spanish': 'es-ES'
}

class StreamManager:
    def __init__(self):
        self.active = True
        self.lock = threading.Lock()
    
    def stop(self):
        with self.lock:
            self.active = False
    
    def is_active(self):
        with self.lock:
            return self.active

@sock.route('/ws/transcribe')
def transcribe(ws):
    logger.info("🔌 Client connected to Google STT")

    # Get language from query parameters or default to English
    language = request.args.get('lang', 'english').lower()
    language_code = LANGUAGE_MAP.get(language, 'en-US')
    
    logger.info(f"🎯 Using language: {language} (code: {language_code})")

    # Use thread-safe queue for audio chunks with max size
    audio_queue = queue.Queue(maxsize=100)
    stream_manager = StreamManager()

    # Configuration with dynamic language
    recognition_config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
        sample_rate_hertz=16000,
        language_code=language_code,
        enable_automatic_punctuation=True,
    )

    streaming_config = speech.StreamingRecognitionConfig(
        config=recognition_config,
        interim_results=True,
    )

    def request_generator():
        while stream_manager.is_active():
            try:
                # Get audio chunk with short timeout
                chunk = audio_queue.get(timeout=1.0)
                if chunk is None:  # Sentinel value to stop
                    break
                    
                yield speech.StreamingRecognizeRequest(audio_content=chunk)
                audio_queue.task_done()
                
            except queue.Empty:
                # Continue to check if stream is still active
                continue
            except Exception as e:
                logger.error(f"Generator error: {e}")
                break

    def listen_responses():
        try:
            requests = request_generator()
            responses = client.streaming_recognize(streaming_config, requests)
            
            for response in responses:
                if not stream_manager.is_active():
                    break
                    
                if not response.results:
                    continue
                    
                result = response.results[0]
                if result.alternatives:
                    transcript = result.alternatives[0].transcript
                    is_final = result.is_final
                    
                    logger.info(f"📝 Transcript: {transcript} (final: {is_final})")
                    
                    try:
                        ws.send(json.dumps({
                            "transcript": transcript,
                            "isFinal": is_final,
                            "language": language_code
                        }))
                    except Exception as e:
                        logger.error(f"WebSocket send error: {e}")
                        break
                        
        except Exception as e:
            logger.error(f"Google STT response error: {e}")
        finally:
            stream_manager.stop()

    # Start response thread
    response_thread = threading.Thread(target=listen_responses)
    response_thread.daemon = True
    response_thread.start()

    try:
        # Receive audio from frontend
        while stream_manager.is_active():
            try:
                message = ws.receive(timeout=1.0)
                if message is None:
                    logger.info("Client sent None, closing connection")
                    break
                
                # Add audio chunk to queue with timeout
                try:
                    audio_queue.put(message, timeout=1.0)
                except queue.Full:
                    logger.warning("Audio queue full, dropping chunk")
                    
            except Exception as e:
                # Check if it's a timeout (normal) or actual error
                if "timeout" not in str(e).lower() and "2000" not in str(e):
                    logger.error(f"WebSocket receive error: {e}")
                    break
                
    except Exception as e:
        logger.error(f"WebSocket main loop error: {e}")
    finally:
        logger.info("🔌 Client disconnected, cleaning up...")
        stream_manager.stop()
        
        # Wait for response thread to finish
        response_thread.join(timeout=3.0)
        
        logger.info("✅ Cleanup completed")

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return json.dumps({"status": "healthy", "service": "google_stt"})

if __name__ == "__main__":
    logger.info("🚀 Google STT Server starting on ws://localhost:5001/ws/transcribe")
    logger.info("🌍 Supported languages: %s", list(LANGUAGE_MAP.keys()))
    app.run(host="0.0.0.0", port=5001, debug=False)