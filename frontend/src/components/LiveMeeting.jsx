import { useOpenAITranscription } from "../hooks/useOpenAITranscription";

const LiveMeeting = ({
  // Remove these props - they'll come from the hook instead
  currentMeeting,
  setCurrentMeeting,
  showToast,
  transcript,
  setTranscript,
  transcriptRef,
  participants,
  setShowParticipantModal,
  currentService,
}) => {
  // Hook provides these values
  const {
    isRecording,
    isStreaming,
    isConnected,
    isConnecting,
    startLiveRecording,
    stopLiveRecording,
  } = useOpenAITranscription({
    currentMeeting,
    setCurrentMeeting,
    showToast,
    transcript,
    setTranscript,
    participants,
  });

  // Function to process transcript for display
  const getDisplayTranscript = () => {
    if (!transcript || transcript.length === 0) return [];

    return transcript.map((segment, index) => ({
      ...segment,
      id: segment.id || `segment-${index}-${Date.now()}`,
      is_final: true,
      timestamp: segment.timestamp || new Date().toLocaleTimeString(),
    }));
  };

  const displayTranscript = getDisplayTranscript();

  return (
    <div className="tab-content">
      <div className="meeting-controls">
        <h2>Live Meeting Recording</h2>

        {/* Enhanced Connection Status */}
        <div className="service-indicator">
          <span
            className={`service-badge openai ${
              isConnected ? "connected" : "disconnected"
            } ${isConnecting ? "connecting" : ""}`}
          >
            {isConnecting ? "🔄" : isConnected ? "🔗" : "🔌"} {currentService}
            {isRecording && " • LIVE"}
            {isConnecting && " • Connecting..."}
          </span>
          <span className="service-info">
            {isConnected
              ? "Auto-detects English & Arabic - Speaks in same language"
              : isConnecting
              ? "Establishing connection to transcription service..."
              : "Click 'Start Recording' to connect"}
          </span>
          <span
            className={`connection-status ${
              isConnected
                ? "connected"
                : isConnecting
                ? "connecting"
                : "disconnected"
            }`}
          >
            {isConnected
              ? "Connected"
              : isConnecting
              ? "Connecting..."
              : "Disconnected"}
          </span>
        </div>

        <div className="recording-panel">
          <div className="status-indicator">
            <span
              className={`status-dot ${
                isRecording
                  ? "recording"
                  : isConnected
                  ? "connected"
                  : "disconnected"
              }`}
            ></span>
            <span>
              Status:{" "}
              {isRecording
                ? "Recording"
                : isConnected
                ? "Ready"
                : "Disconnected"}
              {isRecording && " - AI transcription active"}
            </span>
          </div>

          <div className="participant-info">
            <span>Participants: {participants.length}</span>
            {participants.length === 0 && (
              <span className="warning-text"> - Add participants to start</span>
            )}
          </div>

          <div className="record-buttons">
            <button
              className="btn btn-participant"
              onClick={() => setShowParticipantModal(true)}
            >
              👥 Manage Participants
            </button>
            {!isRecording ? (
              <button
                className="btn btn-record"
                onClick={startLiveRecording}
                disabled={isConnecting || participants.length === 0}
              >
                {isConnecting ? "🔄 Connecting..." : "🎤 Start Recording"}
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
        <div className="transcript-header">
          <h3>Live Transcript & AI Responses</h3>
          <div className="transcript-stats">
            {displayTranscript.length > 0 && (
              <span>
                {displayTranscript.length} message
                {displayTranscript.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        <div className="transcript-viewer" ref={transcriptRef}>
          {displayTranscript.length > 0 ? (
            displayTranscript.map((segment, index) => (
              <div
                key={segment.id}
                className={`transcript-segment ${
                  segment.isAI ? "ai-response" : "user-speech"
                } ${segment.language === "ar" ? "rtl-text" : "ltr-text"}`}
              >
                <div className="segment-header">
                  <span
                    className={`speaker ${
                      segment.isAI ? "ai-speaker" : "user-speaker"
                    }`}
                  >
                    {segment.isAI ? (
                      <span className="ai-indicator">🤖 AI Assistant</span>
                    ) : (
                      <span className="user-indicator">
                        🎤 {segment.speaker}
                      </span>
                    )}
                  </span>
                  <span className="timestamp">{segment.timestamp}</span>
                  {segment.language && (
                    <span className="language-badge">
                      {segment.language === "ar" ? "العربية" : "English"}
                    </span>
                  )}
                </div>
                <div
                  className={`segment-text ${
                    segment.language === "ar" ? "arabic-text" : "english-text"
                  }`}
                  dir={segment.language === "ar" ? "rtl" : "ltr"}
                >
                  {segment.text}
                </div>
                {segment.isAI && (
                  <div className="ai-response-indicator">
                    AI response in{" "}
                    {segment.language === "ar" ? "Arabic" : "English"}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="empty-state">
              {isRecording ? (
                <div className="listening-state">
                  <div className="pulse-animation"></div>
                  <p>🎤 Listening for speech (English or Arabic)...</p>
                  <p className="subtext">
                    Speak clearly - AI will auto-detect language and respond in
                    same language
                  </p>
                </div>
              ) : (
                <div className="ready-state">
                  <p>🎯 Ready to record</p>
                  <p className="subtext">
                    {participants.length === 0
                      ? "Add participants and click Start Recording to begin"
                      : "Click Start Recording to begin transcription"}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveMeeting;

// const LiveMeeting = ({
// isRecording,
// isStreaming,
// transcript,
// transcriptRef,
// startLiveRecording,
// stopLiveRecording,
// participants,
// setShowParticipantModal,
// language,
// setLanguage,
// currentService,
// }) => {
// // Function to process transcript for display - preserves all segments
// const getDisplayTranscript = () => {
//     if (!transcript || transcript.length === 0) return [];

//     const displaySegments = [];
//     let currentFinalIndex = -1;

//     // Find the last final segment to show all final segments + current interim
//     for (let i = transcript.length - 1; i >= 0; i--) {
//     if (transcript[i].is_final) {
//         currentFinalIndex = i;
//         break;
//     }
//     }

//     // If we found final segments, include all of them
//     if (currentFinalIndex >= 0) {
//     displaySegments.push(...transcript.slice(0, currentFinalIndex + 1));
//     }

//     // Add the most recent interim segment if it exists and is different from last final
//     const lastSegment = transcript[transcript.length - 1];
//     if (lastSegment && !lastSegment.is_final) {
//     // Only add if it's meaningfully different from the last final segment
//     if (
//         displaySegments.length === 0 ||
//         lastSegment.text !== displaySegments[displaySegments.length - 1].text
//     ) {
//         displaySegments.push(lastSegment);
//     }
//     }

//     return displaySegments;
// };

// const displayTranscript = getDisplayTranscript();

// return (
//     <div className="tab-content">
//     <div className="meeting-controls">
//         <h2>Live Meeting Recording</h2>

//         {/* Service Indicator */}
//         <div className="service-indicator">
//         <span
//             className={`service-badge ${
//             currentService === "Deepgram" ? "deepgram" : "google"
//             }`}
//         >
//             {isRecording && " • LIVE"}
//         </span>
//         </div>

//         <div className="recording-panel">
//         <div className="status-indicator">
//             <span
//             className={`status-dot ${isRecording ? "recording" : "stopped"}`}
//             ></span>
//             <span>Status: {isRecording ? "Recording" : "Stopped"}</span>
//         </div>

//         <div className="record-buttons">
//             <button
//             className="btn btn-record"
//             onClick={() => setShowParticipantModal(true)}
//             >
//             + Add Participant
//             </button>
//             {!isRecording ? (
//             <button
//                 className="btn btn-record"
//                 onClick={startLiveRecording}
//                 disabled={isStreaming || participants.length === 0}
//             >
//                 {isStreaming ? "Connecting…" : "Start Recording"}
//             </button>
//             ) : (
//             <button className="btn btn-stop" onClick={stopLiveRecording}>
//                 ⏹️ Stop Recording
//             </button>
//             )}
//         </div>
//         </div>
//     </div>

//     {/* Live Transcript */}
//     <div className="transcript-section">
//         <h3>Live Transcript</h3>
//         <div className="transcript-viewer" ref={transcriptRef}>
//         {displayTranscript && displayTranscript.length > 0 ? (
//             displayTranscript.map((segment, index) => (
//             <div key={segment.id || index} className="transcript-segment">
//                 <div className="segment-header">
//                 <span className="speaker">{segment.speaker}</span>
//                 <span className="timestamp">
//                     {segment.timestamp
//                     ? `[${new Date(
//                         segment.timestamp * 1000
//                         ).toLocaleTimeString()}]`
//                     : ""}
//                 </span>
//                 {!segment.is_final && (
//                     <span className="typing-indicator"> (typing...)</span>
//                 )}
//                 </div>
//                 <div className="segment-text">{segment.text}</div>
//             </div>
//             ))
//         ) : (
//             <div className="empty-state">
//             {isRecording
//                 ? `Listening for ${
//                     language === "ar" ? "Arabic" : "English"
//                 } speech...`
//                 : "Start recording to see transcript"}
//             </div>
//         )}
//         </div>
//     </div>
//     </div>
// );
// };

// export default LiveMeeting;



// const LiveMeeting = ({
// isRecording,
// isStreaming,
// transcript,
// transcriptRef,
// startLiveRecording,
// stopLiveRecording,
// participants,
// setShowParticipantModal,
// language,
// setLanguage,
// currentService,
// }) => {
// // Function to process transcript for display - preserves all segments
// const getDisplayTranscript = () => {
//     if (!transcript || transcript.length === 0) return [];

//     const displaySegments = [];
//     let currentFinalIndex = -1;

//     // Find the last final segment to show all final segments + current interim
//     for (let i = transcript.length - 1; i >= 0; i--) {
//     if (transcript[i].is_final) {
//         currentFinalIndex = i;
//         break;
//     }
//     }

//     // If we found final segments, include all of them
//     if (currentFinalIndex >= 0) {
//     displaySegments.push(...transcript.slice(0, currentFinalIndex + 1));
//     }

//     // Add the most recent interim segment if it exists and is different from last final
//     const lastSegment = transcript[transcript.length - 1];
//     if (lastSegment && !lastSegment.is_final) {
//     // Only add if it's meaningfully different from the last final segment
//     if (
//         displaySegments.length === 0 ||
//         lastSegment.text !== displaySegments[displaySegments.length - 1].text
//     ) {
//         displaySegments.push(lastSegment);
//     }
//     }

//     return displaySegments;
// };

// const displayTranscript = getDisplayTranscript();

// return (
//     <div className="tab-content">
//     <div className="meeting-controls">
//         <h2>Live Meeting Recording</h2>

//         {/* Service Indicator */}
//         <div className="service-indicator">
//         <span
//             className={`service-badge ${
//             currentService === "Deepgram" ? "deepgram" : "google"
//             }`}
//         >
//             {isRecording && " • LIVE"}
//         </span>
//         </div>

//         <div className="recording-panel">
//         <div className="status-indicator">
//             <span
//             className={`status-dot ${isRecording ? "recording" : "stopped"}`}
//             ></span>
//             <span>Status: {isRecording ? "Recording" : "Stopped"}</span>
//         </div>

//         <div className="record-buttons">
//             <button
//             className="btn btn-record"
//             onClick={() => setShowParticipantModal(true)}
//             >
//             + Add Participant
//             </button>
//             {!isRecording ? (
//             <button
//                 className="btn btn-record"
//                 onClick={startLiveRecording}
//                 disabled={isStreaming || participants.length === 0}
//             >
//                 {isStreaming ? "Connecting…" : "Start Recording"}
//             </button>
//             ) : (
//             <button className="btn btn-stop" onClick={stopLiveRecording}>
//                 ⏹️ Stop Recording
//             </button>
//             )}
//         </div>
//         </div>
//     </div>

//     {/* Live Transcript */}
//     <div className="transcript-section">
//         <h3>Live Transcript</h3>
//         <div className="transcript-viewer" ref={transcriptRef}>
//         {displayTranscript && displayTranscript.length > 0 ? (
//             displayTranscript.map((segment, index) => (
//             <div key={segment.id || index} className="transcript-segment">
//                 <div className="segment-header">
//                 <span className="speaker">{segment.speaker}</span>
//                 <span className="timestamp">
//                     {segment.timestamp
//                     ? `[${new Date(
//                         segment.timestamp * 1000
//                         ).toLocaleTimeString()}]`
//                     : ""}
//                 </span>
//                 {!segment.is_final && (
//                     <span className="typing-indicator"> (typing...)</span>
//                 )}
//                 </div>
//                 <div className="segment-text">{segment.text}</div>
//             </div>
//             ))
//         ) : (
//             <div className="empty-state">
//             {isRecording
//                 ? `Listening for ${
//                     language === "ar" ? "Arabic" : "English"
//                 } speech...`
//                 : "Start recording to see transcript"}
//             </div>
//         )}
//         </div>
//     </div>
//     </div>
// );
// };

// export default LiveMeeting;
