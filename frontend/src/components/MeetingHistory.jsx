import React, { useEffect, useState, useCallback } from "react";

const MeetingHistory = () => {
  const [meetings, setMeetings] = useState([]);
  const [hostName, setHostName] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [participantFilter, setParticipantFilter] = useState("");
  const [selectedMeeting, setSelectedMeeting] = useState(null);

  const token = localStorage.getItem("token");

  const fetchMeetings = useCallback(async () => {
    if (!hostName) return;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      if (participantFilter) params.append("participant", participantFilter);

      const url = `https://ai-meeting-assistant-backend-suu9.onrender.com/api/meetings/host/${hostName}${
        params.toString() ? `?${params.toString()}` : ""
      }`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = await res.json();
      setMeetings(data);
    } catch (err) {
      console.error("Failed to fetch meetings:", err);
    } finally {
      setLoading(false);
    }
  }, [hostName, searchQuery, participantFilter, token]);

  useEffect(() => {
    const storedEmail = localStorage.getItem("email");
    if (storedEmail) setHostName(storedEmail);
  }, []);

  useEffect(() => {
    if (hostName) fetchMeetings();
  }, [hostName, fetchMeetings]);

  const handleViewMeeting = (meeting) => {
    setSelectedMeeting(meeting);
  };

  const closeModal = () => setSelectedMeeting(null);

  const handleSearch = () => fetchMeetings();

  return (
    <div className="tab-content">
      <div className="history-header">
        <h2 class="fs-4 fs-sm-3 fs-md-2 fw-semibold mb-3 text-center text-md-start text-dark dark:text-white">
          Meeting History (by Host)
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
            <div key={meeting.id || meeting._id} className="meeting-card">
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
                  {meeting.participants?.join(", ") || "None listed"}
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
      {selectedMeeting && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="btn-close-modal">
              <button className="btn btn-close" onClick={closeModal}></button>
            </div>
            <h2>{selectedMeeting.title}</h2>
            <p>
              <strong>Host:</strong> {selectedMeeting.host}
            </p>
            <p>
              <strong>Participants:</strong>{" "}
              {selectedMeeting.participants?.join(", ") || "None"}
            </p>
            <p>
              <strong>Status:</strong> {selectedMeeting.status}
            </p>
            <p>
              <strong>Date:</strong>{" "}
              {new Date(selectedMeeting.timestamp).toLocaleString()}
            </p>

            {/* ✅ Render summary object safely */}
            {selectedMeeting.summary && (
              <div className="meeting-summary">
                <h3>Summary</h3>
                <p>
                  {selectedMeeting.summary.summary || "No summary available"}
                </p>

                {selectedMeeting.summary.key_points?.length > 0 && (
                  <>
                    <h4>Key Points</h4>
                    <ul>
                      {selectedMeeting.summary.key_points.map((point, idx) => (
                        <li key={idx}>{point}</li>
                      ))}
                    </ul>
                  </>
                )}

                {selectedMeeting.summary.action_items?.length > 0 && (
                  <>
                    <h4>Action Items</h4>
                    <ul>
                      {selectedMeeting.summary.action_items.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </>
                )}

                {selectedMeeting.summary.decisions_made?.length > 0 && (
                  <>
                    <h4>Decisions Made</h4>
                    <ul>
                      {selectedMeeting.summary.decisions_made.map(
                        (decision, idx) => (
                          <li key={idx}>{decision}</li>
                        )
                      )}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* ✅ Render transcript */}
            {selectedMeeting.transcript?.length > 0 && (
              <div className="meeting-transcript">
                <h3>Transcript</h3>
                {selectedMeeting.transcript.map((t, idx) => (
                  <p key={idx}>
                    <strong>{t.speaker}:</strong> {t.text}
                  </p>
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
      `}</style>
    </div>
  );
};

export default MeetingHistory;
