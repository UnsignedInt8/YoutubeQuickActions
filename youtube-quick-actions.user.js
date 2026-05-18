// ==UserScript==
// @name         YouTube Quick Actions
// @namespace    https://tampermonkey.net/
// @version      1.1.0
// @description  Hover a thumbnail to reveal "Add to queue" and "Not interested" buttons; reverse playlist order on playlist pages
// @match        https://www.youtube.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const RENDERERS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'yt-lockup-view-model',
  ].join(',');

  const KEYWORDS = {
    queue: ['add to queue', 'save to queue', '加入播放队列', '队列'],
    notInterested: ['not interested', 'hide', '不感兴趣', '隐藏'],
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function makeSvg(...paths) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'white');
    for (const d of paths) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  }

  const ICON_QUEUE = () => makeSvg(
    'M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3z',
    'M19 14h-2v3h-3v2h3v3h2v-3h3v-2h-3z'
  );
  const ICON_NOT_INTERESTED = () => makeSvg(
    'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
  );

  // ── Styles ─────────────────────────────────────────────────────────────────

  function injectStyles() {
    const el = document.createElement('style');
    el.textContent = `
      #yqa-portal {
        position: fixed; z-index: 2147483647;
        display: flex; gap: 4px;
        opacity: 0; pointer-events: none;
        transition: opacity 0.15s ease;
      }
      #yqa-portal.yqa-visible {
        opacity: 1; pointer-events: auto;
      }
      .yqa-btn {
        width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer;
        background: rgba(0,0,0,.6);
        backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        padding: 6px; box-sizing: border-box;
        transition: background .15s, transform .1s;
      }
      .yqa-btn:hover { background: rgba(0,0,0,.85); transform: scale(1.1); }
      .yqa-btn svg { width: 20px; height: 20px; display: block; }
      #yqa-reverse-btn svg { fill: var(--yt-spec-text-primary, white); }
    `;
    document.head.appendChild(el);
  }

  // ── Portal (single fixed overlay above everything) ─────────────────────────

  let portal = null;
  let currentThumb = null;
  let hideTimer = null;

  function createPortal() {
    const el = document.createElement('div');
    el.id = 'yqa-portal';
    el._lockedThumb = null;
    el.appendChild(createBtn(ICON_QUEUE, 'Add to queue',
      () => trigger(el._lockedThumb, KEYWORDS.queue)));
    el.appendChild(createBtn(ICON_NOT_INTERESTED, 'Not interested',
      () => trigger(el._lockedThumb, KEYWORDS.notInterested)));
    el.addEventListener('mouseenter', () => {
      el._lockedThumb = currentThumb;
      cancelHide();
    });
    el.addEventListener('mouseleave', scheduleHide);
    document.body.appendChild(el);
    return el;
  }

  function showPortal(thumb) {
    if (!portal) portal = createPortal();
    currentThumb = thumb;
    const r = thumb.getBoundingClientRect();
    portal.style.top  = (r.top  + 8) + 'px';
    portal.style.left = (r.left + 8) + 'px';
    cancelHide();
    portal.classList.add('yqa-visible');
  }

  function scheduleHide() {
    hideTimer = setTimeout(() => portal && portal.classList.remove('yqa-visible'), 250);
  }

  function cancelHide() {
    clearTimeout(hideTimer);
  }

  // Scroll invalidates the portal↔thumb binding: portal is position:fixed but
  // the thumb under it scrolls away. Hide and reset so the next hover starts clean.
  function hideOnScroll() {
    if (!portal || !portal.classList.contains('yqa-visible')) return;
    portal.classList.remove('yqa-visible');
    portal._lockedThumb = null;
    currentThumb = null;
    cancelHide();
    if (leaveWatcher) { leaveWatcher.abort(); leaveWatcher = null; }
  }

  // ── Button factory ─────────────────────────────────────────────────────────

  function createBtn(iconFn, title, handler) {
    const btn = document.createElement('button');
    btn.className = 'yqa-btn';
    btn.title = title;
    btn.appendChild(iconFn());
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      handler();
    });
    return btn;
  }

  // ── Attach hover listeners to a thumbnail ──────────────────────────────────

  let leaveWatcher = null;

  function watchLeave(thumb) {
    if (leaveWatcher) leaveWatcher.abort();
    leaveWatcher = new AbortController();
    document.addEventListener('mousemove', e => {
      const r = thumb.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right ||
          e.clientY < r.top  || e.clientY > r.bottom) {
        scheduleHide();
        leaveWatcher.abort();
        leaveWatcher = null;
      }
    }, { passive: true, signal: leaveWatcher.signal });
  }

  function attachHover(thumb) {
    if (thumb.dataset.yqaHover) return;
    thumb.dataset.yqaHover = '1';

    thumb.addEventListener('mouseenter', () => {
      if (leaveWatcher) { leaveWatcher.abort(); leaveWatcher = null; }
      showPortal(thumb);
    });

    thumb.addEventListener('mouseleave', e => {
      const r = thumb.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right &&
          e.clientY >= r.top  && e.clientY <= r.bottom) {
        // Inline preview appeared on top — mouse hasn't actually left
        watchLeave(thumb);
      } else {
        scheduleHide();
      }
    });
  }

  // ── Find the "⋯" button for a given thumbnail ──────────────────────────────

  function findDotMenu(thumb) {
    const renderer = thumb.closest(RENDERERS);
    if (!renderer) return null;
    return (
      renderer.querySelector('button[aria-label="Action menu"]') ||
      renderer.querySelector('button[aria-label="More actions"]') ||
      renderer.querySelector('ytd-menu-renderer yt-icon-button button') ||
      renderer.querySelector('ytd-menu-renderer button')
    );
  }

  // ── Menu item search ───────────────────────────────────────────────────────

  const ITEM_SELECTOR =
    'yt-list-item-view-model, ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer';

  // YouTube reuses menu-item DOM across opens and just updates their content.
  // The closed dropdown sets display:none on its wrapper, so descendants of
  // closed (stale) menus have offsetParent === null. Items in the currently
  // open dropdown have a real offsetParent.
  function findItem(keywords) {
    for (const el of document.querySelectorAll(ITEM_SELECTOR)) {
      if (el.offsetParent === null) continue;
      const text = el.textContent.trim().toLowerCase();
      if (keywords.some(k => text.includes(k))) return el;
    }
    return null;
  }

  function waitForItem(keywords, ms) {
    return new Promise(resolve => {
      const immediate = findItem(keywords);
      if (immediate) { resolve(immediate); return; }

      let settled = false;
      const finish = val => {
        if (settled) return;
        settled = true;
        obs.disconnect();
        resolve(val);
      };
      const obs = new MutationObserver(() => {
        const it = findItem(keywords);
        if (it) finish(it);
      });
      // Watch attributes too: when reused items become visible the change is
      // a style/aria-hidden toggle on an ancestor, not a childList mutation.
      obs.observe(document.body, { childList: true, subtree: true, attributes: true });
      setTimeout(() => finish(null), ms);
    });
  }

  // ── Main action ────────────────────────────────────────────────────────────

  let busy = false;

  async function trigger(thumb, keywords) {
    if (busy) return;
    busy = true;
    try {
      const dotBtn = findDotMenu(thumb);
      if (!dotBtn) return;

      const veil = document.createElement('style');
      veil.textContent = 'tp-yt-iron-dropdown { opacity: 0 !important; pointer-events: none !important; }';
      document.head.appendChild(veil);

      dotBtn.click();
      const item = await waitForItem(keywords, 1000);

      if (item) (item.querySelector('button') || item).click();
      veil.remove();
    } finally {
      busy = false;
    }
  }

  // ── Scanner ────────────────────────────────────────────────────────────────

  function scan() {
    document.querySelectorAll('yt-thumbnail-view-model').forEach(attachHover);
  }

  function startObserver() {
    new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.('yt-thumbnail-view-model')) {
            attachHover(node);
          } else {
            node.querySelectorAll?.('yt-thumbnail-view-model').forEach(attachHover);
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ── Playlist reverse ───────────────────────────────────────────────────────

  const PL_PANEL_SEL    = 'ytd-playlist-panel-renderer';
  const PL_CONTENTS_SEL = 'ytd-playlist-panel-renderer #items';
  const PL_ITEM_SEL     = 'ytd-playlist-panel-video-renderer';

  let plReversed   = false;
  let plReverseBtn = null;

  function onWatchWithPlaylist() {
    return location.pathname === '/watch' && new URLSearchParams(location.search).has('list');
  }

  function syncPlLinks(container) {
    const items = Array.from(container.querySelectorAll(`:scope > ${PL_ITEM_SEL}`));
    items.forEach((item, i) => {
      const n = i + 1;
      const idxEl = item.querySelector('span#index');
      if (idxEl) idxEl.textContent = n;
      const link = item.querySelector('a#wc-endpoint');
      if (link) {
        try {
          const u = new URL(link.href, location.origin);
          u.searchParams.set('index', n);
          link.href = u.pathname + u.search;
        } catch (_) {}
      }
    });
  }

  function toggleReversePlaylist() {
    const container = document.querySelector(PL_CONTENTS_SEL);
    if (!container) return;
    const items = Array.from(container.querySelectorAll(`:scope > ${PL_ITEM_SEL}`));
    if (items.length < 2) return;
    for (let i = items.length - 1; i >= 0; i--) container.appendChild(items[i]);
    plReversed = !plReversed;
    syncPlLinks(container);
    if (plReverseBtn) {
      const on = plReversed;
      plReverseBtn.querySelector('svg').style.fill = on ? '#3ea6ff' : '';
      plReverseBtn.title       = on ? 'Restore original order' : 'Reverse playlist order';
    }
  }

  function buildReverseBtn() {
    const btn = document.createElement('button');
    btn.id    = 'yqa-reverse-btn';
    btn.title = 'Reverse playlist order';
    Object.assign(btn.style, {
      width: '36px', height: '36px', flexShrink: '0',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'transparent', border: 'none', borderRadius: '50%',
      color: 'currentColor', padding: '0', cursor: 'pointer',
      transition: 'background .15s, color .15s',
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    // swap_vert: two opposing vertical arrows — represents reversed order
    path.setAttribute('d', 'M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z');
    svg.appendChild(path);
    btn.appendChild(svg);
    btn.addEventListener('click', toggleReversePlaylist);
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(128,128,128,0.2)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
    return btn;
  }

  function tryInjectReverseBtn() {
    if (!onWatchWithPlaylist() || document.getElementById('yqa-reverse-btn')) return;
    const area = document.querySelector(`${PL_PANEL_SEL} #playlist-action-menu #top-level-buttons-computed`);
    if (!area) return;
    plReverseBtn = buildReverseBtn();
    area.appendChild(plReverseBtn);
  }

  function resetPlaylistState() {
    plReversed   = false;
    plReverseBtn = null;
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  function init() {
    injectStyles();
    scan();
    [500, 1500, 3000].forEach(t => setTimeout(scan, t));
    startObserver();
    window.addEventListener('scroll', hideOnScroll, { passive: true, capture: true });
    [500, 1500, 3000].forEach(t => setTimeout(tryInjectReverseBtn, t));
  }

  document.addEventListener('yt-navigate-finish', () => {
    resetPlaylistState();
    scan();
    [500, 1500].forEach(t => setTimeout(scan, t));
    [500, 1500, 3000].forEach(t => setTimeout(tryInjectReverseBtn, t));
  });
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
