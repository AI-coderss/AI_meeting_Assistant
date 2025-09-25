import React, { useEffect, useState } from "react";

const MeetingHistory = ({
  setCurrentMeeting,
  setTranscript,
  setSummary,
  setActiveTab,
}) => {
  const [meetings, setMeetings] = useState([]);
  const [hostName, setHostName] = useState("");
  const [loading, setLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [participantFilter, setParticipantFilter] = useState("");

  const token = localStorage.getItem("token");

  // Fetch meetings by host + optional search/participant filters
  const fetchMeetings = async () => {
    if (!hostName) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      if (participantFilter) params.append("participant", participantFilter);

      const url = `http://127.0.0.1:8001/api/meetings/host/${hostName}${
        params.toString() ? `?${params.toString()}` : ""
      }`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const data = await res.json();
      setMeetings(data);
    } catch (err) {
      console.error("Failed to fetch meetings:", err);
    } finally {
      setLoading(false);
    }
  };

  // Step 1: set hostName from localStorage
  useEffect(() => {
    const storedEmail = localStorage.getItem("email");
    if (storedEmail) {
      setHostName(storedEmail);
    }
  }, []);

  // Step 2: whenever hostName is set, fetch meetings by default
  useEffect(() => {
    if (hostName) {
      fetchMeetings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostName]);

  return (
    <div className="tab-content">
      <div className="history-header">
        <h2>Meeting History (by Host)</h2>
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
          <button className="btn btn-search" onClick={fetchMeetings}>
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
                  onClick={() => {
                    setCurrentMeeting(meeting);
                    setTranscript(meeting.transcript || []);
                    setSummary(meeting.summary || null);
                    setActiveTab("live");
                  }}
                >
                  View
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">No meetings found for this host.</div>
        )}
      </div>
    </div>
  );
};

export default MeetingHistory;
