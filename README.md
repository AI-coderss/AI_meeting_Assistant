# 🎤 AI Meeting Assistant

An AI-powered platform designed to streamline meeting documentation. This assistant transcribes real-time or pre-recorded meetings, generates structured summaries using GPT-4o, and distributes them via webhook automation. It features a modern React.js frontend, Flask-SocketIO backend, MongoDB database, and integrations with Deepgram and OpenAI.

---

## 🚀 Tech Stack

| Layer        | Technology                                       |
|--------------|--------------------------------------------------|
| Frontend     | React.js, Zustand, CSS, Framer Motion (planned) |
| Backend      | Flask, Flask-SocketIO, AsyncIO, Pydantic        |
| Database     | MongoDB (via Motor async driver)                |
| AI Models    | OpenAI GPT-4o                                   |
| Audio Engine | Deepgram SDK (Real-time + Pre-recorded)         |
| Realtime     | Deepgram WebSocket + Flask-SocketIO             |
| Validation   | Pydantic                                        |
| Deployment   | ASGI-ready (Uvicorn recommended)                |

---

## 📁 Project Structure

```
ai-meeting-assistant/
├── backend/
│   ├── server.py               # Core Flask app with async SocketIO and Deepgram
│   ├── .env                    # Environment variables
├── frontend/
│   ├── public/
│   └── src/
│       ├── App.js              # Main app logic
│       ├── index.js            # Entry point
│       ├── hooks/             # Custom React hooks (state logic)
│       └── components/        # React UI components
├── README.md
```

---

## 🧠 Features

### 🔴 Live Meeting Transcription
- Real-time microphone recording via `ReactMediaRecorder`
- Audio sent to Flask via WebSocket
- Forwarded to Deepgram’s `LiveOptions`
- Returns partial and final transcripts in real time

### 📁 File-Based Transcription
- Upload `.mp3`, `.wav`, `.m4a`, `.mp4`
- Sent to `/api/meetings/<id>/transcribe-file`
- Deepgram `PrerecordedOptions` used
- Response includes diarized utterances

### 🤖 AI Summarization with GPT-4o
- Summarizes using structured JSON schema
- Sections:
  - Key Points
  - Decisions Made
  - Action Items
  - Assignees & Deadlines
  - AI & Attendee Recommendations
  - Follow-up Reminders
  - References
- Handles JSON parsing and error reporting if invalid

### 🔁 Webhook-Based Automation (Planned)
- Replace SendGrid with webhook automation
- After transcription is complete:
  - Automatically trigger summarization
  - Send structured summaries to attendees
- Webhook endpoint can notify internal CRM, ERP, or third-party services

### 🔐 User Authentication & Admin Dashboard (Planned)
- MongoDB-based user authentication system (no external auth providers)
- Login & registration with hashed password storage
- Admin dashboard to:
  - Add/manage users
  - Assign roles (admin, attendee, viewer)
  - View all meetings + summaries
- Only authorized users can access the platform

### 📬 (Deprecated) Email Distribution
- SendGrid is being phased out in favor of webhook automation

### 🗃️ Meeting History
- Search by title, host
- Filter by participant
- Displays meeting metadata
- View transcript + summary from past meetings

### ✨ Export Capabilities (Planned)
- PDF
- Word
- Copy to clipboard

---

## 🔐 Environment Variables (.env)

```env
# API Keys
OPENAI_API_KEY=sk-...
DEEPGRAM_API_KEY=...

# Database
MONGO_URL=mongodb+srv://...
DB_NAME=ai_meetings

# Flask
FLASK_SECRET_KEY=some_long_secret_key

# Frontend
REACT_APP_BACKEND_URL=http://localhost:8001
```

---

## 🧪 Running Locally

### 1. Backend (Python 3.10+)
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python server.py  # Or use: uvicorn server:app --host 0.0.0.0 --port 8001
```

### 2. Frontend (Node.js 16+)
```bash
cd frontend
npm install
npm start
```

---

## 🔌 API Endpoints

### 📡 WebSocket (via Flask-SocketIO)
- `join_meeting`: Initialize Deepgram connection
- `audio_stream`: Stream audio to Deepgram
- `disconnect`: Clean up Deepgram resources

### 📄 REST API
| Method | Endpoint                             | Description                           |
|--------|--------------------------------------|---------------------------------------|
| GET    | `/api/`                              | Root health/info                      |
| POST   | `/api/meetings`                      | Create new meeting                    |
| GET    | `/api/meetings`                      | List meetings (search/filter)        |
| GET    | `/api/meetings/<id>`                | Get specific meeting                 |
| POST   | `/api/meetings/<id>/transcript`     | Save transcript                      |
| POST   | `/api/meetings/<id>/transcribe-file`| Transcribe uploaded file             |
| POST   | `/api/meetings/<id>/summarize`      | Generate AI summary                  |

---

## 📦 Frontend Design

- Modular components: `Header`, `Tabs`, `LiveMeeting`, `UploadMeeting`, etc.
- Logic stored in `hooks/` like `useTranscript`, `useMeetings`, `useWebSocketTranscription`
- Zustand is optionally available for shared global state
- Dark mode support
- Responsive design with CSS Grid/Flex

---

## 🧰 Developer Notes

- All transcription and GPT calls are async and offloaded to threads
- WebSocket uses sid-to-Deepgram connection mapping
- MongoDB schema is Pydantic-based for data validation
- Temporary files are cleaned after transcription
- Errors logged via Python’s `logging` module
- Future N8N workflow automation to replace current email logic
- Planned user authentication via native MongoDB, not third-party providers

---

## 🤝 Contributing

### 🛠️ Workflow
```bash
git clone https://github.com/AI-coderss/AI_meeting_Assistant.git
cd ai-meeting-assistant
# Create feature branch
git checkout -b feat/your-feature
```

### 📐 Style Guidelines
- Backend: PEP8 + async conventions
- Frontend: ESLint + Prettier (auto-format)
- Commit messages: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)

### ✅ Testing (Planned)
- Unit tests for Flask routes and SocketIO handlers
- Jest/React Testing Library for UI

---

## 📬 Contact

Maintained by [Mohammed Bahageel](https://www.linkedin.com/in/mohammed-bahageel/)

📧 Reach out for collaboration, integration requests, or bug reports.

---

## 📄 License

This project is licensed under the **MIT License**. See the `LICENSE` file for details.
