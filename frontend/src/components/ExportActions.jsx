import React from "react";

const ExportActions = ({ exportToPDF, exportToWord, copyToClipboard, openEmailModal }) => {
  return (
    <div className="export-actions">
      <h4>Export & Share</h4>
      <div className="action-buttons">
        <button className="btn btn-export" onClick={exportToPDF}>
          📄 PDF
        </button>
        <button className="btn btn-export" onClick={exportToWord}>
          📝 Word
        </button>
        <button className="btn btn-export" onClick={copyToClipboard}>
          📋 Copy
        </button>
        <button className="btn btn-email" onClick={openEmailModal}>
          📧 Email
        </button>
      </div>
    </div>
  );
};

export default ExportActions;
