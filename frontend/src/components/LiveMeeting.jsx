const LiveMeeting = ({
  isRecording,
  isStreaming,
  transcript,
  transcriptRef,
  startLiveRecording,
  stopLiveRecording,
  participants,
  setShowParticipantModal,
  language,
  setLanguage,
  currentService,
}) => {
  console.log(transcript, "====");
  const handleLanguageChange = (newLanguage) => {
    if (isRecording) {
      if (
        window.confirm(
          "Changing language will stop the current recording. Continue?"
        )
      ) {
        stopLiveRecording();
        setLanguage(newLanguage);
      }
    } else {
      setLanguage(newLanguage);
    }
  };

  return (
    <div className="tab-content">
      <div className="meeting-controls">
        <h2>Live Meeting Recording</h2>

        {/* Service Indicator */}
        <div className="service-indicator">
          <span
            className={`service-badge ${
              currentService === "Deepgram" ? "deepgram" : "google"
            }`}
          >
            {isRecording && " • LIVE"}
          </span>
        </div>

        {/* Language Selector */}
        <div className="language-selector">
          <label htmlFor="language">Transcription Language:</label>
          <select
            id="language"
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
          >
            <option value="en">English </option>
            <option value="ar">Arabic </option>
          </select>
        </div>

        {/* Rest of your component remains the same */}
        <div className="recording-panel">
          <div className="status-indicator">
            <span
              className={`status-dot ${isRecording ? "recording" : "stopped"}`}
            ></span>
            <span>Status: {isRecording ? "Recording" : "Stopped"}</span>
          </div>

          <div className="record-buttons">
            <button
              className="btn btn-record"
              onClick={() => setShowParticipantModal(true)}
            >
              + Add Participant
            </button>
            {!isRecording ? (
              <button
                className="btn btn-record"
                onClick={startLiveRecording}
                disabled={isStreaming || participants.length === 0}
              >
                {isStreaming
                  ? "Connecting…"
                  : `Start ${
                      language === "en"
                        ? "English"
                        : language === "ar"
                        ? "Arabic"
                        : ""
                    } Recording`}
              </button>
            ) : (
              <button className="btn btn-stop" onClick={stopLiveRecording}>
                ⏹️ Stop Recording
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Live Transcript */}
      <div className="transcript-section">
        <h3>Live Transcript</h3>
        <div className="transcript-viewer" ref={transcriptRef}>
          {transcript && transcript.length > 0 ? (
            transcript.map((segment, index) => (
              <div key={segment.id || index} className="transcript-segment">
                <div className="segment-header">
                  <span className="speaker">{segment.speaker}</span>
                  <span className="timestamp">
                    {segment.timestamp
                      ? `[${new Date(
                          segment.timestamp * 1000
                        ).toLocaleTimeString()}]`
                      : ""}
                  </span>
                  {!segment.is_final && (
                    <span className="typing-indicator"> (typing...)</span>
                  )}
                </div>
                <div className="segment-text">{segment.text}</div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              {isRecording
                ? `Listening for ${
                    language === "ar" ? "Arabic" : "English"
                  } speech...`
                : "Start recording to see transcript"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveMeeting;
