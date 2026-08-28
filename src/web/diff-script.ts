/**
 * The review page's behaviour: pick what the rail lists, pick what the reader
 * shows, keep the url honest. Dependency-free and small, like the reading page's
 * script — every pane is already in the document inside a `<template>`, so
 * navigating is moving markup, not building it.
 */
export const DIFF_SCRIPT = `
(function () {
  var model = window.__ADR_DIFF;
  if (!model) return;

  var app = document.getElementById('app');
  var registerEl = document.getElementById('register');
  var readerInner = document.getElementById('reader-inner');
  var search = document.getElementById('q');
  var overview = readerInner.innerHTML;

  var panes = {
    changes: document.getElementById('tpl-changes'),
    records: document.getElementById('tpl-records')
  };

  var state = { mode: 'changes', slug: null, query: '' };

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function cssEscape(value) {
    return String(value).replace(/["\\\\]/g, '\\\\$&');
  }

  /* ---------------------------------------------------------------- register */

  function entries() {
    var list = model[state.mode] || [];
    if (!state.query) return list;
    var needle = state.query.toLowerCase();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].haystack.indexOf(needle) !== -1) out.push(list[i]);
    }
    return out;
  }

  function renderRegister() {
    var list = entries();

    if (list.length === 0) {
      registerEl.innerHTML = '<p class="empty">Nothing matches.</p>';
      return;
    }

    var html = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var mark =
        item.kind === 'added' ? '<span class="mk">new</span> ' :
        item.kind === 'removed' ? '<span class="mk">deleted</span> ' : '';

      html.push(
        '<button class="entry ' + item.significance +
          '" type="button" role="listitem" data-goto="' + item.slug + '"' +
          (item.slug === state.slug ? ' aria-current="true"' : '') + '>' +
          '<span class="num">' + escapeHtml(item.numberLabel) + '</span>' +
          '<span class="title"><span class="dot ' + item.status + '"></span>' +
          '<span class="label">' + escapeHtml(item.title) + '</span></span>' +
          (item.summary ? '<span class="why">' + mark + escapeHtml(item.summary) + '</span>' : '') +
        '</button>'
      );
    }

    registerEl.innerHTML = html.join('');
  }

  /* ------------------------------------------------------------------ routing */

  function paneFor(mode, slug) {
    var template = panes[mode];
    if (!template) return null;
    return template.content.querySelector('[data-slug="' + cssEscape(slug) + '"]');
  }

  function go(slug, push) {
    var pane = paneFor(state.mode, slug);
    if (!pane) return showOverview(push);

    state.slug = slug;
    readerInner.innerHTML = pane.outerHTML;
    app.setAttribute('data-view', 'record');
    readerInner.scrollIntoView({ block: 'start' });
    window.scrollTo(0, 0);

    if (push !== false) location.hash = '#/' + state.mode + '/' + slug;
    highlight();
  }

  function showOverview(push) {
    state.slug = null;
    readerInner.innerHTML = overview;
    app.setAttribute('data-view', 'register');
    if (push !== false) location.hash = '#/' + state.mode;
    highlight();
  }

  function highlight() {
    var current = registerEl.querySelector('[aria-current="true"]');
    if (current) current.removeAttribute('aria-current');
    if (!state.slug) return;
    var next = registerEl.querySelector('[data-goto="' + cssEscape(state.slug) + '"]');
    if (next) {
      next.setAttribute('aria-current', 'true');
      next.scrollIntoView({ block: 'nearest' });
    }
  }

  function setMode(mode, push) {
    if (mode !== 'changes' && mode !== 'records') return;
    state.mode = mode;
    state.slug = null;
    app.setAttribute('data-mode', mode);

    var buttons = document.querySelectorAll('[data-mode]');
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      if (button.tagName !== 'BUTTON') continue;
      button.setAttribute('aria-pressed', String(button.getAttribute('data-mode') === mode));
    }

    renderRegister();
    showOverview(push);
  }

  function fromHash() {
    var parts = (location.hash || '').replace(/^#\\//, '').split('/');
    var mode = parts[0] === 'records' ? 'records' : 'changes';

    if (mode !== state.mode) {
      setMode(mode, false);
    }

    if (parts[1]) go(decodeURIComponent(parts[1]), false);
    else showOverview(false);
  }

  /* ------------------------------------------------------------------- events */

  document.addEventListener('click', function (event) {
    var mode = event.target.closest('[data-mode]');
    if (mode && mode.tagName === 'BUTTON') {
      setMode(mode.getAttribute('data-mode'), true);
      return;
    }

    var goto = event.target.closest('[data-goto]');
    if (goto) {
      event.preventDefault();
      go(goto.getAttribute('data-goto'), true);
      return;
    }

    if (event.target.closest('[data-back]')) {
      event.preventDefault();
      showOverview(true);
    }
  });

  if (search) {
    search.addEventListener('input', function () {
      state.query = search.value.trim();
      renderRegister();
      highlight();
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state.slug) {
      showOverview(true);
    }
    if (event.key === '/' && document.activeElement !== search && search) {
      event.preventDefault();
      search.focus();
    }
  });

  window.addEventListener('hashchange', fromHash);

  renderRegister();
  fromHash();
})();
`;
