// src/hooks/useWebSocketTranscription.js
import { useState, useRef } from "react";
import { io } from "socket.io-client";

const BACKEND_URL = "https://ai-meeting-assistant-backend-suu9.onrender.com";

export const useWebSocketTranscription = ({
  currentMeeting,
  setCurrentMeeting,
  showToast,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);

  const recordingRef = useRef(false);

  const safeToast = (msg, type = "info") =>
    showToast ? showToast(msg, type) : console.log(`[${type}]`, msg);

  const createMeetingIfNeeded = async () => {
    if (currentMeeting) return currentMeeting;
    const token = localStorage.getItem("token");
    const res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: "Live Meeting", participants: [] }),
    });
    if (!res.ok) throw new Error(`Failed to create meeting: ${res.status}`);
    const data = await res.json();
    setCurrentMeeting(data);
    return data;
  };

  const startLiveRecording = async () => {
    try {
      const meeting = await createMeetingIfNeeded();
      if (!meeting) return;

      setIsRecording(true);
      recordingRef.current = true; // ✅ mark recording on
      setIsStreaming(true);
      setTranscript([]);

      console.log("🎙 Requesting microphone access...");
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      console.log("✅ Microphone access granted, stream:", mediaStream);
      streamRef.current = mediaStream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
      audioCtxRef.current = audioCtx;
      const actualRate = audioCtx.sampleRate;
      console.log("🎚 AudioContext started with sample rate:", actualRate);

      const source = audioCtx.createMediaStreamSource(mediaStream);
      const bufferSize = 4096;
      const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioCtx.destination); // 👈 ensure processor runs
      console.log("🔄 Processor connected to source");

      const token = localStorage.getItem("token");
      console.log("🌐 Connecting to socket.io backend...");
      wsRef.current = io(BACKEND_URL, {
        path: "/socket.io",
        transports: ["websocket"],
        auth: { token },
      });

      wsRef.current.on("connect", () => {
        console.log("✅ Connected to socket.io server");
        safeToast("Connected to live transcription", "success");
        setIsStreaming(true);
        wsRef.current.emit("join_meeting", {
          meeting_id: meeting.id,
          sample_rate: actualRate,
        });
        console.log("📨 Sent join_meeting with sample_rate:", actualRate);
      });

      wsRef.current.on("transcript_update", (data) => {
        console.log("📝 Transcript event received:", data);
        if (!data?.text) return;
        const newSegment = {
          id: Date.now().toString(),
          text: data.text,
          timestamp: data.timestamp || Date.now() / 1000,
          speaker: data.speaker || "Speaker 1",
          is_final: data.is_final,
        };
        if (data.is_final) setTranscript((prev) => [...prev, newSegment]);
      });

      wsRef.current.on("connect_error", (err) => {
        console.error("❌ Socket connection error:", err?.message || err);
        safeToast("Socket connection failed", "error");
        setIsStreaming(false);
      });

      wsRef.current.on("disconnect", () => {
        console.log("🔌 Socket disconnected");
        setIsStreaming(false);
      });

      processor.onaudioprocess = (e) => {
        if (
          !recordingRef.current ||
          !wsRef.current ||
          wsRef.current.disconnected
        ) {
          return;
        }
        const input = e.inputBuffer.getChannelData(0);
        console.log("🎤 Raw mic samples captured:", input.length);

        const pcm16buf = float32ToPCM16(input);
        const b64 = arrayBufferToBase64(pcm16buf);

        console.log("📦 Sending audio chunk:", {
          float32Length: input.length,
          pcm16Bytes: pcm16buf.byteLength,
          base64Length: b64.length,
        });

        wsRef.current.emit("audio_stream", {
          audio: b64,
          encoding: "linear16",
        });
      };
    } catch (err) {
      console.error("startLiveRecording error:", err);
      safeToast("Failed to start live transcription", "error");
      setIsStreaming(false);
      setIsRecording(false);
      recordingRef.current = false;
      cleanupAudio();
      if (wsRef.current) {
        wsRef.current.disconnect();
        wsRef.current = null;
      }
    }
  };

  const stopLiveRecording = async () => {
    setIsRecording(false);
    recordingRef.current = false; // ✅ mark recording off
    // console.log("🛑 Stopping live recording...");

    cleanupAudio();

    if (wsRef.current) {
      console.log("🔌 Disconnecting socket...");
      wsRef.current.disconnect();
      wsRef.current = null;
    }

    if (transcript.length > 0 && currentMeeting) {
      try {
        const token = localStorage.getItem("token");
        await fetch(
          `${BACKEND_URL}/api/meetings/${currentMeeting.id}/transcript`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              meeting_id: currentMeeting.id,
              segments: transcript,
            }),
          }
        );
        safeToast("Recording saved successfully", "success");
      } catch (error) {
        console.error("Error saving transcript:", error);
        safeToast("Failed to save transcript", "error");
      }
    }
  };

  const cleanupAudio = () => {
    try {
      if (processorRef.current) {
        try {
          processorRef.current.disconnect();
        } catch {}
        processorRef.current.onaudioprocess = null;
        processorRef.current = null;
      }
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch {}
        audioCtxRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    } catch {}
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

// ---- helpers ----
function float32ToPCM16(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let silenceCheck = 0;

  for (let i = 0; i < float32Array.length; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    silenceCheck += Math.abs(s);
  }

  if (silenceCheck === 0) {
    console.warn("⚠️ Silent buffer captured — no audio detected");
  }

  return buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
