import { afterEach, describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli/args.ts';
import { DEFAULT_PORT, type ServeHandle, startServer } from '../src/commands/serve.ts';
import { injectReload, RELOAD_PATH, RELOAD_SCRIPT } from '../src/web/reload.ts';

const PAGE = '<!doctype html>\n<html><body>\n<div id="app"></div>\n</body>\n</html>\n';

const open: ServeHandle[] = [];

/**
 * Port 0 by default: every test gets its own port, so a keep-alive socket
 * cached by one test's fetch cannot be handed to the next test's server.
 */
async function serve(page: () => string = () => PAGE, port = 0): Promise<ServeHandle> {
  const handle = await startServer(page, { port });
  open.push(handle);
  return handle;
}

/** The real flag path: no port asked for, so the default is tried first. */
async function serveDefault(): Promise<ServeHandle> {
  const handle = await startServer(() => PAGE);
  open.push(handle);
  return handle;
}

function at(handle: ServeHandle, path: string): string {
  return `http://127.0.0.1:${handle.port}${path}`;
}

async function waitFor(condition: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((handle) => handle.close()));
});

describe('injectReload', () => {
  it('puts the client inside the document, before the body closes', () => {
    const html = injectReload(PAGE);

    expect(html).toContain('<div id="app"></div>');
    expect(html.indexOf(RELOAD_SCRIPT)).toBeLessThan(html.indexOf('</body>'));
    expect(html.indexOf(RELOAD_SCRIPT)).toBeGreaterThan(html.indexOf('<div id="app">'));
  });

  it('appends to a fragment that has no body tag', () => {
    const html = injectReload('<div id="app"></div>\n');
    expect(html.startsWith('<div id="app"></div>')).toBe(true);
    expect(html).toContain(RELOAD_SCRIPT);
  });

  it('leaves the page it was given alone', () => {
    injectReload(PAGE);
    expect(PAGE).not.toContain('EventSource');
  });
});

describe('reload client', () => {
  /**
   * Run the injected script against a stub browser. `EventSource` and `window`
   * are free identifiers in it, so they can simply be passed in — enough to
   * drive the thing without a DOM, and better than asserting it parses.
   */
  function run(support = true) {
    let reloads = 0;
    const source = { url: '', closed: false, handlers: {} as Record<string, () => void> };

    class FakeSource {
      constructor(url: string) {
        source.url = url;
      }
      addEventListener(type: string, fn: () => void): void {
        source.handlers[type] = fn;
      }
      close(): void {
        source.closed = true;
      }
    }

    const window = {
      EventSource: support ? FakeSource : undefined,
      location: {
        reload: (): void => {
          reloads++;
        },
      },
    };

    new Function('window', 'EventSource', RELOAD_SCRIPT)(window, FakeSource);

    return { source, reloads: () => reloads };
  }

  it('parses as JavaScript', () => {
    // Same trap as the main page script: a syntax error here produces a page
    // that loads fine and then never reloads, which is invisible.
    expect(() => new Function(RELOAD_SCRIPT)).not.toThrow();
  });

  it('contains no backtick, which would close its own template', () => {
    expect(RELOAD_SCRIPT.includes(String.fromCharCode(96))).toBe(false);
  });

  it('listens where the server streams', () => {
    expect(run().source.url).toBe(RELOAD_PATH);
  });

  it('reloads the page when the server says so', () => {
    const client = run();
    client.source.handlers.reload!();
    expect(client.reloads()).toBe(1);
  });

  it('stops listening when the server says goodbye', () => {
    // Otherwise ctrl-c leaves the tab retrying a socket that is never coming back.
    const client = run();
    client.source.handlers.bye!();
    expect(client.source.closed).toBe(true);
    expect(client.reloads()).toBe(0);
  });

  it('does nothing where EventSource is missing', () => {
    expect(() => run(false)).not.toThrow();
    expect(run(false).source.url).toBe('');
  });
});

describe('startServer', () => {
  it('serves the current build, with the reload client added', async () => {
    let page = PAGE;
    const handle = await serve(() => page);

    const first = await fetch(at(handle, '/'));
    expect(first.headers.get('content-type')).toBe('text/html; charset=utf-8');
    // A cached page cannot be reloaded into a new one.
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(await first.text()).toContain('<div id="app"></div>');

    // The build is read per request, so a rebuild needs no server involvement.
    page = PAGE.replace('app', 'rebuilt');
    expect(await (await fetch(at(handle, '/'))).text()).toContain('id="rebuilt"');
  });

  it('does not change the file on disk', async () => {
    // The point of --serve being additive: the artifact stays plain.
    const handle = await serve();
    await fetch(at(handle, '/'));
    expect(PAGE).not.toContain('EventSource');
  });

  it('404s anything that is not the page', async () => {
    const handle = await serve();
    expect((await fetch(at(handle, '/nope'))).status).toBe(404);
    expect((await fetch(at(handle, '/'), { method: 'POST' })).status).toBe(405);
  });

  it('pushes a reload to every listening page', async () => {
    const handle = await serve();
    const stop = new AbortController();

    const stream = await fetch(at(handle, RELOAD_PATH), { signal: stop.signal });
    expect(stream.headers.get('content-type')).toBe('text/event-stream');

    const reader = stream.body!.getReader();
    await waitFor(() => handle.clients() === 1);

    expect(handle.reload()).toBe(1);

    const decoder = new TextDecoder();
    let received = '';
    while (!received.includes('event: reload')) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
    }

    expect(received).toContain('event: reload');
    stop.abort();
    await waitFor(() => handle.clients() === 0);
  });

  it('reports nobody to push to when no page is open', async () => {
    const handle = await serve();
    expect(handle.reload()).toBe(0);
  });

  it('takes a free port when the usual one is busy', async () => {
    const first = await serveDefault();
    const second = await serveDefault();

    // A second copy of the tool must not fall over because the first is running.
    expect(second.port).not.toBe(first.port);
    expect(second.port).toBeGreaterThan(0);
    // Unless something else on this machine already had it, the first gets the
    // stable port — which is the whole reason for preferring one.
    expect(first.port === DEFAULT_PORT || second.port !== DEFAULT_PORT).toBe(true);
  });

  it('refuses to guess when an explicit port is taken', async () => {
    const taken = await serve();

    await expect(serve(() => PAGE, taken.port)).rejects.toThrow(
      new RegExp(`Port ${taken.port} is already in use`),
    );
  });

  it('stops listening on close', async () => {
    const handle = await serve();
    const url = at(handle, '/');
    await handle.close();
    open.length = 0;

    await expect(fetch(url)).rejects.toThrow();
  });
});

describe('--serve flags', () => {
  it('implies --watch, since a frozen served page is just a worse --open', () => {
    const flags = parseArgs(['web', '--serve']).flags;
    expect(flags.serve).toBe(true);
    expect(flags.watch).toBe(true);
  });

  it('--port implies --serve', () => {
    const flags = parseArgs(['web', '--port', '4000']).flags;
    expect(flags.port).toBe(4000);
    expect(flags.serve).toBe(true);
    expect(flags.watch).toBe(true);
  });

  it('--watch on its own still just writes a file', () => {
    const flags = parseArgs(['web', '--watch']).flags;
    expect(flags.watch).toBe(true);
    expect(flags.serve).toBe(false);
  });

  it('rejects a port that is not one', () => {
    expect(() => parseArgs(['web', '--port', '70000'])).toThrow(/between 1 and 65535/);
    expect(() => parseArgs(['web', '--port', 'http'])).toThrow(/expects a number/);
  });
});
