/**
 * The page's client behaviour, inlined as a string.
 *
 * Deliberately dependency-free and small: build the register, filter it, and
 * swap the reading pane on a hash change. Records live in a `<template>` so a
 * hundred-record corpus does not put a hundred articles in the DOM at once.
 */
export const SCRIPT = String.raw`
(function () {
  var model = window.__ADR;
  var app = document.getElementById('app');
  var registerEl = document.getElementById('register');
  var readerInner = document.getElementById('reader-inner');
  var searchEl = document.getElementById('q');
  var filtersEl = document.getElementById('filters');
  var sortsEl = document.getElementById('sorts');
  var template = document.getElementById('tpl-records');

  var overviewHtml = readerInner.innerHTML;
  var bySlug = {};
  for (var i = 0; i < model.records.length; i++) bySlug[model.records[i].slug] = model.records[i];

  var state = { query: '', filter: 'all', sort: readSort(), slug: null, visible: [] };

  // Remembered for the tab, so changing sort then opening a record and coming
  // back does not silently reset it. Storage can be unavailable in a sandboxed
  // frame, so every access is guarded.
  function readSort() {
    try {
      var saved = window.sessionStorage.getItem('adr-lens:sort');
      if (saved && model.orders[saved]) return saved;
    } catch (e) {}
    return 'newest';
  }

  function writeSort(value) {
    try { window.sessionStorage.setItem('adr-lens:sort', value); } catch (e) {}
  }

  /* ------------------------------------------------------------- filtering */

  function matches(record) {
    if (state.filter === 'current' && record.replaced) return false;
    if (state.filter.indexOf('status:') === 0) {
      if (record.status !== state.filter.slice(7)) return false;
    }
    if (!state.query) return true;

    // Every term must appear somewhere: narrowing a long list is the point.
    var terms = state.query.split(/\s+/);
    for (var i = 0; i < terms.length; i++) {
      if (terms[i] && record.haystack.indexOf(terms[i]) === -1) return false;
    }
    return true;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* -------------------------------------------------------------- register */

  function renderRegister() {
    var order = model.orders[state.sort] || model.orders.newest;
    state.visible = [];
    for (var oi = 0; oi < order.length; oi++) {
      var rec = model.records[order[oi]];
      if (matches(rec)) state.visible.push(rec);
    }

    if (state.visible.length === 0) {
      registerEl.innerHTML =
        '<p class="empty">Nothing matches. <button class="chip" type="button" data-clear>Clear filters</button></p>';
      return;
    }

    var showGroups = model.groups.length > 1 && state.sort === 'number';
    var html = [];
    var lastGroup = null;

    for (var i = 0; i < state.visible.length; i++) {
      var record = state.visible[i];

      if (showGroups && record.group !== lastGroup) {
        lastGroup = record.group;
        var count = 0;
        for (var j = 0; j < state.visible.length; j++) {
          if (state.visible[j].group === record.group) count++;
        }
        html.push(
          '<div class="group-label"><span>' +
            escapeHtml(record.group) +
            '</span><span>' + count + '</span></div>'
        );
      }

      var foot = ['<span class="d">' + escapeHtml(record.dateLabel) + '</span>'];
      if (record.citedBy > 0) foot.push('<span>' + record.citedBy + ' refs</span>');
      foot.push('<span>' + record.minutes + ' min</span>');

      html.push(
        '<button class="entry' + (record.replaced ? ' is-superseded' : '') +
          '" type="button" role="listitem" data-goto="' + record.slug + '"' +
          (record.slug === state.slug ? ' aria-current="true"' : '') + '>' +
          '<span class="num">' + escapeHtml(record.numberLabel) + '</span>' +
          '<span class="title"><span class="dot ' + record.status + '"></span>' +
          '<span class="label">' + escapeHtml(record.title) + '</span></span>' +
          (record.gistText ? '<span class="gist">' + escapeHtml(record.gistText) + '</span>' : '') +
          '<span class="foot">' + foot.join('') + '</span>' +
        '</button>'
      );
    }

    registerEl.innerHTML = html.join('');
  }

  /* ---------------------------------------------------------------- routing */

  function show(slug) {
    state.slug = slug || null;

    if (!slug || !bySlug[slug]) {
      readerInner.innerHTML = overviewHtml;
      readerInner.parentElement.classList.add('overview');
      app.setAttribute('data-view', 'register');
      document.title = model.scope + ' · decisions';
    } else {
      var source = template.content.querySelector('[data-slug="' + cssEscape(slug) + '"]');
      readerInner.innerHTML = source ? source.outerHTML : '';
      readerInner.parentElement.classList.remove('overview');
      app.setAttribute('data-view', 'record');
      document.title = 'ADR ' + bySlug[slug].numberLabel + ' · ' + bySlug[slug].title;
    }

    // Highlight the open record without rebuilding every row.
    var current = registerEl.querySelector('[aria-current="true"]');
    if (current) current.removeAttribute('aria-current');
    if (slug) {
      var next = registerEl.querySelector('[data-goto="' + cssEscape(slug) + '"]');
      if (next) {
        next.setAttribute('aria-current', 'true');
        scrollIntoViewIfNeeded(next);
      }
    }

    readerInner.parentElement.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function scrollIntoViewIfNeeded(el) {
    var box = el.getBoundingClientRect();
    var frame = registerEl.getBoundingClientRect();
    if (box.top < frame.top || box.bottom > frame.bottom) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  function go(slug) {
    var target = slug ? '#/' + slug : '#/';
    if (window.location.hash === target) show(slug);
    else window.location.hash = target;
  }

  function fromHash() {
    var hash = window.location.hash || '';
    // An in-record anchor (#/slug#section) keeps the record and jumps to the heading.
    var match = /^#\/([^#]*)/.exec(hash);
    return match ? decodeURIComponent(match[1]) : '';
  }

  window.addEventListener('hashchange', function () {
    show(fromHash());
  });

  /* ----------------------------------------------------------------- events */

  document.addEventListener('click', function (event) {
    // A heading anchor inside the open record: scroll to it, but leave the hash
    // alone, since the hash is the route.
    var anchor = event.target.closest('a[href^="#"]');
    if (anchor && anchor.getAttribute('href').indexOf('#/') !== 0) {
      var id = anchor.getAttribute('href').slice(1);
      var heading = readerInner.querySelector('[id="' + cssEscape(id) + '"]');
      if (heading) {
        event.preventDefault();
        heading.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
    }

    var goto = event.target.closest('[data-goto]');
    if (goto) {
      event.preventDefault();
      go(goto.getAttribute('data-goto'));
      return;
    }

    if (event.target.closest('[data-back]')) {
      event.preventDefault();
      app.setAttribute('data-view', 'register');
      return;
    }

    if (event.target.closest('[data-clear]')) {
      event.preventDefault();
      state.query = '';
      state.filter = 'all';
      searchEl.value = '';
      syncChips();
      renderRegister();
      restoreCurrent();
      return;
    }

    var sortBtn = event.target.closest('[data-sort]');
    if (sortBtn) {
      state.sort = sortBtn.getAttribute('data-sort');
      writeSort(state.sort);
      syncSorts();
      renderRegister();
      restoreCurrent();
      return;
    }

    var chip = event.target.closest('[data-filter]');
    if (chip) {
      var value = chip.getAttribute('data-filter');
      state.filter = state.filter === value ? 'all' : value;
      syncChips();
      renderRegister();
      restoreCurrent();
    }
  });

  function syncSorts() {
    var buttons = sortsEl.querySelectorAll('[data-sort]');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-sort') === state.sort;
      buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /** Re-mark the open record after the list is rebuilt underneath it. */
  function restoreCurrent() {
    if (!state.slug) return;
    var el = registerEl.querySelector('[data-goto="' + cssEscape(state.slug) + '"]');
    if (el) {
      el.setAttribute('aria-current', 'true');
      scrollIntoViewIfNeeded(el);
    }
  }

  function syncChips() {
    var chips = filtersEl.querySelectorAll('[data-filter]');
    for (var i = 0; i < chips.length; i++) {
      var value = chips[i].getAttribute('data-filter');
      var on = value === state.filter || (state.filter === 'all' && value === 'all');
      chips[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  searchEl.addEventListener('input', function () {
    state.query = searchEl.value.trim().toLowerCase();
    renderRegister();
    restoreCurrent();
  });

  document.addEventListener('keydown', function (event) {
    var typing =
      event.target === searchEl ||
      event.target.tagName === 'INPUT' ||
      event.target.tagName === 'TEXTAREA';

    if (event.key === '/' && !typing) {
      event.preventDefault();
      searchEl.focus();
      searchEl.select();
      return;
    }

    if (event.key === 'Escape') {
      if (typing) {
        searchEl.value = '';
        state.query = '';
        renderRegister();
        searchEl.blur();
      } else {
        go('');
      }
      return;
    }

    if (typing) return;

    // j/k step through the filtered list, so browsing follows the search.
    if (event.key === 'j' || event.key === 'k') {
      if (state.visible.length === 0) return;
      event.preventDefault();
      var index = -1;
      for (var i = 0; i < state.visible.length; i++) {
        if (state.visible[i].slug === state.slug) index = i;
      }
      var next = event.key === 'j' ? index + 1 : index - 1;
      if (next < 0) next = 0;
      if (next > state.visible.length - 1) next = state.visible.length - 1;
      go(state.visible[next].slug);
    }
  });

  /* -------------------------------------------------------------------- init */

  syncChips();
  syncSorts();
  renderRegister();
  show(fromHash());
})();
`.trim();
