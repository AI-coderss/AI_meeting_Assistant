import { useState } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const useTranscript = ({ currentMeeting, showToast }) => {
  const [transcript, setTranscript] = useState([]);
  const [summary, setSummary] = useState(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);

  const handleFileUpload = async (file) => {
    if (!file || !currentMeeting) return;

    setIsTranscribing(true);
    showToast("Transcribing audio file...", "info");

    try {
      const formData = new FormData();
      formData.append("audio_file", file);

      const response = await axios.post(
        `${API}/meetings/${currentMeeting.id}/transcribe-file`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 120000,
        }
      );

      setTranscript(response.data.transcript || []);
      showToast("Audio transcribed successfully", "success");
    } catch (error) {
      console.error("Error transcribing file:", error);
      showToast("Failed to transcribe audio file", "error");
    } finally {
      setIsTranscribing(false);
    }
  };

  const generateSummary = async () => {
    if (!currentMeeting || transcript.length === 0) {
      showToast("No transcript available to summarize", "warning");
      return;
    }

    setIsSummarizing(true);
    showToast("Generating AI summary...", "info");

    try {
      const transcriptText = transcript
        .map((seg) => `${seg.speaker}: ${seg.text}`)
        .join("\n");

      const response = await axios.post(
        `${API}/meetings/${currentMeeting.id}/summarize`,
        {
          meeting_id: currentMeeting.id,
          transcript_text: transcriptText,
        }
      );

      setSummary(response.data.summary);
      showToast("Summary generated successfully", "success");
    } catch (error) {
      console.error("Error generating summary:", error);
      showToast("Failed to generate summary", "error");
    } finally {
      setIsSummarizing(false);
    }
  };

  const copyToClipboard = async () => {
    const content = `Meeting: ${currentMeeting?.title}\n\nTranscript:\n${transcript
      .map((seg) => `${seg.speaker}: ${seg.text}`)
      .join("\n")}\n\nSummary:\n${
      summary ? JSON.stringify(summary, null, 2) : "No summary available"
    }`;

    try {
      await navigator.clipboard.writeText(content);
      showToast("Copied to clipboard", "success");
    } catch (error) {
      showToast("Failed to copy to clipboard", "error");
    }
  };

  const exportToPDF = () => {
    showToast("PDF export feature coming soon", "info");
  };

  const exportToWord = () => {
    showToast("Word export feature coming soon", "info");
  };

  return {
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
  };
};
