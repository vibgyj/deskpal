/**
 * The character's behaviour as a pure state machine. The UI feeds it events
 * and plays what comes back: an optional one-shot animation, then the loop
 * that belongs to the new mode.
 */

export type Mode =
  | 'hidden'
  | 'idle'
  | 'bored'
  | 'asleep'
  | 'dragging'
  | 'listening'
  | 'downloading'
  | 'thinking'
  | 'talking';

export type BehaviourEvent =
  | 'poke' // hover, click or other sign of life
  | 'fidget'
  | 'bored'
  | 'sleep'
  | 'open'
  | 'close'
  | 'ask'
  | 'await-user' // waiting on the visitor, e.g. the download prompt
  | 'download'
  | 'answer-start'
  | 'answer-cited'
  | 'answer-unsure' // a low-confidence answer
  | 'answer-plain'
  | 'chat' // a small-talk reply; the widget picks the expression
  | 'no-answer'
  | 'error'
  | 'drag-start'
  | 'drag-end'
  | 'hide'
  | 'show';

export interface State {
  mode: Mode;
  open: boolean;
  greeted: boolean;
}

export interface Step {
  state: State;
  /** One-shot animation to play before the mode's loop. */
  once?: string;
}

export const initialState: State = { mode: 'idle', open: false, greeted: false };

const LOOPS: Record<Mode, string> = {
  hidden: 'hide',
  idle: 'idle',
  bored: 'bored',
  asleep: 'sleep',
  dragging: 'drag',
  listening: 'listening',
  downloading: 'download',
  thinking: 'thinking',
  talking: 'talking',
};

export function loopFor(mode: Mode): string {
  return LOOPS[mode];
}

/** Text alternatives for expressions that carry meaning (SPEC §5). */
export const ANNOUNCE: Partial<Record<string, string>> = {
  thinking: 'Thinking…',
  download: 'Loading the language model…',
  sorry: 'No answer found in the docs.',
  unsure: 'Not sure about this answer.',
  confused: 'Something went wrong.',
  'wave-goodbye': 'Assistant hidden.',
};

export function step(s: State, event: BehaviourEvent): Step {
  const to = (mode: Mode, once?: string, patch: Partial<State> = {}): Step => ({ state: { ...s, ...patch, mode }, once });
  const resting: Mode = s.open ? 'listening' : 'idle';

  if (s.mode === 'hidden') return event === 'show' ? to('idle', 'appear') : { state: s };

  switch (event) {
    case 'poke':
      if (s.mode === 'asleep') return to(resting, 'wake');
      if (s.mode === 'bored') return to(resting);
      return { state: s };
    case 'fidget':
      return s.mode === 'idle' ? to('idle', 'idle-fidget') : { state: s };
    case 'bored':
      return s.mode === 'idle' ? to('bored') : { state: s };
    case 'sleep':
      return s.mode === 'idle' || s.mode === 'bored' ? to('asleep') : { state: s };
    case 'open': {
      const once = s.mode === 'asleep' ? 'wake' : s.greeted ? undefined : 'greet';
      return to('listening', once, { open: true, greeted: true });
    }
    case 'close':
      return to(s.mode === 'dragging' ? 'dragging' : 'idle', undefined, { open: false });
    case 'ask':
      return to('thinking');
    case 'await-user':
      return to('listening');
    case 'download':
      return to('downloading');
    case 'answer-start':
      return to('talking');
    case 'answer-cited':
      return to(resting, 'pointing');
    case 'answer-unsure':
      return to(resting, 'unsure');
    case 'answer-plain':
    case 'chat':
      return to(resting, 'happy');
    case 'no-answer':
      return to(resting, 'sorry');
    case 'error':
      return to(resting, 'confused');
    case 'drag-start':
      return to('dragging');
    case 'drag-end':
      return s.mode === 'dragging' ? to(resting, 'land') : { state: s };
    case 'hide':
      return to('hidden', 'wave-goodbye', { open: false });
    case 'show':
      return { state: s };
  }
}
