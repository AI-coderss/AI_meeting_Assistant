// hooks/useOpenAITranscription.js
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
  const componentMountedRef = useRef(true); // Add this ref
  const connectingRef = useRef(false); // Prevent cleanup while connecting

  // Set component as mounted on initial render
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

    // Clean up existing socket first
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
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      forceNew: true, // Important: create new connection
    });

    socketRef.current = newSocket;

    // Clear any existing timeout
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }

    // Set connection timeout
    connectionTimeoutRef.current = setTimeout(() => {
      if (newSocket && !newSocket.connected && componentMountedRef.current) {
        console.error("❌ Connection timeout after 15 seconds");
        setIsConnecting(false);
        setIsConnected(false);
        showToast(
          "Connection timeout - check if backend server is running",
          "error"
        );

        // Clean up the stuck socket
        if (socketRef.current === newSocket) {
          newSocket.removeAllListeners();
          newSocket.disconnect();
          socketRef.current = null;
        }
      }
    }, 15000);

    // Socket event handlers
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

      // Your existing transcript handling code...
      if (data.text && data.text.trim() !== "") {
        const newSegment = {
          id: `segment-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 9)}`,
          text: data.text,
          speaker: "Speaker",
          timestamp: new Date().toLocaleTimeString(),
          language: data.language || "en",
          isAI: false,
        };

        setTranscript((prev) => [...prev, newSegment]);

        if (data.ai_response && data.ai_response.trim() !== "") {
          const aiSegment = {
            id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text: data.ai_response,
            speaker: "AI Assistant",
            timestamp: new Date().toLocaleTimeString(),
            language: data.language || "en",
            isAI: true,
          };

          setTimeout(() => {
            if (componentMountedRef.current) {
              setTranscript((prev) => [...prev, aiSegment]);
            }
          }, 500);
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

  const stopLiveRecording = useCallback(() => {
    if (!isRecordingRef.current) {
      return;
    }

    console.log("🛑 Stopping recording...");
    isRecordingRef.current = false;
    setIsRecording(false);
    setIsStreaming(false);

    // Stop media recorder
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

    // Stop audio tracks
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
    // Reset cleanup flag when starting recording
    cleanupRequestedRef.current = false;

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

      // Simple connection wait
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
        },
      });

      if (cleanupRequestedRef.current || !componentMountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      console.log("🎤 Step 3: Setting up MediaRecorder...");
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (
          cleanupRequestedRef.current ||
          !componentMountedRef.current ||
          !isRecordingRef.current
        )
          return;

        if (event.data.size > 0) {
          if (socket && socket.connected) {
            const reader = new FileReader();

            reader.onload = () => {
              if (
                socket.connected &&
                !cleanupRequestedRef.current &&
                componentMountedRef.current
              ) {
                const audioData = reader.result;
                console.log("📤 Sending audio chunk:", {
                  dataLength: audioData.length,
                  dataPreview: audioData.substring(0, 100),
                  language: participants[0]?.language || "en",
                });

                socket.emit("audio_chunk", {
                  data: audioData,
                  language: participants[0]?.language || "en",
                  translate: false,
                });
              }
            };
            reader.readAsDataURL(event.data);
          } else {
            console.warn("⚠️ Tried to send audio but socket not connected");
          }
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error("❌ MediaRecorder error:", event.error);
        showToast("Recording error occurred", "error");
        stopLiveRecording();
      };

      mediaRecorder.onstop = () => {
        console.log("🛑 MediaRecorder stopped");
      };

      console.log("🎤 Step 4: Starting recording...");
      mediaRecorder.start(1000); // 1 second chunks

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
      showToast("Recording started - Speak now!", "success");
    } catch (error) {
      console.error("❌ Error starting recording:", error);
      setIsConnecting(false);
      setIsRecording(false);
      isRecordingRef.current = false;

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
  ]);

  const cleanup = useCallback(() => {
    console.log("🧹 Cleanup requested...");
    cleanupRequestedRef.current = true;

    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }

    stopLiveRecording();

    if (connectingRef.current) {
      console.log("⏳ Skipping socket disconnect while connecting...");
    } else if (socketRef.current) {
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

    setIsConnected(false);
    setIsConnecting(false);
    setIsRecording(false);
    isRecordingRef.current = false;
    setIsStreaming(false);

    console.log("✅ Cleanup completed");
  }, [stopLiveRecording]);

  // Only cleanup on unmount, not on re-renders
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
