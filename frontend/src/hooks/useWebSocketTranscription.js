import { useState, useRef } from "react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

export const useWebSocketTranscription = ({ currentMeeting, showToast }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const wsRef = useRef(null);

  const startLiveRecording = async (startRecordingFn) => {
    if (!currentMeeting) {
      showToast("No meeting found", "error");
      return;
    }

    setIsRecording(true);
    setTranscript([]);
    startRecordingFn();

    try {
      const wsUrl = `${BACKEND_URL.replace("http", "ws")}/api/meetings/${currentMeeting.id}/live-transcribe`;
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "transcript" && data.data.text) {
          const newSegment = {
            id: Date.now().toString(),
            text: data.data.text,
            timestamp: data.data.timestamp,
            speaker: "Speaker 1",
            confidence: 0.9,
            is_final: data.data.is_final,
          };

          if (data.data.is_final) {
            setTranscript((prev) => [...prev, newSegment]);
          }
        }
      };

      wsRef.current.onerror = (error) => {
        console.error("WebSocket error:", error);
        showToast("Live transcription error", "error");
      };
    } catch (error) {
      console.error("WebSocket connection error:", error);
      showToast("Failed to start live transcription", "error");
    }

    showToast("Live recording started", "success");
  };

  const stopLiveRecording = async (stopRecordingFn) => {
    setIsRecording(false);
    stopRecordingFn();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (transcript.length > 0 && currentMeeting) {
      try {
        await fetch(`${BACKEND_URL}/api/meetings/${currentMeeting.id}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meeting_id: currentMeeting.id,
            segments: transcript,
          }),
        });

        showToast("Recording saved successfully", "success");
      } catch (error) {
        console.error("Error saving transcript:", error);
        showToast("Failed to save transcript", "error");
      }
    }
  };

  return {
    transcript,
    setTranscript,
    isRecording,
    startLiveRecording,
    stopLiveRecording,
  };
};
