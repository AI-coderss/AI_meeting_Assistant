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

    const socketUrl = "https://ai-meeting-assistant-backend-suu9.onrender.com";
    // const socketUrl = "http://localhost:8001";

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

          function timeStringToSeconds(timeStr) {
  const [h, m, s] = timeStr.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}
          // Otherwise, add new segment
          console.log("📝 Adding new transcript segment");
          const newSegment = {
            id: `segment-${Date.now()}-${Math.random()
              .toString(36)
              .substr(2, 9)}`,
            text: data.text.trim(),
            speaker: data.speaker,
            timestamp: timeStringToSeconds(new Date().toLocaleTimeString()),
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

const updateMeetingWithTranscript = async () => {
  console.log(currentMeeting,"-------testing ");
  if (!currentMeeting || !currentMeeting.id) {
    console.warn("⚠️ No current meeting found to update.");
    return;
  }

  const token = localStorage.getItem("token");
  const BACKEND_URL = " https://ai-meeting-assistant-backend-suu9.onrender.com";

  try {
    console.log("📝 Updating meeting with transcripts...");
    const res = await fetch(`${BACKEND_URL}/api/meetings/${currentMeeting.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        transcript, // full transcript array
      }),
    });

    if (!res.ok) throw new Error(`Failed to update meeting: ${res.status}`);
    const data = await res.json();
    console.log("✅ Meeting updated successfully:", data);
    showToast("Meeting saved with transcription", "success");
  } catch (err) {
    console.error("❌ Error updating meeting:", err);
    showToast("Failed to save transcription", "error");
  }
};
const stopLiveRecording = useCallback(async () => {
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
      await audioContextRef.current.close();
      audioContextRef.current = null;
    } catch (error) {
      console.error("Error closing audio context:", error);
    }
  }

  // Stop the media stream
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

  // ✅ Save meeting transcript
  await updateMeetingWithTranscript();

  showToast("Recording stopped", "info");
}, [showToast, participants]);


const createMeetingIfNeeded = async () => {
  const token = localStorage.getItem("token");
  const BACKEND_URL = " https://ai-meeting-assistant-backend-suu9.onrender.com";
  const today = new Date();
  const formattedDate = today.toLocaleDateString("en-GB");

  try {
    const res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: `Live Meeting - ${formattedDate}`,
        host: localStorage.getItem("email") || "Host",
        participants: participants.map((p) => p.email || p.name),
      }),
    });

    if (!res.ok) throw new Error(`Failed to create meeting: ${res.status}`);
    const data = await res.json();
    console.log(data)
    setCurrentMeeting(data);
    return data;
  } catch (err) {
    console.error("❌ Error creating meeting:", err);
    showToast("Failed to create meeting", "error");
    return null;
  }
};


const startLiveRecording = useCallback(async () => {
  console.log("🎤 startLiveRecording called");
  cleanupRequestedRef.current = false;
  chunkBufferRef.current = [];
  lastSendTimeRef.current = 0;

  if (participants.length === 0) {
    showToast("Please add participants before starting recording", "warning");
    return;
  }

  // Step 0: Create meeting first
  console.log("🎤 Step 0: Creating meeting...");
  const newMeeting = await createMeetingIfNeeded();
  if (!newMeeting) {
    console.log("❌ Meeting creation failed, stopping recording.");
    return;
  }
  console.log("✅ Meeting created:", newMeeting);

  try {
    if (isRecordingRef.current) return;

    console.log("🎤 Step 1: Initializing socket connection...");
    const socket = initializeSocket();
    if (!socket) throw new Error("Socket initialization failed");

    if (!socket.connected) {
      console.log("🔌 Waiting for socket connection...");
      setIsConnecting(true);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000);
        socket.once("connect", () => { clearTimeout(timeout); resolve(); });
        socket.once("connect_error", (err) => { clearTimeout(timeout); reject(err); });
      });
    }

    console.log("🎤 Step 2: Requesting microphone access...");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1 },
    });
    if (cleanupRequestedRef.current || !componentMountedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;

    console.log("🎤 Step 3: Setting up AudioContext...");
    const audioContext = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      if (!isRecordingRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) pcm16[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
      chunkBufferRef.current.push(pcm16);
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    sendIntervalRef.current = setInterval(() => {
      if (isRecordingRef.current) sendAccumulatedAudio();
    }, 4000);

    isRecordingRef.current = true;
    setIsRecording(true);
    setIsStreaming(true);

    console.log("✅ Recording started successfully");
    showToast("Recording started - Speak now!", "success");
  } catch (err) {
    console.error("❌ Error starting recording:", err);
    setIsRecording(false);
    isRecordingRef.current = false;
  }
}, [
  createMeetingIfNeeded,
  initializeSocket,
  participants,
  showToast,
  sendAccumulatedAudio,
  stopLiveRecording,
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
