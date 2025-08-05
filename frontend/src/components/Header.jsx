import React from "react";

const Header = ({ darkMode, toggleDarkMode }) => {
  return (
    <header className="app-header">
      <div className="header-content">
        <h1>AI Meeting Assistant</h1>
        <div className="header-controls">
          <button
            className="theme-toggle"
            onClick={toggleDarkMode}
            title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
