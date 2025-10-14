import socketio
import base64
import time

# Create a Socket.IO client
sio = socketio.Client()

@sio.event
def connect():
    print("Connected to server")

@sio.event
def connected(data):
    print(f"Server response: {data}")

@sio.event
def transcript(data):
    print(f"Received transcript: {data}")

@sio.event
def error(data):
    print(f"Error: {data}")

@sio.event
def disconnect():
    print("Disconnected from server")

# Connect to the server (env: SOCKET_URL, default http://localhost:8001)
import os
socket_url = os.environ.get('SOCKET_URL', 'http://localhost:8001')
print(f"Connecting to {socket_url}")
sio.connect(socket_url)

# Wait a bit
time.sleep(2)

# Create dummy audio data (small PCM16 audio)
# This is just silence, but enough to test
dummy_audio = b'\x00\x00' * 1000  # 2000 bytes of silence
audio_b64 = base64.b64encode(dummy_audio).decode('utf-8')

# Send audio chunk
sio.emit('audio_chunk', {
    'audio': audio_b64,
    'participants': [{'name': 'Test User'}]
})

print("Sent dummy audio chunk")

# Wait for response
time.sleep(5)

# Disconnect
sio.disconnect()
