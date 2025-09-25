import { useState, useCallback } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_API_BASE || "http://127.0.0.1:8001";
const API = `${BACKEND_URL}/api`;

export const useMeetings = () => {
  const [meetings, setMeetings] = useState([]);
  const [currentMeeting, setCurrentMeeting] = useState(null);
  const token = localStorage.getItem("token"); 
  const fetchMeetings = useCallback(async (searchQuery = "", participant = "") => {
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
