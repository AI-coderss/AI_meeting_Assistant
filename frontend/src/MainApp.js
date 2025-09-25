/* eslint-disable no-unused-vars */
import React, { useRef, useEffect, useState } from "react";
import Header from "./components/Header";
import Tabs from "./components/Tabs";
import LiveMeeting from "./components/LiveMeeting";
import UploadMeeting from "./components/UploadMeeting";
import MeetingHistory from "./components/MeetingHistory";
import SummaryPanel from "./components/SummaryPanel";
import ExportActions from "./components/ExportActions";
import Toast from "./components/Toast";
import { useMeetings } from "./hooks/useMeetings";
import { useTranscript } from "./hooks/useTranscript";
import { useWebSocketTranscription } from "./hooks/useWebSocketTranscription";
import { useDeepgramTranscription } from "./hooks/useDeepgramTranscription";
import { useToast } from "./hooks/useToast";
import ParticipantForm from "./components/ParticipantForm";
import Navbar from "./components/Navbar";
import UserList from "./components/admin/UserList";
import "./App.css";
import AllMeetings from "./components/AllMeetings";
import AdminAnalytics from "./components/admin/AdminAnalytics";
import { useGoogleSTTTranscription } from "./hooks/useGoogleSTTTranscription";

function MainApp() {
  const [activeTab, setActiveTab] = useState("live");
  const [participants, setParticipants] = useState([]);
  const [showParticipantModal, setShowParticipantModal] = useState(false);
  const [roles, setRoles] = useState([]);
  const [language, setLanguage] = useState("en");
  useEffect(() => {
    const storedRoles = JSON.parse(localStorage.getItem("roles")) || [];
    setRoles(storedRoles);
  }, []);
  const isAdmin = roles.includes("admin");
  // ✅ Load dark mode from localStorage
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("darkMode");
    return saved === "true"; // default: false
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [participantFilter, setParticipantFilter] = useState("");

  const fileInputRef = useRef(null);
  const transcriptRef = useRef(null);

  // Toast
  const { toast, showToast } = useToast();

  // Meeting Management
  const {
    meetings,
    currentMeeting,
    setCurrentMeeting,
    fetchMeetings,
    createMeeting,
  } = useMeetings();

  // Transcript + Summary
  // const {
  //     transcript,
  //     setTranscript,
  //     summary,
  //     setSummary,
  //     isTranscribing,
  //     isSummarizing,
  //     handleFileUpload,
  //     generateSummary,
  //     exportToPDF,
  //     exportToWord,
  //     copyToClipboard,
  // } = useTranscript({ currentMeeting, showToast });

  const {
    transcript,
    setTranscript, // Make sure you're getting setTranscript from useTranscript
    summary,
    setSummary,
    isTranscribing,
    isSummarizing,
    handleFileUpload,
    generateSummary,
    exportToPDF,
    exportToWord,
    copyToClipboard,
  } = useTranscript({ currentMeeting, showToast });

  // Live Recording
  // const { isRecording, isStreaming, startLiveRecording, stopLiveRecording } = useWebSocketTranscription({ currentMeeting, setCurrentMeeting, showToast });
  // // In your component, use the actual function names:
  const { isRecording, isStreaming, startLiveRecording, stopLiveRecording } =
    useDeepgramTranscription({
      currentMeeting,
      setCurrentMeeting,
      showToast,
      transcript, // Pass the transcript state
      setTranscript, // Pass the setTranscript function
      participants,
      language,
    });
  // const { isRecording, isStreaming, startLiveRecording, stopLiveRecording } =
  //   useGoogleSTTTranscription({
  //     currentMeeting,
  //     setCurrentMeeting,
  //     showToast,
  //     transcript,
  //     setTranscript,
  //     participants,
  //     language,
  //   });

  // ✅ Toggle dark mode and save to localStorage
  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem("darkMode", newMode);
  };

  // ✅ Update body class based on darkMode state
  useEffect(() => {
    document.body.className = darkMode ? "dark-theme" : "";
  }, [darkMode]);

  // Scroll to bottom of transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  // Load meetings on mount or filter
  useEffect(() => {
    fetchMeetings(searchQuery, participantFilter);
  }, [fetchMeetings, searchQuery, participantFilter]);

  return (
    <div className={`app ${darkMode ? "dark-theme" : ""}`}>
      <Header darkMode={darkMode} toggleDarkMode={toggleDarkMode} />
      <Tabs activeTab={activeTab} setActiveTab={setActiveTab} />
      {/* <Navbar /> */}
      <main className="main-content">
        {activeTab === "live" && (
          <>
            {showParticipantModal && (
              <div className="modal-overlay">
                <div className="modal-content">
                  {/* Close Icon */}
                  <button
                    className="modal-close-btn"
                    onClick={() => setShowParticipantModal(false)}
                  >
                    ×
                  </button>

                  {/* Participant Form */}
                  <ParticipantForm
                    participants={participants}
                    setParticipants={setParticipants}
                    currentMeeting={currentMeeting}
                  />
                </div>
              </div>
            )}

            <LiveMeeting
              isRecording={isRecording}
              isStreaming={isStreaming}
              transcript={transcript}
              transcriptRef={transcriptRef}
              startLiveRecording={startLiveRecording}
              stopLiveRecording={stopLiveRecording}
              participants={participants}
              setShowParticipantModal={setShowParticipantModal}
              language={language} // ✅ pass language
              setLanguage={setLanguage}
            />
          </>
        )}

        {activeTab === "Analytics" && <AdminAnalytics />}

        {activeTab === "history" && (
          <MeetingHistory
            meetings={meetings}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            participantFilter={participantFilter}
            setParticipantFilter={setParticipantFilter}
            fetchMeetings={() => {
              const hostEmail = localStorage.getItem("email"); // 👈 get email from localStorage
              fetchMeetings(hostEmail); // 👈 pass it to your fetch function
            }}
            setCurrentMeeting={setCurrentMeeting}
            setTranscript={setTranscript}
            setSummary={setSummary}
            setActiveTab={setActiveTab}
          />
        )}

        {activeTab === "allMeetings" && (
          <AllMeetings
            meetings={meetings}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            participantFilter={participantFilter}
            setParticipantFilter={setParticipantFilter}
            fetchMeetings={fetchMeetings}
            setCurrentMeeting={setCurrentMeeting}
            setTranscript={setTranscript}
            setSummary={setSummary}
            setActiveTab={setActiveTab}
          />
        )}
        {isAdmin && activeTab === "userlist" && <UserList />}

        {(transcript.length > 0 || summary) && (
          <div className="actions-panel">
            <SummaryPanel
              transcript={transcript}
              summary={summary}
              isSummarizing={isSummarizing}
              generateSummary={generateSummary}
            />
          </div>
        )}
      </main>

      <Toast toast={toast} />
      {activeTab === "live" && (transcript.length > 0 || summary) && (
        <ExportActions
          exportToPDF={exportToPDF}
          exportToWord={exportToWord}
          copyToClipboard={copyToClipboard}
        />
      )}
      {/* <button className="export">EXPORT</button> */}
    </div>
  );
}

export default MainApp;
