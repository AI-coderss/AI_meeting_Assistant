import { create } from "zustand";

/**
 * Simple Zustand store to manage the currently active card id.
 * Used in ChatBot.jsx to highlight a specific app card.
 */

const useCardStore = create((set) => ({
  activeCardId: null,

  setActiveCardId: (id) =>
    set(() => ({
      activeCardId: id,
    })),

  clearActiveCard: () =>
    set(() => ({
      activeCardId: null,
    })),
}));

export default useCardStore;
