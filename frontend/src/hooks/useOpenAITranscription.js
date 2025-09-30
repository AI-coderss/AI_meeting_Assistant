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
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const isRecordingRef = useRef(false);
  const connectionTimeoutRef = useRef(null);

  // Initialize Socket.io connection - only once
  const initializeSocket = useCallback(() => {
    // Don't reinitialize if already connecting or connected
    if (isConnecting || (socket && socket.connected)) {
      return socket;
    }

    try {
      console.log("🔄 Initializing socket connection...");
      setIsConnecting(true);

      // Clear any existing timeout
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }

      const newSocket = io("http://localhost:5000", {
        transports: ["websocket"],
        timeout: 15000, // Increased timeout
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        forceNew: true, // Important: create new connection
        autoConnect: false, // Prevent immediate connection
      });

      // Set connection timeout
      connectionTimeoutRef.current = setTimeout(() => {
        if (!newSocket.connected) {
          console.error("❌ Connection timeout");
          newSocket.disconnect();
          setIsConnecting(false);
          setIsConnected(false);
          showToast("Connection timeout - please try again", "error");
        }
      }, 15000);

      newSocket.on("connect", () => {
        console.log("✅ Connected to OpenAI transcription server");
        clearTimeout(connectionTimeoutRef.current);
        setIsConnected(true);
        setIsConnecting(false);
        showToast("Connected to transcription service", "success");
      });

      newSocket.on("transcript", (data) => {
        console.log("📝 Received transcript:", data);

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

          // Add AI response if available
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
              setTranscript((prev) => [...prev, aiSegment]);
            }, 500);
          }
        }
      });

      newSocket.on("error", (error) => {
        console.error("❌ Transcription error:", error);
        clearTimeout(connectionTimeoutRef.current);
        setIsConnecting(false);
        showToast(`Transcription error: ${error.error}`, "error");
      });

      newSocket.on("disconnect", (reason) => {
        console.log("🔌 Disconnected from transcription server:", reason);
        clearTimeout(connectionTimeoutRef.current);
        setIsConnected(false);
        setIsConnecting(false);
        setIsRecording(false);
        isRecordingRef.current = false;

        if (reason === "io server disconnect") {
          showToast("Server disconnected", "warning");
        } else {
          showToast("Connection lost", "warning");
        }
      });

      newSocket.on("connect_error", (error) => {
        console.error("❌ Connection error:", error);
        clearTimeout(connectionTimeoutRef.current);
        setIsConnected(false);
        setIsConnecting(false);
        showToast("Failed to connect to transcription service", "error");
      });

      newSocket.on("reconnect_attempt", (attempt) => {
        console.log(`🔄 Reconnection attempt ${attempt}`);
      });

      newSocket.on("reconnect_failed", () => {
        console.error("❌ Reconnection failed");
        showToast("Failed to reconnect to service", "error");
      });

      setSocket(newSocket);
      return newSocket;
    } catch (error) {
      console.error("❌ Socket initialization error:", error);
      clearTimeout(connectionTimeoutRef.current);
      setIsConnecting(false);
      showToast("Failed to initialize connection", "error");
      return null;
    }
  }, [showToast, setTranscript, isConnecting, socket]);

  // Initialize socket on component mount
  // useEffect(() => {
  //   const socketInstance = initializeSocket();

  //   return () => {
  //     cleanup();
  //   };
  // }, []); // Empty dependency array - only run once
  const stopLiveRecording = useCallback(() => {
    if (!isRecordingRef.current) {
      return;
    }

    console.log("🛑 Stopping recording...");

    // Stop media recorder first
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch (error) {
        console.error("Error stopping media recorder:", error);
      }
    }

    // Stop all audio tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
          track.enabled = false;
        } catch (error) {
          console.error("Error stopping track:", error);
        }
      });
      streamRef.current = null;
    }

    // Reset states
    setIsRecording(false);
    isRecordingRef.current = false;
    setIsStreaming(false);
    audioChunksRef.current = [];

    console.log("✅ Recording stopped");
    showToast("Recording stopped", "info");
  }, [showToast]);

  const startLiveRecording = useCallback(async () => {
    try {
      if (isRecordingRef.current) {
        console.log("⚠️ Already recording, skipping...");
        return;
      }

      // Ensure participants exist
      if (participants.length === 0) {
        showToast(
          "Please add participants before starting recording",
          "warning"
        );
        return;
      }

      let currentSocket = socket;

      // Initialize socket if missing
      if (!currentSocket) {
        console.log("🔄 Establishing new connection...");
        currentSocket = initializeSocket();
        if (!currentSocket)
          throw new Error("Failed to initialize socket connection");
      }

      if (!currentSocket.connected) {
        currentSocket.connect();
      }

      // Wait for connection
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new Error(
              "Connection timeout - please check if the server is running"
            )
          );
        }, 10000);

        if (currentSocket.connected) {
          clearTimeout(timeout);
          resolve();
          return;
        }

        const onConnect = () => {
          clearTimeout(timeout);
          currentSocket.off("connect_error", onError);
          resolve();
        };

        const onError = (err) => {
          clearTimeout(timeout);
          currentSocket.off("connect", onConnect);
          reject(err);
        };

        currentSocket.once("connect", onConnect);
        currentSocket.once("connect_error", onError);
      });

      // 🎤 Get audio stream
      console.log("🎤 Requesting audio permissions...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // 🎙️ Setup MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (
          event.data.size > 0 &&
          isRecordingRef.current &&
          currentSocket?.connected
        ) {
          const reader = new FileReader();
          reader.onload = () => {
            if (currentSocket.connected) {
              currentSocket.emit("audio_chunk", {
                audio: reader.result,
                language: participants[0]?.language || "en",
                translate: false,
              });
            }
          };
          reader.readAsDataURL(event.data);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event.error);
        showToast("Recording error occurred", "error");
        stopLiveRecording();
      };

      // Start recording with 1s chunks
      console.log("🎙️ Starting media recorder...");
      mediaRecorder.start(1000);
      setIsRecording(true);
      isRecordingRef.current = true;
      setIsStreaming(true);

      // Ensure meeting is created
      if (!currentMeeting) {
        setCurrentMeeting({
          title: `Meeting ${new Date().toLocaleString()}`,
          date: new Date().toISOString(),
          participants: participants.map((p) => p.name),
          transcript: [],
        });
      }

      showToast(
        "Started recording with OpenAI transcription - Auto-detects English & Arabic",
        "success"
      );
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
      }

      showToast(`Error starting recording: ${errorMessage}`, "error");

      // Cleanup stream if failed
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    }
  }, [
    socket,
    initializeSocket,
    currentMeeting,
    setCurrentMeeting,
    participants,
    showToast,
    stopLiveRecording,
  ]);

  const cleanup = useCallback(() => {
    console.log("🧹 Cleaning up resources...");

    // Clear timeout
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }

    // Stop recording first
    if (isRecordingRef.current) {
      stopLiveRecording();
    }

    // Disconnect socket
    if (socket) {
      console.log("🔌 Disconnecting socket...");
      socket.removeAllListeners(); // Remove all listeners first
      socket.disconnect();
      setSocket(null);
    }

    // Clean up media
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.error("Error stopping track during cleanup:", error);
        }
      });
      streamRef.current = null;
    }

    // Reset all states
    setIsConnected(false);
    setIsConnecting(false);
    setIsRecording(false);
    isRecordingRef.current = false;
    setIsStreaming(false);

    console.log("✅ Cleanup completed");
  }, [socket, stopLiveRecording]);

  // Store cleanup in ref to avoid useEffect dependency issues
  const cleanupRef = useRef(cleanup);
  cleanupRef.current = cleanup;

  // Auto-cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current();
    };
  }, []); // Empty dependency array - only run on unmount

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
