import React, { useState, useRef, useEffect } from "react";
import "../styles/ExportActions.css";

const ExportActions = ({ exportToPDF, exportToWord, copyToClipboard }) => {
  const [isOpen, setIsOpen] = useState(false);
  const popupRef = useRef(null);
  const toggleBtnRef = useRef(null);

  // Handle clicks outside to close popup
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target) &&
        toggleBtnRef.current &&
        !toggleBtnRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  return (
    <div className="export-actions">
      {/* Toggle button */}
      {!isOpen && (
        <button
          className="btn-line"
          ref={toggleBtnRef}
          onClick={() => setIsOpen(true)}
        >
          EXPORT
        </button>
      )}

      {/* Popup */}
      {isOpen && (
        <div className="action-popup show" ref={popupRef}>
          <div className="popup-header">
            <h4>Export Options</h4>
            <button
              className="close-btn"
              onClick={() => setIsOpen(false)}
            >
              ×
            </button>
          </div>

          <button className="btn-export" onClick={exportToPDF}>
            📄 Export as PDF
          </button>
          <button className="btn-export" onClick={exportToWord}>
            📝 Export as Word
          </button>
          <button className="btn-export" onClick={copyToClipboard}>
            📋 Copy Content
          </button>
        </div>
      )}
    </div>
  );
};

export default ExportActions;
