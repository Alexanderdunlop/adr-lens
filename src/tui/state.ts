import { STATUS_ORDER } from '../core/status.ts';
import type { Status } from '../core/types.ts';

export type Focus = 'list' | 'detail';
export type Overlay = 'none' | 'help' | 'jump';

export interface State {
  /** Index into the currently visible records. */
  selected: number;
  /** First visible row of the list pane. */
  listOffset: number;
  /** First visible row of the detail pane. */
  detailOffset: number;
  focus: Focus;
  overlay: Overlay;
  query: string;
  /** True while the query is being typed. */
  searching: boolean;
  statusFilter: Status | null;
  liveOnly: boolean;
  /** Ids visited, for `[` / `]` navigation. */
  history: string[];
  historyIndex: number;
}

export type Action =
  | { type: 'move'; delta: number; visibleRows: number; total: number }
  | { type: 'select'; index: number; visibleRows: number; total: number }
  | { type: 'scrollDetail'; delta: number; max: number }
  | { type: 'focus'; focus: Focus }
  | { type: 'overlay'; overlay: Overlay }
  | { type: 'startSearch' }
  | { type: 'setQuery'; query: string }
  | { type: 'endSearch'; commit: boolean }
  | { type: 'cycleStatus' }
  | { type: 'toggleLive' }
  | { type: 'pushHistory'; id: string }
  | { type: 'historyStep'; delta: number };

export interface InitialState {
  query?: string;
  statusFilter?: Status | null;
  liveOnly?: boolean;
}

export function initialState(options: InitialState = {}): State {
  return {
    selected: 0,
    listOffset: 0,
    detailOffset: 0,
    focus: 'list',
    overlay: 'none',
    query: options.query ?? '',
    searching: false,
    statusFilter: options.statusFilter ?? null,
    liveOnly: options.liveOnly ?? false,
    history: [],
    historyIndex: -1,
  };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'move':
      return selectIndex(state, state.selected + action.delta, action.visibleRows, action.total);

    case 'select':
      return selectIndex(state, action.index, action.visibleRows, action.total);

    case 'scrollDetail':
      return { ...state, detailOffset: clamp(state.detailOffset + action.delta, 0, action.max) };

    case 'focus':
      return { ...state, focus: action.focus };

    case 'overlay':
      return { ...state, overlay: action.overlay };

    case 'startSearch':
      return { ...state, searching: true, focus: 'list' };

    case 'setQuery':
      // Changing the query invalidates the selection, so reset to the top.
      return { ...state, query: action.query, selected: 0, listOffset: 0, detailOffset: 0 };

    case 'endSearch':
      // Committing keeps the filter; abandoning drops it entirely.
      return action.commit
        ? { ...state, searching: false }
        : { ...state, searching: false, query: '', selected: 0, listOffset: 0, detailOffset: 0 };

    case 'cycleStatus': {
      const order: Array<Status | null> = [null, ...STATUS_ORDER];
      const next = order[(order.indexOf(state.statusFilter) + 1) % order.length] ?? null;
      return { ...state, statusFilter: next, selected: 0, listOffset: 0, detailOffset: 0 };
    }

    case 'toggleLive':
      return { ...state, liveOnly: !state.liveOnly, selected: 0, listOffset: 0, detailOffset: 0 };

    case 'pushHistory': {
      // A new jump truncates anything ahead, like a browser's forward stack.
      if (state.history[state.historyIndex] === action.id) return state;
      const history = [...state.history.slice(0, state.historyIndex + 1), action.id];
      return { ...state, history, historyIndex: history.length - 1 };
    }

    case 'historyStep': {
      if (state.history.length === 0) return state;
      return {
        ...state,
        historyIndex: clamp(state.historyIndex + action.delta, 0, state.history.length - 1),
      };
    }

    default:
      return state;
  }
}

function selectIndex(state: State, index: number, visibleRows: number, total: number): State {
  if (total === 0) return state;
  const selected = clamp(index, 0, total - 1);
  return {
    ...state,
    selected,
    listOffset: scrollTo(selected, state.listOffset, visibleRows),
    // A different record means the previous scroll position is meaningless.
    detailOffset: 0,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Keep the selected row inside the visible window. */
export function scrollTo(selected: number, offset: number, visibleRows: number): number {
  if (visibleRows <= 0) return 0;
  if (selected < offset) return selected;
  if (selected >= offset + visibleRows) return selected - visibleRows + 1;
  return offset;
}

/** The id the history cursor currently points at, if any. */
export function currentHistoryId(state: State): string | undefined {
  return state.history[state.historyIndex];
}
