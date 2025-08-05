import React from "react";

const MeetingHistory = ({
  meetings,
  searchQuery,
  setSearchQuery,
  participantFilter,
  setParticipantFilter,
  fetchMeetings,
  setCurrentMeeting,
  setTranscript,
  setSummary,
  setActiveTab,
}) => {
  return (
    <div className="tab-content">
      <div className="history-header">
        <h2>Meeting History</h2>
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
        {meetings.length > 0 ? (
          meetings.map((meeting) => (
            <div key={meeting.id} className="meeting-card">
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
                  {meeting.participants.join(", ") || "None listed"}
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
          <div className="empty-state">
            No meetings found. Create your first meeting by recording or
            uploading audio.
          </div>
        )}
      </div>
    </div>
  );
};

export default MeetingHistory;
