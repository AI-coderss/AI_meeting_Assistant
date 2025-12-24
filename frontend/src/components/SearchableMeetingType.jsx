import { useState } from "react";

export default function SearchableMeetingType({ value, onChange }) {
    
      const MEETING_TYPES = [
      // Existing
      "Consultation",
      "Case Discussion",
      "Follow-up",
      "Team Meetings",
      "Client Meetings",
      "Project Kickoff Meetings",
      "Status Update Meetings",
      "Brainstorming Sessions",
      "Training Sessions",
      "Board Meetings",
      "All-Hands Meetings",
      "Strategy Planning Meetings",
      "Performance Review Meetings",
      "Daily Stand-Ups",
      "Retrospective Meetings",
      "Innovation Sessions (Hackathons)",
      "Committee Meetings",
      "Demo Meetings (with vendors or companies)",
      "Sales Meetings",
      "Product Demos and Launch Meetings",
      "Crisis Management Meetings",
      "Cross-department Meetings",
      "Town Hall Meetings",
      "Budget or Financial Review Meetings",
    ];
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const filteredOptions = MEETING_TYPES.filter((type) =>
    type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ position: "relative" }}>
      <label>Meeting Type</label>

      <input
        type="text"
        placeholder="Search meeting type..."
        value={search || value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
          onChange(""); // clear actual value while searching
        }}
      />

      {open && (
        <ul
          style={{
            position: "absolute",
            zIndex: 10,
            background: "#fff",
            border: "1px solid #ccc",
            width: "100%",
            maxHeight: "180px",
            overflowY: "auto",
            padding: 0,
            margin: 0,
            listStyle: "none",
          }}
        >
          {filteredOptions.length === 0 && (
            <li style={{ padding: "8px", color: "#999" }}>
              No results
            </li>
          )}

          {filteredOptions.map((type) => (
            <li
              key={type}
              onClick={() => {
                onChange(type);
                setSearch("");
                setOpen(false);
              }}
              style={{
                padding: "8px",
                cursor: "pointer",
              }}
            >
              {type}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
