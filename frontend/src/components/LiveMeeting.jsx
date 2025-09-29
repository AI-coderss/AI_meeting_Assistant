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

  // Function to process transcript for display - preserves all segments
  const getDisplayTranscript = () => {
    if (!transcript || transcript.length === 0) return [];

    const displaySegments = [];
    let currentFinalIndex = -1;

    // Find the last final segment to show all final segments + current interim
    for (let i = transcript.length - 1; i >= 0; i--) {
      if (transcript[i].is_final) {
        currentFinalIndex = i;
        break;
      }
    }

    // If we found final segments, include all of them
    if (currentFinalIndex >= 0) {
      displaySegments.push(...transcript.slice(0, currentFinalIndex + 1));
    }

    // Add the most recent interim segment if it exists and is different from last final
    const lastSegment = transcript[transcript.length - 1];
    if (lastSegment && !lastSegment.is_final) {
      // Only add if it's meaningfully different from the last final segment
      if (
        displaySegments.length === 0 ||
        lastSegment.text !== displaySegments[displaySegments.length - 1].text
      ) {
        displaySegments.push(lastSegment);
      }
    }

    return displaySegments;
  };

  const displayTranscript = getDisplayTranscript();

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
          {displayTranscript && displayTranscript.length > 0 ? (
            displayTranscript.map((segment, index) => (
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
