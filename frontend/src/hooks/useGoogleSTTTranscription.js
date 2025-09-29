import { useState, useRef, useCallback, useEffect } from "react";
import axios from "axios";

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
  const reconnectTimeoutRef = useRef(null);
  const connectionAttemptsRef = useRef(0);

  const safeToast = (msg, type = "info") =>
    showToast ? showToast(msg, type) : console.log(`[${type}]`, msg);

  // ✅ Function to create a new meeting if none exists
  const createNewMeeting = useCallback(async () => {
    try {
      console.log("📝 Creating new meeting for Arabic transcription...");

      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found");
      }

      const response = await axios.post(
        `${process.env.REACT_APP_BACKEND_URL}/api/meetings`,
        {
          title: `Arabic Meeting ${new Date().toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}`,
          participants: participants.map((p) => p.email),
          language: language,
          status: "in_progress",
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("✅ Meeting created successfully:", response.data);
      setCurrentMeeting(response.data);
      safeToast("New Arabic meeting created", "success");

      return response.data;
    } catch (error) {
      console.error("❌ Failed to create meeting:", error);
      safeToast(`Failed to create meeting: ${error.message}`, "error");
      throw error;
    }
  }, [participants, language, setCurrentMeeting, safeToast]);

  // ✅ Function to ensure we have a valid meeting
  const ensureMeetingExists = useCallback(async () => {
    if (currentMeeting && currentMeeting.id) {
      console.log("✅ Using existing meeting:", currentMeeting.id);
      return currentMeeting;
    }

    console.log("🆕 No current meeting, creating new one...");
    return await createNewMeeting();
  }, [currentMeeting, createNewMeeting]);

  // Enhanced cleanup function
  const cleanupAudio = useCallback(() => {
    try {
      // console.log("🧹 Cleaning up audio resources...");

      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
        processorRef.current = null;
      }

      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
        streamRef.current = null;
      }

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  }, []);

  useEffect(() => {
    return () => {
      // Only cleanup audio resources, no state/toasts
      cleanupAudio();
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // Create meeting if needed when language is Arabic and no current meeting
  useEffect(() => {
    const createIfNeeded = async () => {
      if (language === "ar" && !currentMeeting) {
        console.log("🆕 No current meeting for Arabic, creating new one...");
        await ensureMeetingExists();
      }
    };
    createIfNeeded();
  }, [language, currentMeeting, ensureMeetingExists]);

  const stopLiveRecording = useCallback(() => {
    // console.log("🛑 Stopping recording...");
    setIsRecording(false);
    recordingRef.current = false;
    setIsStreaming(false);

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: "stop" }));
        wsRef.current.close(1000, "Recording stopped");
      }
      wsRef.current = null;
    }

    cleanupAudio();
    safeToast("Recording stopped", "info");
  }, [cleanupAudio]); // removed safeToast dependency

  // Enhanced WebSocket connection with retry logic
  const connectWebSocket = useCallback(async () => {
    return new Promise((resolve, reject) => {
      try {
        // Clean up any existing connection first
        if (wsRef.current) {
          if (wsRef.current.readyState === WebSocket.OPEN) {
            console.log("✅ Using existing WebSocket connection");
            resolve();
            return;
          }
          // Close if in connecting or closing state
          wsRef.current.close(1000, "Reconnecting");
          wsRef.current = null;
        }

        const uri = `ws://localhost:5001/ws/transcribe?lang=${language}`;
        console.log(`🔌 Attempting to connect to ${uri}`);

        const ws = new WebSocket(uri);
        wsRef.current = ws;
        ws.binaryType = "arraybuffer";

        let resolved = false;
        let connectionTimeout = null;

        const cleanup = () => {
          if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            connectionTimeout = null;
          }
        };

        const successfulConnection = () => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve();
          }
        };

        const failedConnection = (error) => {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(error);
          }
        };

        // Set connection timeout (8 seconds)
        connectionTimeout = setTimeout(() => {
          failedConnection(
            new Error(
              "Connection timeout - Server may not be running on port 5001"
            )
          );
        }, 8000);

        ws.onopen = () => {
          console.log("✅ Connected to Google STT server");
          safeToast("Connected to live transcription", "success");
          setIsStreaming(true);
          connectionAttemptsRef.current = 0;
          successfulConnection();
        };

        ws.onmessage = (event) => {
          try {
            // Handle both binary and text messages
            let data;
            if (typeof event.data === "string") {
              data = JSON.parse(event.data);
            } else {
              // If binary data is received, convert to string first
              const textDecoder = new TextDecoder();
              const text = textDecoder.decode(event.data);
              data = JSON.parse(text);
            }

            if (data.error) {
              console.error("STT Error:", data.error);
              safeToast("Transcription error: " + data.error, "error");
              return;
            }

            if (data.transcript) {
              setTranscript((prev) => {
                const newSegment = {
                  id: Date.now().toString(),
                  text: data.transcript.trim(),
                  timestamp: Date.now() / 1000,
                  speaker: participants[0]?.name || "Speaker",
                  is_final: data.isFinal || false,
                };

                if (data.isFinal) {
                  // Add final transcript and remove any interim segments
                  const finalSegments = prev.filter((item) => item.is_final);
                  return [...finalSegments, newSegment];
                } else {
                  // Update interim transcript - keep only the latest interim
                  const finalSegments = prev.filter((item) => item.is_final);
                  return [...finalSegments, newSegment];
                }
              });
            }
          } catch (err) {
            console.error("Error parsing WebSocket message:", err);
            // Don't reject the connection for message parsing errors
          }
        };

        ws.onerror = (error) => {
          console.error("❌ WebSocket connection error:", error);
          // Note: The error event doesn't give much info, we'll rely on onclose for details
        };

        ws.onclose = (event) => {
          console.log(
            `🔌 WebSocket closed - Code: ${event.code}, Reason: "${event.reason}", Clean: ${event.wasClean}`
          );
          setIsStreaming(false);
          cleanup();

          // Analyze closure reason
          let errorMessage = "Connection closed";
          switch (event.code) {
            case 1000:
              errorMessage = "Connection closed normally";
              break;
            case 1006:
              errorMessage = "Connection failed - Server may not be running";
              break;
            case 1011:
              errorMessage = "Server error occurred";
              break;
            default:
              errorMessage = `Connection lost (code: ${event.code})`;
          }

          // Auto-reconnect logic
          if (recordingRef.current && event.code !== 1000) {
            connectionAttemptsRef.current++;

            if (connectionAttemptsRef.current <= 3) {
              console.log(
                `🔄 Attempting to reconnect... (attempt ${connectionAttemptsRef.current}/3)`
              );
              safeToast(
                `Reconnecting... (${connectionAttemptsRef.current}/3)`,
                "warning"
              );

              reconnectTimeoutRef.current = setTimeout(() => {
                connectWebSocket().catch(console.error);
              }, Math.min(3000 * connectionAttemptsRef.current, 10000)); // Max 10 second delay
            } else {
              console.error("Max reconnection attempts reached");
              safeToast(
                "Connection lost. Please check if the server is running and try again.",
                "error"
              );
              stopLiveRecording();
            }
          }

          if (!resolved) {
            failedConnection(new Error(errorMessage));
          } else if (recordingRef.current && event.code !== 1000) {
            // If connection drops after initial success, show toast
            safeToast("Transcription connection lost", "error");
          }
        };
      } catch (error) {
        console.error("Failed to create WebSocket:", error);
        reject(
          new Error(`Failed to create WebSocket connection: ${error.message}`)
        );
      }
    });
  }, [
    participants,
    setTranscript,
    safeToast,
    stopLiveRecording,
    setIsStreaming,
    language,
  ]);

  const startLiveRecording = async () => {
    try {
      console.log("🎙 Starting live recording...");

      // ✅ Ensure we have a meeting before starting
      await ensureMeetingExists();

      setIsRecording(true);
      recordingRef.current = true;
      setTranscript([]);
      connectionAttemptsRef.current = 0;

      // Connect WebSocket first
      await connectWebSocket();

      console.log("🎙 Requesting microphone access...");
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      console.log("✅ Microphone access granted");
      streamRef.current = mediaStream;

      // Create audio context
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
      audioCtxRef.current = audioCtx;

      // Resume audio context if suspended
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(mediaStream);
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioCtx.destination);

      processor.onaudioprocess = (e) => {
        if (
          !recordingRef.current ||
          !wsRef.current ||
          wsRef.current.readyState !== WebSocket.OPEN
        )
          return;

        const input = e.inputBuffer.getChannelData(0);

        // Compute volume
        const volume = Math.sqrt(
          input.reduce((sum, sample) => sum + sample * sample, 0) / input.length
        );

        // Skip very silent frames but still send small frames to prevent timeout
        if (volume < 0.001) return;

        const pcm16buf = float32ToPCM16(input);
        wsRef.current.send(pcm16buf);
      };

      safeToast("Recording started", "success");
    } catch (err) {
      console.error("startLiveRecording error:", err);
      safeToast(`Failed to start transcription: ${err.message}`, "error");
      stopLiveRecording();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // console.log("🧹 Cleaning up Google STT hook");
      stopLiveRecording();
    };
  }, [stopLiveRecording]);

  return {
    transcript,
    setTranscript,
    isRecording,
    isStreaming,
    startLiveRecording,
    stopLiveRecording,
  };
};

// Enhanced helper function with better error handling
function float32ToPCM16(float32Array) {
  try {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < float32Array.length; i++) {
      // Clamp the value between -1 and 1
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      // Convert to 16-bit PCM
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(i * 2, intSample, true); // little-endian
    }

    return buffer;
  } catch (error) {
    console.error("Error converting audio format:", error);
    return new ArrayBuffer(0);
  }
}
