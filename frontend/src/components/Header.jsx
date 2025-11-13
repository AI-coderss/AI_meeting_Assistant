import React from "react";

const Header = ({ darkMode, toggleDarkMode }) => {
  return (
    <header className="app-header">
      <div className="header-content">
        <img
          src="https://www.dsah.sa/sites/default/files/dsah-logo.png"
          alt="Logo"
          className="app-logo"
        />
        <div className="logo-title">
          <h1>AI Meeting Assistant</h1>
        </div>
        <div className="header-controls">
          <button
            className="theme-toggle"
            onClick={toggleDarkMode}
            title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
          <button class="btn login-btn d-flex align-items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M10 17l5-5-5-5v10z" />
              <path d="M19 3H5a2 2 0 00-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2z" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
