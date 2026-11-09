import type { TrainOutcome, TrainingEvent, VizLevel } from '@noesis/engine-client';
import { create } from 'zustand';
import {
  ANIMATED,
  DROPPABLE,
  EPOCH_EVENTS,
  applyEvent,
  emptyVisual,
  visualFromEvents,
  type VisualState,
} from './events';

/** How fast the page shows what happened (docs/design/training-events.md, "Pacing"). */
export type Pacing = 'live' | 'slow' | 'step';

/** The most events kept for one run. Past this, only events that carry a result are kept. */
export const MAX_EVENTS = 50_000;

/** Milliseconds between animated events in slow motion, and when replaying a finished run. */
export const SLOW_MS = 70;
export const REPLAY_MS = 35;

interface TrainingState {
  runId: string | null;
  /** Every event received. The picture shows the first `cursor` of them. */
  events: TrainingEvent[];
  cursor: number;
  visual: VisualState;
  pacing: Pacing;
  viz: VizLevel;
  /** True while a finished run is being replayed or inspected from its stored log. */
  replay: boolean;
  /** Whether the engine is still working on this run. */
  running: boolean;
  outcome: TrainOutcome | null;
}

export const useTraining = create<TrainingState>(() => ({
  runId: null,
  events: [],
  cursor: 0,
  visual: emptyVisual(),
  pacing: 'live',
  viz: 'full',
  replay: false,
  running: false,
  outcome: null,
}));

const raf = (fn: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
  else setTimeout(fn, 16);
};

let frame = false;
let timer: ReturnType<typeof setInterval> | null = null;
/** The picture being built. It is rebuilt only when the position moves backwards. */
let picture = emptyVisual();
let pictureAt = 0;

function showUpTo(count: number): void {
  const { events, cursor } = useTraining.getState();
  const target = Math.max(0, Math.min(count, events.length));
  if (target < pictureAt) {
    picture = visualFromEvents(events, target);
  } else {
    for (let i = pictureAt; i < target; i++) applyEvent(picture, events[i] as TrainingEvent);
  }
  pictureAt = target;
  if (target !== cursor || target === 0)
    useTraining.setState({ cursor: target, visual: { ...picture } });
}

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Slow motion and replay: one event per tick, skipping straight past bookkeeping events. */
function startTimer(ms: number): void {
  stopTimer();
  timer = setInterval(() => {
    const { events, cursor, running, replay } = useTraining.getState();
    if (cursor >= events.length) {
      if (!running) stopTimer();
      return;
    }
    let next = cursor + 1;
    while (next < events.length && !ANIMATED.has((events[next - 1] as TrainingEvent).type)) next++;
    showUpTo(next);
    void replay;
  }, ms);
}

/** Forgets the last run and gets ready to receive a new one. */
export function beginRun(runId: string, viz: VizLevel): void {
  stopTimer();
  picture = emptyVisual();
  pictureAt = 0;
  useTraining.setState({
    runId,
    events: [],
    cursor: 0,
    visual: emptyVisual(),
    viz,
    replay: false,
    running: true,
    outcome: null,
  });
}

/** Takes in a batch of events from the engine. */
export function pushEvents(batch: TrainingEvent[]): void {
  if (batch.length === 0) return;
  const state = useTraining.getState();
  // A flood of droppable events is thinned, not stored: memory and the page stay bounded.
  for (const e of batch)
    if (state.events.length < MAX_EVENTS || !DROPPABLE.has(e.type)) state.events.push(e);
  if (state.pacing === 'live') {
    if (frame) return;
    frame = true;
    raf(() => {
      frame = false;
      showUpTo(useTraining.getState().events.length);
    });
  } else if (state.pacing === 'slow' && !timer) startTimer(SLOW_MS);
}

export function finishRun(outcome: TrainOutcome): void {
  useTraining.setState({ running: false, outcome });
  const { pacing, events } = useTraining.getState();
  if (pacing === 'live') showUpTo(events.length);
}

export function setPacing(pacing: Pacing): void {
  stopTimer();
  useTraining.setState({ pacing });
  const { events, running, cursor, replay } = useTraining.getState();
  if (pacing === 'live') showUpTo(events.length);
  else if (pacing === 'slow' && (running || cursor < events.length))
    startTimer(replay ? REPLAY_MS : SLOW_MS);
}

/** Step mode: show the next event, or everything up to the next epoch, round or batch of trees. */
export function stepForward(unit: 'event' | 'epoch'): void {
  const { events, cursor } = useTraining.getState();
  if (cursor >= events.length) return;
  if (unit === 'event') return showUpTo(cursor + 1);
  let next = cursor + 1;
  while (next < events.length && !EPOCH_EVENTS.has((events[next - 1] as TrainingEvent).type))
    next++;
  showUpTo(next);
}

/** Shows a finished run from its stored events. It plays from the start in slow motion. */
export function showStoredRun(runId: string, events: TrainingEvent[], autoplay = true): void {
  stopTimer();
  picture = emptyVisual();
  pictureAt = 0;
  useTraining.setState({
    runId,
    events: [...events],
    cursor: 0,
    visual: emptyVisual(),
    replay: true,
    running: false,
    outcome: null,
    pacing: autoplay ? 'slow' : 'step',
  });
  if (autoplay) startTimer(REPLAY_MS);
}

/** Jumps to a position in the run, for the scrubber under a replay. */
export function seek(position: number): void {
  stopTimer();
  useTraining.setState({ pacing: 'step' });
  showUpTo(position);
}

export function clearTraining(): void {
  stopTimer();
  picture = emptyVisual();
  pictureAt = 0;
  useTraining.setState({
    runId: null,
    events: [],
    cursor: 0,
    visual: emptyVisual(),
    replay: false,
    running: false,
    outcome: null,
  });
}
