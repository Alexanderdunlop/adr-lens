/**
 * The live-reload client, and where it listens.
 *
 * This is injected into the *served* copy of the page and nowhere else. The file
 * on disk stays exactly what it was — one self-contained page with no sockets in
 * it — so it can still be committed, emailed, or opened from disk long after the
 * server has stopped.
 */

/** The SSE endpoint. Namespaced so it cannot collide with a record slug. */
export const RELOAD_PATH = '/__adr/live';

export const RELOAD_SCRIPT = `
(function () {
  if (!window.EventSource) return;

  var source = new EventSource('/__adr/live');

  source.addEventListener('reload', function () {
    // The hash is the route and sessionStorage holds the scroll offset, so a
    // plain reload comes back to the same record at the same place.
    window.location.reload();
  });

  // EventSource retries on its own, which is what you want when a rebuild is
  // slow. It cannot tell that apart from a server that has stopped for good, so
  // the server says goodbye on the way out and we stop listening.
  source.addEventListener('bye', function () {
    source.close();
  });
})();
`.trim();

/**
 * Put the reload client into a rendered page, just before the closing body tag
 * so it runs after the page's own script has set up its routing.
 */
export function injectReload(html: string): string {
  const tag = `<script>\n${RELOAD_SCRIPT}\n</script>\n`;
  const index = html.lastIndexOf('</body>');
  if (index === -1) return html + tag;
  return html.slice(0, index) + tag + html.slice(index);
}
