// src/components/LiveMeeting.jsx
import React, { useEffect } from "react";

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
}) => {
  // Debug: log transcript changes
  useEffect(() => {
    // console.log("Transcript updated:", transcript);
  }, [transcript]);

  return (
    <div className="tab-content">
      <div className="meeting-controls">
        <h2>Live Meeting Recording</h2>

        {/* Language Selector */}
        {/* <div className="language-selector">
          <label htmlFor="language">Language: </label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </select>
        </div> */}

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
                {isStreaming ? "Connecting…" : "Start Recording"}
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
                  <span className="speaker">
                   {segment.speaker}
                  </span>
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
                ? "Listening for speech..."
                : "Start recording to see transcript"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveMeeting;
