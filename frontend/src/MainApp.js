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
import ScheduleMeetingForm from "./components/ScheduleMeetingForm";
import UpcomingMeetings from "./components/UpcomingMeetings";
import MeetingMobileNav from "./components/MeetingMobileNav";

function MainApp() {
  const [activeTab, setActiveTab] = useState("schedule");
  const [participants, setParticipants] = useState([]);
  const [showParticipantModal, setShowParticipantModal] = useState(false);
  const [roles, setRoles] = useState([]);

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
  const [diarizationSegments, setDiarizationSegments] = useState([]);

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

  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem("darkMode", newMode);
  };

  useEffect(() => {
    document.body.className = darkMode ? "dark-theme" : "";
  }, [darkMode]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  useEffect(() => {
    fetchMeetings(searchQuery, participantFilter).then((data) => {
      if (!currentMeeting && data && data.length > 0) {
        const active = data.find((m) => m.status === "active");
        if (active) setCurrentMeeting(active);
      }
    });
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
                  <ParticipantForm
                    participants={participants}
                    setParticipants={setParticipants}
                    currentMeeting={currentMeeting}
                    closeForm={() => setShowParticipantModal(false)}
                  />
                </div>
              </div>
            )}

            <LiveMeeting
              currentMeeting={currentMeeting}
              setCurrentMeeting={setCurrentMeeting}
              showToast={showToast}
              transcript={transcript}
              setTranscript={setTranscript}
              transcriptRef={transcriptRef}
              participants={participants}
              setShowParticipantModal={setShowParticipantModal}
              currentService="gpt-40-transcribe"
              diarizationSegments={diarizationSegments}
              setDiarizationSegments={setDiarizationSegments}
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
        {activeTab === "upcoming" && <UpcomingMeetings />}

        {isAdmin && activeTab === "userlist" && <UserList />}
        {activeTab === "schedule" && <ScheduleMeetingForm />}

        {(transcript.length > 0 || summary) && (
          <div className="actions-panel">
            <SummaryPanel
              transcript={transcript}
              summary={summary}
              setSummary={setSummary}
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
      <MeetingMobileNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}

export default MainApp;
