/* The contents of a blog post (post.css), built from the h2 headings of the element marked data-post:
   - a number over each section heading ("03 / 08", drawn by CSS from data-post-k);
   - on a wide window a rail of ticks at the left edge, the current section's tick longer and in the accent, the
     names on hover; shown while the article is on screen, after the header;
   - everywhere a button at the bottom right that names the current section ("Contents" before the first) and opens
     the list.
   Headings inside figures, <details> and a scroll story's stage are not sections. A heading without an id gets one
   (or uses its section's), so a section can be linked. A heading inside a scroll story's step is reached through the
   story (story.js), so its stage shows that step.
   The button gives way: it sits above the design preview bar when the two would meet, shrinks to its icon while a
   story's sticky stage holds the bottom of the window, and leaves when even the icon would cover the stage. */
(function () {
  'use strict';
  var body = document.querySelector('[data-post]');
  if (!body) return;
  var CALM = window.matchMedia('(prefers-reduced-motion: reduce)');
  var heads = [].filter.call(body.querySelectorAll('h2'), function (h) {
    return !h.closest('figure, details, .story-stage, [hidden]') && h.textContent.trim();
  });
  if (heads.length < 3) return;

  function make(tag, cls, text, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }

  /* sections: the heading, its name (without an ordinal of its own: the list numbers them), an id to link to */
  var used = {};
  [].forEach.call(document.querySelectorAll('[id]'), function (e) { used[e.id] = 1; });
  var secs = heads.map(function (h, i) {
    var name = h.textContent.replace(/\s+/g, ' ').trim(), id = h.id, made = false;
    if (!id) {
      var sec = h.closest('section[id]');
      if (sec && sec.querySelector('h2') === h) id = sec.id;
    }
    if (!id) {
      var base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section', k = 2;
      id = base;
      while (used[id]) id = base + '-' + (k++);
      h.id = id; used[id] = 1; made = true;
    }
    h.setAttribute('data-post-k', two(i + 1) + ' / ' + two(heads.length));
    return { el: h, id: id, made: made, name: name.replace(/^\d+\.\s+/, '') };
  });

  var bar = document.querySelector('header.nav, header.sitebar');
  var head = document.querySelector('.post-head');
  function topbar() { return bar ? bar.getBoundingClientRect().bottom : 0; }

  function go(i, now) {
    var h = secs[i].el, step = h.closest('.story-step'), story = h.closest('.story');
    if (step && story && story.story && story.getAttribute('data-layout') !== 'plain') {
      story.story.go([].indexOf.call(story.querySelectorAll('.story-step'), step));
    } else {
      var y = Math.max(0, window.pageYOffset + h.getBoundingClientRect().top - topbar() - 24);
      try { window.scrollTo({ top: y, behavior: now || CALM.matches ? 'instant' : 'smooth' }); } catch (e) { window.scrollTo(0, y); }
    }
    try { history.replaceState(null, '', '#' + secs[i].id); } catch (e) { /* a page opened from a folder */ }
  }

  /* the rail and the button with its list */
  var rail = make('nav', 'post-rail', null, document.body);
  rail.setAttribute('aria-label', 'Sections');
  var wrap = make('div', 'post-toc', null, document.body);
  var btn = make('button', 'post-toc-btn', null, wrap), panel = make('nav', 'post-toc-panel', null, wrap);
  btn.type = 'button';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'Contents');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Contents');
  var icon = make('span', 'post-toc-ic', null, btn);
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<i></i><i></i><i></i>';
  var now = make('span', 'post-toc-now', null, btn), nowN = make('b', null, '', now), nowT = make('span', null, 'Contents', now);

  function open(on) {
    panel.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    wrap.classList.toggle('is-open', on);
  }
  var items = secs.map(function (s, i) {
    var t = make('a', 'post-tick', null, rail);
    t.href = '#' + s.id;
    make('span', null, s.name, t);
    t.setAttribute('aria-label', s.name);
    var p = make('a', 'post-toc-item', null, panel);
    p.href = '#' + s.id;
    make('b', null, two(i + 1), p);
    make('span', null, s.name, p);
    [t, p].forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        open(false);
        go(i);
      });
    });
    return [t, p];
  });
  btn.addEventListener('click', function () { open(panel.hidden); });
  document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) open(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) { open(false); btn.focus(); }
  });

  /* where the reader is, and what else holds the edges of the window */
  var cur = -2, queued = false;
  /* A section is current once its heading has passed a line 40% down the window. Over the last screen of the page
     the line moves to the bottom, so the last sections get their turn. A heading in a scroll story's step uses the
     story's own reading line, so the button and the stage agree. */
  function storyLine(h) {
    var story = h.closest('.story-step') && h.closest('.story.is-on'), stage = story && story.querySelector('.story-stage');
    if (!stage) return 0;
    var vh = window.innerHeight;
    if (story.getAttribute('data-layout') === 'side') return vh * 0.5;
    var top = parseFloat(getComputedStyle(stage).top) || 0, tall = stage.offsetHeight;
    return Math.min(vh - 48, Math.round(top + tall + (vh - top - tall) * 0.35));
  }
  function mark() {
    queued = false;
    var vh = window.innerHeight, rest = document.documentElement.scrollHeight - vh - window.pageYOffset;
    var line = vh * (0.4 + 0.6 * Math.max(0, Math.min(1, 1 - rest / vh))), k = -1;
    secs.forEach(function (s, i) { if (s.el.getBoundingClientRect().top <= Math.max(line, storyLine(s.el))) k = i; });
    if (k !== cur) {
      cur = k;
      items.forEach(function (pair, i) {
        pair.forEach(function (a) {
          a.classList.toggle('is-now', i === k);
          if (i === k) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
        });
      });
      nowN.textContent = k < 0 ? '' : two(k + 1);
      nowN.hidden = k < 0;
      nowT.textContent = k < 0 ? 'Contents' : secs[k].name;
    }
    var top = topbar();
    rail.classList.toggle('is-on', (!head || head.getBoundingClientRect().bottom <= top + 1) &&
      body.getBoundingClientRect().bottom > window.innerHeight * 0.5);
    place();
  }
  function place() {
    var vw = document.documentElement.clientWidth, vh = window.innerHeight, cs = getComputedStyle(wrap);
    var right = vw - (parseFloat(cs.right) || 14), widest = Math.min(vw * 0.78, 320), lift = 0;
    ['dbar', 'dchip'].forEach(function (id) {               /* the design preview bar, or its chip (pre-launch) */
      var e = document.getElementById(id), r = e && e.getBoundingClientRect();
      if (r && r.width && r.right > right - widest - 8 && r.left < right + 8) lift = Math.max(lift, vh - r.top + 8);
    });
    wrap.style.setProperty('--post-lift', lift + 'px');
    var bottom = vh - Math.max(lift, parseFloat(cs.bottom) || 14), tall = btn.offsetHeight || 32, over = 0;
    [].forEach.call(document.querySelectorAll('.story.is-on[data-layout="side"] > .story-stage'), function (st) {
      var r = st.getBoundingClientRect();
      if (r.bottom <= bottom - tall - 6 || r.top >= bottom) return;
      if (r.right > right - 36 - 8) over = 2; else if (r.right > right - widest - 8) over = Math.max(over, 1);
    });
    wrap.classList.toggle('is-compact', over === 1);
    wrap.classList.toggle('is-away', over === 2 && panel.hidden);
  }
  function later() { if (!queued) { queued = true; requestAnimationFrame(mark); } }
  window.addEventListener('scroll', later, { passive: true });
  window.addEventListener('resize', later);
  var ro = 'ResizeObserver' in window ? new ResizeObserver(later) : null;
  function watch() {                 /* the bar and the stages appear after this script has run */
    if (ro) [].forEach.call(document.querySelectorAll('#dbar, #dchip, .story-stage'), function (e) { ro.observe(e); });
    later();
  }
  document.addEventListener('DOMContentLoaded', watch);
  window.addEventListener('load', watch);
  watch();
  mark();

  /* A page opened with a section's address: the heading comes to rest under the top bar. The browser cannot do it
     for an id given here, and the page's layout still moves while fonts, pictures and a scroll story arrive, so the
     section is placed now, when everything has loaded and once more after that, unless the reader has moved on. */
  var moved = false;
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (type) {
    window.addEventListener(type, function () { moved = true; }, { passive: true });
  });
  function fromAddress() {
    var want = '';
    try { want = decodeURIComponent(location.hash.slice(1)); } catch (e) { /* not a section's address */ }
    if (want && !moved) secs.forEach(function (s, i) { if (s.id === want) go(i, true); });
  }
  fromAddress();
  window.addEventListener('load', function () { fromAddress(); setTimeout(fromAddress, 500); });
})();
