import React from "react";
import Swal from "sweetalert2";
import { FaTrash } from "react-icons/fa";
const AllMeetings = ({
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
  // 🔹 Delete meeting API call
    const deleteMeeting = async (id) => {
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
    const token = localStorage.getItem("token");
    try {
      const response = await fetch(`/api/meetings/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await response.json();
      Swal.fire("Deleted!", "Meeting has been deleted.", "success");
      fetchMeetings(); // 🔄 refresh meetings
    } catch (error) {
      console.error("Failed to delete meeting:", error);
      Swal.fire("Error!", "Failed to delete meeting. Please try again.", "error");
    }
  };


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
            <div key={meeting.id} className="meeting-card relative">
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
                  className="btn btn-view text-white"
                  onClick={() => {
                    setCurrentMeeting(meeting);
                    setTranscript(meeting.transcript || []);
                    setSummary(meeting.summary || null);
                    setActiveTab("live");
                  }}
                >
                  View
                </button>
                <div className=" del-responsive">
                <button
                  className="btn btn-delete "
                  onClick={() => deleteMeeting(meeting.id)}
                >
                 <span className="text-danger"> <FaTrash /></span>
                </button>
                </div>
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

export default AllMeetings;
