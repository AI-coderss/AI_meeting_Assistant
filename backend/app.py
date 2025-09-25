import os
import json
import threading
from flask import Flask
from flask_sock import Sock
from google.cloud import speech

# Point to your Google Service Account JSON
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = r"E:\Medical Report\AI_meeting_Assistant\backend\meeting-assitent-doctor-7fca1bd4dcde.json"

client = speech.SpeechClient()

app = Flask(__name__)
sock = Sock(app)


@sock.route('/ws/transcribe')
def transcribe(ws):
    print("🔌 Client connected")

    requests = []

    # Define config once
    recognition_config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
        sample_rate_hertz=16000,
        language_code="ar-SA",
        enable_automatic_punctuation=True,
    )

    streaming_config = speech.StreamingRecognitionConfig(
        config=recognition_config,
        interim_results=True,
    )

    # Generator for audio chunks
    def request_generator():
        while True:
            if requests:
                chunk = requests.pop(0)
                yield speech.StreamingRecognizeRequest(audio_content=chunk)

    # Listen for responses in background thread
    def listen_responses(call):
        try:
            for response in call:
                for result in response.results:
                    transcript = result.alternatives[0].transcript
                    is_final = result.is_final
                    ws.send(json.dumps({
                        "transcript": transcript,
                        "isFinal": is_final
                    }))
        except Exception as e:
            print("Google STT error:", e)
            ws.close()

    # ✅ FIXED: pass both config and request generator
    call = client.streaming_recognize(config=streaming_config, requests=request_generator())

    # Start response listener thread
    response_thread = threading.Thread(target=listen_responses, args=(call,))
    response_thread.start()

    # Receive binary audio from frontend
    try:
        while True:
            message = ws.receive()
            if message is None:  # client disconnected
                break
            requests.append(message)
    except Exception as e:
        print("WebSocket closed:", e)
    finally:
        ws.close()
        print("🔌 Client disconnected")


if __name__ == "__main__":
    from gevent import pywsgi
    from geventwebsocket.handler import WebSocketHandler

    server = pywsgi.WSGIServer(("0.0.0.0", 5001), app, handler_class=WebSocketHandler)
    print("🚀 Server running on ws://localhost:5001/ws/transcribe")
    server.serve_forever()
