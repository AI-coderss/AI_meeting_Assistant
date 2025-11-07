import React, { useState, useEffect } from "react";
import "../styles/ParticipantForm.css";

const ParticipantForm = ({ participants, setParticipants, closeForm }) => {
  const [meetingTitle, setMeetingTitle] = useState("");
  const [category, setCategory] = useState("Medical Meeting");

  const [newParticipant, setNewParticipant] = useState({
    name: "",
    email: "",
    role: "participant",
  });

  const [emailError, setEmailError] = useState("");
  const [nameError, setNameError] = useState("");
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [modalError, setModalError] = useState("");

  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");

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
    const namePattern = /^[A-Za-z\s]*$/;
    const error = !namePattern.test(name)
      ? "Name can only contain letters and spaces"
      : "";
    setNameError(error);

    if (error) {
      setModalError(error);
      setShowErrorModal(true);
    }

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
        <h4> Schedule Medical Meeting</h4>
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
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="category-select"
          >
            <option value="Medical Meeting">Medical Meeting</option>
            <option value="Follow-up Consultation">Follow-up Consultation</option>
            <option value="Case Discussion">Case Discussion</option>
            <option value="Training Session">Training Session</option>
            <option value="Emergency Meeting">Emergency Meeting</option>
          </select>
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
