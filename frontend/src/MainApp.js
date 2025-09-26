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
import { useToast } from "./hooks/useToast";
import ParticipantForm from "./components/ParticipantForm";
import UserList from "./components/admin/UserList";
import "./App.css";
import AllMeetings from "./components/AllMeetings";
import AdminAnalytics from "./components/admin/AdminAnalytics";
import { useDeepgramTranscription } from "./hooks/useDeepgramTranscription";
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

  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("darkMode");
    return saved === "true";
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
  const {
    transcript,
    setTranscript,
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

  // ✅ Initialize both hooks but only use one based on language
  const deepgramHook = useDeepgramTranscription({
    currentMeeting,
    setCurrentMeeting,
    showToast,
    transcript,
    setTranscript,
    participants,
    language,
  });

  const googleSTTHook = useGoogleSTTTranscription({
    currentMeeting,
    setCurrentMeeting,
    showToast,
    transcript,
    setTranscript,
    participants,
    language,
  });

  // ✅ Properly isolate the active service
  const getActiveTranscriptionService = () => {
    if (language === "ar") {
      console.log("🔤 Active service: Google STT (Arabic)");
      return googleSTTHook;
    } else {
      console.log("🔤 Active service: Deepgram (English)");
      return deepgramHook;
    }
  };

  const activeService = getActiveTranscriptionService();
  const { isRecording, isStreaming, startLiveRecording, stopLiveRecording } =
    activeService;

  // ✅ Stop the inactive service when language changes
  useEffect(() => {
    // Stop any ongoing recording when language changes
    if (deepgramHook.isRecording && language === "ar") {
      console.log("🛑 Stopping Deepgram (switching to Arabic)");
      deepgramHook.stopLiveRecording();
    }

    if (googleSTTHook.isRecording && language === "en") {
      console.log("🛑 Stopping Google STT (switching to English)");
      googleSTTHook.stopLiveRecording();
    }

    // Clear transcript when language changes
    setTranscript([]);
    showToast(
      `Language changed to ${
        language === "ar" ? "Arabic" : "English"
      }. Transcription service switched.`,
      "info"
    );
  }, [language]);

  // ✅ Toggle dark mode
  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem("darkMode", newMode);
  };

  useEffect(() => {
    document.body.className = darkMode ? "dark-theme" : "";
  }, [darkMode]);

  // Scroll to bottom of transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  // Load meetings
  useEffect(() => {
    fetchMeetings(searchQuery, participantFilter);
  }, [fetchMeetings, searchQuery, participantFilter]);

  return (
    <div className={`app ${darkMode ? "dark-theme" : ""}`}>
      <Header darkMode={darkMode} toggleDarkMode={toggleDarkMode} />
      <Tabs activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="main-content">
        {activeTab === "live" && (
          <>
            {showParticipantModal && (
              <div className="modal-overlay">
                <div className="modal-content">
                  <button
                    className="modal-close-btn"
                    onClick={() => setShowParticipantModal(false)}
                  >
                    ×
                  </button>
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
              language={language}
              setLanguage={setLanguage}
              currentService={language === "ar" ? "Google STT" : "Deepgram"}
            />
          </>
        )}

        {/* Other tab contents remain the same */}
        {activeTab === "Analytics" && <AdminAnalytics />}
        {activeTab === "history" && (
          <MeetingHistory
            meetings={meetings}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            participantFilter={participantFilter}
            setParticipantFilter={setParticipantFilter}
            fetchMeetings={() => {
              const hostEmail = localStorage.getItem("email");
              fetchMeetings(hostEmail);
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
    </div>
  );
}

export default MainApp;
