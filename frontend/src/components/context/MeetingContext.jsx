import { createContext } from "react";

const MeetingContext = createContext({
  selectedMeeting: null,
  setSelectedMeeting: () => {}
});

export default MeetingContext;
