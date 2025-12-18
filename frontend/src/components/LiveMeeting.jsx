import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "../styles/LiveMeeting.css";
import MeetingAudioVisualizer from "./MeetingAudioVisualizer.jsx";
import AudioVisualizer from "./AudioVisualizer.jsx";
import Swal from "sweetalert2";
import { Pencil, Trash2, Check, X, CloudCog } from "lucide-react";

const LiveMeeting = ({
  participants,
  setParticipants,
  setShowParticipantModal,
  showToast,
  meetingTitle,
  setMeetingTitle,
}) => {
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
  const [recordBtnLoading, setRecordBtnLoading] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [notified, setNotified] = useState(false);
  const [editIndex, setEditIndex] = useState(null);
  const [editItem, setEditItem] = useState({
    task: "",
    owner: "",
    due_date: "",
    note: "",
  });
  const [agenda, setAgenda] = useState([]);
  const [meetingStartTime, setMeetingStartTime] = useState(null);
  const [shownAgendaPopups, setShownAgendaPopups] = useState([]);

  const syncActionItemsToAPI = async (updatedItems) => {
    if (!currentMeeting?.id) return;

    const token = localStorage.getItem("token");

    try {
      await axios.put(
        `https://ai-meeting-assistant-backend-suu9.onrender.com/api/meetings/${currentMeeting.id}/action-items`,
        { action_items: updatedItems },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      console.log("✅ Action items synced");
    } catch (err) {
      console.error("❌ Failed to sync action items:", err);
    }
  };

  const startEditing = (index) => {
    setEditIndex(index);
    setEditItem({ ...actionItems[index] });
  };

  const saveEdit = (index) => {
    const updated = [...actionItems];

    // ✅ Auto assign due date if missing
    if (!editItem.due_date) {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      editItem.due_date = d.toISOString().split("T")[0];
    }

    updated[index] = { ...editItem };
    setActionItems(updated);
    syncActionItemsToAPI(updated);
    setEditIndex(null);
    setEditItem({
      task: "",
      owner: "",
      due_date: "",
      note: "",
    });
  };

  const cancelEdit = () => {
    setEditIndex(null);
    setEditItem({
      task: "",
      owner: "",
      due_date: "",
      priority: "",
    });
  };

  // Delete item
  const deleteItem = (index) => {
    const updated = actionItems.filter((_, i) => i !== index);
    setActionItems(updated);
    syncActionItemsToAPI(updated);
  };

  const toggleComplete = (index) => {
    const updated = [...actionItems];
    updated[index].completed = !updated[index].completed;
    setActionItems(updated);
    syncActionItemsToAPI(updated);
  };

  useEffect(() => {
    const userEmail = localStorage.getItem("email");

    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `https://ai-meeting-assistant-backend-suu9.onrender.com/api/get_user_medical_meetings?email=${encodeURIComponent(
            userEmail
          )}`
        );
        const meetings = await res.json();

        const now = new Date();

        meetings.forEach((m) => {
          const meetingTime = new Date(m.meeting_time);

          // Check if meeting is live within last 5 minutes
          if (
            now >= meetingTime &&
            now - meetingTime <= 5 * 60 * 1000 &&
            !notified
          ) {
            // Check if the user is a participant
            const isParticipant = m.participants.some(
              (p) => p.email === userEmail
            );

            if (isParticipant) {
              Swal.fire({
                title: "Your meeting has started",
                text: `Meeting: ${m.meeting_title}`,
                icon: "info",
                confirmButtonText: "Join Now",
              }).then(() => {
                // setCurrentMeeting(m);
                setParticipants(m.participants || []);

                // NEW → load agenda
                if (Array.isArray(m.agenda)) {
                  setAgenda(m.agenda);
                }
              });

              setNotified(true); // Prevent multiple popups
            }
          }
        });
      } catch (e) {
        console.error("Error checking meeting:", e);
      }
    }, 10000); // check every 10 seconds

    return () => clearInterval(interval);
  }, [notified]);

  const addNewItem = () => {
    if (!newItem.trim()) return;
    const updated = [...actionItems, { task: newItem, completed: false }];
    setActionItems(updated);
    syncActionItemsToAPI(updated);

    setNewItem("");
    setShowInput(false);
  };

  useEffect(() => {
    if (!meetingStartTime || agenda.length === 0) return;

    const interval = setInterval(() => {
      const now = new Date();
      const elapsedMinutes = Math.floor((now - meetingStartTime) / 60000);

      agenda.forEach((ag, idx) => {
        if (
          elapsedMinutes >= ag.time_offset &&
          !shownAgendaPopups.includes(idx)
        ) {
          // Show popup alert
          Swal.fire({
            title: `⏱ Agenda Time Reached`,
            html: `
            <b>${ag.item}</b><br/>
            Speaker: ${ag.speaker_name} (${ag.speaker_email})
          `,
            icon: "info",
            confirmButtonText: "OK",
          });

          // Mark popup as shown
          setShownAgendaPopups((prev) => [...prev, idx]);
        }
      });
    }, 15000); // check every 15 seconds

    return () => clearInterval(interval);
  }, [meetingStartTime, agenda, shownAgendaPopups]);

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
      syncActionItemsToAPI(formatted);

      localStorage.setItem("mom_actionItems", JSON.stringify(formatted));
    }
  }, [transcriptData]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const BACKEND_URL =
      "https://ai-meeting-assistant-backend-suu9.onrender.com";

    async function checkScheduledMeeting() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/get_medical_meetings`);
        const meetings = await res.json();

        const now = new Date();

        const upcoming = meetings.find((m) => {
          const t = new Date(m.meeting_time);
          return t >= now && t - now <= 5 * 60 * 1000; // within 5 minutes
        });

        if (upcoming) {
          const userEmail = localStorage.getItem("email")?.toLowerCase();

          const isParticipant = upcoming.participants.some(
            (p) =>
              p.email?.toLowerCase() === userEmail ||
              p?.toLowerCase() === userEmail
          );

          if (!isParticipant) {
            console.log("⛔ User is not a participant, popup blocked");
            return; // ❌ do not show popup
          }

          Swal.fire({
            title: "Scheduled Meeting Detected",
            html: `
    <b>${upcoming.meeting_title}</b><br/>
    ${new Date(upcoming.meeting_time).toLocaleString()}
  `,
            icon: "info",
            confirmButtonText: "Load Meeting",
          }).then(() => {
            // setCurrentMeeting(upcoming);
            setParticipants(upcoming.participants);
            setMeetingTitle(upcoming.meeting_title);
            // ⬇️ NEW — Load agenda
            if (Array.isArray(upcoming.agenda)) {
              setAgenda(upcoming.agenda);
            }
          });
        }
      } catch (err) {
        console.error(err);
      }
    }

    checkScheduledMeeting();
  }, []);

  const createMeetingIfNeeded = async () => {
    const token = localStorage.getItem("token");
    // const BACKEND_URL = "https://ai-meeting-assistant-backend-suu9.onrender.com";
    const BACKEND_URL =
      "https://ai-meeting-assistant-backend-suu9.onrender.com";
    const today = new Date();
    const formattedDate = today.toLocaleDateString("en-GB");
    console.log("Meeting Title: ", meetingTitle);
    const hostEmail = (localStorage.getItem("email") || "").toLowerCase();
    const hostName =
      localStorage.getItem("name") || localStorage.getItem("email") || "Host";

    // Normalize other participants
    const normalizedParticipants = participants.map((p) => ({
      name: p.name || "",
      email: (p.email || "").toLowerCase(),
      role: p.role || "participant",
    }));

    // Check if host already exists
    const hostExists = normalizedParticipants.some(
      (p) => p.email && p.email === hostEmail
    );
    try {
      const res = await fetch(
        `https://ai-meeting-assistant-backend-suu9.onrender.com/api/meetings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: meetingTitle,
            host: localStorage.getItem("email") || "Host",

            participants: [
              // ✅ Add host ONLY if missing
              ...(!hostExists && hostEmail
                ? [
                    {
                      name: hostName,
                      email: hostEmail,
                      role: "host",
                    },
                  ]
                : []),

              // Other participants
              ...normalizedParticipants,
            ],
          }),
        }
      );

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
    actionItems // <-- pass your React state action items here
  ) => {
    const token = localStorage.getItem("token");
    const BACKEND_URL =
      "https://ai-meeting-assistant-backend-suu9.onrender.com";

    try {
      // Build combined summary text (for display & emails)
      const combinedSummary = `
📝 **Overview**
${summaryData?.overview || "No overview available."}

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
`;

      // API request body
      const body = {
        transcript: structuredTranscript, // Structured speaker transcript
        summary: combinedSummary, // Combined summary string
        overview: summaryData?.overview || "",
        insights: summaryData?.insights || [],
        outline: summaryData?.outline || [],
        key_points: summaryData?.key_points || [],
        action_items: actionItems, // <-- NEW checklist version
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
      setRecordBtnLoading(true); // ← show loader + disable button

      // Prevent double click for 2 seconds
      setTimeout(() => setRecordBtnLoading(false), 2000);
      console.log(currentMeeting, "----this is before meeting---------");
      // alert(currentMeeting);

      if (!currentMeeting) {
        console.log(
          currentMeeting,
          "----this is inside the meeting nffwe meeting---------"
        );
        showToast && showToast("Creating a new meeting...");
        const newMeeting = await createMeetingIfNeeded();
        if (!newMeeting) {
          setRecordBtnLoading(false);
          showToast("Failed to create meeting", "error");
          return;
        }
        setCurrentMeeting(newMeeting);
      }

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
      setMeetingStartTime(new Date());

      setIsRecording(true);
      showToast && showToast("Recording started...");
    } catch (err) {
      setRecordBtnLoading(false);
      console.error("❌ Error starting recording:", err);
      showToast("Microphone access denied or meeting creation failed", "error");
    }
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      showToast && showToast("Recording stopped.");
    }
    localStorage.removeItem("mom_transcriptData");
    localStorage.removeItem("mom_actionItems");
    localStorage.removeItem("mom_activeTab");

    // Optional: reset local state too
    setTranscriptData(null);
    setActionItems([]);
    setActiveTab("summary");
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
            summary: finalData?.summary || "",
            overview: finalData?.overview || "",
            insights: finalData?.insights || [],
            outline: finalData?.outline || [],
            key_points: finalData?.key_points || [],
            action_items: actionItems || [],
            decisions_made: finalData?.decisions_made || [],
            structured_transcript: finalData?.structured_transcript || [],
            participants,
            meeting_id: currentMeeting?.id,
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
        <h2>Live Meeting</h2>

        <div className="recording-panel">
          <div className="participant-info">
            <span>Participants: {participants.length}</span>
          </div>

          <div className="record-buttons">
            <button
              className="btn btn-participant"
              onClick={() => setShowParticipantModal(true)}
            >
              <span className="filter-icon">👥 </span> Manage Participants
            </button>

            {!isRecording ? (
              <button
                className="btn btn-record"
                onClick={startRecording}
                disabled={recordBtnLoading || participants.length === 0}
              >
                {recordBtnLoading ? "⏳ Starting..." : "🎤 Start Recording"}
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
        {agenda.length > 0 && (
          <div className="agenda-box">
            <h3>📋 Agenda</h3>
            <ul>
              {agenda.map((a, i) => (
                <li key={i}>
                  <strong>{a.item}</strong> — {a.speaker_name} —{" "}
                  {a.speaker_email}
                  <span style={{ color: "#777" }}>
                    {" "}
                    (at {a.time_offset} min)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
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

              <div className="overflow-x-auto mt-3">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-100 text-left text-sm text-gray-700 bg-white dark-bg-clr">
                      <th className=" w-8"></th>
                      <th className="">Task</th>
                      <th className="">Assigned To</th>
                      <th className="">Due Date</th>
                      <th className="">Note</th>
                      <th className=" w-28">Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {actionItems.map((item, i) => (
                      <tr key={i} className="border-b hover:bg-gray-50">
                        {/* Checkbox */}
                        <td className="">
                          <input
                            type="checkbox"
                            checked={item.completed}
                            onChange={() => toggleComplete(i)}
                            className=" cursor-pointer checkbox-design"
                          />
                        </td>

                        {/* Task */}
                        <td className="p-2">
                          {editIndex === i ? (
                            <input
                              type="text"
                              value={editItem.task}
                              onChange={(e) =>
                                setEditItem({
                                  ...editItem,
                                  task: e.target.value,
                                })
                              }
                              className="border p-1 rounded w-full text-sm"
                            />
                          ) : (
                            <span
                              className={`text-sm ${
                                item.completed
                                  ? "line-through text-gray-400"
                                  : "text-gray-700"
                              }`}
                            >
                              {item.task}
                            </span>
                          )}
                        </td>

                        {/* Owner */}
                        <td className="p-2">
                          {editIndex === i ? (
                            <input
                              type="text"
                              value={editItem.owner || ""}
                              onChange={(e) =>
                                setEditItem({
                                  ...editItem,
                                  owner: e.target.value,
                                })
                              }
                              className="border p-1 rounded w-full text-sm"
                            />
                          ) : (
                            <span className="text-sm">{item.owner || "-"}</span>
                          )}
                        </td>

                        {/* Due Date */}
                        <td className="p-2">
                          {editIndex === i ? (
                            <input
                              type="date"
                              value={editItem.due_date || ""}
                              onChange={(e) =>
                                setEditItem({
                                  ...editItem,
                                  due_date: e.target.value,
                                })
                              }
                              className="border p-1 rounded w-full text-sm"
                            />
                          ) : (
                            <span className="text-sm">
                              {item.due_date || "-"}
                            </span>
                          )}
                        </td>

                        {/* Note */}
                        <td className="p-2">
                          {editIndex === i ? (
                            <input
                              type="text"
                              value={editItem.note || ""}
                              onChange={(e) =>
                                setEditItem({
                                  ...editItem,
                                  note: e.target.value,
                                })
                              }
                              className="border p-1 rounded w-full text-sm"
                            />
                          ) : (
                            <span className="text-sm">{item.note || "-"}</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="p-2 flex justify-center gap-2">
                          {editIndex === i ? (
                            <>
                              <button
                                className="px-2 py-1 border me-2 border-green-600 text-green-600 rounded hover:bg-green-600 hover:text-white"
                                onClick={() => saveEdit(i)}
                              >
                                ✅
                              </button>

                              <button
                                className="px-2 py-1 border border-gray-500 text-gray-600 rounded hover:bg-gray-600 hover:text-white"
                                onClick={cancelEdit}
                              >
                                ✖
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="px-2 py-1 border border-blue-600 text-blue-600 rounded hover:bg-blue-600 hover:text-white btn-edit"
                                onClick={() => startEditing(i)}
                              >
                                <Pencil></Pencil>
                              </button>

                              <button
                                className="px-2 py-1 border border-red-600 text-red-600 rounded hover:bg-red-600 hover:text-whit btn-dlt"
                                onClick={() => deleteItem(i)}
                              >
                                <Trash2></Trash2>
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Add Action Item */}
                {!showInput && (
                  <button
                    onClick={() => setShowInput(true)}
                    className="mt-3 text-gray-600 hover:text-gray-900 text-sm btn-add"
                  >
                    + Add action item
                  </button>
                )}

                {showInput && (
                  <div className="flex gap-2 mt-3">
                    <input
                      type="text"
                      placeholder="New action item..."
                      value={newItem}
                      onChange={(e) => setNewItem(e.target.value)}
                      className="border p-2 rounded w-80"
                    />
                    <button
                      onClick={addNewItem}
                      className="btn-primary btn-prime"
                    >
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
