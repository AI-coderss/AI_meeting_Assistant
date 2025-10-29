import { useState, useCallback } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_API_BASE || "https://ai-meeting-assistant-backend-suu9.onrender.com";
const API = `${BACKEND_URL}/api`;

export const useMeetings = () => {
  const [meetings, setMeetings] = useState([]);
  const [currentMeeting, setCurrentMeeting] = useState(null);
  const token = localStorage.getItem("token"); 

  const fetchMeetings = useCallback(
    async (searchQuery = "", participant = "") => {
      try {
        const params = new URLSearchParams();
        if (searchQuery) params.append("search", searchQuery);
        if (participant) params.append("participant", participant);

        const response = await axios.get(
          `${API}/meetings?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const meetingsData = response.data || [];
        setMeetings(meetingsData);

        // ✅ Auto-select most recent meeting if none selected
        if (meetingsData.length > 0 && !currentMeeting) {
          const latest = meetingsData[0];
          setCurrentMeeting(latest);
        }

        return meetingsData;
      } catch (error) {
        console.error("Error fetching meetings:", error);
        return [];
      }
    },
    [token, currentMeeting]
  );

  const createMeeting = useCallback(
    async (title, host = "Current User", participants = []) => {
      try {
        const response = await axios.post(
          `${API}/meetings`,
          { title, host, participants },
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        setCurrentMeeting(response.data);
        return response.data;
      } catch (error) {
        console.error("Error creating meeting:", error);
        return null;
      }
    },
    [token]
  );

  return {
    meetings,
    currentMeeting,
    setCurrentMeeting,
    fetchMeetings,
    createMeeting,
  };
};
