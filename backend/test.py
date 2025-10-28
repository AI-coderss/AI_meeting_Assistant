from flask import Flask, request
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config['SECRET_KEY'] = 'supersecret'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

@app.route('/')
def index():
    return "Flask-SocketIO + Eventlet on Render!"

@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")
    emit("message", {"msg": "Connected successfully!"})

if __name__ == "__main__":
    # For local testing only
    socketio.run(app, host="0.0.0.0", port=5000)
