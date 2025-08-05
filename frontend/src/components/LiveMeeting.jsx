import React  from "react";
import { ReactMediaRecorder } from "react-media-recorder";

const LiveMeeting = ({
  isRecording,
  isTranscribing,
  transcript,
  transcriptRef,
  startLiveRecording,
  stopLiveRecording,
}) => {
  return (
    <div className="tab-content">
      <div className="meeting-controls">
        <h2>Live Meeting Recording</h2>
        <ReactMediaRecorder
          audio
          onStart={() => console.log("Recording started")}
          onStop={(blobUrl, blob) => console.log("Recording stopped")}
          render={({ startRecording, stopRecording, mediaBlobUrl }) => (
            <div className="recording-panel">
              <div className="status-indicator">
                <span
                  className={`status-dot ${
                    isRecording ? "recording" : "stopped"
                  }`}
                ></span>
                <span>
                  Status: {isRecording ? "Recording" : "Stopped"}
                </span>
              </div>

              <div className="record-buttons">
                {!isRecording ? (
                  <button
                    className="btn btn-record"
                    onClick={() => startLiveRecording(startRecording)}
                    disabled={isTranscribing}
                  >
                    🎤 Start Recording
                  </button>
                ) : (
                  <button
                    className="btn btn-stop"
                    onClick={() => stopLiveRecording(stopRecording)}
                  >
                    ⏹️ Stop Recording
                  </button>
                )}
              </div>

              {mediaBlobUrl && (
                <div className="audio-preview">
                  <audio src={mediaBlobUrl} controls />
                </div>
              )}
            </div>
          )}
        />
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
