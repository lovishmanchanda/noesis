import type { Engine, EnginePhase, EngineProgress } from '@noesis/engine-client';
import { create } from 'zustand';
import { BrowserEngine } from '../engine/client';

interface EngineState {
  phase: EnginePhase;
  progress: EngineProgress | null;
  error: string | null;
  /** Starts the engine once. Safe to call again. */
  start: () => Promise<void>;
}

let instance: Engine | null = null;
let starting: Promise<void> | null = null;

/** The running engine, for screens that need to ask it for work. */
export function getEngine(): Engine {
  if (!instance) throw new Error('The engine has not been started');
  return instance;
}

export const useEngine = create<EngineState>((set) => ({
  phase: 'idle',
  progress: null,
  error: null,
  start: () => {
    if (starting) return starting;
    instance = new BrowserEngine();
    set({ phase: 'loading', progress: null, error: null });
    starting = instance
      .init((progress) => set({ progress }))
      .then(() => set({ phase: 'ready' }))
      .catch((error: unknown) => {
        starting = null;
        set({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
      });
    return starting;
  },
}));
