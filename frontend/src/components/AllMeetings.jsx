import React, { useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Swal from "sweetalert2";
import { FaTrash } from "react-icons/fa";

/**
 * AllMeetings.jsx
 *
 * - Fetches /api/meetings/all on mount
 * - Displays meeting cards
 * - Modal view with summary, key points, action items (TABLE), decisions, transcript
 * - Delete on card + inside modal
 *
 * NOTE: set REACT_APP_API_BASE in env to override the default backend base URL.
 */
const API_BASE = process.env.REACT_APP_API_BASE || "https://ai-meeting-assistant-backend-suu9.onrender.com";

const AllMeetings = () => {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [participantFilter, setParticipantFilter] = useState("");
  const [selectedMeeting, setSelectedMeeting] = useState(null);

  const token = localStorage.getItem("token");

  const fetchAllMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`https://ai-meeting-assistant-backend-suu9.onrender.com/api/meetings/all`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      setMeetings(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch meetings:", err);
      Swal.fire("Error", "Unable to load meetings", "error");
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Filtered fetch when hitting Search (calls existing /meetings route with query params)
  const fetchFilteredMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      if (participantFilter) params.append("participant", participantFilter);

      const url = `${API_BASE}/api/meetings${params.toString() ? `?${params.toString()}` : ""}`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      setMeetings(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch filtered meetings:", err);
      Swal.fire("Error", "Unable to search meetings", "error");
    } finally {
      setLoading(false);
    }
  }, [searchQuery, participantFilter, token]);

  useEffect(() => {
    fetchAllMeetings();
  }, [fetchAllMeetings]);

  // delete meeting by id (available on card + inside modal)
  const deleteMeeting = async (id, afterDeleteCloseModal = false) => {
    const result = await Swal.fire({
      title: "Are you sure?",
      text: "This meeting will be permanently deleted.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#d33",
      cancelButtonColor: "#3085d6",
      confirmButtonText: "Yes, delete it!",
    });

    if (!result.isConfirmed) return;

    try {
      const res = await fetch(`${API_BASE}/api/meetings/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Delete failed: ${res.status}`);
      }

      Swal.fire("Deleted!", "Meeting has been deleted.", "success");
      // refresh list
      await fetchAllMeetings();
      if (afterDeleteCloseModal) setSelectedMeeting(null);
    } catch (err) {
      console.error("Failed to delete meeting:", err);
      Swal.fire("Error!", "Failed to delete meeting. Please try again.", "error");
    }
  };

  // Safe participants renderer (handles strings, objects, mixed arrays)
  const renderParticipants = (participants) => {
    if (!participants) return "None listed";
    if (!Array.isArray(participants)) return String(participants);
    return participants
      .map((p) => {
        if (typeof p === "string") return p;
        // try common keys
        return p.name || p.email || p.id || JSON.stringify(p);
      })
      .join(", ");
  };

  // Safe action item cells (ensure we don't try to render objects directly)
  const renderActionItemsRow = (ai) => {
    // ai may be string or object
    if (!ai) return { task: "-", owner: "-", due_date: "-", note: "-" };
    if (typeof ai === "string") return { task: ai, owner: "-", due_date: "-", note: "-" };
    // assume object with task, owner, due_date, note
    return {
      task: ai.task ?? "-",
      owner: ai.owner ?? "-",
      due_date: ai.due_date ?? "-",
      note: ai.note ?? "-",
    };
  };

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
          <button
            className="search-view"
            onClick={() => {
              // call filtered endpoint
              fetchFilteredMeetings();
            }}
          >
            🔍 Search
          </button>
          <button
            className="search-view"
            style={{ marginLeft: 8 }}
            onClick={() => {
              // reset filters and fetch all
              setSearchQuery("");
              setParticipantFilter("");
              fetchAllMeetings();
            }}
          >
            ⟲ Reset
          </button>
        </div>
      </div>

      <div className="meetings-list">
        {loading ? (
          <p>Loading meetings...</p>
        ) : meetings.length > 0 ? (
          meetings.map((meeting) => {
            const id = meeting.id || meeting._id;
            return (
              <div key={id} className="meeting-card">
                <div className="card-header">
                  <h3>{meeting.title || "Untitled meeting"}</h3>
                  <span className="meeting-date">
                    {meeting.timestamp ? new Date(meeting.timestamp).toLocaleDateString() : "-"}
                  </span>
                </div>

                <div className="card-body">
                  <p>
                    <strong>Host:</strong> {meeting.host || "-"}
                  </p>
                  <p>
                    <strong>Participants:</strong> {renderParticipants(meeting.participants)}
                  </p>
                  <p>
                    <strong>Status:</strong> {meeting.status || "-"}
                  </p>
                  <p>
                    <strong>Transcript segments:</strong> {meeting.transcript?.length || 0}
                  </p>
                </div>

                <div className="card-actions">
                  <button
                    className="btn btn-view"
                    onClick={() => setSelectedMeeting(meeting)}
                  >
                    View
                  </button>

                  <button
                    className="btn btn-delete"
                    onClick={() => deleteMeeting(id, false)}
                    title="Delete meeting"
                    style={{ marginLeft: 8 }}
                  >
                    <FaTrash />
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="empty-state">No meetings found.</div>
        )}
      </div>

      {/* Modal */}
      {selectedMeeting && (
        <div className="modal-overlay" onClick={() => setSelectedMeeting(null)}>
          <div
            className="modal-content bg-space"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="btn-close-modal">
              <button className="btn btn-close" onClick={() => setSelectedMeeting(null)}></button>
            </div>
{/* 
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h2 style={{ margin: 0 }}>{selectedMeeting.title || "Untitled"}</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-delete"
                  onClick={() => deleteMeeting(selectedMeeting.id || selectedMeeting._id, true)}
                  title="Delete meeting"
                >
                  <FaTrash /> Delete
                </button>
              </div>
            </div> */}

            <p>
              <strong>Host:</strong> {selectedMeeting.host || "-"}
            </p>
            <p>
              <strong>Participants:</strong> {renderParticipants(selectedMeeting.participants)}
            </p>
            <p>
              <strong>Status:</strong> {selectedMeeting.status || "-"}
            </p>
            <p>
              <strong>Date:</strong>{" "}
              {selectedMeeting.timestamp ? new Date(selectedMeeting.timestamp).toLocaleString() : "-"}
            </p>

            {/* Summary */}
            {selectedMeeting.summary && (
              <div className="summary-section">
                <h3 className="section-title">Summary</h3>
                <div className="markdown-box">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedMeeting.summary.full_summary ||
                      selectedMeeting.summary.summary ||
                      "No summary available"}
                  </ReactMarkdown>
                </div>

                {/* Key Points */}
                {selectedMeeting.summary.key_points?.length > 0 && (
                  <>
                    <h4 className="sub-title">Key Points</h4>
                    <ul className="nice-list">
                      {selectedMeeting.summary.key_points.map((point, idx) => (
                        <li key={idx}>{String(point)}</li>
                      ))}
                    </ul>
                  </>
                )}

                {/* Action Items TABLE */}
                {selectedMeeting.summary.action_items?.length > 0 && (
                  <>
                    <h4 className="sub-title">Action Items</h4>
                    <div style={{ overflowX: "auto", marginBottom: 12 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: 8, borderBottom: "2px solid #e6eefc" }}>Task</th>
                            <th style={{ textAlign: "left", padding: 8, borderBottom: "2px solid #e6eefc" }}>Owner</th>
                            <th style={{ textAlign: "left", padding: 8, borderBottom: "2px solid #e6eefc" }}>Due Date</th>
                            <th style={{ textAlign: "left", padding: 8, borderBottom: "2px solid #e6eefc" }}>Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedMeeting.summary.action_items.map((rawAi, idx) => {
                            const ai = renderActionItemsRow(rawAi);
                            return (
                              <tr key={idx}>
                                <td style={{ padding: 8, borderBottom: "1px solid #f1f5fb" }}>{ai.task}</td>
                                <td style={{ padding: 8, borderBottom: "1px solid #f1f5fb" }}>{ai.owner}</td>
                                <td style={{ padding: 8, borderBottom: "1px solid #f1f5fb" }}>{ai.due_date || "-"}</td>
                                <td style={{ padding: 8, borderBottom: "1px solid #f1f5fb" }}>{ai.note}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {/* Decisions */}
                {selectedMeeting.summary.decisions_made?.length > 0 && (
                  <>
                    <h4 className="sub-title">Decisions Made</h4>
                    <ul className="nice-list">
                      {selectedMeeting.summary.decisions_made.map((d, idx) => (
                        <li key={idx}>{String(d)}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* Transcript */}
            {selectedMeeting.transcript?.length > 0 && (
              <div className="transcript-section">
                <h3 className="section-title">Transcript</h3>

                {selectedMeeting.transcript.map((t, idx) => (
                  <div key={idx} className="transcript-line">
                    <strong>{t.speaker || t.s || "Speaker"}:</strong>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.text || t.t || ""}</ReactMarkdown>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inline CSS */}
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
          padding: 20px;
          box-sizing: border-box;
        }
        .modal-content {
          background: white;
          width: 100%;
          max-width: 1200px;
          max-height: 90vh;
          overflow-y: auto;
          border-radius: 12px;
          padding: 2rem;
          box-shadow: 0 0 20px rgba(0, 0, 0, 0.3);
          position: relative;
          color: #222;
        }
        .meeting-card {
          border: 1px solid #e6eefc;
          padding: 16px;
          border-radius: 10px;
          margin-bottom: 12px;
          background: #fff;
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 8px;
        }
        .card-body p {
          margin: 6px 0;
        }
        .card-actions {
          margin-top: 10px;
          display: flex;
          gap: 8px;
        }
        .btn {
          padding: 8px 12px;
          border-radius: 8px;
          cursor: pointer;
        }
        .btn-view {
          background: #0073e6;
          color: white;
          border: none;
        }
        .btn-delete {
          background: #fff0f0;
          color: #c00;
          border: 1px solid #f5c6cb;
        }
        .section-title {
          font-size: 20px;
          margin-top: 18px;
          margin-bottom: 8px;
          color: #0066cc;
        }
        .sub-title {
          font-size: 16px;
          margin-top: 12px;
          margin-bottom: 8px;
          color: #333;
        }
        .markdown-box {
          background: #f8f9fc;
          border: 1px solid #e3e6f0;
          padding: 15px 20px;
          border-radius: 10px;
          margin-bottom: 12px;
          font-size: 15px;
          line-height: 1.6;
          color: #333;
        }
        .nice-list {
          background: #f8f9fc;
          padding: 12px 20px;
          border-radius: 10px;
          border-left: 4px solid #0073e6;
        }
        .transcript-section {
          margin-top: 20px;
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
          margin-bottom: 6px;
        }

        /* dark-theme adjustments if needed */
        .dark-theme .modal-content {
          background: #111418;
          color: #fff;
        }
        .dark-theme .markdown-box {
          background: #131820;
          border: 1px solid #48494c;
        }
      `}</style>
    </div>
  );
};

export default AllMeetings;
