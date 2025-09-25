import { useState, useRef, useCallback } from "react";

export const useGoogleSTTTranscription = ({
  currentMeeting,
  setCurrentMeeting,
  showToast,
  transcript,
  setTranscript,
  participants,
  language,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const recordingRef = useRef(false);

  const safeToast = (msg, type = "info") =>
    showToast ? showToast(msg, type) : console.log(`[${type}]`, msg);

  const startLiveRecording = async () => {
    try {
      setIsRecording(true);
      recordingRef.current = true;
      setIsStreaming(true);
      setTranscript([]);

      console.log("🎙 Requesting microphone access...");
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      console.log("✅ Microphone access granted");
      streamRef.current = mediaStream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(mediaStream);
      const processor = audioCtx.createScriptProcessor(1024, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioCtx.destination);

      // Connect to Flask WebSocket
      const uri = "ws://localhost:5001/ws/transcribe"; // adjust if backend deployed
      wsRef.current = new WebSocket(uri);

      wsRef.current.binaryType = "arraybuffer";

      wsRef.current.onopen = () => {
        console.log("✅ Connected to Google STT proxy");
        safeToast("Connected to live transcription", "success");
      };

      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.transcript) {
          setTranscript((prev) => {
            const newSegment = {
              id: Date.now().toString(),
              text: data.transcript,
              timestamp: Date.now() / 1000,
              speaker: participants[0]?.name || "Speaker",
              is_final: data.isFinal,
            };

            if (data.isFinal) {
              return [...prev, newSegment];
            } else {
              const updated = [...prev];
              if (updated.length > 0 && !updated[updated.length - 1].is_final) {
                updated[updated.length - 1] = newSegment;
              } else {
                updated.push(newSegment);
              }
              return updated;
            }
          });
        }
      };

      wsRef.current.onerror = (err) => {
        console.error("❌ WebSocket error:", err);
        safeToast("WebSocket connection error", "error");
        setIsStreaming(false);
      };

      wsRef.current.onclose = () => {
        console.log("🔌 WebSocket closed");
        setIsStreaming(false);
      };

      processor.onaudioprocess = (e) => {
        if (!recordingRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const input = e.inputBuffer.getChannelData(0);
        const pcm16buf = float32ToPCM16(input);
       wsRef.current.send(new Uint8Array(pcm16buf));
      };
    } catch (err) {
      console.error("startLiveRecording error:", err);
      safeToast("Failed to start transcription", "error");
      stopLiveRecording();
    }
  };

  const stopLiveRecording = useCallback(() => {
    setIsRecording(false);
    recordingRef.current = false;
    console.log("🛑 Stopping recording...");

    cleanupAudio();

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const cleanupAudio = useCallback(() => {
    try {
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
        processorRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  }, []);

  return { transcript, setTranscript, isRecording, isStreaming, startLiveRecording, stopLiveRecording };
};

// Helper
function float32ToPCM16(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
