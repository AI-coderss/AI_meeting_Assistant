import os
import json
import threading
import queue
from flask import Flask
from flask_sock import Sock
from google.cloud import speech
import time

# Set Google credentials
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = r"D:\AI_meeting_Assistant\backend\meeting-assitent-doctor-4ba8ba3fe3f2.json"

client = speech.SpeechClient()
app = Flask(__name__)
sock = Sock(app)

@sock.route('/ws/transcribe')
def transcribe(ws):
    print("🔌 Client connected to Google STT")

    # Use thread-safe queue for audio chunks
    audio_queue = queue.Queue()
    streaming_active = True

    # Configuration
    recognition_config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
        sample_rate_hertz=16000,
        language_code="ar-SA",  # Arabic Saudi Arabia
        enable_automatic_punctuation=True,
    )

    streaming_config = speech.StreamingRecognitionConfig(
        config=recognition_config,
        interim_results=True,
    )

    def request_generator():
        while streaming_active:
            try:
                # Get audio chunk with timeout
                chunk = audio_queue.get(timeout=1.0)
                yield speech.StreamingRecognizeRequest(audio_content=chunk)
            except queue.Empty:
                continue
            except Exception as e:
                print("Generator error:", e)
                break

    def listen_responses():
        try:
            requests = request_generator()
            responses = client.streaming_recognize(streaming_config, requests)
            
            for response in responses:
                if not response.results:
                    continue
                    
                result = response.results[0]
                if result.alternatives:
                    transcript = result.alternatives[0].transcript
                    is_final = result.is_final
                    
                    print(f"📝 Transcript: {transcript} (final: {is_final})")
                    
                    try:
                        ws.send(json.dumps({
                            "transcript": transcript,
                            "isFinal": is_final
                        }))
                    except Exception as e:
                        print("WebSocket send error:", e)
                        break
                        
        except Exception as e:
            print("Google STT response error:", e)
        finally:
            nonlocal streaming_active
            streaming_active = False

    # Start response thread
    response_thread = threading.Thread(target=listen_responses)
    response_thread.daemon = True
    response_thread.start()

    try:
        # Receive audio from frontend
        while True:
            message = ws.receive()
            if message is None:
                break
                
            # Add audio chunk to queue
            audio_queue.put(message)
            
    except Exception as e:
        print("WebSocket receive error:", e)
    finally:
        streaming_active = False
        try:
            ws.close()
        except:
            pass
        print("🔌 Client disconnected")



if __name__ == "__main__":
    print("🚀 Google STT Server starting on ws://localhost:5001/ws/transcribe")
    app.run(host="0.0.0.0", port=5001, debug=True)