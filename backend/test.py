import eventlet
eventlet.monkey_patch()

import logging
import os
import base64
from flask import Flask, request
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from dotenv import load_dotenv
import redis
from pyannote.audio import Pipeline
import torch
import numpy as np
import io
from openai import OpenAI
import threading, time
# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
HF_TOKEN = os.getenv("HF_TOKEN")
# REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
REDIS_URL = os.getenv("REDIS_URL", "redis://default:ASFVAAImcDJjZjIwOWEzNTkxZmQ0MTQ1OGY1ODBiM2ZhNWE1MDkzY3AyODUzMw@relevant-stingray-8533.upstash.io:6379")

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

@app.route('/')
def index():
    return "Socket.IO running on Render with Eventlet!"

@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")
    emit("message", {"msg": "Connected successfully!"})

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)
