import React, { useEffect, useRef } from "react";
import "../styles/MeetingAudioVisualizer.css";

/**
 * Props:
 *  - stream: MediaStream | null  (microphone or any audio source)
 *  - isActive: boolean           (whether to animate or pause)
 *  - label?: string              (optional label under the visualizer)
 */
const MeetingAudioVisualizer = ({ stream, isActive = true, label = "Live audio levels" }) => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);

  useEffect(() => {
    if (!stream || !isActive) {
      // Stop animation & audio when not active or no stream
      stopVisualizer();
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const canvasCtx = canvas.getContext("2d");
    const AudioContext = window.AudioContext || window.webkitAudioContext;

    // Create / reuse audio context
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const audioCtx = audioCtxRef.current;

    // If context is suspended (e.g. mobile), try to resume
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }

    // Create analyser
    analyserRef.current = audioCtx.createAnalyser();
    analyserRef.current.fftSize = 256; // number of bars
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Connect stream -> analyser
    sourceRef.current = audioCtx.createMediaStreamSource(stream);
    sourceRef.current.connect(analyserRef.current);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const analyser = analyserRef.current;
      if (!analyser) return;

      analyser.getByteFrequencyData(dataArray);

      const width = canvas.width;
      const height = canvas.height;

      // Clear canvas
      canvasCtx.clearRect(0, 0, width, height);

      // Background (slight translucent fill)
      canvasCtx.fillStyle = "rgba(10, 18, 40, 0.12)";
      canvasCtx.fillRect(0, 0, width, height);

      const barCount = 40; // how many bars to draw (subset of fft bins)
      const step = Math.floor(bufferLength / barCount);
      const barWidth = width / barCount;

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step];
        const barHeight = (value / 255) * height;

        const x = i * barWidth;
        const y = height - barHeight;

        // Gradient-style bar (no CSS required)
        const gradient = canvasCtx.createLinearGradient(0, y, 0, height);
        gradient.addColorStop(0, "#36c1ff");
        gradient.addColorStop(0.6, "#4f46e5");
        gradient.addColorStop(1, "#111827");

        canvasCtx.fillStyle = gradient;
        const padding = barWidth * 0.25;
        canvasCtx.fillRect(x + padding / 2, y, barWidth - padding, barHeight);
        // Rounded tops
        canvasCtx.beginPath();
        canvasCtx.roundRect(
          x + padding / 2,
          y,
          barWidth - padding,
          barHeight,
          Math.min(6, barWidth / 2)
        );
        canvasCtx.fill();
      }
    };

    // Resize canvas to container size (for responsiveness)
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const { width, height } = parent.getBoundingClientRect();
      canvas.width = width * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      canvasCtx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    draw();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      stopVisualizer();
    };
  }, [stream, isActive]);

  const stopVisualizer = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch (e) {}
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch (e) {}
      analyserRef.current = null;
    }
    // Keep audioCtx for reuse; don't close so it can be resumed quickly
  };

  return (
    <div className="meeting-visualizer">
      <div className="meeting-visualizer__header">
        <span className="meeting-visualizer__dot meeting-visualizer__dot--pulse" />
        <span className="meeting-visualizer__title">{label}</span>
      </div>

      <div className="meeting-visualizer__canvas-wrapper">
        <canvas ref={canvasRef} className="meeting-visualizer__canvas" />
      </div>

      <div className="meeting-visualizer__footer">
        <span className={`meeting-visualizer__status ${isActive ? "on" : "off"}`}>
          {isActive ? "Listening..." : "Paused"}
        </span>
      </div>
    </div>
  );
};

export default MeetingAudioVisualizer;