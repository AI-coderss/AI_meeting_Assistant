// src/components/LiveMeeting.jsx
import React from "react";

const LiveMeeting = ({
  isRecording,
  isStreaming,
  transcript,
  transcriptRef,
  startLiveRecording,
  stopLiveRecording,
}) => {
  return (
    <div className="tab-content">
      <div className="meeting-controls">
        <h2>Live Meeting Recording</h2>

        <div className="recording-panel">
          <div className="status-indicator">
            <span
              className={`status-dot ${isRecording ? "recording" : "stopped"}`}
            ></span>
            <span>Status: {isRecording ? "Recording" : "Stopped"}</span>
          </div>

          <div className="record-buttons">
            {!isRecording ? (
              <button
                className="btn btn-record"
                onClick={() => {
                  console.log("Start button clicked");
                  startLiveRecording();
                }}
                disabled={isStreaming}
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
          {transcript.length > 0 ? (
            transcript.map((segment, index) => (
              <div key={index} className="transcript-segment">
                <div className="segment-header">
                  <span className="speaker">{segment.speaker}</span>
                  <span className="timestamp">
                    [{new Date(segment.timestamp * 1000).toLocaleTimeString()}]
                  </span>
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
