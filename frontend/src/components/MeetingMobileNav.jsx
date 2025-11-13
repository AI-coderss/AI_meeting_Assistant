import React, { useState, useEffect } from "react";
import {
  FiCalendar,
  FiVideo,
  FiClock,
  FiRotateCcw,
  FiUsers,
  FiList,
} from "react-icons/fi";
import "../styles/MeetingMobileNav.css";

const TABS = [
  { id: "schedule", label: "Schedule", icon: FiCalendar },
  { id: "live", label: "Live", icon: FiVideo },
  { id: "upcoming", label: "Upcoming", icon: FiClock },
  { id: "history", label: "History", icon: FiRotateCcw },
  { id: "userlist", label: "Users", icon: FiUsers },
  { id: "allMeetings", label: "All", icon: FiList },
];

const MeetingMobileNav = ({ activeTab, setActiveTab }) => {
  const [roles, setRoles] = useState([]);
  const [visibleTabs, setVisibleTabs] = useState([]);

  useEffect(() => {
    const storedRoles = JSON.parse(localStorage.getItem("roles")) || [];
    setRoles(storedRoles);

    // Filter tabs based on role
    const isAdmin = storedRoles.includes("admin");
    const filtered = isAdmin
      ? TABS
      : TABS.filter((tab) => tab.id !== "userlist" && tab.id !== "allMeetings");
    setVisibleTabs(filtered);
  }, []);

  return (
    <div className="fixed bottom-0 left-0 w-full bg-gray-800 text-white flex justify-around items-center py-2 z-50 md:hidden">
      <div className="navigation">
        <ul>
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <li
                key={tab.id}
                className={`list${isActive ? " active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <a href="#!" onClick={(e) => e.preventDefault()}>
                  <span className="icon">
                    <Icon />
                  </span>
                  <span className="text">{tab.label}</span>
                </a>
              </li>
            );
          })}

          <div
            className="indicator"
            style={{
              transform: `translateX(calc(70px * ${visibleTabs.findIndex(
                (t) => t.id === activeTab
              )}))`,
            }}
          ></div>
        </ul>
      </div>
    </div>
  );
};

export default MeetingMobileNav;
