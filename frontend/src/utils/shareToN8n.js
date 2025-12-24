import axios from "axios";

export async function shareMeetingToN8n(meeting) {
  if (!meeting) {
    throw new Error("No meeting selected");
  }

  return axios.post(
    "https://n8n-latest-h3pu.onrender.com/webhook/ae676cc6-99fc-411f-8ffd-e11b0d1092b3",
    {
      meeting_id: meeting.id || meeting._id,
      meeting_title: meeting.meeting_title || meeting.title || "",

      participants: meeting.participants || [],

      summary: meeting.summary || "",
      overview: meeting.overview || "",
      insights: meeting.insights || [],
      outline: meeting.outline || [],
      key_points: meeting.key_points || [],
      action_items: meeting.action_items || [],
      decisions_made: meeting.decisions_made || [],
      structured_transcript: meeting.structured_transcript || [],

      shared_by:
        meeting.shared_by ||
        localStorage.getItem("email") ||
        "",

      timestamp: new Date().toISOString(),
    }
  );
}
