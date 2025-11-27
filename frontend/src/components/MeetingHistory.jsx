import React, { useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
          <div className="modal-content bg-space" onClick={(e) => e.stopPropagation()}>
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
            {/* Summary Section */}
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
                        <li key={idx}>{point}</li>
                      ))}
                    </ul>
                  </>
                )}

                {/* Action Items */}
                {selectedMeeting.summary.action_items?.length > 0 && (
                  <>
                    <h4 className="sub-title">Action Items </h4>
                    <ul className="nice-list">
                      {selectedMeeting.summary.action_items.map((item, idx) => (
                        <li key={idx}>
  <strong>{item.task}</strong>
  {item.owner && ` — ${item.owner}`}
  {item.due_date && ` (Due: ${new Date(item.due_date).toLocaleDateString()})`}
  {item.note && <div style={{ fontSize: "13px", opacity: 0.8 }}>💬 {item.note}</div>}
</li>

                      ))}
                    </ul>
                  </>
                )}

                {/* Decisions */}
                {selectedMeeting.summary.decisions_made?.length > 0 && (
                  <>
                    <h4 className="sub-title">Decisions Made</h4>
                    <ul className="nice-list">
                      {selectedMeeting.summary.decisions_made.map((d, idx) => (
                        <li key={idx}>{d}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* ✅ Render transcript */}
            {/* Transcript */}
            {selectedMeeting.transcript?.length > 0 && (
              <div className="transcript-section">
                <h3 className="section-title">Transcript</h3>

                {selectedMeeting.transcript.map((t, idx) => (
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
    animation: fadeIn 0.5s 
ease-out;
    padding-top: 20px;
}
 .dark-theme .modal-content.bg-space {
    background-color: rgb(19 24 32);
    box-shadow: rgb(177 177 186 / 25%) 0px 50px 100px -20px, rgba(0, 0, 0, 0.3) 0px 30px 60px -30px, rgb(153 162 171 / 35%) 0px -2px 6px 0px inset;
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
    .dark-theme  .transcript-line strong {
    color: #fff;
}
      `}</style>
    </div>
  );
};

export default MeetingHistory;
