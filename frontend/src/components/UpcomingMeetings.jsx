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
    const storedEmail = localStorage.getItem("email");
    if (!storedEmail) {
      console.error("No email in localStorage");
      return;
    }

    const res = await fetch(
      `https://ai-meeting-assistant-backend-suu9.onrender.com/api/get_user_medical_meetings?email=${encodeURIComponent(
        storedEmail
      )}`
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("Bad response:", text);
      throw new Error("Failed to fetch user meetings");
    }

    const data = await res.json();
    console.log("User meetings:", data);

    const now = new Date();
    const upcoming = data.filter((m) => {
      const meetingTime = new Date(m.meeting_time);
      return meetingTime > now;
    });

    setMeetings(upcoming);
  } catch (err) {
    console.error("Error fetching user meetings:", err);
  } finally {
    setLoading(false);
  }
};


  const formatDate = (gmtString) =>
    new Date(gmtString).toLocaleString("en-SA", {
      timeZone: "Asia/Riyadh",
      dateStyle: "medium",
      timeStyle: "short",
    });

  return (
    <div className="upcoming-container">
      <h2 class="fw-bold text-center my-4 fs-4 fs-sm-3 fs-md-2 fs-lg-1">
        🩺 Upcoming Medical Meetings
      </h2>

      {loading ? (
        <p>Loading meetings...</p>
      ) : meetings.length === 0 ? (
        <p>No upcoming meetings scheduled.</p>
      ) : (
        <div className="table-responsive">
          <table className="upcoming-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Scheduled Time</th>
                <th>Host</th>
                <th>Participants</th>
                <th>Agenda's</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m, idx) => (
                <tr key={idx}>
                  <td>{m.meeting_title}</td>
                  <td>{m.meeting_type}</td>
                  <td>{formatDate(m.meeting_time)}</td>
                  <td>{m.host_email}</td>
                  <td>{m.participants.map((p) => p.email).join(", ")}</td>
               <td>
  <ul style={{ margin: 0, paddingLeft: "20px" }}>
    {m.agenda?.map((ag, i) => (
      <li key={i}>
        {ag.item}{" "}
        {ag.scheduled_time
          ? `(${new Date(ag.scheduled_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`
          : ""}
        {ag.speaker_email ? ` - ${ag.speaker_name} (${ag.speaker_email})` : ""}
      </li>
    ))}
  </ul>
</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default UpcomingMeetings;
