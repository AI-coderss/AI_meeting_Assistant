import React from "react";

const Tabs = ({ activeTab, setActiveTab }) => {
  return (
    <nav className="tabs">
      <button
        className={`tab ${activeTab === "live" ? "active" : ""}`}
        onClick={() => setActiveTab("live")}
      >
        🔴 Live Meeting
      </button>
      <button
        className={`tab ${activeTab === "upload" ? "active" : ""}`}
        onClick={() => setActiveTab("upload")}
      >
        📁 Upload Meeting
      </button>
      <button
        className={`tab ${activeTab === "history" ? "active" : ""}`}
        onClick={() => setActiveTab("history")}
      >
        📜 Meeting History
      </button>
    </nav>
  );
};

export default Tabs;
