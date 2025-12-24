import React, { useState, useEffect } from "react";
import "../styles/ParticipantForm.css";

const ParticipantForm = ({ participants, setParticipants, closeForm,meetingTitle, setMeetingTitle}) => {
  // const [meetingTitle, setMeetingTitle] = useState("");
  const [category, setCategory] = useState("Medical Meeting");

  const [newParticipant, setNewParticipant] = useState({
    name: "",
    email: "",
    role: "",
  });

  const [emailError, setEmailError] = useState("");
  const [nameError, setNameError] = useState("");
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [modalError, setModalError] = useState("");

  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
function SearchableMeetingCategory({ value, onChange }) {
  const MEETING_TYPES = [
      // Existing
      "Consultation",
      "Case Discussion",
      "Follow-up",
      "Team Meetings",
      "Client Meetings",
      "Project Kickoff Meetings",
      "Status Update Meetings",
      "Brainstorming Sessions",
      "Training Sessions",
      "Board Meetings",
      "All-Hands Meetings",
      "Strategy Planning Meetings",
      "Performance Review Meetings",
      "Daily Stand-Ups",
      "Retrospective Meetings",
      "Innovation Sessions (Hackathons)",
      "Committee Meetings",
      "Demo Meetings (with vendors or companies)",
      "Sales Meetings",
      "Product Demos and Launch Meetings",
      "Crisis Management Meetings",
      "Cross-department Meetings",
      "Town Hall Meetings",
      "Budget or Financial Review Meetings",
    ];
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = MEETING_TYPES.filter((type) =>
    type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        placeholder="Search meeting category..."
        value={search || value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setSearch(e.target.value);
          onChange("");
        }}
      />

      {open && (
        <ul
          style={{
            position: "absolute",
            zIndex: 20,
            width: "100%",
            background: "#fff",
            border: "1px solid #ccc",
            maxHeight: "180px",
            overflowY: "auto",
            listStyle: "none",
            padding: 0,
            margin: 0,
          }}
        >
          {filtered.length === 0 && (
            <li style={{ padding: "8px", color: "#999" }}>No results</li>
          )}

          {filtered.map((type) => (
            <li
              key={type}
              style={{ padding: "8px", cursor: "pointer" }}
              onClick={() => {
                onChange(type);
                setSearch("");
                setOpen(false);
              }}
            >
              {type}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

  // ✅ Add host automatically
  useEffect(() => {
    if (
      currentUser.email &&
      !participants.some((p) => p.email === currentUser.email)
    ) {
      const hostParticipant = {
        id: "host",
        name: currentUser.name || "Host",
        email: currentUser.email,
        role: "host",
        isHost: true,
      };
      setParticipants([
        hostParticipant,
        ...participants.filter((p) => p.id !== "host"),
      ]);
    }
  }, [currentUser.email, participants, setParticipants]);

  // ✅ Validate Name (letters only)
  const handleNameChange = (name) => {
    // const namePattern = /^[A-Za-z\s]*$/;
    // const error = !namePattern.test(name)
    //   ? "Name can only contain letters and spaces"
    //   : "";
    // setNameError(error);

    // if (error) {
    //   setModalError(error);
    //   setShowErrorModal(true);
    // }

    setNewParticipant({ ...newParticipant, name });
  };

  // ✅ Validate Email (basic pattern)
  const handleEmailChange = (email) => {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const error =
      email && !emailPattern.test(email) ? "Invalid email address" : "";
    setEmailError(error);

    if (error) {
      setModalError(error);
      setShowErrorModal(true);
    }

    setNewParticipant({ ...newParticipant, email });
  };

  // ✅ Add participant (inherits shared meetingTitle & category)
  const handleAddParticipant = () => {
    if (!meetingTitle.trim()) {
      setModalError("Meeting Title is required");
      setShowErrorModal(true);
      return;
    }

    if (!newParticipant.email.trim()) {
      setModalError("Email is required");
      setShowErrorModal(true);
      return;
    }

    if (emailError || nameError) {
      setModalError(emailError || nameError);
      setShowErrorModal(true);
      return;
    }

    const participant = {
      id: Date.now().toString(),
      name: newParticipant.name || newParticipant.email.split("@")[0],
      email: newParticipant.email.trim(),
      category,
      meetingTitle,
      role: newParticipant.role,
      isHost: false,
    };

    setParticipants([...participants, participant]);

    // Reset participant fields
    setNewParticipant({
      name: "",
      email: "",
      role: "participant",
    });
  };

  const handleRemoveParticipant = (id) => {
    if (id === "host") return;
    setParticipants(participants.filter((p) => p.id !== id));
  };

  return (
    <div className="participant-form">
      <div className="participant-form-header">
        <h4>Start a Meeting</h4>
        <button className="form-close-btn" onClick={closeForm}>
          ×
        </button>
      </div>

      {/* 🔹 Common Meeting Details */}
      <div className="common-meeting-fields space-lable">
        <div className="input-group">
          <label>Meeting Title</label>
          <input
            type="text"
            placeholder="e.g., Patient Case Discussion"
            value={meetingTitle}
            onChange={(e) => setMeetingTitle(e.target.value)}
          />
        </div>

        <div className="input-group">
          <label>Meeting Category</label>
          <SearchableMeetingCategory
  value={category}
  onChange={setCategory}
  className="category-select"
/>

        </div>
      </div>

      {/* 🔹 Add Participants */}
      <div className="add-participant">
        <div className="input-group">
          <label></label>
          <input
            type="text"
            placeholder="Participant Name"
            value={newParticipant.name}
            onChange={(e) => handleNameChange(e.target.value)}
            className={`participant-name-input ${nameError ? "invalid" : ""}`}
          />
          {nameError && <span className="error-msg">{nameError}</span>}
        </div>

        <div className="input-group">
          <input
            type="email"
            placeholder="Participant Email"
            value={newParticipant.email}
            onChange={(e) => handleEmailChange(e.target.value)}
            className={`participant-email-input ${emailError ? "invalid" : ""}`}
          />
          {emailError && <span className="error-msg">{emailError}</span>}
        </div>

          <div className="input-group">
          <label>Role</label>
          <input
            type="text"
            value={newParticipant.role}
            onChange={(e) =>
              setNewParticipant({ ...newParticipant, role: e.target.value })
            }
            className="role-input"
            placeholder="Enter role (e.g., doctor, nurse, patient)"
          />
        </div>

        <button
          onClick={handleAddParticipant}
          disabled={!newParticipant.email || emailError || nameError}
          className="add-participant-btn plus-btn"
        >
          Add
        </button>
      </div>

      {/* 🔹 Participants List */}
      <div className="participants-list">
        {participants.map((p) => (
          <div key={p.id} className={`participant-item ${p.isHost ? "host" : ""}`}>
            <div className="participant-info">
              <span className="participant-name">{p.name}</span>
              <span className="participant-email">({p.email})</span>
              <span className="participant-role">{p.role}</span>
              <span className="participant-title">{p.meetingTitle}</span>
              <span className="participant-category">{p.category}</span>
              {p.isHost && <span className="host-label">(Host)</span>}
            </div>
            {!p.isHost && (
              <div className="participant-actions">
                <button
                  onClick={() => handleRemoveParticipant(p.id)}
                  className="remove-btn"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Total Participants */}
        <div className="total-participants">
          Total Participants: {participants.length}
        </div>
      </div>

    </div>
  );
};

export default ParticipantForm;
