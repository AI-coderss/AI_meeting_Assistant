import React, { useState } from "react";
import "../styles/ParticipantForm.css";

const ParticipantForm = ({ participants, setParticipants, currentMeeting }) => {
  const [newParticipant, setNewParticipant] = useState({
    email: "",
    role: "participant", // default role
  });
  const [assigningSpeaker, setAssigningSpeaker] = useState(null);

  const handleAssignSpeaker = (participantId, speakerId) => {
    setParticipants((prev) =>
      prev.map((p) => (p.id === participantId ? { ...p, speakerId } : p))
    );
    setAssigningSpeaker(null);
  };

  // Get current user from localStorage
  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");

  // Add host as first participant if not already added
  React.useEffect(() => {
    if (
      currentUser.email &&
      !participants.some((p) => p.email === currentUser.email)
    ) {
      const hostParticipant = {
        id: "host",
        email: currentUser.email,
        name: currentUser.name || "Host",
        role: "host",
        isHost: true,
      };

      setParticipants([
        hostParticipant,
        ...participants.filter((p) => p.id !== "host"),
      ]);
    }
  }, [currentUser.email, participants, setParticipants]);

  const handleAddParticipant = () => {
    if (!newParticipant.email.trim()) return;

    const participant = {
      id: Date.now().toString(),
      email: newParticipant.email.trim(),
      name: newParticipant.email.split("@")[0], // Default name from email
      role: newParticipant.role,
      isHost: false,
    };

    setParticipants([...participants, participant]);
    setNewParticipant({ email: "", role: "participant" });
  };

  const handleRemoveParticipant = (id) => {
    // Don't allow removing the host
    if (id === "host") return;
    setParticipants(participants.filter((p) => p.id !== id));
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleAddParticipant();
    }
  };

  return (
    <div className="participant-form">
      <h4>Meeting Participants</h4>

      <div className="add-participant">
        <input
          type="email"
          placeholder="Participant Email"
          value={newParticipant.email}
          onChange={(e) =>
            setNewParticipant({ ...newParticipant, email: e.target.value })
          }
          onKeyPress={handleKeyPress}
          className="participant-email-input"
        />

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
          disabled={!newParticipant.email}
          className="add-participant-btn"
        >
          +
        </button>
      </div>

      <div className="participants-list">
        {participants.map((participant) => (
          <div
            key={participant.id}
            className={`participant-item ${participant.isHost ? "host" : ""}`}
          >
            <div className="participant-info">
              <span className="participant-name">{participant.name}</span>
              <span className="participant-email">({participant.email})</span>
              <span className={`participant-role ${participant.role}`}>
                {participant.role} {participant.isHost && "(Host)"}
              </span>
            </div>

            <div className="participant-actions">
              {!participant.isHost && (
                <div className="actions-row">
                  <button
                    onClick={() => handleRemoveParticipant(participant.id)}
                    className="remove-btn"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ParticipantForm;
