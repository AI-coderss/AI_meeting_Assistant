import React from "react";

const UploadMeeting = ({
  fileInputRef,
  handleFileUpload,
  isTranscribing,
  transcript,
}) => {
  return (
    <div className="tab-content">
      <div className="upload-section">
        <h2>Upload Audio File</h2>
        <div className="file-upload-area">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".mp3,.wav,.mp4,.m4a"
            style={{ display: "none" }}
          />
          <button
            className="btn btn-upload"
            onClick={() => fileInputRef.current?.click()}
            disabled={isTranscribing}
          >
            📁 {isTranscribing ? "Transcribing..." : "Choose Audio File"}
          </button>
          <p className="upload-help">
            Supported formats: MP3, WAV, MP4, M4A
          </p>
        </div>

        {isTranscribing && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <p>Transcribing your audio file...</p>
          </div>
        )}
      </div>

      {transcript.length > 0 && (
        <div className="transcript-section">
          <h3>Transcript</h3>
          <div className="transcript-viewer">
            {transcript.map((segment, index) => (
              <div key={index} className="transcript-segment">
                <div className="segment-header">
                  <span className="speaker">{segment.speaker}</span>
                  <span className="timestamp">
                    [{segment.timestamp.toFixed(1)}s]
                  </span>
                </div>
                <div className="segment-text">{segment.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadMeeting;
