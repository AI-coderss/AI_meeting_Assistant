// src/hooks/useWebSocketTranscription.js
import { useState, useRef } from "react";
import { io } from "socket.io-client";

// const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const BACKEND_URL = "http://127.0.0.1:8001";
export const useWebSocketTranscription = ({ currentMeeting, setCurrentMeeting, showToast }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const wsRef = useRef(null);

  // ✅ Helper toast (fallback if showToast missing)
  const safeToast = (msg, type = "info") => {
    if (showToast) showToast(msg, type);
    else console.log(`[${type}]`, msg);
  };

  // Ensure meeting exists before starting
  const createMeetingIfNeeded = async () => {
    if (currentMeeting) return currentMeeting;

    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${BACKEND_URL}/api/meetings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: "Live Meeting",
          participants: [],
        }),
      });

      if (!res.ok) throw new Error(`Failed to create meeting: ${res.status}`);
      const data = await res.json();
      setCurrentMeeting(data);
      return data;
    } catch (err) {
      console.error("Error creating meeting:", err);
      safeToast("Error creating meeting", "error");
      throw err;
    }
  };

  const startLiveRecording = async () => {
    try {
      const meeting = await createMeetingIfNeeded();
      if (!meeting) return;

      setIsRecording(true);
      setIsStreaming(true);
      setTranscript([]);

      const token = localStorage.getItem("token");

      // ✅ connect to Flask-SocketIO
      wsRef.current = io(BACKEND_URL, {
        path: "/socket.io",
        transports: ["websocket"],
        auth: { token },
      });

      wsRef.current.on("connect", () => {
        console.log("✅ Connected to socket.io server");
        safeToast("Connected to live transcription", "success");

        // join the meeting room
        wsRef.current.emit("join_meeting", { meeting_id: meeting.id });
        setIsStreaming(false);
      });

      wsRef.current.on("transcript", (data) => {
        if (data.text) {
          const newSegment = {
            id: Date.now().toString(),
            text: data.text,
            timestamp: data.timestamp || Date.now() / 1000,
            speaker: data.speaker || "Speaker 1",
            is_final: data.is_final,
          };
          if (data.is_final) {
            setTranscript((prev) => [...prev, newSegment]);
          }
        }
      });

      wsRef.current.on("connect_error", (err) => {
        console.error("❌ Socket connection error:", err.message);
        safeToast("Socket connection failed", "error");
        setIsStreaming(false);
      });

      wsRef.current.on("disconnect", () => {
        console.log("🔌 Socket disconnected");
        setIsStreaming(false);
      });

    } catch (err) {
      console.error("startLiveRecording error:", err);
      safeToast("Failed to start live transcription", "error");
      setIsStreaming(false);
      setIsRecording(false);
    }
  };

  const stopLiveRecording = async () => {
    setIsRecording(false);

    if (wsRef.current) {
      wsRef.current.disconnect();
      wsRef.current = null;
    }

    if (transcript.length > 0 && currentMeeting) {
      try {
        const token = localStorage.getItem("token");
        await fetch(`${BACKEND_URL}/api/meetings/${currentMeeting.id}/transcript`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            meeting_id: currentMeeting.id,
            segments: transcript,
          }),
        });
        safeToast("Recording saved successfully", "success");
      } catch (error) {
        console.error("Error saving transcript:", error);
        safeToast("Failed to save transcript", "error");
      }
    }
  };

  return {
    transcript,
    setTranscript,
    isRecording,
    isStreaming,
    startLiveRecording,
    stopLiveRecording,
  };
};
