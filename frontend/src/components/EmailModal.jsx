import React from "react";

const EmailModal = ({
  emailModal,
  setEmailModal,
  sendEmail,
}) => {
  const handleClose = () => {
    setEmailModal({
      show: false,
      emails: "",
      senderEmail: "",
      senderName: "",
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Send Meeting Summary</h3>
          <button className="modal-close" onClick={handleClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Recipient Emails (comma-separated):</label>
            <textarea
              value={emailModal.emails}
              onChange={(e) =>
                setEmailModal({ ...emailModal, emails: e.target.value })
              }
              placeholder="john@example.com, jane@example.com"
              rows="3"
            />
          </div>
          <div className="form-group">
            <label>Sender Email:</label>
            <input
              type="email"
              value={emailModal.senderEmail}
              onChange={(e) =>
                setEmailModal({ ...emailModal, senderEmail: e.target.value })
              }
              placeholder="meetings@company.com"
            />
          </div>
          <div className="form-group">
            <label>Sender Name:</label>
            <input
              type="text"
              value={emailModal.senderName}
              onChange={(e) =>
                setEmailModal({ ...emailModal, senderName: e.target.value })
              }
              placeholder="AI Meeting Assistant"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-cancel" onClick={handleClose}>
            Cancel
          </button>
          <button className="btn btn-send" onClick={sendEmail}>
            📧 Send Email
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmailModal;
