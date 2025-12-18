import axios from "axios";

export async function shareMeetingToN8n(meeting) {
  if (!meeting) {
    throw new Error("No meeting selected");
  }

  return axios.post(
    "https://n8n-latest-h3pu.onrender.com/webhook/85637224-7bfe-42fa-bdb0-7bfa84b16001",
    {
      meeting_id: meeting.id || meeting._id,
      title: meeting.title,
      host: meeting.host,
      participants: (meeting.participants || [])
        .map((p) => p.email)
        .filter(Boolean),
      status: meeting.status,
      timestamp: meeting.timestamp,
      summary: meeting.summary || {},
      transcript: meeting.transcript || [],
      source: "voice_assistant",
      shared_at: new Date().toISOString(),
    }
  );
}
