/** View state that is not part of the design: the results tab and the guided tour. */
import { create } from 'zustand';

export type ResultsTab = 'overview' | 'section' | 'span' | 'sweep' | 'flow3d' | 'calc' | 'export';

const TOUR_KEY = 'hydrofoil-designer:tour';

function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === 'done';
  } catch {
    return false;
  }
}

interface UiState {
  resultsTab: ResultsTab;
  tourOpen: boolean;
  setResultsTab(t: ResultsTab): void;
  openTour(): void;
  /** Close the tour and remember not to show it on the next visit. */
  closeTour(): void;
}

export const useUi = create<UiState>((set) => ({
  resultsTab: 'overview',
  // first visit: offer the tour
  tourOpen: !tourSeen(),
  setResultsTab: (t) => set({ resultsTab: t }),
  openTour: () => set({ tourOpen: true }),
  closeTour: () => {
    set({ tourOpen: false });
    try {
      localStorage.setItem(TOUR_KEY, 'done');
    } catch {
      // storage unavailable: the tour shows again next visit
    }
  },
}));
