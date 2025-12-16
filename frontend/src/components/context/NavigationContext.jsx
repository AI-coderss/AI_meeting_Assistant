import { createContext } from "react";

export const NavigationContext = createContext({
  activeTab: "schedule",
  setActiveTab: () => {},
});
