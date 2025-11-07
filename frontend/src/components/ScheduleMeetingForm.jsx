import React, { useState, useEffect } from "react";
import "../styles/MeetingSchedule.css";

const MedicalMeetingScheduler = () => {
  const [formData, setFormData] = useState({
    meeting_title: "",
    meeting_type: "",
    meeting_time: "",
    host_email: "",
    participants: [{ name: "", email: "", role: "" }],
  });

  const [response, setResponse] = useState({ type: "", message: "" });

  // Prefill host email from localStorage
  useEffect(() => {
    const storedEmail = localStorage.getItem("email") || "";
    setFormData((prev) => ({ ...prev, host_email: storedEmail }));
  }, []);

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
  };

  const handleParticipantChange = (index, field, value) => {
    const updated = [...formData.participants];
    updated[index][field] = value;
    setFormData((prev) => ({ ...prev, participants: updated }));
  };

  const addParticipant = () => {
    setFormData((prev) => ({
      ...prev,
      participants: [...prev.participants, { name: "", email: "", role: "" }],
    }));
  };

  const removeParticipant = (index) => {
    const updated = [...formData.participants];
    updated.splice(index, 1);
    setFormData((prev) => ({ ...prev, participants: updated }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setResponse({ type: "", message: "" });

    try {

  function toLocalIsoWithOffset(dateString) {
  const date = new Date(dateString);

  // Get timezone offset in hours and minutes
  const tzOffset = -date.getTimezoneOffset();
  const sign = tzOffset >= 0 ? "+" : "-";
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const hours = pad(tzOffset / 60);
  const minutes = pad(tzOffset % 60);

  // Build ISO string with offset
  const iso = date.toISOString().replace("Z", "");
  return `${iso}${sign}${hours}:${minutes}`;
}

// Original meeting time
const meetingTimeISO = toLocalIsoWithOffset(formData.meeting_time);

// 1 hour later
const oneHourLater = new Date(formData.meeting_time);
oneHourLater.setHours(oneHourLater.getHours() + 1);
const oneHourLaterISO = toLocalIsoWithOffset(oneHourLater.toISOString());

const payload = {
  ...formData,
  meeting_time: toLocalIsoWithOffset(formData.meeting_time)
};

const n8npayload = {
  ...formData,
  meeting_time: meetingTimeISO,       // Original time
  reminder_time: oneHourLaterISO      // 1 hour later
};

      // Send to n8n webhook
      const n8nWebhookUrl = "https://n8n-latest-h3pu.onrender.com/webhook/0ca8d94d-a335-43f8-90c7-130fe37292b3";
      await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(n8npayload),
      });

      // Save to Flask MongoDB API
      const flaskAPI = "https://ai-meeting-assistant-backend-suu9.onrender.com/api/save_medical_meeting";
      const flaskRes = await fetch(flaskAPI, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (flaskRes.ok) {
        setResponse({
          type: "success",
          message: "✅ Medical meeting scheduled successfully!",
        });
        setFormData({
          meeting_title: "",
          meeting_type: "",
          meeting_time: "",
          host_email: localStorage.getItem("email") || "",
          participants: [{ name: "", email: "", role: "" }],
        });
      } else {
        setResponse({
          type: "error",
          message: "❌ Error saving meeting. Please try again.",
        });
      }
    } catch (err) {
      console.error(err);
      setResponse({
        type: "error",
        message: "❌ Network issue — unable to connect to server.",
      });
    }
  };

  return (
    <div className="meeting-container">
      <h2> Schedule a Meeting</h2>
      <form onSubmit={handleSubmit} className="meeting-form">
        {/* Meeting Title */}
        <div>
          <label>Meeting Title</label>
          <input
            id="meeting_title"
            type="text"
            placeholder="e.g., Post-surgery follow-up"
            value={formData.meeting_title}
            onChange={handleChange}
            required
          />
        </div>

        {/* Meeting Type */}
        <div>
          <label>Meeting Type</label>
          <select
            id="meeting_type"
            value={formData.meeting_type}
            onChange={handleChange}
            required
          >
            <option value="">Select Meeting Type</option>
            <option value="Consultation">Consultation</option>
            <option value="Case Discussion">Case Discussion</option>
            <option value="Follow-up">Follow-up</option>
            <option value="Team Meeting">Team Meeting</option>
            <option value="Training Session">Training Session</option>
          </select>
        </div>

        {/* Meeting Time */}
        <div>
          <label>Meeting Date & Time</label>
          <input
            id="meeting_time"
            type="datetime-local"
            value={formData.meeting_time}
            onChange={handleChange}
            required
          />
        </div>

        {/* Host */}
        <div>
          <label>Host (Doctor/Staff Email)</label>
          <input id="host_email" type="email" value={formData.host_email} readOnly />
        </div>

        {/* Participants */}
        <div className="participants-section">
          <label>Add Participants</label>
          {formData.participants.map((p, index) => (
            <div key={index} className="participant-row">
              <input
                type="text"
                placeholder="Name"
                value={p.name}
                onChange={(e) => handleParticipantChange(index, "name", e.target.value)}
                required
              />
              <input
                type="email"
                placeholder="Email"
                value={p.email}
                onChange={(e) => handleParticipantChange(index, "email", e.target.value)}
                required
              />
              <select
                value={p.role}
                onChange={(e) => handleParticipantChange(index, "role", e.target.value)}
                required
              >
                <option value="">Select Role</option>
                <option value="Doctor">Doctor</option>
                <option value="Nurse">Nurse</option>
                <option value="Patient">Patient</option>
                <option value="Technician">Technician</option>
                <option value="Admin Staff">Admin Staff</option>
              </select>

              {formData.participants.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeParticipant(index)}
                  className="remove-btn"
                >
                  ❌
                </button>
              )}
            </div>
          ))}

          <button type="button" onClick={addParticipant} className="add-btn">
            + Add Participant
          </button>
        </div>

        <button type="submit">💾 Schedule Meeting</button>
      </form>

      {response.message && (
        <div
          className={`response-message ${
            response.type === "success" ? "response-success" : "response-error"
          }`}
        >
          {response.message}
        </div>
      )}
    </div>
  );
};

export default MedicalMeetingScheduler;
