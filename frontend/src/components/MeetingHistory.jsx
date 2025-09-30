import React, { useEffect, useState, useCallback } from "react";

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

  // ✅ Use useCallback to prevent unnecessary recreations
  const fetchMeetings = useCallback(async () => {
    if (!hostName) {
      console.log("No hostname available yet");
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      if (participantFilter) params.append("participant", participantFilter);

      const url = `http://127.0.0.1:8001/api/meetings/host/${hostName}${
        params.toString() ? `?${params.toString()}` : ""
      }`;

      console.log("Fetching meetings from:", url);

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
      console.log("Fetched meetings:", data);
      setMeetings(data);
    } catch (err) {
      console.error("Failed to fetch meetings:", err);
      // ✅ Keep existing meetings instead of clearing them on error
    } finally {
      setLoading(false);
    }
  }, [hostName, searchQuery, participantFilter, token]);

  // Step 1: set hostName from localStorage
  useEffect(() => {
    const storedEmail = localStorage.getItem("email");
    console.log("Setting hostname from localStorage:", storedEmail);
    if (storedEmail) {
      setHostName(storedEmail);
    }
  }, []);

  // Step 2: fetch meetings when dependencies change
  useEffect(() => {
    if (hostName) {
      console.log("Hostname changed, fetching meetings...");
      fetchMeetings();
    }
  }, [hostName, fetchMeetings]);

  // ✅ Improved view meeting handler with validation
  const handleViewMeeting = (meeting) => {
    console.log("Setting current meeting:", meeting);

    // Validate meeting object
    if (!meeting || !meeting.id) {
      console.error("Invalid meeting object:", meeting);
      return;
    }

    // Set states in a batch to prevent race conditions
    setCurrentMeeting(meeting);
    setTranscript(meeting.transcript || []);
    setSummary(meeting.summary || null);
    setActiveTab("live");

    console.log("Meeting set successfully, switching to live tab");
  };

  // ✅ Handle search with debouncing
  const handleSearch = () => {
    fetchMeetings();
  };

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
          <button className="btn btn-search" onClick={handleSearch}>
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
                {/* ✅ Add language display for debugging */}
                <p>
                  <strong>Language:</strong>{" "}
                  {meeting.language || "Not specified"}
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
    </div>
  );
};

export default MeetingHistory;
