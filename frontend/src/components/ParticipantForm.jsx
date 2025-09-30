import React, { useState, useEffect } from "react";
import "../styles/ParticipantForm.css";

const ParticipantForm = ({ participants, setParticipants, closeForm }) => {
  const [newParticipant, setNewParticipant] = useState({
    name: "",
    meetingTitle: "",
    email: "",
    category: "Business Meeting",
    role: "participant",
  });

  const [emailError, setEmailError] = useState("");
  const [nameError, setNameError] = useState("");
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [modalError, setModalError] = useState("");

  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");

  // Add host if not already added
  useEffect(() => {
    if (
      currentUser.email &&
      !participants.some((p) => p.email === currentUser.email)
    ) {
      const hostParticipant = {
        id: "host",
        name: currentUser.name || "Host",
        meetingTitle: "",
        email: currentUser.email,
        category: "Business Meeting",
        role: "host",
        isHost: true,
      };
      setParticipants([
        hostParticipant,
        ...participants.filter((p) => p.id !== "host"),
      ]);
    }
  }, [currentUser.email, participants, setParticipants]);

  // Validate name: only letters and spaces
  const handleNameChange = (name) => {
    const namePattern = /^[A-Za-z\s]*$/;
    const error = !namePattern.test(name)
      ? "Name can only contain letters and spaces"
      : "";
    setNameError(error);

    // Show full-screen error if validation fails
    if (error) {
      setModalError(error);
      setShowErrorModal(true);
    }

    setNewParticipant({ ...newParticipant, name });
  };

  // Validate email in real-time
  const handleEmailChange = (email) => {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const error =
      email && !emailPattern.test(email) ? "Invalid email address" : "";
    setEmailError(error);

    // Show full-screen error if validation fails
    if (error) {
      setModalError(error);
      setShowErrorModal(true);
    }

    setNewParticipant({ ...newParticipant, email });
  };

  const handleAddParticipant = () => {
    if (!newParticipant.email.trim()) {
      setModalError("Email is required");
      setShowErrorModal(true);
      return;
    }

    if (emailError) {
      setModalError(emailError);
      setShowErrorModal(true);
      return;
    }

    if (nameError) {
      setModalError(nameError);
      setShowErrorModal(true);
      return;
    }

    const participant = {
      id: Date.now().toString(),
      name: newParticipant.name || newParticipant.email.split("@")[0],
      meetingTitle: newParticipant.meetingTitle,
      email: newParticipant.email.trim(),
      category: newParticipant.category,
      role: newParticipant.role,
      isHost: false,
    };

    setParticipants([...participants, participant]);
    setNewParticipant({
      name: "",
      meetingTitle: "",
      email: "",
      category: "Business Meeting",
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
        <h4>Meeting Participants</h4>
        <button className="form-close-btn" onClick={closeForm}>
          ×
        </button>
      </div>

      <div className="add-participant">
        <div className="input-group">
          <input
            type="text"
            placeholder="Name"
            value={newParticipant.name}
            onChange={(e) => handleNameChange(e.target.value)}
            className={`participant-name-input ${nameError ? "invalid" : ""}`}
          />
          {nameError && <span className="error-msg">{nameError}</span>}
        </div>

        <div className="input-group">
          <input
            type="text"
            placeholder="Title of Meeting"
            value={newParticipant.meetingTitle}
            onChange={(e) =>
              setNewParticipant({
                ...newParticipant,
                meetingTitle: e.target.value,
              })
            }
            className="participant-title-input"
          />
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

        <select
          value={newParticipant.category}
          onChange={(e) =>
            setNewParticipant({ ...newParticipant, category: e.target.value })
          }
          className="category-select"
        >
          <option value="Business Meeting">Business Meeting</option>
          <option value="Medical Meeting">Medical Meeting</option>
        </select>

        <select
          value={newParticipant.role}
          onChange={(e) =>
            setNewParticipant({ ...newParticipant, role: e.target.value })
          }
          className="role-select"
        >
          <option value="participant">Participant</option>
          <option value="viewer">Viewer</option>
        </select>

        <button
          onClick={handleAddParticipant}
          disabled={!newParticipant.email || emailError || nameError}
          className="add-participant-btn"
        >
          +
        </button>
      </div>

      <div className="participants-list">
        {participants.map((p) => (
          <div
            key={p.id}
            className={`participant-item ${p.isHost ? "host" : ""}`}
          >
            <div className="participant-info">
              <span className="participant-name">{p.name}</span>
              <span className="participant-title">{p.meetingTitle}</span>
              <span className="participant-category">{p.category}</span>
              <span className="participant-email">({p.email})</span>
              <span className={`participant-role ${p.role}`}>
                {p.role} {p.isHost && "(Host)"}
              </span>
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

        {/* Total Participants Div */}
        <div className="total-participants">
          Total Participants: {participants.length}
        </div>
      </div>
    </div>
  );
};

export default ParticipantForm;
