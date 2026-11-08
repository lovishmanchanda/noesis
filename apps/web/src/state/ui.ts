import { create } from 'zustand';
import { SCREENS, screenIndex, screenStatus, type ScreenId } from '../screens';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Mode = 'guided' | 'expert';

const read = (key: string, fallback: string): string => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage can be blocked; the choice then lasts for this visit only */
  }
};

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = resolveTheme(choice);
}

interface UiState {
  theme: ThemeChoice;
  mode: Mode;
  screen: ScreenId;
  completed: ScreenId[];
  setTheme: (theme: ThemeChoice) => void;
  setMode: (mode: Mode) => void;
  goTo: (screen: ScreenId) => void;
  markDone: (screen: ScreenId) => void;
  markUndone: (screen: ScreenId) => void;
  next: () => void;
  back: () => void;
}

export const useUi = create<UiState>((set, get) => ({
  theme: read('noesis.theme', 'system') as ThemeChoice,
  mode: read('noesis.mode', 'guided') as Mode,
  screen: 'project',
  completed: [],
  setTheme: (theme) => {
    write('noesis.theme', theme);
    applyTheme(theme);
    set({ theme });
  },
  setMode: (mode) => {
    write('noesis.mode', mode);
    set({ mode });
  },
  goTo: (screen) => {
    const { screen: current, completed } = get();
    if (screenStatus(screen, current, completed).status !== 'locked') set({ screen });
  },
  markDone: (screen) =>
    set((s) => ({
      completed: s.completed.includes(screen) ? s.completed : [...s.completed, screen],
    })),
  markUndone: (screen) => set((s) => ({ completed: s.completed.filter((id) => id !== screen) })),
  next: () => {
    const { screen, goTo } = get();
    const following = SCREENS[screenIndex(screen) + 1];
    if (following) goTo(following.id);
  },
  back: () => {
    const { screen, goTo } = get();
    const previous = SCREENS[screenIndex(screen) - 1];
    if (previous) goTo(previous.id);
  },
}));
