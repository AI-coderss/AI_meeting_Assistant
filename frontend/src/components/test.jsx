import React, { useState } from "react";

export default function AssemblyAITranscriber() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");
  const [transcript, setTranscript] = useState("");
  const [utterances, setUtterances] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [entities, setEntities] = useState([]);
  const [sentiments, setSentiments] = useState([]);
  const [topics, setTopics] = useState([]);

  const ASSEMBLY_API_KEY = "077139a3e3e840a8b96325ba8b449a04"; // ⚠️ only for local testing

  // Utility: convert ms → HH:MM:SS
  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, "0")}:${m
      .toString()
      .padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleUpload = async () => {
    if (!file) return alert("Please select an audio file first!");

    try {
      setStatus("Uploading file...");

      // 1️⃣ Upload audio file to AssemblyAI
      const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
        method: "POST",
        headers: { authorization: ASSEMBLY_API_KEY },
        body: file,
      });

      const uploadData = await uploadRes.json();
      const audioUrl = uploadData.upload_url;
      setStatus("File uploaded successfully!");

      // 2️⃣ Start transcription with full metadata
      setStatus("Starting transcription...");
      const config = {
        audio_url: audioUrl,
        speaker_labels: true,
        speakers_expected: 100, 
        entity_detection: true,
        sentiment_analysis: true,
        iab_categories: true,
        auto_chapters: true,
        auto_highlights: true,
        disfluencies: true,
        format_text: true,
        punctuate: true,
        language_detection: true,
        speech_model: "universal",
      };

      const transcribeRes = await fetch("https://api.assemblyai.com/v2/transcript", {
        method: "POST",
        headers: {
          authorization: ASSEMBLY_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify(config),
      });

      const { id } = await transcribeRes.json();

      // 3️⃣ Poll until completed
      setStatus("Processing transcription (this can take several minutes)...");
      let completed = false;
      let result;

      while (!completed) {
        const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
          headers: { authorization: ASSEMBLY_API_KEY },
        });
        result = await pollRes.json();

        if (result.status === "completed") {
          completed = true;
        } else if (result.status === "error") {
          throw new Error(result.error);
        } else {
          await new Promise((r) => setTimeout(r, 8000));
        }
      }

      // 4️⃣ Extract relevant metadata
      setTranscript(result.text);
      setUtterances(result.utterances || []);
      setChapters(result.chapters || []);
      setEntities(result.entities || []);
      setSentiments(result.sentiment_analysis_results || []);
      setTopics(
        result.iab_categories_result?.summary
          ? Object.entries(result.iab_categories_result.summary)
          : []
      );
      setStatus("✅ Transcription complete!");
    } catch (err) {
      console.error(err);
      setStatus(`❌ Error: ${err.message}`);
    }
  };

  return (
    <div
      style={{
        maxWidth: 800,
        margin: "2rem auto",
        textAlign: "center",
        fontFamily: "sans-serif",
      }}
    >
      <h2>🎙️ AssemblyAI Audio Transcriber</h2>
      <input
        type="file"
        accept="audio/*"
        onChange={(e) => setFile(e.target.files[0])}
        style={{ marginTop: "1rem" }}
      />
      <br />
      <button
        onClick={handleUpload}
        style={{
          marginTop: "1rem",
          padding: "0.6rem 1.2rem",
          border: "none",
          backgroundColor: "#4f46e5",
          color: "white",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Upload & Transcribe
      </button>

      <p style={{ marginTop: "1rem" }}>{status}</p>

      {/* Transcript */}
      {transcript && (
        <div
          style={{
            marginTop: "2rem",
            textAlign: "left",
            background: "#f9fafb",
            padding: "1rem",
            borderRadius: 8,
          }}
        >
          <h3>📝 Transcript:</h3>
          {utterances.length > 0 ? (
            utterances.map((u, i) => (
              <p key={i}>
                <strong>
                  Speaker {u.speaker} [{formatTime(u.start)} - {formatTime(u.end)}]:
                </strong>{" "}
                {u.text}
              </p>
            ))
          ) : (
            <p>{transcript}</p>
          )}
        </div>
      )}

      {/* Chapters */}
      {chapters.length > 0 && (
        <div
          style={{
            marginTop: "2rem",
            background: "#eef2ff",
            padding: "1rem",
            borderRadius: 8,
            textAlign: "left",
          }}
        >
          <h3>📚 Chapters:</h3>
          {chapters.map((c, i) => (
            <div key={i} style={{ marginBottom: "1rem" }}>
              <strong>{c.headline}</strong>
              <p>{c.gist}</p>
              <p style={{ color: "gray" }}>
                {formatTime(c.start)} → {formatTime(c.end)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Entities */}
      {entities.length > 0 && (
        <div
          style={{
            marginTop: "2rem",
            background: "#ecfdf5",
            padding: "1rem",
            borderRadius: 8,
            textAlign: "left",
          }}
        >
          <h3>🔍 Entities:</h3>
          {entities.map((e, i) => (
            <p key={i}>
              <strong>{e.entity_type}</strong>: {e.text}
            </p>
          ))}
        </div>
      )}

      {/* Sentiment */}
      {sentiments.length > 0 && (
        <div
          style={{
            marginTop: "2rem",
            background: "#fefce8",
            padding: "1rem",
            borderRadius: 8,
            textAlign: "left",
          }}
        >
          <h3>💬 Sentiment Analysis:</h3>
          {sentiments.map((s, i) => (
            <p key={i}>
              <strong>[{s.sentiment}]</strong> {s.text}
            </p>
          ))}
        </div>
      )}

      {/* Topics */}
      {topics.length > 0 && (
        <div
          style={{
            marginTop: "2rem",
            background: "#fff7ed",
            padding: "1rem",
            borderRadius: 8,
            textAlign: "left",
          }}
        >
          <h3>🏷️ Topics (IAB Categories):</h3>
          {topics.map(([topic, score], i) => (
            <p key={i}>
              {topic}: {score.toFixed(2)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
