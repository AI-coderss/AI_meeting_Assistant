import React, { useState, useRef } from "react";
import axios from "axios";
import "../styles/LiveMeeting.css";
import MeetingAudioVisualizer from "./MeetingAudioVisualizer.jsx";

const LiveMeeting = ({
  participants,
  setShowParticipantModal,
  showToast,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [transcriptData, setTranscriptData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentMeeting, setCurrentMeeting] = useState(null);
  const [summaryData, setSummaryData] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [audioStream, setAudioStream] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

const createMeetingIfNeeded = async () => {
  const token = localStorage.getItem("token");
  // const BACKEND_URL = "https://ai-meeting-assistant-backend-suu9.onrender.com";
  const BACKEND_URL = "https://ai-meeting-assistant-backend-suu9.onrender.com";
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
    console.log("✅ Meeting created:", data);
    setCurrentMeeting(data);
    return data;
  } catch (err) {
    console.error("❌ Error creating meeting:", err);
    showToast("Failed to create meeting", "error");
    return null;
  }
};
const updateMeetingWithTranscript = async (currentMeeting, transcriptData, summaryData) => {
  const token = localStorage.getItem("token");
  const BACKEND_URL = "https://ai-meeting-assistant-backend-suu9.onrender.com";

  try {
    // 🧩 Merge all summary-related data into one field
    const combinedSummary = `
📝 **Summary:**
${summaryData?.summary || "No summary available."}

🔹 **Key Points:**
${(summaryData?.key_points || []).map((p, i) => `${i + 1}. ${p}`).join("\n") || "None"}

✅ **Action Items:**
${(summaryData?.action_items || []).map((p, i) => `${i + 1}. ${p}`).join("\n") || "None"}

📌 **Decisions Made:**
${(summaryData?.decisions_made || []).map((p, i) => `${i + 1}. ${p}`).join("\n") || "None"}
`;

    const res = await fetch(`${BACKEND_URL}/api/meetings/${currentMeeting.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        transcript: transcriptData,  // full structured transcript
        summary: combinedSummary     // single string with all info combined
      }),
    });

    if (!res.ok) throw new Error(`Failed to update meeting: ${res.status}`);
    const updated = await res.json();
    console.log("✅ Meeting updated:", updated);
    showToast("Meeting updated successfully", "success");
    return updated;
  } catch (err) {
    console.error("❌ Error updating meeting:", err);
    showToast("Failed to update meeting", "error");
  }
};

// Helper: Normalize backend values into arrays
const normalizeToArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(/\n+/)               // split by newlines
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
};

const startRecording = async () => {
  try {
    // 🧩 Step 1: Ensure a meeting exists before recording
    if (!currentMeeting) {
      showToast && showToast("Creating a new meeting...");
      const newMeeting = await createMeetingIfNeeded();
      if (!newMeeting) {
        showToast && showToast("Failed to create meeting, cannot start recording.", "error");
        return;
      }
      setCurrentMeeting(newMeeting);
      console.log("🆕 Created meeting:", newMeeting);
    }

    // 🎤 Step 2: Start microphone capture
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
     setAudioStream(stream);
    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;
    chunksRef.current = [];

    mediaRecorder.ondataavailable = (e) => chunksRef.current.push(e.data);
    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
      setAudioBlob(audioBlob);
    };

    mediaRecorder.start();
    setIsRecording(true);
    showToast && showToast("Recording started...");

  } catch (err) {
    console.error("❌ Error starting recording:", err);
    showToast && showToast("Microphone access denied or meeting creation failed");
  }
};


  const stopRecording = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      showToast && showToast("Recording stopped.");
    }
  };

  const uploadRecording = async () => {
    if (!audioBlob) return showToast && showToast("No recording found.");

    setIsProcessing(true);
    const formData = new FormData();
    formData.append("audio_data", audioBlob, "meeting_audio.webm");
    formData.append("participants", JSON.stringify(participants));

    try {
      const res = await axios.post("https://ai-meeting-assistant-backend-suu9.onrender.com/api/process-meeting", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const data = res.data;
      setTranscriptData(data);
      showToast && showToast("Meeting processed successfully!");

      // 🔹 Send summary and key details to n8n webhook (including structured transcript)
      const webhookPayload = {
        summary: data.summary || "",
        key_points: data.key_points || [],
        action_items: data.action_items || [],
        decisions_made: data.decisions_made || [],
        participants: participants || [],
        structured_transcript: data.structured_transcript || [],
        timestamp: new Date().toISOString(),
      };
      await updateMeetingWithTranscript(
  currentMeeting,
  data.structured_transcript,
  data
);


      try {
        await axios.post(
          "https://n8n-latest-h3pu.onrender.com/webhook/9d74e4da-cdfb-4610-9fe7-c309c9494a87",
          webhookPayload
        );
        console.log("✅ Sent meeting summary to n8n successfully");
        showToast && showToast("Summary sent to n8n workflow!");
      } catch (webhookErr) {
        console.error("⚠️ Error sending to n8n webhook:", webhookErr);
        showToast && showToast("Failed to send summary to n8n webhook.");
      }

    } catch (err) {
      console.error(err);
      showToast && showToast("Error processing meeting.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="tab-content">
      <div className="meeting-controls">
        <h2>Recorded Meeting</h2>

        <div className="recording-panel">
          <div className="participant-info">
            <span>Participants: {participants.length}</span>
          </div>

          <div className="record-buttons">
            <button
              className="btn btn-participant"
              onClick={() => setShowParticipantModal(true)}
            >
            <span class="filter-icon">👥 </span>  Manage Participants
            </button>

            {!isRecording ? (
              <button
                className="btn btn-record"
                onClick={startRecording}
                disabled={participants.length === 0}
              >
                🎤 Start Recording
              </button>
            ) : (
              <button className="btn btn-stop" onClick={stopRecording}>
                ⏹️ Stop Recording
              </button>
            )}

            {audioBlob && (
              <button
                className="btn btn-upload"
                onClick={uploadRecording}
                disabled={isProcessing}
              >
                {isProcessing ? "Processing..." : "📤 Generate Minutes of Meeting"}
              </button>
            )}
          </div>
        </div>
      </div>
{isRecording && audioStream && (
  <div style={{ marginTop: "20px" }}>
    <MeetingAudioVisualizer
      stream={audioStream} 
      isActive={isRecording} 
      label="Live Meeting Audio"
    />
  </div>
)}
      {/* 🧠 Summary & Key Details Section */}
{transcriptData && (
  <>
    <div className="summary-section">
      <h3>📝 Meeting Summary</h3>

      <div className="summary-block">
        <h4>Summary</h4>
        <p>{transcriptData.summary || "No summary available."}</p>

        <h4>Key Points</h4>
        <ul>
          {normalizeToArray(transcriptData.key_points).length > 0 ? (
            normalizeToArray(transcriptData.key_points).map((point, idx) => (
              <li key={idx}>{point}</li>
            ))
          ) : (
            <li>No key points found.</li>
          )}
        </ul>

        <h4>Action Items</h4>
        <ul>
          {normalizeToArray(transcriptData.action_items).length > 0 ? (
            normalizeToArray(transcriptData.action_items).map((item, idx) => (
              <li key={idx}>{item}</li>
            ))
          ) : (
            <li>No action items listed.</li>
          )}
        </ul>

        <h4>Decisions Made</h4>
        <ul>
          {normalizeToArray(transcriptData.decisions_made).length > 0 ? (
            normalizeToArray(transcriptData.decisions_made).map((dec, idx) => (
              <li key={idx}>{dec}</li>
            ))
          ) : (
            <li>No decisions made.</li>
          )}
        </ul>
      </div>
    </div>

    {/* 🎧 Structured Transcript Section */}
  <div className="transcript-section">
  <h3>🗣️ Structured Transcript</h3>
  <div className="structured-transcript">

    {transcriptData.structured_transcript ? (
      (() => {
        // If backend returns a string, convert it into array
        const raw = transcriptData.structured_transcript;

        const lines = typeof raw === "string"
          ? raw.split("\n").filter((l) => l.trim() !== "")
          : raw;

        const parsed = lines.map((line) => {
          const [speaker, ...speechParts] = line.split(":");
          return {
            speaker: speaker?.trim() || "Unknown",
            speech: speechParts.join(":").trim()
          };
        });

        return parsed.map((entry, idx) => (
          <div key={idx} className="transcript-entry">
            <span className="speaker-name">{entry.speaker}:</span>
            <span className="speaker-text">{entry.speech}</span>
          </div>
        ));
      })()
    ) : (
      <p>No structured transcript available.</p>
    )}

  </div>
</div>

  </>
)}

    </div>
  );
};

export default LiveMeeting;
