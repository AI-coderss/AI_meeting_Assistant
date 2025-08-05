/* eslint-disable no-unused-vars */
import React, { useRef, useEffect, useState } from "react";
import Header from "./components/Header";

import Tabs from "./components/Tabs";
import LiveMeeting from "./components/LiveMeeting";
import UploadMeeting from "./components/UploadMeeting";
import MeetingHistory from "./components/MeetingHistory";
import SummaryPanel from "./components/SummaryPanel";
import ExportActions from "./components/ExportActions";
import EmailModal from "./components/EmailModal";
import Toast from "./components/Toast";

import { useMeetings } from "./hooks/useMeetings";
import { useTranscript } from "./hooks/useTranscript";
import { useWebSocketTranscription } from "./hooks/useWebSocketTranscription";
import { useToast } from "./hooks/useToast";

import "./App.css";

function App() {
  const [activeTab, setActiveTab] = useState("live");
  const [darkMode, setDarkMode] = useState(false);
  const [emailModal, setEmailModal] = useState({
    show: false,
    emails: "",
    senderEmail: "",
    senderName: "",
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

  // Live Recording
  const {
    isRecording,
    startLiveRecording,
    stopLiveRecording,
  } = useWebSocketTranscription({ currentMeeting, showToast });

  // Dark Mode
  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    document.body.className = !darkMode ? "dark-theme" : "";
  };

  // Send Email
  const sendEmail = async () => {
    if (!currentMeeting || !emailModal.emails) {
      showToast("Please enter recipient emails", "warning");
      return;
    }

    try {
      const emailList = emailModal.emails
        .split(",")
        .map((email) => email.trim());

      await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/meetings/${currentMeeting.id}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meeting_id: currentMeeting.id,
          recipient_emails: emailList,
          sender_email: emailModal.senderEmail || "meetings@company.com",
          sender_name: emailModal.senderName || "AI Meeting Assistant",
        }),
      });

      showToast("Email sent successfully", "success");
      setEmailModal({ show: false, emails: "", senderEmail: "", senderName: "" });
    } catch (error) {
      console.error("Email sending error:", error);
      showToast("Failed to send email", "error");
    }
  };

  const openEmailModal = () => {
    setEmailModal({
      show: true,
      emails: "",
      senderEmail: "",
      senderName: "",
    });
  };

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

      <main className="main-content">
        {activeTab === "live" && (
          <LiveMeeting
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            transcript={transcript}
            transcriptRef={transcriptRef}
            startLiveRecording={startLiveRecording}
            stopLiveRecording={stopLiveRecording}
          />
        )}

        {activeTab === "upload" && (
          <UploadMeeting
            fileInputRef={fileInputRef}
            handleFileUpload={(e) => handleFileUpload(e.target.files[0])}
            isTranscribing={isTranscribing}
            transcript={transcript}
          />
        )}

        {activeTab === "history" && (
          <MeetingHistory
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

        {(transcript.length > 0 || summary) && (
          <div className="actions-panel">
            <SummaryPanel
              transcript={transcript}
              summary={summary}
              isSummarizing={isSummarizing}
              generateSummary={generateSummary}
            />

            <ExportActions
              exportToPDF={exportToPDF}
              exportToWord={exportToWord}
              copyToClipboard={copyToClipboard}
              openEmailModal={openEmailModal}
            />
          </div>
        )}
      </main>

      {emailModal.show && (
        <EmailModal
          emailModal={emailModal}
          setEmailModal={setEmailModal}
          sendEmail={sendEmail}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}

export default App;
