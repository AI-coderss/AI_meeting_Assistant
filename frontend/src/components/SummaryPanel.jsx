import React from "react";

const SummaryPanel = ({
  transcript,
  summary,
  isSummarizing,
  generateSummary,
}) => {
  return (
    <div className="summary-section">
      <div className="summary-header">
        <h3>Meeting Summary</h3>
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
    </div>
  );
};

export default SummaryPanel;
