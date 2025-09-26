// src/hooks/useDeepgramTranscription.js
import { useState, useRef, useCallback, useEffect } from "react";

export const useDeepgramTranscription = ({
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
  // const [transcript, setTranscript] = useState([]);
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
    const BACKEND_URL = "http://127.0.0.1:8001";
    const today = new Date();
    const formattedDate = today.toLocaleDateString("en-GB");
    const res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: `${formattedDate} - Live Meeting`,
        host: localStorage.getItem("email") || "Test Shah",
        participants: participants.map((p) => p.email),
      }),
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
      recordingRef.current = true;
      setIsStreaming(true);
      setTranscript([]);

      console.log("🎙 Requesting microphone access...");
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      console.log("✅ Microphone access granted");
      streamRef.current = mediaStream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(mediaStream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioCtx.destination);

      // Connect to Deepgram WebSocket
      const apiKey = process.env.REACT_APP_DEEPGRAM_API_KEY;
      if (!apiKey) {
        throw new Error("Deepgram API key not found");
      }
      // In your startLiveRecording function, enhance the Deepgram connection URI:
      const diarizeParam =
        participants.length > 0 ? "&diarize=true&utterances=true" : "";
      const model = language === "ar" ? "nova-3" : "nova-3";
      const uri = `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&interim=true&punctuate=true${diarizeParam}&model=${model}&language=${language}`;
      wsRef.current = new WebSocket(uri, ["token", apiKey]);

      wsRef.current.onopen = () => {
        console.log("✅ Connected to Deepgram");
        safeToast("Connected to live transcription", "success");
        setIsStreaming(true);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Deepgram response:", data);

          if (
            data.type === "Results" &&
            data.channel &&
            data.channel.alternatives &&
            data.channel.alternatives[0]
          ) {
            const transcriptText = data.channel.alternatives[0].transcript;
            const isFinal = data.is_final || false;

            let speakerId = "0";
            if (
              data.channel.alternatives[0].words &&
              data.channel.alternatives[0].words.length > 0
            ) {
              speakerId =
                data.channel.alternatives[0].words[0].speaker || speakerId;
            }

            // 🔹 Map Deepgram speakerId → participant name
            let speakerName = "Unknown Speaker";
            const speakerIndex = parseInt(speakerId, 10);

            if (!isNaN(speakerIndex) && participants[speakerIndex]) {
              speakerName = participants[speakerIndex].name;
            } else if (participants.length > 0) {
              // fallback to first participant if index missing
              speakerName = participants[0].name;
            }

            if (transcriptText && transcriptText.trim() !== "") {
              console.log(
                "📝 Transcript received:",
                transcriptText,
                "Speaker ID:",
                speakerId,
                "Final:",
                isFinal
              );

              setTranscript((prev) => {
                const newSegment = {
                  id: Date.now().toString(),
                  text: transcriptText,
                  timestamp: Date.now() / 1000,
                  speaker: speakerName,
                  is_final: isFinal,
                };

                if (isFinal) {
                  return [...prev, newSegment];
                } else {
                  const updated = [...prev];
                  if (
                    updated.length > 0 &&
                    !updated[updated.length - 1].is_final
                  ) {
                    updated[updated.length - 1] = newSegment;
                  } else {
                    updated.push(newSegment);
                  }
                  return updated;
                }
              });
            }
          }
        } catch (error) {
          console.error("Error processing Deepgram response:", error);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error("❌ WebSocket error:", error);
        safeToast("WebSocket connection error", "error");
        setIsStreaming(false);
      };

      wsRef.current.onclose = () => {
        console.log("🔌 WebSocket connection closed");
        setIsStreaming(false);
      };

      processor.onaudioprocess = (e) => {
        if (
          !recordingRef.current ||
          !wsRef.current ||
          wsRef.current.readyState !== WebSocket.OPEN
        ) {
          return;
        }

        const input = e.inputBuffer.getChannelData(0);
        const pcm16buf = float32ToPCM16(input);

        // Send raw PCM data to Deepgram
        wsRef.current.send(pcm16buf);
      };
    } catch (err) {
      console.error("startLiveRecording error:", err);
      safeToast("Failed to start live transcription", "error");
      setIsStreaming(false);
      setIsRecording(false);
      recordingRef.current = false;
      cleanupAudio();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    }
  };
  // Add this cleanup effect
  useEffect(() => {
    return () => {
      stopLiveRecording();
      cleanupAudio();
    };
  }, []);
  const stopLiveRecording = async () => {
    setIsRecording(false);
    recordingRef.current = false;
    // console.log("🛑 Stopping live recording...");

    cleanupAudio();

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Send CloseStream message to Deepgram
      wsRef.current.send(JSON.stringify({ type: "CloseStream" }));
      setTimeout(() => {
        wsRef.current.close();
        wsRef.current = null;
      }, 1000);
    }

    // Save transcript to backend if needed
    if (transcript.length > 0 && currentMeeting) {
      try {
        const token = localStorage.getItem("token");
        const BACKEND_URL = "http://127.0.0.1:8001";
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
              segments: transcript.filter((t) => t.is_final),
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

  return {
    transcript,
    setTranscript,
    isRecording,
    isStreaming,
    startLiveRecording,
    stopLiveRecording,
  };
};

// Helper functions
function float32ToPCM16(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}
