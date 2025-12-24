import React, { useState, useEffect, useContext } from "react";
import "../styles/MeetingSchedule.css";
import VoiceAssistant from "./VoiceAssistant.jsx";
import { FormContext } from "./context/FormContext.jsx";
import api from "../api/api";
import SearchableMeetingType from "./SearchableMeetingType.jsx";

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

const emptyAgendaRow = () => ({
  item: "",
  speaker_email: "",
  speaker_name: "",
  time_offset: 0,
});

const MedicalMeetingScheduler = () => {
  // const [formData, setFormData] = useState({
  //   meeting_title: "",
  //   meeting_type: "",
  //   meeting_time: "",
  //   host_email: "",
  //   participants: [],
  //   // agenda will be an array of objects (saved only when user confirms in modal)
  //   agenda: [],
  // });
  // useEffect(() => {
  //   console.log("🟦 Updated FORM DATA:", formData);
  // }, [formData]);
  const { formData, setFormData } = useContext(FormContext);
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
      ],
    }));
  }, []);

  useEffect(() => {
    const handler = (e) => {
      console.log("🔥 voice_participant EVENT RECEIVED:", e.detail.name);

      const { mode, index, name, email, role, field, value } = e.detail;

      // -----------------------------
      // MODE 1: ADD PARTICIPANT
      // -----------------------------
      if (mode === "add") {
  console.log("➕ Adding new participant row...");

  setFormData(prev => {
    const updated = [...prev.participants, { name: "", email: "", role: "" }];
    return { ...prev, participants: updated };
  });

  setTimeout(() => {
    setFormData(prev => {
      const targetIndex = prev.participants.length - 1; // NEW correct index

      console.log("🆕 Correct participant index:", targetIndex);

      const updated = [...prev.participants];
      updated[targetIndex] = {
        ...updated[targetIndex],
        name: e.detail.name,
        email: e.detail.email,
        role: e.detail.role,
      };

      return { ...prev, participants: updated };
    });
  }, 50);

  return;
}
      // -----------------------------
      // MODE 2: UPDATE PARTICIPANT FIELD
      // -----------------------------
      if (mode === "update") {
        console.log(
          `✏️ Updating participant index ${index}, field "${field}" with value "${value}"`
        );

        handleParticipantChange(index, field, value);

        console.log("📌 Updated participants:", formData.participants);
        return;
      }
    };

    window.addEventListener("voice_participant", handler);
    return () => window.removeEventListener("voice_participant", handler);
  },[]);

  useEffect(() => {
    const handler = (e) => {
      const { index, field, value } = e.detail;
      handleParticipantChange(index, field, value);
    };
    window.addEventListener("voice_set_participant", handler);
    return () => window.removeEventListener("voice_set_participant", handler);
  }, [formData]);

  useEffect(() => {
    function handleDeleteAgenda(e) {
      const { index, all } = e.detail;

      setFormData((prev) => {
        let updatedAgenda = [...prev.agenda];

        if (all) {
          updatedAgenda = [];
        } else if (index !== undefined) {
          updatedAgenda.splice(index, 1);
        }

        return { ...prev, agenda: updatedAgenda };
      });
    }

    window.addEventListener("voice_delete_agenda", handleDeleteAgenda);
    return () =>
      window.removeEventListener("voice_delete_agenda", handleDeleteAgenda);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const { item, speaker_email, time_offset } = e.detail;

      setFormData((prev) => ({
        ...prev,
        agenda: [
          ...prev.agenda,
          {
            item,
            speaker_email,
            speaker_name:
              prev.participants.find((p) => p.email === speaker_email)?.name ||
              "",
            time_offset,
          },
        ],
      }));
    };
    window.addEventListener("voice_add_agenda", handler);
    return () => window.removeEventListener("voice_add_agenda", handler);
  }, [formData]);

  // Helpers
  const availableParticipants = () =>
    formData.participants.filter((p) => p && p.email && p.name);

  const nonHostCount = () =>
    formData.participants.filter((p) => p && p.role !== "Host").length;

  const agendaDisabled = !formData.meeting_time || nonHostCount() < 1;
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
    // if (!formData.meeting_time) {
    //   setModalError("Please select the meeting date & time before adding agenda items.");
    //   return;
    // }
    // if (nonHostCount() < 1) {
    //   setModalError("Please add at least one participant (other than the host) before creating agendas.");
    //   return;
    // }

    // Prefill modal with existing agenda if present, else a single empty row
    if (formData.agenda && formData.agenda.length > 0) {
      setModalAgendaRows(formData.agenda.map((a) => ({ ...a })));
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
      const exists = formData.participants.some(
        (p) => p.email === r.speaker_email
      );
      if (!exists)
        return `Selected speaker for row ${
          i + 1
        } is not a current participant.`;
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
    setFormData((prev) => ({
      ...prev,
      agenda: modalAgendaRows.map((r) => ({ ...r })),
    }));
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

    // 🔹 Public webhook → fetch
    await fetch(
      "https://n8n-latest-h3pu.onrender.com/webhook/e6ed149a-7494-4477-b2dd-f6a254fa36de",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(n8npayload),
      }
    );

    // 🔐 Authenticated API → api instance
    await api.post("/api/save_medical_meeting", payload);

    setResponse({
      type: "success",
      message: "✅ Medical meeting scheduled successfully in Saudi time!",
    });

    setFormData({
      meeting_title: "",
      meeting_type: "",
      meeting_time: "",
      host_email: localStorage.getItem("email") || "",
      participants: [{ name: "", email: "", role: "" }],
      agenda: [],
    });
  } catch (err) {
    console.error("❌ Scheduling error:", err);
    setResponse({
      type: "error",
      message: "❌ Unable to schedule meeting. Please try again.",
    });
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

      <div className="d-flex gap-5 mob">
        <div className="participants-section border-right">
          <label className="agenda-item">Agenda Items</label>
          {/* show quick summary of current agendas */}
          {formData.agenda && formData.agenda.length > 0 ? (
            <div className=" block-line">
              {formData.agenda.map((a, i) => (
                <div key={i} className=" ">
                  <strong>{a.item}</strong>
                  <div>
                    Speaker: {a.speaker_name || a.speaker_email} • At{" "}
                    {formatMinutesLabel(a.time_offset)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">No agenda items added yet.</div>
          )}
          <div className=" mt-3 mb-3">
            <button
              type="button"
              className="add-btn"
              onClick={openAgendaModal}
              disabled={agendaDisabled}
            >
              + Add / Edit Agenda Items
            </button>
            {modalError && (
              <div className="response-error mt-2">{modalError}</div>
            )}
          </div>
        </div>
        <form onSubmit={handleSubmit} className="meeting-form">
          <h2 className="h3 h2-md h1-lg">Schedule a Meeting</h2>

          <div className="fex-sec">
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
            <SearchableMeetingType
  value={formData.meeting_type}
  onChange={(val) =>
    setFormData({ ...formData, meeting_type: val })
  }
/>

          </div>

          <div className="fex-sec">
            {/* Meeting Time */}
            <div>
              <label>Meeting Date & Time (Saudi Time)</label>
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
              <input
                id="host_email"
                type="email"
                value={formData.host_email}
                readOnly
              />
            </div>
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
                  onChange={(e) =>
                    handleParticipantChange(index, "name", e.target.value)
                  }
                  required
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={p.email}
                  onChange={(e) =>
                    handleParticipantChange(index, "email", e.target.value)
                  }
                  required
                />
                <input
                  type="text"
                  placeholder="Role (e.g., Doctor, Nurse, Employee)"
                  value={p.role}
                  onChange={(e) =>
                    handleParticipantChange(index, "role", e.target.value)
                  }
                  required
                />

                {index !== 0 && formData.participants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeParticipant(index)}
                    className="remove-btn  remove-icon"
                  >
                    X
                  </button>
                )}
              </div>
            ))}

            <div className="text-center mt-3 mb-3">
              <button
                type="button"
                onClick={addParticipant}
                className="add-btn"
              >
                + Add Participant
              </button>
            </div>
          </div>
          {/* Agenda Button (opens modal) */}
          <div className="participants-section mob-visible">
            <label className="agenda-item">Agenda Items</label>
            {/* show quick summary of current agendas */}
            {formData.agenda && formData.agenda.length > 0 ? (
              <div className=" block-line">
                {formData.agenda.map((a, i) => (
                  <div key={i} className=" ">
                    <strong>{a.item}</strong>
                    <div>
                      Speaker: {a.speaker_name || a.speaker_email} • At{" "}
                      {formatMinutesLabel(a.time_offset)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">No agenda items added yet.</div>
            )}
            <div className=" mt-3 mb-3">
              <button
                type="button"
                className="add-btn"
                onClick={openAgendaModal}
              >
                + Add / Edit Agenda Items
              </button>
              {modalError && (
                <div className="response-error mt-2">{modalError}</div>
              )}
            </div>
          </div>
          <button type="submit">💾 Schedule Meeting</button>
        </form>
      </div>
      {response.message && (
        <div
          className={`response-message ${
            response.type === "success" ? "response-success" : "response-error"
          }`}
        >
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
              <div className="agenda-row mb-2" key={idx}>
                <input
                  type="text"
                  placeholder={`Agenda item ${idx + 1}`}
                  value={row.item}
                  onChange={(e) =>
                    handleModalRowChange(idx, "item", e.target.value)
                  }
                />

                <select
                  value={row.speaker_email}
                  onChange={(e) =>
                    handleModalRowChange(idx, "speaker_email", e.target.value)
                  }
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
                      handleModalRowChange(
                        idx,
                        "time_offset",
                        parseInt(e.target.value, 10)
                      )
                    }
                    className="time-offset-input"
                  />
                  <p class="mins-m">mins</p>
                </div>

                <button
                  className="remove-icon"
                  onClick={() => removeModalAgendaRow(idx)}
                >
                  ✕
                </button>
              </div>
            ))}

            <div className="modal-actions">
              <div className="">
                <button className="add-row-btn" onClick={addModalAgendaRow}>
                  + Add
                </button>
              </div>
              <div className="d-flex gap-2">
                <button className="save-btn" onClick={saveModalAgenda}>
                  Save
                </button>
                <button className="cancel-btn" onClick={closeAgendaModal}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* <VoiceAssistant formData={formData} setFormData={setFormData} /> */}
    </div>
  );
};

export default MedicalMeetingScheduler;
