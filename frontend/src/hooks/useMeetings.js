import { useState, useCallback } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const useMeetings = () => {
  const [meetings, setMeetings] = useState([]);
  const [currentMeeting, setCurrentMeeting] = useState(null);

  const fetchMeetings = useCallback(async (searchQuery = "", participant = "") => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      if (participant) params.append("participant", participant);

      const response = await axios.get(`${API}/meetings?${params.toString()}`);
      setMeetings(response.data);
    } catch (error) {
      console.error("Error fetching meetings:", error);
    }
  }, []);

  const createMeeting = useCallback(async (title, host = "Current User", participants = []) => {
    try {
      const response = await axios.post(`${API}/meetings`, {
        title,
        host,
        participants,
      });
      setCurrentMeeting(response.data);
      return response.data;
    } catch (error) {
      console.error("Error creating meeting:", error);
      return null;
    }
  }, []);

  return {
    meetings,
    currentMeeting,
    setCurrentMeeting,
    fetchMeetings,
    createMeeting,
  };
};
