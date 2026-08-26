import { spawn } from 'node:child_process';
import { relative } from 'node:path';
import { Box, render, Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { CommandContext } from '../commands/context.ts';
import { renderShow } from '../commands/show.ts';
import { ageInDays, formatAge } from '../core/digest.ts';
import { search } from '../core/search.ts';
import type { AdrNode, Status } from '../core/types.ts';
import { truncateToWidth, visibleWidth } from '../render/inline.ts';
import { STATUS_STYLE, statusGlyph } from '../render/theme.ts';
import { currentHistoryId, type Focus, initialState, reducer } from './state.ts';
import { useTerminalSize } from './useTerminalSize.ts';

export interface BrowserOptions {
  context: CommandContext;
  initialQuery?: string;
  status?: Status[];
  liveOnly?: boolean;
}

export async function startBrowser(options: BrowserOptions): Promise<void> {
  const instance = render(<Browser {...options} />, { exitOnCtrlC: true });
  await instance.waitUntilExit();
}

/* ------------------------------------------------------------------ component */

function Browser({ context, initialQuery, status, liveOnly }: BrowserOptions): React.ReactElement {
  const { exit } = useApp();
  const size = useTerminalSize();

  const [state, dispatch] = useReducer(
    reducer,
    initialState({
      query: initialQuery ?? '',
      statusFilter: status?.[0] ?? null,
      liveOnly: liveOnly ?? false,
    }),
  );

  const [message, setMessage] = useState<string | null>(null);

  // Layout: 2 rows of header, 1 of footer, 1 of borders top and bottom.
  const bodyHeight = Math.max(6, size.rows - 5);
  const listWidth = Math.max(28, Math.min(48, Math.floor(size.columns * 0.36)));
  const detailWidth = Math.max(30, size.columns - listWidth - 3);

  const visible = useMemo(() => {
    const results = search(context.corpus.adrs, {
      query: state.query,
      ...(state.statusFilter ? { status: [state.statusFilter] } : {}),
      liveOnly: state.liveOnly,
    });
    return results.map((r) => r.adr);
  }, [context.corpus.adrs, state.query, state.statusFilter, state.liveOnly]);

  const selected = visible[Math.min(state.selected, Math.max(0, visible.length - 1))];

  const detailLines = useMemo(() => {
    if (!selected) return [];
    return renderShow({ ...context, width: detailWidth }, selected, { urls: false });
  }, [context, selected, detailWidth]);

  const maxDetailOffset = Math.max(0, detailLines.length - bodyHeight);

  // Records reachable from the selected one, offered by the jump overlay.
  const jumpTargets = useMemo(() => {
    if (!selected) return [];
    const ids = [...selected.outbound, ...selected.inbound];
    const seen = new Set<string>();
    const targets: AdrNode[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const node = context.corpus.byId.get(id);
      if (node) targets.push(node);
    }
    return targets;
  }, [selected, context.corpus.byId]);

  const goTo = useCallback(
    (id: string) => {
      const index = visible.findIndex((a) => a.id === id);
      if (index >= 0) {
        dispatch({ type: 'select', index, visibleRows: bodyHeight, total: visible.length });
        dispatch({ type: 'pushHistory', id });
        return true;
      }
      // The target exists but the active filter hides it — say so rather than
      // silently doing nothing, which reads as a broken keybinding.
      setMessage('Target is hidden by the current filter — press c to clear');
      return false;
    },
    [visible, bodyHeight],
  );

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 2600);
    return () => clearTimeout(timer);
  }, [message]);

  useInput((input, key) => {
    // Typing a query swallows almost every key, so it is handled first.
    if (state.searching) {
      if (key.escape) return dispatch({ type: 'endSearch', commit: false });
      if (key.return) return dispatch({ type: 'endSearch', commit: true });
      if (key.backspace || key.delete) {
        return dispatch({ type: 'setQuery', query: state.query.slice(0, -1) });
      }
      if (key.ctrl && input === 'u') return dispatch({ type: 'setQuery', query: '' });
      if (input && !key.ctrl && !key.meta) {
        return dispatch({ type: 'setQuery', query: state.query + input });
      }
      return;
    }

    if (state.overlay !== 'none') {
      if (state.overlay === 'jump') {
        const digit = Number.parseInt(input, 10);
        if (!Number.isNaN(digit) && digit >= 1 && digit <= jumpTargets.length) {
          const target = jumpTargets[digit - 1]!;
          dispatch({ type: 'overlay', overlay: 'none' });
          goTo(target.id);
          return;
        }
      }
      if (key.escape || input === 'q' || input === '?' || input === 'x') {
        return dispatch({ type: 'overlay', overlay: 'none' });
      }
      return;
    }

    if (input === 'q' || (key.ctrl && input === 'c')) return exit();
    if (input === '?') return dispatch({ type: 'overlay', overlay: 'help' });
    if (input === '/') return dispatch({ type: 'startSearch' });
    if (input === 'x' && jumpTargets.length > 0) {
      return dispatch({ type: 'overlay', overlay: 'jump' });
    }
    if (input === 'c') {
      dispatch({ type: 'setQuery', query: '' });
      return setMessage('Filters cleared');
    }
    if (input === 's') return dispatch({ type: 'cycleStatus' });
    if (input === 'L') return dispatch({ type: 'toggleLive' });
    if (input === 'e' && selected) return openInEditor(selected, setMessage);
    if (key.tab) {
      return dispatch({ type: 'focus', focus: state.focus === 'list' ? 'detail' : 'list' });
    }

    if (input === '[' || input === ']') {
      const delta = input === '[' ? -1 : 1;
      const stepped = reducer(state, { type: 'historyStep', delta });
      const id = currentHistoryId(stepped);
      if (id && id !== currentHistoryId(state)) {
        dispatch({ type: 'historyStep', delta });
        goTo(id);
      }
      return;
    }

    const detailFocused = state.focus === 'detail';
    const page = Math.max(1, bodyHeight - 2);

    if (key.escape) return dispatch({ type: 'focus', focus: 'list' });
    if (key.return) return dispatch({ type: 'focus', focus: 'detail' });

    if (input === 'g') {
      return detailFocused
        ? dispatch({ type: 'scrollDetail', delta: -detailLines.length, max: maxDetailOffset })
        : dispatch({ type: 'select', index: 0, visibleRows: bodyHeight, total: visible.length });
    }
    if (input === 'G') {
      return detailFocused
        ? dispatch({ type: 'scrollDetail', delta: detailLines.length, max: maxDetailOffset })
        : dispatch({
            type: 'select',
            index: visible.length - 1,
            visibleRows: bodyHeight,
            total: visible.length,
          });
    }

    const down = key.downArrow || input === 'j';
    const up = key.upArrow || input === 'k';
    const pageDown = key.pageDown || input === ' ' || (key.ctrl && input === 'd');
    const pageUp = key.pageUp || input === 'b' || (key.ctrl && input === 'u');

    if (detailFocused) {
      if (down) return dispatch({ type: 'scrollDetail', delta: 1, max: maxDetailOffset });
      if (up) return dispatch({ type: 'scrollDetail', delta: -1, max: maxDetailOffset });
      if (pageDown) return dispatch({ type: 'scrollDetail', delta: page, max: maxDetailOffset });
      if (pageUp) return dispatch({ type: 'scrollDetail', delta: -page, max: maxDetailOffset });
      // Moving between records from the detail pane is convenient enough to keep.
      if (key.rightArrow) {
        return dispatch({ type: 'move', delta: 1, visibleRows: bodyHeight, total: visible.length });
      }
      if (key.leftArrow) {
        return dispatch({
          type: 'move',
          delta: -1,
          visibleRows: bodyHeight,
          total: visible.length,
        });
      }
      return;
    }

    if (down)
      return dispatch({ type: 'move', delta: 1, visibleRows: bodyHeight, total: visible.length });
    if (up)
      return dispatch({ type: 'move', delta: -1, visibleRows: bodyHeight, total: visible.length });
    if (pageDown)
      return dispatch({
        type: 'move',
        delta: page,
        visibleRows: bodyHeight,
        total: visible.length,
      });
    if (pageUp)
      return dispatch({
        type: 'move',
        delta: -page,
        visibleRows: bodyHeight,
        total: visible.length,
      });
  });

  const rows = visible.slice(state.listOffset, state.listOffset + bodyHeight);

  return (
    <Box flexDirection="column" width={size.columns}>
      <Header
        context={context}
        total={context.corpus.adrs.length}
        shown={visible.length}
        query={state.query}
        searching={state.searching}
        statusFilter={state.statusFilter}
        liveOnly={state.liveOnly}
        width={size.columns}
      />

      <Box>
        <Box
          flexDirection="column"
          width={listWidth}
          height={bodyHeight}
          borderStyle="round"
          borderColor={state.focus === 'list' ? 'cyan' : 'gray'}
          borderTop={false}
          borderBottom={false}
          borderLeft={false}
          paddingRight={1}
        >
          {rows.length === 0 ? (
            <Text dimColor>No matches</Text>
          ) : (
            rows.map((adr, i) => (
              <ListRow
                key={adr.id}
                adr={adr}
                width={listWidth - 2}
                selected={state.listOffset + i === state.selected}
                focused={state.focus === 'list'}
                now={context.now}
              />
            ))
          )}
        </Box>

        <Box flexDirection="column" width={detailWidth} height={bodyHeight} paddingLeft={1}>
          {state.overlay === 'help' ? (
            <HelpOverlay />
          ) : state.overlay === 'jump' ? (
            <JumpOverlay targets={jumpTargets} width={detailWidth - 2} />
          ) : (
            detailLines
              .slice(state.detailOffset, state.detailOffset + bodyHeight)
              .map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
                <Text key={i} wrap="truncate">
                  {line || ' '}
                </Text>
              ))
          )}
        </Box>
      </Box>

      <Footer
        message={message}
        focus={state.focus}
        detailOffset={state.detailOffset}
        maxDetailOffset={maxDetailOffset}
        jumpCount={jumpTargets.length}
        position={visible.length === 0 ? '0/0' : `${state.selected + 1}/${visible.length}`}
      />
    </Box>
  );
}

/* ----------------------------------------------------------------- subviews */

function Header(props: {
  context: CommandContext;
  total: number;
  shown: number;
  query: string;
  searching: boolean;
  statusFilter: Status | null;
  liveOnly: boolean;
  width: number;
}): React.ReactElement {
  const source =
    props.context.corpus.dirs.length === 1
      ? relative(process.cwd(), props.context.corpus.dirs[0]!.path) || '.'
      : `${props.context.corpus.dirs.length} directories`;

  const chips: string[] = [];
  if (props.statusFilter) chips.push(STATUS_STYLE[props.statusFilter].label);
  if (props.liveOnly) chips.push('current only');

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan">
          adr-lens
        </Text>
        <Text dimColor> {source}</Text>
        <Text dimColor>
          {'  '}
          {props.shown === props.total ? `${props.total}` : `${props.shown}/${props.total}`} records
        </Text>
        {chips.length > 0 && <Text color="yellow">{`  [${chips.join(', ')}]`}</Text>}
      </Box>
      <Box>
        {props.searching ? (
          <Text>
            <Text color="cyan">/</Text>
            {props.query}
            <Text inverse> </Text>
          </Text>
        ) : props.query ? (
          <Text dimColor>
            filter: {props.query} <Text dimColor>(c to clear)</Text>
          </Text>
        ) : (
          <Text dimColor>press / to filter · ? for keys</Text>
        )}
      </Box>
    </Box>
  );
}

function ListRow(props: {
  adr: AdrNode;
  width: number;
  selected: boolean;
  focused: boolean;
  now: Date;
}): React.ReactElement {
  const { adr, width, selected } = props;
  const number = (adr.numberLabel ?? '—').padStart(4);
  const age = formatAge(ageInDays(adr, props.now));
  const refs = adr.inbound.length > 0 ? `←${adr.inbound.length}` : '';

  const meta = `${refs.padStart(3)} ${age.padStart(4)}`;
  const titleWidth = Math.max(8, width - number.length - visibleWidth(meta) - 4);
  const title = truncateToWidth(adr.title, titleWidth);

  return (
    <Box>
      <Text inverse={selected} wrap="truncate">
        <Text dimColor={!selected}>{number}</Text>{' '}
        <Text color={selected ? undefined : STATUS_COLORS[adr.status]}>
          {STATUS_STYLE[adr.status].glyph}
        </Text>{' '}
        <Text strikethrough={Boolean(adr.supersededBy)}>{title}</Text>
        {' '.repeat(Math.max(1, titleWidth - visibleWidth(title) + 1))}
        <Text dimColor={!selected}>{meta}</Text>
      </Text>
    </Box>
  );
}

const STATUS_COLORS: Record<Status, string> = {
  accepted: 'green',
  proposed: 'yellow',
  rejected: 'red',
  deprecated: 'magenta',
  superseded: 'gray',
  unknown: 'gray',
};

function JumpOverlay(props: { targets: AdrNode[]; width: number }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Jump to a related record
      </Text>
      <Text dimColor>Press a number, or esc to cancel.</Text>
      <Text> </Text>
      {props.targets.slice(0, 9).map((adr, i) => (
        <Text key={adr.id} wrap="truncate">
          <Text color="cyan">{i + 1}</Text>{' '}
          <Text dimColor>{(adr.numberLabel ?? '—').padStart(4)}</Text> {statusGlyph(adr.status)}{' '}
          {truncateToWidth(adr.title, props.width - 12)}
        </Text>
      ))}
      {props.targets.length > 9 && (
        <Text dimColor>… {props.targets.length - 9} more (use / to filter instead)</Text>
      )}
    </Box>
  );
}

const KEYS: ReadonlyArray<[string, string]> = [
  ['↑ ↓ / j k', 'move between records'],
  ['space / b', 'page down / up'],
  ['g / G', 'first / last'],
  ['enter', 'focus the record pane'],
  ['tab', 'switch pane'],
  ['esc', 'back to the list'],
  ['/', 'filter — type, enter to keep, esc to drop'],
  ['c', 'clear the filter'],
  ['s', 'cycle status filter'],
  ['L', 'toggle current-only'],
  ['x', 'jump to a related record'],
  ['[ / ]', 'back / forward through jumps'],
  ['e', 'open in $EDITOR'],
  ['?', 'this help'],
  ['q', 'quit'],
];

function HelpOverlay(): React.ReactElement {
  const width = Math.max(...KEYS.map(([key]) => key.length));
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Keys
      </Text>
      <Text> </Text>
      {KEYS.map(([key, description]) => (
        <Text key={key}>
          <Text color="cyan">{key.padEnd(width)}</Text> <Text dimColor>{description}</Text>
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>Press esc or ? to close.</Text>
    </Box>
  );
}

function Footer(props: {
  message: string | null;
  focus: Focus;
  detailOffset: number;
  maxDetailOffset: number;
  jumpCount: number;
  position: string;
}): React.ReactElement {
  if (props.message) {
    return (
      <Box>
        <Text color="yellow">{props.message}</Text>
      </Box>
    );
  }

  const scroll =
    props.maxDetailOffset === 0
      ? 'all'
      : `${Math.round((props.detailOffset / props.maxDetailOffset) * 100)}%`;

  return (
    <Box>
      <Text dimColor>{props.position}</Text>
      <Text dimColor>{'  ·  '}</Text>
      <Text dimColor>{props.focus === 'list' ? 'list' : `record ${scroll}`}</Text>
      {props.jumpCount > 0 && <Text dimColor>{`  ·  x: ${props.jumpCount} related`}</Text>}
      <Text dimColor>{'  ·  '}</Text>
      <Text dimColor>? keys · q quit</Text>
    </Box>
  );
}

/* -------------------------------------------------------------------- editor */

function openInEditor(adr: AdrNode, notify: (message: string) => void): void {
  const editor = process.env.VISUAL ?? process.env.EDITOR;
  if (!editor) {
    notify('Set $EDITOR to open records in your editor');
    return;
  }

  // Detached so quitting the editor does not take the browser with it, and
  // stdio inherited so terminal editors actually work.
  const child = spawn(editor, [adr.path], { stdio: 'inherit', detached: false });
  child.on('error', () => notify(`Could not run ${editor}`));
}
