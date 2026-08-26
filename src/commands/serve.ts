import { createServer, type Server, type ServerResponse } from 'node:http';
import { injectReload, RELOAD_PATH } from '../web/reload.ts';

/**
 * A local server for the generated page, so a rebuild can push a reload instead
 * of waiting for someone to hit refresh.
 *
 * It is additive: the page is still written to disk, and the copy served here is
 * that same page with a few lines of reload client added on the way out.
 */

/**
 * Tried first so the URL survives a restart and the open tab stays valid. High
 * and unremarkable, to keep out of the way of whatever else is running.
 */
export const DEFAULT_PORT = 4230;

/** Loopback only. This serves your unpublished decisions; the LAN is not invited. */
const HOST = '127.0.0.1';

export interface ServeOptions {
  /**
   * Port to bind. When set, a busy port is an error — you asked for that one.
   * When omitted, {@link DEFAULT_PORT} is tried and a free port used if it is taken.
   */
  port?: number;
  host?: string;
}

export interface ServeHandle {
  /** What to print, and what `--open` opens. */
  url: string;
  port: number;
  /** Push a reload to every connected page. Returns how many were told. */
  reload(): number;
  /** How many pages are currently listening. */
  clients(): number;
  /** Say goodbye, drop the connections, and stop listening. */
  close(): Promise<void>;
}

/** Keeps intermediaries from treating a quiet stream as a dead one. */
const HEARTBEAT_MS = 25_000;

/**
 * Start serving `page()` — called per request, so every reload gets the newest
 * build without the server having to be told what changed.
 */
export async function startServer(
  page: () => string,
  options: ServeOptions = {},
): Promise<ServeHandle> {
  const host = options.host ?? HOST;
  const listeners = new Set<ServerResponse>();

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];

    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET' }).end();
      return;
    }

    if (path === RELOAD_PATH) {
      openStream(req, res, listeners);
      return;
    }

    if (path === '/' || path === '/index.html') {
      const html = injectReload(page());
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(html),
        // A cached copy would defeat the entire point of pushing a reload.
        'cache-control': 'no-store',
      });
      res.end(html);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found\n');
  });

  const port = await bind(server, host, options.port);

  const heartbeat = setInterval(() => {
    for (const res of listeners) res.write(':\n\n');
  }, HEARTBEAT_MS);
  // The server already holds the process open; this timer should not.
  heartbeat.unref();

  return {
    url: `http://${host === HOST ? 'localhost' : host}:${port}/`,
    port,
    clients: () => listeners.size,
    reload(): number {
      let told = 0;
      for (const res of listeners) {
        res.write('event: reload\ndata: rebuilt\n\n');
        told++;
      }
      return told;
    },
    async close(): Promise<void> {
      clearInterval(heartbeat);
      for (const res of listeners) {
        res.write('event: bye\ndata: stopping\n\n');
        res.end();
      }
      listeners.clear();
      // Without this, close() waits on keep-alive sockets that will never be
      // used again, and ctrl-c appears to hang.
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

/* ------------------------------------------------------------------ streaming */

function openStream(
  req: { on(event: 'close', listener: () => void): unknown },
  res: ServerResponse,
  listeners: Set<ServerResponse>,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // Buffering a stream whose whole job is to be immediate would break it.
    'x-accel-buffering': 'no',
  });
  // Reconnect quickly: a rebuild that restarts the tool should not leave the
  // page silent for the default three seconds.
  res.write('retry: 1000\n\n');

  listeners.add(res);
  req.on('close', () => {
    listeners.delete(res);
  });
}

/* -------------------------------------------------------------------- binding */

async function bind(server: Server, host: string, port: number | undefined): Promise<number> {
  if (port !== undefined) {
    try {
      await listenOnce(server, host, port);
    } catch (error) {
      if (isAddressInUse(error)) {
        throw new Error(`Port ${port} is already in use. Pass a different --port, or drop it.`);
      }
      throw error;
    }
    return boundPort(server);
  }

  try {
    await listenOnce(server, host, DEFAULT_PORT);
  } catch (error) {
    if (!isAddressInUse(error)) throw error;
    // Somebody else — very likely another copy of this — has the usual port.
    await listenOnce(server, host, 0);
  }
  return boundPort(server);
}

function listenOnce(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function boundPort(server: Server): number {
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : 0;
}

function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
  );
}
