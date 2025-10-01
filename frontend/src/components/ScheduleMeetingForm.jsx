import React, { useState } from "react";
import "../styles/MeetingSchedule.css";

const ScheduleMeetingForm = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    phone: "",
    demo_date: "",
    duration_minutes: 30,
    message: "",
  });

  const [response, setResponse] = useState({ type: "", message: "" });

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setResponse({ type: "", message: "" });

    try {
      const payload = {
        ...formData,
        demo_date: new Date(formData.demo_date).toISOString(),
        duration_minutes: parseInt(formData.duration_minutes, 10),
      };

      const res = await fetch("http://127.0.0.1:8001/api/schedule_meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        setResponse({
          type: "success",
          message: (
            <div>
              ✅ Demo Scheduled! <br />
              Meet Link:{" "}
              <a href={data.meet_link} target="_blank" rel="noreferrer">
                {data.meet_link}
              </a>
              <br />
              Calendar:{" "}
              <a href={data.calendar_link} target="_blank" rel="noreferrer">
                Open Google Calendar
              </a>
            </div>
          ),
        });
        setFormData({
          name: "",
          email: "",
          company: "",
          phone: "",
          demo_date: "",
          duration_minutes: 30,
          message: "",
        });
      } else {
        setResponse({
          type: "error",
          message: `❌ ${data.error || "Something went wrong"}`,
        });
      }
    } catch (err) {
      setResponse({ type: "error", message: "❌ Failed to connect to server" });
    }
  };

  return (
    <div className="meeting-container">
      <h2>📅 Schedule a Demo</h2>
      <form onSubmit={handleSubmit} className="meeting-form">
        <div>
          <label>Name</label>
          <input
            id="name"
            type="text"
            value={formData.name}
            onChange={handleChange}
            required
          />
        </div>

        <div>
          <label>Email</label>
          <input
            id="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
            required
          />
        </div>

        <div>
          <label>Company</label>
          <input
            id="company"
            type="text"
            value={formData.company}
            onChange={handleChange}
          />
        </div>

        <div>
          <label>Phone</label>
          <input
            id="phone"
            type="text"
            value={formData.phone}
            onChange={handleChange}
          />
        </div>

        <div>
          <label>Date & Time (Your Local Time)</label>
          <input
            id="demo_date"
            type="datetime-local"
            value={formData.demo_date}
            onChange={handleChange}
            required
          />
          <p className="info-text">
            This will be converted to UTC automatically
          </p>
        </div>

        <div>
          <label>Duration (minutes)</label>
          <input
            id="duration_minutes"
            type="number"
            value={formData.duration_minutes}
            onChange={handleChange}
            required
          />
        </div>

        <div>
          <label>Message</label>
          <textarea
            id="message"
            value={formData.message}
            onChange={handleChange}
          />
        </div>

        <button type="submit">Schedule</button>
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

export default ScheduleMeetingForm;
