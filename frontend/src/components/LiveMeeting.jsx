import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "../styles/LiveMeeting.css";
import MeetingAudioVisualizer from "./MeetingAudioVisualizer.jsx";
import AudioVisualizer from "./AudioVisualizer.jsx";

const LiveMeeting = ({ participants, setShowParticipantModal, showToast }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [transcriptData, setTranscriptData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentMeeting, setCurrentMeeting] = useState(null);
  const [summaryData, setSummaryData] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [activeTab, setActiveTab] = useState("summary");
  const [audioStream, setAudioStream] = useState(null);
  const [showLoader, setShowLoader] = useState(false);
  const [loaderText, setLoaderText] = useState("");
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const [actionItems, setActionItems] = useState([]);

  const [showInput, setShowInput] = useState(false);
  const [newItem, setNewItem] = useState("");

  const toggleComplete = (index) => {
    const updated = [...actionItems];
    updated[index].completed = !updated[index].completed;
    setActionItems(updated);
  };

  const addNewItem = () => {
    if (!newItem.trim()) return;

    setActionItems([...actionItems, { task: newItem, completed: false }]);
    setNewItem("");
    setShowInput(false);
  };
  useEffect(() => {
    const savedTranscript = localStorage.getItem("mom_transcriptData");
    const savedItems = localStorage.getItem("mom_actionItems");
    const savedTab = localStorage.getItem("mom_activeTab");

    if (savedTranscript) {
      setTranscriptData(JSON.parse(savedTranscript));
    }

    if (savedItems) {
      setActionItems(JSON.parse(savedItems));
    }

    if (savedTab) {
      setActiveTab(savedTab);
    }
  }, []);

  useEffect(() => {
    if (actionItems.length > 0) {
      localStorage.setItem("mom_actionItems", JSON.stringify(actionItems));
    }
  }, [actionItems]);

  useEffect(() => {
    localStorage.setItem("mom_activeTab", activeTab);
  }, [activeTab]);

  // 🟢 Load action items when transcriptData arrives
  useEffect(() => {
    if (transcriptData?.action_items) {
      const formatted = transcriptData.action_items.map((item) => ({
        task: item.task,
        completed: false,
        owner: item.owner || null,
        due_date: item.due_date || null,
      }));

      setActionItems(formatted);
      localStorage.setItem("mom_actionItems", JSON.stringify(formatted));
    }
  }, [transcriptData]);

  const createMeetingIfNeeded = async () => {
    const token = localStorage.getItem("token");
    // const BACKEND_URL = "https://ai-meeting-assistant-backend-suu9.onrender.com";
    const BACKEND_URL =
      "https://ai-meeting-assistant-backend-suu9.onrender.com";
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
          participants: [
            localStorage.getItem("email") || "Host", // add host here
            ...participants.map((p) => p.email || p.name),
          ],
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
  const updateMeetingWithTranscript = async (
    currentMeeting,
    structuredTranscript,
    summaryData,
    updatedActionItems // <-- pass your React state action items here
  ) => {
    const token = localStorage.getItem("token");
    const BACKEND_URL =
      "https://ai-meeting-assistant-backend-suu9.onrender.com";

    try {
      // Build combined summary text (for display & emails)
      const combinedSummary = `
📝 **Overview**
${summaryData?.overview || "No overview available."}

📝 **Summary**
${summaryData?.summary || "No summary available."}

🔹 **Insights**
${
  (summaryData?.insights || []).map((p, i) => `${i + 1}. ${p}`).join("\n") ||
  "None"
}

📚 **Outline**
${
  (summaryData?.outline || [])
    .map(
      (section, i) =>
        `\n${i + 1}. ${section.heading}\n   - ${section.points.join("\n   - ")}`
    )
    .join("\n") || "None"
}

🧩 **Key Points**
${
  (summaryData?.key_points || []).map((p, i) => `${i + 1}. ${p}`).join("\n") ||
  "None"
}

☑️ **Action Items**
${
  updatedActionItems
    .map(
      (item, i) =>
        `${i + 1}. ${item.task} ${item.completed ? "(Completed)" : ""}`
    )
    .join("\n") || "None"
}
`;

      // API request body
      const body = {
        transcript: structuredTranscript, // Structured speaker transcript
        summary: combinedSummary, // Combined summary string
        overview: summaryData?.overview || "",
        insights: summaryData?.insights || [],
        outline: summaryData?.outline || [],
        key_points: summaryData?.key_points || [],
        action_items: updatedActionItems, // <-- NEW checklist version
        decisions_made: summaryData?.decisions_made || [],
      };

      // Fire request
      const res = await fetch(
        `${BACKEND_URL}/api/meetings/${currentMeeting.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        }
      );

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
        .split(/\n+/) // split by newlines
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
          showToast &&
            showToast(
              "Failed to create meeting, cannot start recording.",
              "error"
            );
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
      showToast &&
        showToast("Microphone access denied or meeting creation failed");
    }
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      showToast && showToast("Recording stopped.");
    }
  };
  const handleRecordingComplete = (blob) => {
    // 👉 send `blob` to your transcription endpoint here
    // e.g. via fetch/axios
    console.log("Recording finished, blob size:", blob.size);
  };
  const uploadRecording = async () => {
    if (!audioBlob) return showToast && showToast("No recording found.");

    setIsProcessing(true);
    const formData = new FormData();
    formData.append("audio_data", audioBlob, "meeting_audio.webm");
    formData.append("participants", JSON.stringify(participants));
    setShowLoader(true);
    setLoaderText("Transcribing the Meeting...");

    try {
      // -----------------------------------------------------------
      // 1️⃣ FIRST CALL — Process meeting WITHOUT structured transcript
      // -----------------------------------------------------------
      const res = await axios.post(
        "https://ai-meeting-assistant-backend-suu9.onrender.com/api/process-meeting",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );

      const data = res.data;
      setTranscriptData(data);
      showToast && showToast("Transcription completed!");

      const rawTranscript = data?.transcript;
      if (!rawTranscript) {
        showToast("No transcript text received.", "error");
        return;
      }

      // -----------------------------------------------------------
      // 2️⃣ SECOND CALL — Generate structured speaker transcript
      // -----------------------------------------------------------
      setLoaderText("Generating Summary...");
      const structuredRes = await axios.post(
        "https://ai-meeting-assistant-backend-suu9.onrender.com/api/structured-transcript",
        {
          transcript: rawTranscript,
          participants: participants,
        }
      );

      const structuredData = structuredRes.data;
      console.log("🗣️ Structured transcript:", structuredData);

      // Inject structured transcript into existing data
      const finalData = {
        ...data,
        structured_transcript: structuredData.structured_transcript,
      };

      setTranscriptData(finalData);
      // SAVE EVERYTHING TO LOCAL STORAGE
      localStorage.setItem("mom_transcriptData", JSON.stringify(finalData));
      localStorage.setItem("mom_actionItems", JSON.stringify(actionItems));
      localStorage.setItem("mom_activeTab", activeTab);

      // -----------------------------------------------------------
      // 3️⃣ SAVE EVERYTHING TO DATABASE
      // -----------------------------------------------------------
      await updateMeetingWithTranscript(
        currentMeeting,
        finalData.structured_transcript,
        finalData,
        actionItems
      );

      // -----------------------------------------------------------
      // 4️⃣ Send to n8n
      // -----------------------------------------------------------
      try {
        await axios.post(
          "https://n8n-latest-h3pu.onrender.com/webhook/85637224-7bfe-42fa-bdb0-7bfa84b16001",
          {
            summary: finalData.summary || "",
            key_points: finalData.key_points || [],
            action_items: finalData.action_items || [],
            decisions_made: finalData.decisions_made || [],
            structured_transcript: finalData.structured_transcript || [],
            participants,
            timestamp: new Date().toISOString(),
          }
        );

        console.log("✅ Sent to n8n");
      } catch (webhookErr) {
        console.error("⚠️ Error sending to n8n:", webhookErr);
      }
    } catch (err) {
      console.error("❌ Error processing:", err);
      showToast && showToast("Error processing meeting");
    } finally {
      setIsProcessing(false);
      setShowLoader(false);
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
              <span class="filter-icon">👥 </span> Manage Participants
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
                {isProcessing
                  ? "Processing..."
                  : "📤 Generate Minutes of Meeting"}
              </button>
            )}
          </div>
        </div>
      </div>
      {isRecording && audioStream && (
        <div style={{ marginTop: "0px" }}>
          {/* <MeetingAudioVisualizer
      stream={audioStream} 
      isActive={isRecording} 
      label="Live Meeting Audio"
    /> */}
          <AudioVisualizer stream={audioStream} isRecording={isRecording} />
        </div>
      )}
      {showLoader && (
        <div className="fullscreen-loader">
          <div className="loader-box">
            <div className="spinner"></div>
            <p>{loaderText}</p>
          </div>
        </div>
      )}

      {transcriptData && (
        <div className="bottom-tabs">
          <button
            className={`tab-btn ${activeTab === "summary" ? "active" : ""}`}
            onClick={() => setActiveTab("summary")}
          >
            Summary
          </button>

          <button
            className={`tab-btn ${activeTab === "transcript" ? "active" : ""}`}
            onClick={() => setActiveTab("transcript")}
          >
            Transcript
          </button>
        </div>
      )}

      {/* 🧠 Summary & Key Details Section */}
      {transcriptData && (
        <>
          {activeTab === "summary" && transcriptData && (
            <div className="summary-section">
              <div className="section-title">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginRight: "6px" }}
                >
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="18" x2="14" y2="18" />
                </svg>
                Overview
              </div>

              <p>{transcriptData.overview}</p>
              <div className="section-title">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginRight: "6px" }}
                >
                  <path d="M9 11l3 3L22 4" />
                  <path d="M2 12h7" />
                  <path d="M2 18h7" />
                  <path d="M2 6h7" />
                </svg>
                Action Items
              </div>

              <div className="space-y-3">
                {actionItems.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 cursor-pointer"
                    onClick={() => toggleComplete(i)} // <-- CLICK ANYWHERE
                  >
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={() => toggleComplete(i)}
                      className="mt-1 h-4 w-4 cursor-pointer me-2"
                      onClick={(e) => e.stopPropagation()} // prevent double toggle
                    />

                    <span
                      className={`text-sm ${
                        item.completed
                          ? "line-through text-gray-400"
                          : "text-gray-700"
                      }`}
                    >
                      {item.task} - {item.owner}
                    </span>
                  </div>
                ))}

                {/* Add Action Item Button */}
                {!showInput && (
                  <button
                    onClick={() => setShowInput(true)}
                    className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm bg-button"
                  >
                    <span className="text-xl">+</span> Add action item
                  </button>
                )}

                {/* Input Field (only shows after clicking button) */}
                {showInput && (
                  <div className="action-input-row">
                    <input
                      type="text"
                      placeholder="New action item..."
                      value={newItem}
                      onChange={(e) => setNewItem(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addNewItem()}
                      className="action-input"
                      autoFocus
                    />

                    <button onClick={addNewItem} className="btn-primary">
                      Save
                    </button>

                    <button
                      onClick={() => {
                        setShowInput(false);
                        setNewItem("");
                      }}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              <div className="section-title">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginRight: "6px" }}
                >
                  <path d="M3 3v18h18" />
                  <path d="M7 14l3-3 4 4 5-6" />
                </svg>
                <h3>Insights</h3>
              </div>

              <ul>
                {transcriptData.insights?.map((ins, i) => (
                  <li key={i}>{ins}</li>
                ))}
              </ul>

              <div className="section-title">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginRight: "6px" }}
                >
                  <rect x="3" y="4" width="18" height="4" rx="1.5" />
                  <rect x="3" y="10" width="18" height="4" rx="1.5" />
                  <rect x="3" y="16" width="18" height="4" rx="1.5" />
                </svg>
                Overview
              </div>

              <div className="outline-section">
                {transcriptData.outline?.map((sec, i) => (
                  <div key={i} className="outline-block">
                    <h4>{sec.heading}</h4>
                    <ul>
                      {sec.points.map((p, j) => (
                        <li key={j}>{p}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "transcript" && transcriptData && (
            <div className="transcript-section">
              <div className="section-title">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginRight: "6px" }}
                >
                  <path d="M4 4h10l6 6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                  <line x1="8" y1="16" x2="14" y2="16" />
                </svg>
                Transcript
              </div>

              {transcriptData.structured_transcript?.map((item, i) => (
                <div key={i} className="transcript-entry">
                  <div className="speaker-title">
                    <span className="speaker-name">{item.speaker}</span>
                    {item.role && (
                      <span className="speaker-role"> ({item.role})</span>
                    )}
                  </div>
                  <div className="speaker-text">{item.text}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default LiveMeeting;
