import React, { useEffect, useState, useCallback, useContext } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import MeetingContext from "./context/MeetingContext";
import axios from "axios";
import Swal from "sweetalert2";
import { shareMeetingToN8n } from "../utils/shareToN8n";
import api from "../api/api";

const MeetingHistory = () => {
  const [meetings, setMeetings] = useState([]);
  const [hostName, setHostName] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [participantFilter, setParticipantFilter] = useState("");
  const [modalMeeting, setModalMeeting] = useState(null);
  const { selectedMeeting, setSelectedMeeting } = useContext(MeetingContext);
  const getMeetingId = (m) => (m ? m.id || m._id : null);

  const handleSelectForAI = (meeting) => {
    const currentId = getMeetingId(selectedMeeting);
    const newId = getMeetingId(meeting);

    console.log("Current selected ID:", currentId);
    console.log("Clicked meeting ID:", newId);

    if (currentId === newId) {
      console.log("Unselecting meeting");
      setSelectedMeeting(null);
    } else {
      console.log("Selecting meeting...");
      setSelectedMeeting(meeting);
    }
  };

  const token = localStorage.getItem("token");

 const handleShareToN8n = async (meeting) => {
  try {
    // Optional: show loading popup
    Swal.fire({
      title: "Sharing meeting...",
      text: "Please wait while we send the data",
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

await shareMeetingToN8n(meeting);

    Swal.fire({
      icon: "success",
      title: "Shared successfully",
      text: "Meeting has been sent to the automation workflow",
      timer: 2000,
      showConfirmButton: false,
    });
  } catch (error) {
    console.error("Failed to share meeting:", error);

    Swal.fire({
      icon: "error",
      title: "Share failed",
      text: "Unable to share meeting. Please try again.",
      confirmButtonText: "OK",
    });
  }
};
const formatParticipants = (participants = []) => {
  if (!Array.isArray(participants)) return "None";

  return participants
    .map((p) => p?.name || p?.email)
    .filter(Boolean)
    .join(", ");
};

  const fetchMeetings = useCallback(async () => {
  if (!hostName) return;

  setLoading(true);
  try {
    const params = new URLSearchParams();
    if (searchQuery) params.append("search", searchQuery);
    if (participantFilter) params.append("participant", participantFilter);

    const res = await api.get(
      `/api/meetings/host/${hostName}${params.toString() ? `?${params.toString()}` : ""}`
    );

    setMeetings(res.data);
  } catch (err) {
    console.error("Failed to fetch meetings:", err);
  } finally {
    setLoading(false);
  }
}, [hostName, searchQuery, participantFilter]);


  useEffect(() => {
    const storedEmail = localStorage.getItem("email");
    if (storedEmail) setHostName(storedEmail);
  }, []);

  useEffect(() => {
    if (hostName) fetchMeetings();
  }, [hostName, fetchMeetings]);

  const handleViewMeeting = (meeting) => {
    setModalMeeting(meeting);
  };

  const closeModal = () => setModalMeeting(null);

  const handleSearch = () => fetchMeetings();

  return (
    <div className="tab-content">
      <div className="history-header">
        <h2 className="fs-4 fs-sm-3 fs-md-2 fw-semibold mb-3 text-center text-md-start text-dark dark:text-white">
          Meeting History
        </h2>

        <div className="search-controls">
          <input
            type="text"
            placeholder="Search meetings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <input
            type="text"
            placeholder="Filter by participant..."
            value={participantFilter}
            onChange={(e) => setParticipantFilter(e.target.value)}
            className="search-input"
          />
          <button className="search-view" onClick={handleSearch}>
            🔍 Search
          </button>
        </div>
      </div>

      <div className="meetings-list">
        {loading ? (
          <p>Loading meetings...</p>
        ) : meetings.length > 0 ? (
          meetings.map((meeting) => (
            <div
              key={meeting.id || meeting._id}
              className={`meeting-card ${
                (selectedMeeting?.id ?? selectedMeeting?._id) ===
                (meeting.id ?? meeting._id)
                  ? "selected-meeting"
                  : ""
              }`}
            >
              <div className="card-header">
                <h3>{meeting.title}</h3>
                <span className="meeting-date">
                  {new Date(meeting.timestamp).toLocaleDateString()}
                </span>
              </div>
              <div className="card-body">
                <p>
                  <strong>Host:</strong> {meeting.host}
                </p>
                <p>
                  <strong>Participants:</strong>{" "}
                 {formatParticipants(meeting.participants) || "None listed"}
                </p>
                <p>
                  <strong>Status:</strong> {meeting.status}
                </p>
                <p>
                  <strong>Transcript segments:</strong>{" "}
                  {meeting.transcript?.length || 0}
                </p>
              </div>
              <div className="card-actions">
                <button
                  className="btn btn-view"
                  onClick={() => handleViewMeeting(meeting)}
                >
                  View
                </button>
                <button
                  className={`btn btn-select ${
                    (selectedMeeting?.id ?? selectedMeeting?._id) ===
                    (meeting.id ?? meeting._id)
                      ? "selected"
                      : ""
                  }`}
                  onClick={() => handleSelectForAI(meeting)}
                >
                  {(selectedMeeting?.id ?? selectedMeeting?._id) ===
                  (meeting.id ?? meeting._id)
                    ? "Unselect"
                    : "Select"}
                </button>
                <button
                  className="btn btn-share"
                  onClick={() => handleShareToN8n(meeting)}
                >
                  Share
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            {hostName
              ? "No meetings found for this host."
              : "Please log in to view meetings."}
          </div>
        )}
      </div>

      {/* ✅ Modal Content */}
      {modalMeeting && (
        <div className="modal-overlay" onClick={closeModal}>
          <div
            className="modal-content bg-space"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="btn-close-modal">
              <button className=" btn-close" onClick={closeModal}></button>
            </div>
            <h2>{modalMeeting.title}</h2>
            <p>
              <strong>Host:</strong> {modalMeeting.host}
            </p>
            <p>
              <strong>Participants:</strong>{" "}
               {formatParticipants(modalMeeting.participants) || "None"}
            </p>
            <p>
              <strong>Status:</strong> {modalMeeting.status}
            </p>
            <p>
              <strong>Date:</strong>{" "}
              {new Date(modalMeeting.timestamp).toLocaleString()}
            </p>

            {/* ✅ Render summary object safely */}
            {/* Summary Section */}
            {modalMeeting.summary && (
              <div className="summary-section">
                <h3 className="section-title">Summary</h3>

                <div className="markdown-box">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {modalMeeting.summary.full_summary ||
                      modalMeeting.summary.summary ||
                      "No summary available"}
                  </ReactMarkdown>
                </div>

                {/* Key Points */}
                {modalMeeting.summary.key_points?.length > 0 && (
                  <>
                    <h4 className="sub-title">Key Points</h4>
                    <ul className="nice-list">
                      {modalMeeting.summary.key_points.map((point, idx) => (
                        <li key={idx}>{point}</li>
                      ))}
                    </ul>
                  </>
                )}

                {/* Action Items */}
                {modalMeeting.summary.action_items?.length > 0 && (
                  <>
                    <h4 className="sub-title">Action Items </h4>
                    <ul className="nice-list">
                      {modalMeeting.summary.action_items.map((item, idx) => (
                        <li key={idx}>
                          <strong>{item.task}</strong>
                          {item.owner && ` — ${item.owner}`}
                          {item.due_date &&
                            ` (Due: ${new Date(
                              item.due_date
                            ).toLocaleDateString()})`}
                          {item.note && (
                            <div style={{ fontSize: "13px", opacity: 0.8 }}>
                              💬 {item.note}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {/* Decisions */}
                {modalMeeting.summary.decisions_made?.length > 0 && (
                  <>
                    <h4 className="sub-title">Decisions Made</h4>
                    <ul className="nice-list">
                      {modalMeeting.summary.decisions_made.map((d, idx) => (
                        <li key={idx}>{d}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* ✅ Render transcript */}
            {/* Transcript */}
            {modalMeeting.transcript?.length > 0 && (
              <div className="transcript-section">
                <h3 className="section-title">Transcript</h3>

                {modalMeeting.transcript.map((t, idx) => (
                  <div key={idx} className="transcript-line">
                    <strong>{t.speaker}:</strong>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {t.text}
                    </ReactMarkdown>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ✅ Inline CSS for modal styling */}
      <style jsx>{`
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 9999;
        }
        .modal-content {
          background: white;
          width: 80%;
          max-height: 90vh;
          overflow-y: auto;
          border-radius: 12px;
          padding: 2rem;
          box-shadow: 0 0 20px rgba(0, 0, 0, 0.3);
          position: relative;
          color: #222;
        }
        .modal-close {
          position: absolute;
          top: 10px;
          right: 15px;
          background: none;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
        }
        .transcript-section {
          background: #f9f9f9;
          padding: 1rem;
          border-radius: 8px;
        }
        .modal-content h2 {
          color: #004aad;
          font-size: 21px;
        }
        .modal-content h3 {
          margin-top: 1rem;
          color: #0073e6;
          font-size: 20px;
        }
        .btn-close-modal {
          display: flex;
          justify-content: end;
        }
        .btn-close-modal .btn.btn-close {
          box-shadow: unset;
        }
        .section-title {
          font-size: 22px;
          margin-top: 20px;
          margin-bottom: 10px;
          font-weight: 700;
          color: #0066cc;
        }

        .sub-title {
          font-size: 18px;
          margin-top: 15px;
          color: #444;
          font-weight: 600;
        }

        .markdown-box {
          background: #f8f9fc;
          border: 1px solid #e3e6f0;
          padding: 15px 20px;
          border-radius: 10px;
          margin-bottom: 15px;
          font-size: 15px;
          line-height: 1.6;
          color: #333;
        }

        .markdown-box p {
          margin-bottom: 12px;
        }

        .nice-list {
          background: #f8f9fc;
          padding: 12px 20px;
          border-radius: 10px;
          border-left: 4px solid #0073e6;
        }

        .nice-list li {
          margin-bottom: 8px;
        }

        .transcript-section {
          margin-top: 25px;
        }

        .transcript-line {
          background: #fafafa;
          padding: 10px 15px;
          margin-bottom: 10px;
          border-radius: 8px;
          border: 1px solid #eee;
        }

        .transcript-line strong {
          display: block;
          color: #333;
          margin-bottom: 5px;
        }
        .modal-content.bg-space {
          flex: 1 1;
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
          width: 100%;
          animation: fadeIn 0.5s ease-out;
          padding-top: 20px;
        }
        .dark-theme .modal-content.bg-space {
          background-color: rgb(19 24 32);
          box-shadow: rgb(177 177 186 / 25%) 0px 50px 100px -20px,
            rgba(0, 0, 0, 0.3) 0px 30px 60px -30px,
            rgb(153 162 171 / 35%) 0px -2px 6px 0px inset;
        }
        .dark-theme .markdown-box {
          background: #131820;
          border: 1px solid #48494c;
        }
        .dark-theme .btn-close-modal .btn.btn-close {
          box-shadow: unset;
          filter: invert(1);
        }
        .dark-theme .summary-section li {
          color: #ffff;
        }
        .dark-theme .transcript-line {
          background: #131820;
          border: 1px solid #48494c;
        }
        .dark-theme .transcript-line strong {
          color: #fff;
        }
        .meeting-card {
          position: relative;
          overflow: visible !important; /* allow glow outside */
          border-radius: 14px; /* adjust to match your card */
        }

        /* when selected */
        .selected-meeting {
          position: relative;
          z-index: 2;
          background: #f0f7ff !important;
        }

        /* OUTER GLOW LAYER (animation ONLY here) */
        .selected-meeting::after {
          content: "";
          position: absolute;
          top: 6px;
          left: 6px;
          right: 9px;
          bottom: 4px;
          border-radius: 16px;
          z-index: -1;
          animation: pulseBorder 2s infinite ease-in-out,
            radiationBorder 2.5s infinite ease-out;
        }
        .dark-theme .btn-select.selected {
          background-color: #307f7f !important;
        }
        /* soft blue pulse */
        @keyframes pulseBorder {
          0% {
            box-shadow: 0 0 0 0 rgba(74, 144, 226, 0.4);
          }
          50% {
            box-shadow: 0 0 18px 12px rgba(74, 144, 226, 0.25);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(74, 144, 226, 0);
          }
        }

        /* slow breathing glow */
        @keyframes radiationBorder {
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.04);
          }
          100% {
            transform: scale(1);
          }
        }

        .btn-select.selected {
          background: #4a90e2 !important;
          color: white !important;
        }
        .btn-select {
          color: #fff;
        }
        .btn-select:hover {
          color: #ffffff;
        }
        .btn-view:hover {
          color: #fff;
        }
        .dark-theme .selected-meeting {
          background-color: #1e2637 !important;
        }
        .btn-share {
          background: #6c63ff;
          color: #fff;
        }

        .btn-share:hover {
          background: #5848e5;
          color: #fff;
        }
      `}</style>
    </div>
  );
};

export default MeetingHistory;
