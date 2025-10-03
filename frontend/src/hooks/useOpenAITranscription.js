import { useState, useRef, useCallback, useEffect } from "react";
import io from "socket.io-client";

export const useOpenAITranscription = ({
  currentMeeting,
  setCurrentMeeting,
  showToast,
  transcript,
  setTranscript,
  participants,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const isRecordingRef = useRef(false);
  const connectionTimeoutRef = useRef(null);
  const socketRef = useRef(null);
  const cleanupRequestedRef = useRef(false);
  const componentMountedRef = useRef(true);
  const connectingRef = useRef(false);
  const chunkBufferRef = useRef([]);
  const sendIntervalRef = useRef(null);
  const lastSendTimeRef = useRef(0);

  useEffect(() => {
    componentMountedRef.current = true;
    return () => {
      componentMountedRef.current = false;
    };
  }, []);

  const initializeSocket = useCallback(() => {
    if (cleanupRequestedRef.current || !componentMountedRef.current) {
      console.log("🚫 Cleanup requested, skipping socket initialization");
      return null;
    }

    if (socketRef.current) {
      console.log("🔄 Cleaning up existing socket...");
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    console.log("🔄 Initializing new socket connection...");
    setIsConnecting(true);
    connectingRef.current = true;

    const socketUrl = "http://localhost:5001";
    console.log(`🔗 Connecting to: ${socketUrl}`);

    const newSocket = io(socketUrl, {
      transports: ["polling"],
      timeout: 15000,
      forceNew: true,
    });

    socketRef.current = newSocket;

    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }

    connectionTimeoutRef.current = setTimeout(() => {
      if (newSocket && !newSocket.connected && componentMountedRef.current) {
        console.error("❌ Connection timeout after 15 seconds");
        setIsConnecting(false);
        setIsConnected(false);
        showToast(
          "Connection timeout - check if backend server is running",
          "error"
        );

        if (socketRef.current === newSocket) {
          newSocket.removeAllListeners();
          newSocket.disconnect();
          socketRef.current = null;
        }
      }
    }, 15000);

    newSocket.on("connect", () => {
      if (!componentMountedRef.current) return;

      console.log("✅ Socket connected successfully");
      clearTimeout(connectionTimeoutRef.current);
      setIsConnected(true);
      setIsConnecting(false);
      connectingRef.current = false;
      showToast("Connected to transcription service", "success");
    });

    newSocket.on("connected", (data) => {
      if (!componentMountedRef.current) return;
      console.log("✅ Server acknowledged connection:", data);
    });

    newSocket.on("transcript", (data) => {
      if (!componentMountedRef.current) return;
      console.log("📝 Received transcript:", data);

      if (
        data.text &&
        data.text.trim() !== "" &&
        (data.language === "en" || data.language === "ar")
      ) {
        const newSegment = {
          id: `segment-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 9)}`,
          text: data.text,
          speaker: "Speaker",
          timestamp: new Date().toLocaleTimeString(),
          isAI: false,
          language: data.language,
          languageName:
            data.language_name ||
            (data.language === "en" ? "English" : "Arabic"),
        };

        setTranscript((prev) => [...prev, newSegment]);

        // Add AI response if available
        if (data.ai_response && data.ai_response.trim()) {
          const aiSegment = {
            id: `segment-${Date.now()}-${Math.random()
              .toString(36)
              .substr(2, 9)}`,
            text: data.ai_response,
            speaker: "AI",
            timestamp: new Date().toLocaleTimeString(),
            isAI: true,
            language: data.language,
            languageName:
              data.language_name ||
              (data.language === "en" ? "English" : "Arabic"),
          };
          setTranscript((prev) => [...prev, aiSegment]);
        }

        // Show language detection toast briefly
        if (data.languageName) {
          showToast(`Detected: ${data.languageName}`, "info", 1500);
        }
      }
    });

    newSocket.on("disconnect", (reason) => {
      if (!componentMountedRef.current) return;
      console.log("🔌 Socket disconnected:", reason);
      clearTimeout(connectionTimeoutRef.current);
      setIsConnected(false);
      setIsConnecting(false);
      setIsRecording(false);
      isRecordingRef.current = false;

      if (reason === "io server disconnect") {
        showToast("Server disconnected the connection", "warning");
      } else {
        showToast("Connection lost", "warning");
      }
    });

    newSocket.on("connect_error", (error) => {
      if (!componentMountedRef.current) return;
      console.error("❌ Socket connection error:", error);
      clearTimeout(connectionTimeoutRef.current);
      setIsConnected(false);
      setIsConnecting(false);
      connectingRef.current = false;

      let errorMessage = error.message;
      if (error.message.includes("ECONNREFUSED")) {
        errorMessage =
          "Cannot connect to server. Please ensure the backend is running on localhost:5001";
      }

      showToast(`Connection failed: ${errorMessage}`, "error");
    });

    newSocket.on("error", (error) => {
      if (!componentMountedRef.current) return;
      console.error("❌ Socket error:", error);
      showToast(
        `Socket error: ${error.message || JSON.stringify(error)}`,
        "error"
      );
    });

    return newSocket;
  }, [showToast, setTranscript]);

  // Function to send accumulated audio chunks
  const sendAccumulatedAudio = useCallback(() => {
    if (!socketRef.current || !socketRef.current.connected) {
      console.log("⚠️ Socket not connected, skipping send");
      return;
    }

    if (chunkBufferRef.current.length === 0) {
      return;
    }

    const now = Date.now();
    // Send more frequently - every 1.5 seconds minimum
    if (now - lastSendTimeRef.current < 1500) {
      return;
    }

    // Combine all chunks into one blob
    const combinedBlob = new Blob(chunkBufferRef.current, {
      type: "audio/webm;codecs=opus",
    });

    // Reduced minimum size for faster response
    if (combinedBlob.size < 5000) {
      // Reduced from 30000
      console.log(
        `⚠️ Audio too small (${combinedBlob.size} bytes), waiting for more`
      );
      return;
    }

    console.log("📤 Sending accumulated audio:", {
      chunks: chunkBufferRef.current.length,
      totalSize: combinedBlob.size,
      duration: `${(combinedBlob.size / 16000).toFixed(2)}s estimated`,
    });

    // Convert to base64 and send
    const reader = new FileReader();

    reader.onloadend = () => {
      const audioData = reader.result;

      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit("audio_chunk", {
          audio: audioData,
          mimeType: "audio/webm;codecs=opus",
          translate: false,
        });

        lastSendTimeRef.current = Date.now();
        // Clear buffer after successful send
        chunkBufferRef.current = [];
      }
    };

    reader.onerror = (error) => {
      console.error("❌ FileReader error:", error);
      chunkBufferRef.current = [];
    };

    reader.readAsDataURL(combinedBlob);
  }, []);

  const stopLiveRecording = useCallback(() => {
    if (!isRecordingRef.current) {
      return;
    }

    console.log("🛑 Stopping recording...");
    isRecordingRef.current = false;
    setIsRecording(false);
    setIsStreaming(false);

    // Clear the send interval
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }

    // Send any remaining buffered audio before stopping
    if (chunkBufferRef.current.length > 0) {
      const combinedBlob = new Blob(chunkBufferRef.current, {
        type: "audio/webm;codecs=opus",
      });

      if (combinedBlob.size > 1000 && socketRef.current?.connected) {
        const reader = new FileReader();
        reader.onloadend = () => {
          socketRef.current.emit("audio_chunk", {
            audio: reader.result,
            mimeType: "audio/webm;codecs=opus",
            translate: false,
          });
        };
        reader.readAsDataURL(combinedBlob);
      }
      chunkBufferRef.current = [];
    }

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch (error) {
        console.error("Error stopping media recorder:", error);
      }
      mediaRecorderRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.error("Error stopping track:", error);
        }
      });
      streamRef.current = null;
    }

    audioChunksRef.current = [];
    console.log("✅ Recording stopped");
    showToast("Recording stopped", "info");
  }, [showToast]);

  const startLiveRecording = useCallback(async () => {
    console.log("🎤 startLiveRecording called");
    cleanupRequestedRef.current = false;
    chunkBufferRef.current = [];
    lastSendTimeRef.current = 0;

    try {
      if (isRecordingRef.current) {
        console.log("⚠️ Already recording, skipping...");
        return;
      }

      if (participants.length === 0) {
        showToast(
          "Please add participants before starting recording",
          "warning"
        );
        return;
      }

      console.log("🎤 Step 1: Initializing socket connection...");
      const socket = initializeSocket();
      if (!socket) {
        throw new Error("Socket initialization failed");
      }

      if (!socket.connected) {
        console.log("🔌 Waiting for socket connection...");
        setIsConnecting(true);

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(
              new Error(
                "Connection timeout - ensure backend is running on localhost:5001"
              )
            );
          }, 5000);

          socket.once("connect", () => {
            clearTimeout(timeout);
            console.log(
              "✅ Socket connected, proceeding with recording setup..."
            );
            resolve();
          });

          socket.once("connect_error", (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
      }

      console.log("🎤 Step 2: Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (cleanupRequestedRef.current || !componentMountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      console.log("🎤 Step 3: Setting up MediaRecorder...");

      let mimeType = "";
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        mimeType = "audio/webm";
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
        audioBitsPerSecond: 128000,
      });

      mediaRecorderRef.current = mediaRecorder;

      // Handle incoming audio data - accumulate chunks
      mediaRecorder.ondataavailable = (event) => {
        if (
          cleanupRequestedRef.current ||
          !componentMountedRef.current ||
          !isRecordingRef.current
        ) {
          return;
        }

        if (event.data && event.data.size > 0) {
          chunkBufferRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error("❌ MediaRecorder error:", event.error);
        showToast("Recording error occurred", "error");
        stopLiveRecording();
      };

      console.log("🎤 Step 4: Starting recording...");

      // Start recording with smaller chunks for faster processing
      mediaRecorder.start(500); // Reduced from 1000ms to 500ms

      // Set up more frequent sending (every 2 seconds)
      sendIntervalRef.current = setInterval(() => {
        if (isRecordingRef.current) {
          sendAccumulatedAudio();
        }
      }, 2000); // Reduced from 4000ms to 2000ms

      isRecordingRef.current = true;
      setIsRecording(true);
      setIsStreaming(true);

      if (!currentMeeting) {
        setCurrentMeeting({
          title: `Meeting ${new Date().toLocaleString()}`,
          date: new Date().toISOString(),
          participants: participants.map((p) => p.name),
          transcript: [],
        });
      }

      console.log("✅ Recording started successfully");
      showToast(
        "Recording started - Speak now! (English or Arabic)",
        "success"
      );
    } catch (error) {
      console.error("❌ Error starting recording:", error);
      setIsConnecting(false);
      setIsRecording(false);
      isRecordingRef.current = false;

      if (sendIntervalRef.current) {
        clearInterval(sendIntervalRef.current);
        sendIntervalRef.current = null;
      }

      let errorMessage = error.message;
      if (error.name === "NotAllowedError") {
        errorMessage =
          "Microphone permission denied. Please allow microphone access.";
      } else if (error.name === "NotFoundError") {
        errorMessage = "No microphone found. Please check your audio device.";
      } else if (
        error.message.includes("timeout") ||
        error.message.includes("ECONNREFUSED")
      ) {
        errorMessage =
          "Cannot connect to server. Please ensure the backend server is running on localhost:5001";
      }

      showToast(`Error: ${errorMessage}`, "error");

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    }
  }, [
    initializeSocket,
    currentMeeting,
    setCurrentMeeting,
    participants,
    showToast,
    stopLiveRecording,
    sendAccumulatedAudio,
  ]);

  const cleanup = useCallback(() => {
    if (isRecordingRef.current || connectingRef.current) {
      console.log("⚠️ Ignoring cleanup - active recording session");
      return;
    }

    console.log("🧹 Cleanup requested...");
    cleanupRequestedRef.current = true;

    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }

    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch (error) {
        console.error("Error stopping media recorder:", error);
      }
      mediaRecorderRef.current = null;
    }

    if (socketRef.current) {
      console.log("🔌 Disconnecting socket...");
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.error("Error stopping track:", error);
        }
      });
      streamRef.current = null;
    }

    chunkBufferRef.current = [];
    setIsConnected(false);
    setIsConnecting(false);
    setIsRecording(false);
    isRecordingRef.current = false;
    setIsStreaming(false);

    console.log("✅ Cleanup completed");
  }, []);

  useEffect(() => {
    return () => {
      console.log("🔴 Component unmounting - performing final cleanup");
      cleanup();
    };
  }, [cleanup]);

  return {
    isRecording,
    isStreaming,
    isConnected,
    isConnecting,
    startLiveRecording,
    stopLiveRecording,
    cleanup,
  };
};
