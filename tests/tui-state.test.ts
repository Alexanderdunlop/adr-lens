import { describe, expect, it } from 'vitest';
import {
  type Action,
  currentHistoryId,
  initialState,
  reducer,
  type State,
  scrollTo,
} from '../src/tui/state.ts';

const ROWS = 10;

function apply(state: State, ...actions: Action[]): State {
  return actions.reduce(reducer, state);
}

const move = (delta: number, total = 50): Action => ({
  type: 'move',
  delta,
  visibleRows: ROWS,
  total,
});

describe('scrollTo', () => {
  it('leaves the window alone when the selection is inside it', () => {
    expect(scrollTo(5, 0, ROWS)).toBe(0);
  });

  it('scrolls up to reveal a selection above the window', () => {
    expect(scrollTo(3, 8, ROWS)).toBe(3);
  });

  it('scrolls down just enough to reveal a selection below the window', () => {
    expect(scrollTo(12, 0, ROWS)).toBe(3);
  });

  it('degrades safely when there is no room', () => {
    expect(scrollTo(4, 2, 0)).toBe(0);
  });
});

describe('selection', () => {
  it('clamps at both ends rather than wrapping', () => {
    expect(apply(initialState(), move(-5)).selected).toBe(0);
    expect(apply(initialState(), move(999)).selected).toBe(49);
  });

  it('keeps the selection visible while paging', () => {
    const state = apply(initialState(), move(8), move(8), move(8));
    expect(state.selected).toBe(24);
    expect(state.selected).toBeGreaterThanOrEqual(state.listOffset);
    expect(state.selected).toBeLessThan(state.listOffset + ROWS);
  });

  it('is a no-op when nothing is visible', () => {
    const empty = apply(initialState(), move(1, 0));
    expect(empty.selected).toBe(0);
  });

  it('resets the detail scroll when the record changes', () => {
    const scrolled = apply(initialState(), { type: 'scrollDetail', delta: 20, max: 40 });
    expect(scrolled.detailOffset).toBe(20);
    expect(apply(scrolled, move(1)).detailOffset).toBe(0);
  });
});

describe('detail scrolling', () => {
  it('clamps to the available range', () => {
    const state = apply(initialState(), { type: 'scrollDetail', delta: 500, max: 40 });
    expect(state.detailOffset).toBe(40);
    expect(apply(state, { type: 'scrollDetail', delta: -500, max: 40 }).detailOffset).toBe(0);
  });
});

describe('filtering', () => {
  it('keeps the query when the search is committed', () => {
    const state = apply(
      initialState(),
      { type: 'startSearch' },
      { type: 'setQuery', query: 'retry' },
      { type: 'endSearch', commit: true },
    );
    expect(state.query).toBe('retry');
    expect(state.searching).toBe(false);
  });

  it('drops the query when the search is abandoned', () => {
    const state = apply(
      initialState(),
      { type: 'startSearch' },
      { type: 'setQuery', query: 'retry' },
      { type: 'endSearch', commit: false },
    );
    expect(state.query).toBe('');
  });

  it('returns to the top when the query changes', () => {
    const state = apply(initialState(), move(20), { type: 'setQuery', query: 'dlq' });
    expect(state.selected).toBe(0);
    expect(state.listOffset).toBe(0);
  });

  it('cycles the status filter back round to unfiltered', () => {
    let state = initialState();
    const seen: Array<string | null> = [];
    for (let i = 0; i < 7; i++) {
      state = reducer(state, { type: 'cycleStatus' });
      seen.push(state.statusFilter);
    }
    expect(seen[0]).toBe('accepted');
    expect(seen[6]).toBeNull(); // six statuses then back to no filter
  });

  it('toggles current-only', () => {
    const on = reducer(initialState(), { type: 'toggleLive' });
    expect(on.liveOnly).toBe(true);
    expect(reducer(on, { type: 'toggleLive' }).liveOnly).toBe(false);
  });
});

describe('history', () => {
  it('walks back and forward through visited records', () => {
    const state = apply(
      initialState(),
      { type: 'pushHistory', id: 'a' },
      { type: 'pushHistory', id: 'b' },
      { type: 'pushHistory', id: 'c' },
    );
    expect(currentHistoryId(state)).toBe('c');

    const back = apply(state, { type: 'historyStep', delta: -1 });
    expect(currentHistoryId(back)).toBe('b');
    expect(currentHistoryId(apply(back, { type: 'historyStep', delta: 1 }))).toBe('c');
  });

  it('truncates the forward stack on a new jump', () => {
    const state = apply(
      initialState(),
      { type: 'pushHistory', id: 'a' },
      { type: 'pushHistory', id: 'b' },
      { type: 'historyStep', delta: -1 },
      { type: 'pushHistory', id: 'c' },
    );
    expect(state.history).toEqual(['a', 'c']);
    expect(currentHistoryId(state)).toBe('c');
  });

  it('does not stack a repeat of the current record', () => {
    const state = apply(
      initialState(),
      { type: 'pushHistory', id: 'a' },
      { type: 'pushHistory', id: 'a' },
    );
    expect(state.history).toEqual(['a']);
  });

  it('clamps at both ends of an empty or exhausted history', () => {
    expect(
      currentHistoryId(apply(initialState(), { type: 'historyStep', delta: -1 })),
    ).toBeUndefined();
    const one = apply(initialState(), { type: 'pushHistory', id: 'a' });
    expect(currentHistoryId(apply(one, { type: 'historyStep', delta: -5 }))).toBe('a');
    expect(currentHistoryId(apply(one, { type: 'historyStep', delta: 5 }))).toBe('a');
  });
});

describe('initial state', () => {
  it('carries the options through', () => {
    const state = initialState({ query: 'dlq', statusFilter: 'accepted', liveOnly: true });
    expect(state.query).toBe('dlq');
    expect(state.statusFilter).toBe('accepted');
    expect(state.liveOnly).toBe(true);
    expect(state.focus).toBe('list');
    expect(state.overlay).toBe('none');
  });
});
