import { create } from "zustand";

const useUiStore = create((set) => ({
  // -----------------------
  // Assistant / Sidebar
  // -----------------------
  assistantOpen: false,
  toggleAssistant: () =>
    set((state) => ({ assistantOpen: !state.assistantOpen })),

  // -----------------------
  // Chat Section
  // -----------------------
  chatOpen: false,
  setChatVisible: (visible) => set({ chatOpen: visible }),
  toggleChat: () =>
    set((state) => ({ chatOpen: !state.chatOpen })),
  closeChat: () => set({ chatOpen: false }),

  // -----------------------
  // Dashboard Visibility
  // -----------------------
  dashboardOpen: false,
  toggleDashboard: () =>
    set((state) => ({ dashboardOpen: !state.dashboardOpen })),
  showDashboard: () => set({ dashboardOpen: true }),
  hideDashboard: () => set({ dashboardOpen: false }),

  // -----------------------
  // App Theme
  // -----------------------
  theme: "light",
  toggleTheme: () =>
    set((state) => ({
      theme: state.theme === "light" ? "dark" : "light",
    })),
  setTheme: (theme) => set({ theme }),

  // -----------------------
  // Subtitles
  // -----------------------
  subtitles: "",
  setSubtitles: (text) => set({ subtitles: text }),

  // -----------------------
  // Audio / Mic State
  // -----------------------
  micActive: false,
  setMicActive: (active) => set({ micActive: active }),

  // -----------------------
  // Response Text
  // -----------------------
  assistantText: "",
  setAssistantText: (text) => set({ assistantText: text }),

  // -----------------------
  // Orb / Visualizer State
  // -----------------------
  orbActive: false,
  setOrbActive: (active) => set({ orbActive: active }),

  // -----------------------
  // Voice Settings
  // -----------------------
  voice: "alloy",
  chooseVoice: (voice) => set({ voice }),

  // -----------------------
  // RESET FUNCTION (FIX FOR ERROR)
  // -----------------------
  resetToggles: () =>
    set({
      assistantOpen: false,
      chatOpen: false,
      dashboardOpen: false,
      micActive: false,
      orbActive: false,
      assistantText: "",
      subtitles: "",
    }),
}));

export default useUiStore;
