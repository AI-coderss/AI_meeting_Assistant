import React, { useEffect, useRef, useState } from "react";
import AudioWave from "./AudioWave";
import "../styles/AudioVisualizer.css";

const AudioVisualizer = ({ stream, isRecording }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef(null);

  /** Format HH:MM:SS */
  const formatTime = (totalSeconds) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [
      hours.toString().padStart(2, "0"),
      minutes.toString().padStart(2, "0"),
      seconds.toString().padStart(2, "0")
    ].join(":");
  };

  /** Start timer */
  const startTimer = () => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
  };

  /** Stop timer */
  const stopTimer = () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
  };

  /** Handle recording state changes */
  useEffect(() => {
    if (isRecording) {
      setElapsedSeconds(0);
      startTimer();
    } else {
      stopTimer();
    }
    return stopTimer;
  }, [isRecording]);

  return (
    <div className="audio-visualizer-wrapper">
      <div className="audio-visualizer-card">
        <div className="av-header">
          <div className="av-title">Live Audio Monitor</div>

          <div className={`av-status ${isRecording ? "av-status--live" : "av-status--idle"}`}>
            <span className="av-status-dot" />
            <span className="av-status-text">{isRecording ? "LIVE" : "Idle"}</span>
          </div>
        </div>

        <div className="av-timer-row">
          <span className="av-timer-label">Recording time</span>
          <span className="av-timer-value">{formatTime(elapsedSeconds)}</span>
        </div>

        <div className="av-wave-container">
          <AudioWave stream={isRecording ? stream : null} />
        </div>
      </div>
    </div>
  );
};

export default AudioVisualizer;
