import React, { useEffect } from "react";

const SummaryPanel = ({
  transcript,
  summary,
  isSummarizing,
  generateSummary,
  language,
  setSummary, // Add setSummary prop to clear the summary
}) => {
  // Clear summary when language changes
  useEffect(() => {
    if (summary) {
      setSummary(null);
    }
  }, [language]); // This effect runs when language changes

  // Show message if summary exists but transcript language doesn't match
  const showLanguageMismatch = summary && transcript.length > 0;

  return (
    <div className="summary-section">
      <div className="summary-header">
        <h3>
          Meeting Summary{" "}
          {language && `(${language === "ar" ? "Arabic" : "English"})`}
        </h3>

        <button
          className="btn btn-generate"
          onClick={generateSummary}
          disabled={isSummarizing || transcript.length === 0}
        >
          {isSummarizing ? "⏳ Generating..." : "🤖 Generate Summary"}
        </button>
      </div>

      {summary && (
        <div className="summary-content">
          <div className="summary-section-item">
            <h4>🔑 Key Points</h4>
            <ul>
              {summary.key_points?.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>

          <div className="summary-section-item">
            <h4>📋 Decisions Made</h4>
            <ul>
              {summary.decisions_made?.map((decision, i) => (
                <li key={i}>{decision}</li>
              ))}
            </ul>
          </div>

          <div className="summary-section-item">
            <h4>✅ Action Items</h4>
            <ul>
              {summary.action_items?.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="summary-section-item">
            <h4>👥 Assignees</h4>
            <ul>
              {summary.assignees?.map((assignee, i) => (
                <li key={i}>{assignee}</li>
              ))}
            </ul>
          </div>

          <div className="summary-section-item">
            <h4>❓ Unresolved Issues</h4>
            <ul>
              {summary.unresolved_issues?.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {!summary && transcript.length > 0 && (
        <div className="summary-placeholder">
          <p>
            No summary generated yet. Click "Generate Summary" to create an AI
            summary of your meeting.
          </p>
        </div>
      )}
    </div>
  );
};

export default SummaryPanel;
