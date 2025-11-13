import React, { useEffect, useState } from "react";

const Tabs = ({ activeTab, setActiveTab }) => {
  const [roles, setRoles] = useState([]);

  useEffect(() => {
    const storedRoles = JSON.parse(localStorage.getItem("roles")) || [];
    setRoles(storedRoles);
  }, []);

  const isAdmin = roles.includes("admin");

  return (
    <nav className="tabs">
   

      <div className="button-left">
        <button
          className={`tab ${activeTab === "schedule" ? "active" : ""}`}
          onClick={() => setActiveTab("schedule")}
        >
          📅 Meeting Schedule
        </button>

        <button
          className={`tab ${activeTab === "live" ? "active" : ""}`}
          onClick={() => setActiveTab("live")}
        >
          🔴 Live Meeting
        </button>
        <button
          className={`tab ${activeTab === "upcoming" ? "active" : ""}`}
          onClick={() => setActiveTab("upcoming")}
        >
          Upcoming Meetings
        </button>
        <button
          className={`tab ${activeTab === "history" ? "active" : ""}`}
          onClick={() => setActiveTab("history")}
        >
          📜 Meeting History
        </button>

        {/* ✅ Show UserList tab only for Admins */}
        {isAdmin && (
          <>
            <button
              className={`tab ${activeTab === "userlist" ? "active" : ""}`}
              onClick={() => setActiveTab("userlist")}
            >
              👥 User List
            </button>
            <button
              className={`tab ${activeTab === "allMeetings" ? "active" : ""}`}
              onClick={() => setActiveTab("allMeetings")}
            >
              📚 All Meetings
            </button>
          </>
        )}
      </div>
    </nav>
  );
};

export default Tabs;
