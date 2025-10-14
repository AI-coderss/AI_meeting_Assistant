import { useState, useRef, useCallback, useEffect } from "react";
import io from "socket.io-client";

export const useOpenAITranscription = ({
  currentMeeting,
  setCurrentMeeting,
  showToast,
  transcript,
  setTranscript,
  participants,
  setDiarizationSegments,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const isRecordingRef = useRef(false);
  const componentMountedRef = useRef(true);
  const socketRef = useRef(null);
  const cleanupRequestedRef = useRef(false);
  const connectingRef = useRef(false);
  const connectionTimeoutRef = useRef(null);
  const chunkBufferRef = useRef([]);
  const lastSendTimeRef = useRef(0);
  const sendIntervalRef = useRef(null);
  const mimeTypeRef = useRef("audio/pcm");

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
      transports: ["polling", "websocket"],
      timeout: 15000,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 1000,
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
          "Connection timeout - check if backend server is running on localhost:5001",
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
      console.log("📝 Received transcript from server:", data);

      if (data.text && data.text.trim() !== "") {
        console.log(
          `✅ Processing transcript: "${data.text}" from ${data.speaker}`
        );

        setTranscript((prev) => {
          const last = prev[prev.length - 1];

          // If it's an interim result and matches last speaker, update
          if (
            !data.is_final &&
            last &&
            last.speaker === data.speaker &&
            !last.isAI
          ) {
            console.log("📝 Updating interim transcript");
            return prev.map((seg, i) =>
              i === prev.length - 1 ? { ...seg, text: data.text.trim() } : seg
            );
          }

          // If final and same speaker, append
          if (
            data.is_final &&
            last &&
            last.speaker === data.speaker &&
            !last.isAI
          ) {
            console.log("📝 Appending to same speaker");
            return prev.map((seg, i) =>
              i === prev.length - 1
                ? { ...seg, text: seg.text + " " + data.text.trim() }
                : seg
            );
          }

          // Otherwise, add new segment
          console.log("📝 Adding new transcript segment");
          const newSegment = {
            id: `segment-${Date.now()}-${Math.random()
              .toString(36)
              .substr(2, 9)}`,
            text: data.text.trim(),
            speaker: data.speaker,
            timestamp: new Date().toLocaleTimeString(),
            isAI: false,
            language: data.language || "en",
            languageName:
              data.language === "en"
                ? "English"
                : data.language === "ar"
                ? "Arabic"
                : "Unknown",
          };
          return [...prev, newSegment];
        });
      } else {
        console.log("⚠️ Received empty transcript, ignoring");
      }
    });

    newSocket.on("diarization", (data) => {
      if (!componentMountedRef.current) return;
      console.log("🎯 Received diarization segments:", data);
      if (data.segments) {
        setDiarizationSegments(data.segments);
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
    // Send every 3.5 seconds minimum
    if (now - lastSendTimeRef.current < 3500) {
      return;
    }

    // Calculate total length
    let totalLength = 0;
    for (const chunk of chunkBufferRef.current) {
      totalLength += chunk.length;
    }

    // Reduced minimum size for faster response
    if (totalLength < 8000) {
      console.log(
        `⚠️ Audio too small (${totalLength} samples), waiting for more`
      );
      return;
    }

    // Concatenate all Int16Arrays
    const combined = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of chunkBufferRef.current) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert to Uint8Array (little-endian bytes)
    const uint8Array = new Uint8Array(combined.buffer);

    // Convert to base64
    let binary = "";
    const bytes = uint8Array;
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const audioData = "data:audio/pcm;base64," + btoa(binary);

    console.log("📤 Sending accumulated audio:", {
      chunks: chunkBufferRef.current.length,
      totalSamples: totalLength,
      totalSize: uint8Array.length,
      duration: `${(totalLength / 16000).toFixed(2)}s estimated`,
      participants: participants.length,
    });

    if (socketRef.current && socketRef.current.connected) {
      // Send with participants data
      socketRef.current.emit("audio_chunk", {
        audio: audioData,
        mimeType: mimeTypeRef.current,
        participants: participants.map((p) => ({ name: p.name })),
        translate: false,
      });

      lastSendTimeRef.current = Date.now();
      // Clear buffer after successful send
      chunkBufferRef.current = [];
      console.log("✅ Audio sent successfully");
    }
  }, [participants]);

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
      let totalLength = 0;
      for (const chunk of chunkBufferRef.current) {
        totalLength += chunk.length;
      }

      if (totalLength > 4000 && socketRef.current?.connected) {
        const combined = new Int16Array(totalLength);
        let offset = 0;
        for (const chunk of chunkBufferRef.current) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        const uint8Array = new Uint8Array(combined.buffer);
        let binary = "";
        const bytes = uint8Array;
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const audioData = "data:audio/pcm;base64," + btoa(binary);

        socketRef.current.emit("audio_chunk", {
          audio: audioData,
          mimeType: mimeTypeRef.current,
          participants: participants.map((p) => ({ name: p.name })),
          translate: false,
        });

        console.log("📤 Sent final audio chunk before stopping");
      }
      chunkBufferRef.current = [];
    }

    // Stop the audio processor
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
        processorRef.current = null;
      } catch (error) {
        console.error("Error stopping audio processor:", error);
      }
    }

    // Close audio context
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
        audioContextRef.current = null;
      } catch (error) {
        console.error("Error closing audio context:", error);
      }
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
    console.log("✅ Recording stopped");
    showToast("Recording stopped", "info");
  }, [showToast, participants]);

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
      console.log(
        "👥 Participants:",
        participants.map((p) => p.name)
      );

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

      console.log("🎤 Step 3: Setting up AudioContext for PCM16 recording...");

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      // Handle incoming audio data - convert to PCM16 and accumulate
      processor.onaudioprocess = (event) => {
        if (
          cleanupRequestedRef.current ||
          !componentMountedRef.current ||
          !isRecordingRef.current
        ) {
          return;
        }

        const inputBuffer = event.inputBuffer;
        const channelData = inputBuffer.getChannelData(0);

        // Convert Float32 to Int16 PCM
        const pcm16 = new Int16Array(channelData.length);
        for (let i = 0; i < channelData.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, channelData[i] * 32768));
        }

        chunkBufferRef.current.push(pcm16);
      };

      // Connect the nodes
      source.connect(processor);
      processor.connect(audioContext.destination);

      console.log("🎤 Step 4: Starting recording...");

      // Set up sending every 4 seconds
      sendIntervalRef.current = setInterval(() => {
        if (isRecordingRef.current) {
          sendAccumulatedAudio();
        }
      }, 4000);

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
      console.log(
        "👥 Active participants:",
        participants.map((p) => p.name)
      );
      showToast("Recording started - Speak now!", "success");
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

    // Stop the audio processor
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
        processorRef.current = null;
      } catch (error) {
        console.error("Error stopping audio processor:", error);
      }
    }

    // Close audio context
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
        audioContextRef.current = null;
      } catch (error) {
        console.error("Error closing audio context:", error);
      }
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
