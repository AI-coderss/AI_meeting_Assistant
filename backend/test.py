import eventlet
eventlet.monkey_patch()

from flask import Flask, request
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config['SECRET_KEY'] = 'supersecret'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

@app.route('/')
def index():
    return "Socket.IO running on Render with Eventlet!"

@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")
    emit("message", {"msg": "Connected successfully!"})

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)
