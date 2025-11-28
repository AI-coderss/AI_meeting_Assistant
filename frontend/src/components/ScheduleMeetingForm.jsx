import React, { useState, useEffect } from "react";
import "../styles/MeetingSchedule.css";

// MedicalMeetingScheduler.jsx
// - Adds agenda modal (separate UI) where each agenda item has:
//   - agenda text
//   - speaker dropdown (from participants)
//   - time offset (minutes into the meeting)
// - Agendas only addable when meeting_time is set AND there is at least one participant other than host
// - Stores agenda as array of objects: { item, speaker_email, speaker_name, time_offset }

const formatMinutesLabel = (m) => `${m} min`;

const MinutesOptions = ({ max = 180 }) => {
  const opts = [];
  for (let i = 0; i <= max; i++) {
    opts.push(
      <option key={i} value={i}>
        {formatMinutesLabel(i)}
      </option>
    );
  }
  return opts;
};

const emptyAgendaRow = () => ({ item: "", speaker_email: "", speaker_name: "", time_offset: 0 });

const MedicalMeetingScheduler = () => {
  const [formData, setFormData] = useState({
    meeting_title: "",
    meeting_type: "",
    meeting_time: "",
    host_email: "",
    participants: [{ name: "", email: "", role: "" }],
    // agenda will be an array of objects (saved only when user confirms in modal)
    agenda: [],
  });

  const [response, setResponse] = useState({ type: "", message: "" });
  const [isScheduling, setIsScheduling] = useState(false);

  // Modal state
  const [showAgendaModal, setShowAgendaModal] = useState(false);
  // local modal state for editing agenda rows before saving to formData
  const [modalAgendaRows, setModalAgendaRows] = useState([emptyAgendaRow()]);
  const [modalError, setModalError] = useState("");

  // Prefill host email & name from localStorage
  useEffect(() => {
    const storedEmail = localStorage.getItem("email") || "";
    const storedName = localStorage.getItem("name") || "";

    setFormData((prev) => ({
      ...prev,
      host_email: storedEmail,
      participants: [
        {
          name: storedName,
          email: storedEmail,
          role: "Host",
        },
        ...prev.participants,
      ],
    }));
  }, []);

  // Helpers
  const availableParticipants = () =>
    formData.participants.filter((p) => p && p.email && p.name);

  const nonHostCount = () =>
    formData.participants.filter((p) => p && p.role !== "Host").length;

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
  };

  const handleParticipantChange = (index, field, value) => {
    const updated = [...formData.participants];
    updated[index] = { ...updated[index], [field]: value };
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

  // Agenda modal handlers
  const openAgendaModal = () => {
    setModalError("");
    // Validation: meeting_time must be set, and there must be at least one participant other than host
    if (!formData.meeting_time) {
      setModalError("Please select the meeting date & time before adding agenda items.");
      return;
    }
    if (nonHostCount() < 1) {
      setModalError("Please add at least one participant (other than the host) before creating agendas.");
      return;
    }

    // Prefill modal with existing agenda if present, else a single empty row
    if (formData.agenda && formData.agenda.length > 0) {
      setModalAgendaRows(
        formData.agenda.map((a) => ({ ...a }))
      );
    } else {
      setModalAgendaRows([emptyAgendaRow()]);
    }

    setShowAgendaModal(true);
  };

  const closeAgendaModal = () => {
    setModalError("");
    setShowAgendaModal(false);
  };

  const handleModalRowChange = (index, field, value) => {
    const updated = [...modalAgendaRows];
    updated[index] = { ...updated[index], [field]: value };
    // if speaker_email changed, also set speaker_name from participants lookup
    if (field === "speaker_email") {
      const p = formData.participants.find((pp) => pp.email === value);
      updated[index].speaker_name = p ? p.name : "";
    }
    setModalAgendaRows(updated);
  };

  const addModalAgendaRow = () => {
    setModalAgendaRows((prev) => [...prev, emptyAgendaRow()]);
  };

  const removeModalAgendaRow = (index) => {
    const updated = [...modalAgendaRows];
    updated.splice(index, 1);
    setModalAgendaRows(updated.length ? updated : [emptyAgendaRow()]);
  };

  const validateModalBeforeSave = () => {
    for (let i = 0; i < modalAgendaRows.length; i++) {
      const r = modalAgendaRows[i];
      if (!r.item || !r.speaker_email || r.time_offset === "") {
        return `Please fill all fields for agenda row ${i + 1}.`;
      }
      // ensure speaker email exists in participants
      const exists = formData.participants.some((p) => p.email === r.speaker_email);
      if (!exists) return `Selected speaker for row ${i + 1} is not a current participant.`;
    }
    return "";
  };

  const saveModalAgenda = () => {
    const err = validateModalBeforeSave();
    if (err) {
      setModalError(err);
      return;
    }
    // Save to main form data (deep copy)
    setFormData((prev) => ({ ...prev, agenda: modalAgendaRows.map((r) => ({ ...r })) }));
    setShowAgendaModal(false);
  };

  // Convert to Saudi ISO (same helper as before)
  function toSaudiIso(dateString) {
    const [datePart, timePart] = dateString.split("T");
    if (!timePart) return null;
    return `${datePart}T${timePart}:00+03:00`;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsScheduling(true);
    setResponse({ type: "", message: "" });

    try {
      const saudiMeetingISO = toSaudiIso(formData.meeting_time);

      // Reminder (1 hour later)
      const oneHourLater = new Date(formData.meeting_time);
      oneHourLater.setHours(oneHourLater.getHours() + 1);
      const saudiReminderISO = toSaudiIso(oneHourLater.toISOString());

      const payload = {
        ...formData,
        meeting_time: saudiMeetingISO,
      };

      const n8npayload = {
        ...formData,
        meeting_time: saudiMeetingISO,
        reminder_time: saudiReminderISO,
      };

      // Send to n8n webhook
      const n8nWebhookUrl =
        "https://n8n-latest-h3pu.onrender.com/webhook/e6ed149a-7494-4477-b2dd-f6a254fa36de";
      await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(n8npayload),
      });

      // Save to Flask MongoDB API
      const flaskAPI =
        "https://ai-meeting-assistant-backend-suu9.onrender.com/api/save_medical_meeting";
      const flaskRes = await fetch(flaskAPI, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (flaskRes.ok) {
        setResponse({ type: "success", message: "✅ Medical meeting scheduled successfully in Saudi time!" });
        setFormData({
          meeting_title: "",
          meeting_type: "",
          meeting_time: "",
          host_email: localStorage.getItem("name") || "",
          participants: [{ name: "", email: "", role: "" }],
          agenda: [],
        });
      } else {
        setResponse({ type: "error", message: "❌ Error saving meeting. Please try again." });
      }
    } catch (err) {
      console.error(err);
      setResponse({ type: "error", message: "❌ Network issue — unable to connect to server." });
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <div className="meeting-container">
      {isScheduling && (
        <div className="fullscreen-loader">
          <div className="loader-text">⏳ Scheduling your meeting...</div>
        </div>
      )}

      <h2 className="h3 h2-md h1-lg">Schedule a Meeting</h2>
      <form onSubmit={handleSubmit} className="meeting-form">
        <div className="fex-sec">
          {/* Meeting Title */}
          <div>
            <label>Meeting Title</label>
            <input id="meeting_title" type="text" placeholder="e.g., Post-surgery follow-up" value={formData.meeting_title} onChange={handleChange} required />
          </div>

          {/* Meeting Type */}
          <div>
            <label>Meeting Type</label>
            <select id="meeting_type" value={formData.meeting_type} onChange={handleChange} required>
              <option value="">Select Meeting Type</option>
              <option value="Consultation">Consultation</option>
              <option value="Case Discussion">Case Discussion</option>
              <option value="Follow-up">Follow-up</option>
              <option value="Team Meeting">Team Meeting</option>
              <option value="Training Session">Training Session</option>
            </select>
          </div>
        </div>

        <div className="fex-sec">
          {/* Meeting Time */}
          <div>
            <label>Meeting Date & Time (Saudi Time)</label>
            <input id="meeting_time" type="datetime-local" value={formData.meeting_time} onChange={handleChange} required />
          </div>

          {/* Host */}
          <div>
            <label>Host (Doctor/Staff Email)</label>
            <input id="host_email" type="email" value={formData.host_email} readOnly />
          </div>
        </div>

        {/* Participants */}
        <div className="participants-section">
          <label>Add Participants</label>
          {formData.participants.map((p, index) => (
            <div key={index} className="participant-row">
              <input type="text" placeholder="Name" value={p.name} onChange={(e) => handleParticipantChange(index, "name", e.target.value)} required />
              <input type="email" placeholder="Email" value={p.email} onChange={(e) => handleParticipantChange(index, "email", e.target.value)} required />
              <select value={p.role} onChange={(e) => handleParticipantChange(index, "role", e.target.value)} required>
                <option value="">Select Role</option>
                <option value="Doctor">Doctor</option>
                <option value="Nurse">Nurse</option>
                <option value="Patient">Department manager</option>
                <option value="Technician">Employee</option>
                <option value="Admin Staff">Admin Staff</option>
              </select>

              {index !== 0 && formData.participants.length > 1 && (
                <button type="button" onClick={() => removeParticipant(index)} className="remove-btn">❌</button>
              )}
            </div>
          ))}

          <div className="text-center mt-3 mb-3">
            <button type="button" onClick={addParticipant} className="add-btn">+ Add Participant</button>
          </div>
        </div>
        {/* Agenda Button (opens modal) */}
        <div className="participants-section">
          <label>Agenda Items</label>

          <div className="text-center mt-3 mb-3">
            <button type="button" className="add-btn" onClick={openAgendaModal}>
              + Add / Edit Agenda Items
            </button>
            {modalError && <div className="response-error mt-2">{modalError}</div>}
          </div>

          {/* show quick summary of current agendas */}
          {formData.agenda && formData.agenda.length > 0 ? (
            <div className="agenda-summary">
              {formData.agenda.map((a, i) => (
                <div key={i} className="agenda-row">
                  <strong>{a.item}</strong>
                  <div>
                    Speaker: {a.speaker_name || a.speaker_email} • At {formatMinutesLabel(a.time_offset)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">No agenda items added yet.</div>
          )}
        </div>
        <button type="submit">💾 Schedule Meeting</button>
      </form>

      {response.message && (
        <div className={`response-message ${response.type === "success" ? "response-success" : "response-error"}`}>
          {response.message}
        </div>
      )}

     {showAgendaModal && (
  <div className="custom-modal-overlay">
    <div className="custom-modal">
      <h3 className="modal-title">Add Agenda Items</h3>

      <div className="modal-subtext">
        Meeting starts at: {formData.meeting_time}
      </div>

      {modalAgendaRows.map((row, idx) => (
        <div className="agenda-row" key={idx}>
          <input
            type="text"
            placeholder={`Agenda item ${idx + 1}`}
            value={row.item}
            onChange={(e) => handleModalRowChange(idx, "item", e.target.value)}
          />

          <select
            value={row.speaker_email}
            onChange={(e) => handleModalRowChange(idx, "speaker_email", e.target.value)}
          >
            <option value="">Select speaker</option>
            {formData.participants
              .filter((p) => p && p.email)
              .map((p, i) => (
                <option key={i} value={p.email}>
                  {p.name || p.email}
                  {/* {p.role === "Host" ? " (Host)" : ""} */}
                </option>
              ))}
          </select>
       <div className="d-flex align-items-center gap-1">

         <input
  type="number"
  min={0}
  max={180}
  step={1}
  value={row.time_offset}
  onChange={(e) =>
    handleModalRowChange(idx, "time_offset", parseInt(e.target.value, 10))
  }
  className="time-offset-input"
/>
<p class="mins-m">mins</p></div>


          <button className="remove-icon" onClick={() => removeModalAgendaRow(idx)}>✕</button>
        </div>
      ))}


      <div className="modal-actions">
        <div className="">
      <button className="add-row-btn" onClick={addModalAgendaRow}>
        + Add
      </button>
      </div>
      <div className="d-flex gap-2">
        <button className="save-btn" onClick={saveModalAgenda}>Save</button>
        <button className="cancel-btn" onClick={closeAgendaModal}>Cancel</button>
        </div>
      </div>
    </div>
  </div>
)}

    </div>
  );
};

export default MedicalMeetingScheduler;
