import React, { useEffect, useState } from "react";
import "../styles/UpcomingMeetings.css";

const UpcomingMeetings = () => {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUpcomingMeetings();
  }, []);

  useEffect(() => {
  if (!("Notification" in window)) return;

  Notification.requestPermission(); // Ask permission once

  const checkReminders = () => {
    const now = new Date();
    meetings.forEach((m) => {
      const meetingTime = new Date(m.meeting_time);
      const diffMinutes = (meetingTime - now) / 1000 / 60;
      if (diffMinutes > 59 && diffMinutes <= 60) {
        // Fire notification only once
        new Notification("Meeting Reminder", {
          body: `${m.meeting_title} starts in 1 hour!`,
        });
      }
    });
  };

  const interval = setInterval(checkReminders, 60 * 1000); // check every minute
  return () => clearInterval(interval);
}, [meetings]);

// Check if browser supports notifications
// if ("Notification" in window) {
//   Notification.requestPermission().then((permission) => {
//     if (permission === "granted") {
//       // Show a test notification
//       new Notification("🩺 Test Meeting Reminder", {
//         body: "This is a test notification for a meeting starting in 1 hour!",
//         icon: "https://cdn-icons-png.flaticon.com/512/2910/2910768.png", // optional icon
//       });
//     } else {
//       alert("Notification permission denied");
//     }
//   });
// } else {
//   alert("Your browser does not support notifications.");
// }

  const fetchUpcomingMeetings = async () => {
    try {
      const res = await fetch("http://127.0.0.1:8001/api/get_medical_meetings");
      const data = await res.json();

      // Filter only future meetings
      const now = new Date();
      const upcoming = data.filter(
        (m) => new Date(m.meeting_time) > now
      );
      setMeetings(upcoming);
    } catch (err) {
      console.error("Error fetching meetings:", err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (iso) =>
    new Date(iso).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });

  return (
    <div className="upcoming-container">
      <h2>🩺 Upcoming Medical Meetings</h2>

      {loading ? (
        <p>Loading meetings...</p>
      ) : meetings.length === 0 ? (
        <p>No upcoming meetings scheduled.</p>
      ) : (
        <table className="upcoming-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Scheduled Time</th>
              <th>Host</th>
              <th>Participants</th>
            </tr>
          </thead>
          <tbody>
            {meetings.map((m, idx) => (
              <tr key={idx}>
                <td>{m.meeting_title}</td>
                <td>{m.meeting_type}</td>
                <td>{formatDate(m.meeting_time)}</td>
                <td>{m.host_email}</td>
                <td>
                  {m.participants.map((p) => p.email).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default UpcomingMeetings;
