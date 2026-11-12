/* Scroll story: a figure (the stage) stays in view while short text steps scroll past it, and changes with each step.

   Markup (what this script works on, and what a page may write directly):

     <section class="story" data-story>
       <div class="story-intro">…</div>                       optional: a heading above both columns
       <div class="story-stage">…</div>                       the sticky figure: any container (a figure, a viewer)
       <div class="story-steps">
         <div class="story-step" data-step="name" data-label="Short name" data-…>
           …text…
           <figure class="story-frame">…</figure>            optional: something the stage shows during this step
         </div>
       </div>
     </section>

   Flat form, for markdown posts (a markdown renderer does not render markdown inside block HTML): empty marker
   elements between ordinary blocks. Everything from a step marker to the next one becomes that step, blocks before
   the first step become the intro, and the .story-stage is taken from wherever it stands:

     <div data-story></div>
     ## Heading
     <div class="story-step" data-step="one" data-label="One"></div>
     Text…
     <figure class="story-stage">…</figure>
     <div class="story-step" data-step="two" data-label="Two" data-focus="x"></div>
     Text…
     <div data-story-end></div>

   What the script does once story.css is loaded:
   - The step nearest the reading line is active: data-active="<step>" on the section, .is-active on the step, and
     the step's other data-* attributes copied onto the stage (so CSS can react: .story-stage[data-focus~="x"]).
     data-note, if a step has one, is shown as one line in the stage (a story in which no step has one keeps no
     room for it: data-notes="0" on the section).
   - A "story:step" event on the section (it bubbles) with detail {step, index, count, data, element, stage}.
     A script that starts later reads section.dataset.active, or section.story.active.
   - .story-frame elements are moved into the stage and shown during their step (or the steps named in
     data-for="a b"); data-frames on the stage is how many the active step shows. They go back to their place in
     the text when the stage is pinned to the top instead.
   - A progress row in the stage (one tick per step, "3 / 12"). A tick, a step's heading or its label (data-label,
     shown above a step that has no heading) moves to that step; with keyboard focus on a step, the up and down
     arrows move to its neighbours.
   - Layout (data-layout on the section): "side" on a wide window, the stage beside the text; otherwise "top", the
     stage pinned under the top bar with the steps scrolling below it (a figcaption directly in the stage then
     scrolls with the text). If the pinned stage would take more than half of the window, or the section says
     data-story-narrow="plain", the story stays the plain sequence ("plain").

   Without this script or without story.css nothing is moved or hidden: the markup reads in source order.
   No scroll listeners: position: sticky and one IntersectionObserver per story. */
(function () {
  'use strict';
  var RESERVED = { step: 1, label: 1, for: 1 };
  var WIDE = window.matchMedia('(min-width: 1180px) and (min-height: 700px)');
  var CALM = window.matchMedia('(prefers-reduced-motion: reduce)');

  function make(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function onChange(mq, fn) {
    if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn);
  }

  /* The flat form: build the section from the markers. Returns null when the end marker is missing. */
  function upgrade(begin) {
    var nodes = [], n = begin.nextSibling;
    while (n && !(n.nodeType === 1 && n.hasAttribute('data-story-end'))) { nodes.push(n); n = n.nextSibling; }
    if (!n) return null;
    var section = make('section', 'story'), intro = make('div', 'story-intro'), steps = make('div', 'story-steps');
    var stage = null, cur = null;
    for (var i = 0; i < begin.attributes.length; i++) {
      var a = begin.attributes[i];
      if (a.name === 'class') section.className += ' ' + a.value; else section.setAttribute(a.name, a.value);
    }
    begin.parentNode.insertBefore(section, begin);
    nodes.forEach(function (node) {
      var el = node.nodeType === 1 ? node : null;
      if (el && el.classList.contains('story-step') && !el.firstElementChild && !el.textContent.trim()) {
        cur = el; steps.appendChild(el);                     // the marker becomes the step
      } else if (el && !stage && el.classList.contains('story-stage')) {
        stage = el;
      } else {
        (cur || intro).appendChild(node);
      }
    });
    if (intro.firstElementChild) section.appendChild(intro);
    if (stage) section.appendChild(stage);
    section.appendChild(steps);
    begin.parentNode.removeChild(begin);
    n.parentNode.removeChild(n);
    return section;
  }

  function Story(root) {
    var stage = root.querySelector('.story-stage');
    var steps = [].slice.call(root.querySelectorAll('.story-step'));
    if (!stage || !steps.length) return;
    var names = steps.map(function (s, i) { return s.getAttribute('data-step') || String(i + 1); });
    var active = -1, mode = null, io = null, lineY = 0, lock = null, lockTimer = 0, raf = 0, lastWidth = -1;

    /* steps: a label to click, focus for the arrow keys */
    var labels = steps.map(function (s, i) {
      var head = s.querySelector('.story-label') || s.querySelector('h2, h3, h4');
      var above = i === 0 ? root.querySelector('.story-intro h2, .story-intro h3, .story-intro h4') : null;
      var text = s.getAttribute('data-label') || (head || above || s).textContent.trim().slice(0, 60);
      if (!head && s.getAttribute('data-label')) {
        head = make('span', 'story-kicker', text);
        s.insertBefore(head, s.firstChild);
      }
      if (head) head.classList.add('story-label');
      s.tabIndex = 0;
      s.setAttribute('role', 'group');
      s.setAttribute('aria-label', 'Step ' + (i + 1) + ' of ' + steps.length + ': ' + text);
      return text;
    });

    /* the stage's own parts: progress, the note line, the frames */
    var progress = make('div', 'story-progress'), ticks = make('span', 'story-ticks');
    var count = make('span', 'story-count');
    progress.setAttribute('role', 'navigation');
    progress.setAttribute('aria-label', 'Story steps');
    count.setAttribute('aria-hidden', 'true');
    var buttons = steps.map(function (s, i) {
      var b = make('button');
      b.type = 'button'; b.tabIndex = -1; b.title = labels[i];
      b.setAttribute('aria-label', 'Step ' + (i + 1) + ' of ' + steps.length + ': ' + labels[i]);
      b.setAttribute('data-i', i);
      ticks.appendChild(b);
      return b;
    });
    progress.appendChild(ticks); progress.appendChild(count);
    stage.insertBefore(progress, stage.firstChild);
    var caps = [].slice.call(stage.children).filter(function (c) {
      return c.tagName === 'FIGCAPTION' || c.hasAttribute('data-story-flow');
    }).map(function (c) { return { el: c, mark: document.createComment('story-caption') }; });
    var capHolder = caps.length ? make('figure', 'story-caption') : null;
    var note = make('p', 'story-note');
    stage.appendChild(note);
    if (!steps.some(function (s) { return s.hasAttribute('data-note'); })) root.setAttribute('data-notes', '0');
    var frameBox = make('div', 'story-frames');
    stage.appendChild(frameBox);
    var frames = [].slice.call(root.querySelectorAll('.story-frame')).map(function (f) {
      var own = f.closest('.story-step'), list = (f.getAttribute('data-for') || '').split(/\s+/).filter(Boolean);
      if (!list.length && own) list = [names[steps.indexOf(own)]];
      return { el: f, steps: list, mark: document.createComment('story-frame') };
    });

    function move(item, target) {            // into target, or back to where it stood (target null)
      if (target) {
        if (!item.mark.parentNode) item.el.parentNode.insertBefore(item.mark, item.el);
        target.appendChild(item.el);
      } else if (item.mark.parentNode) {
        item.mark.parentNode.insertBefore(item.el, item.mark);
        item.mark.parentNode.removeChild(item.mark);
      }
    }

    function show(i) {
      var s = steps[i], prev = steps[active], k;
      if (prev) for (k in prev.dataset) if (!RESERVED[k]) delete stage.dataset[k];
      for (k in s.dataset) if (!RESERVED[k]) stage.dataset[k] = s.dataset[k];
      active = i;
      steps.forEach(function (x, j) {
        x.classList.toggle('is-active', j === i);
        if (j === i) x.setAttribute('aria-current', 'step'); else x.removeAttribute('aria-current');
        buttons[j].classList.toggle('is-done', j < i);
        if (j === i) buttons[j].setAttribute('aria-current', 'step'); else buttons[j].removeAttribute('aria-current');
      });
      root.setAttribute('data-active', names[i]);
      note.textContent = s.getAttribute('data-note') || '';
      count.textContent = (i + 1) + ' / ' + steps.length;
      var shown = 0;
      frames.forEach(function (f) { var on = f.steps.indexOf(names[i]) >= 0; f.el.classList.toggle('is-on', on); if (on) shown++; });
      stage.setAttribute('data-frames', shown);            // how many frames this step shows (0: the stage alone)
      var detail = { step: names[i], index: i, count: steps.length, data: {}, element: s, stage: stage };
      for (k in s.dataset) detail.data[k] = s.dataset[k];
      root.dispatchEvent(new CustomEvent('story:step', { bubbles: true, detail: detail }));
    }
    function activate(i) { if (i !== active) show(i); }

    function pick() {                          // the step nearest the reading line
      if (lock !== null || mode === 'plain') return;
      var best = 0, dist = Infinity;
      steps.forEach(function (s, i) {
        var r = s.getBoundingClientRect();
        var d = lineY < r.top ? r.top - lineY : (lineY > r.bottom ? lineY - r.bottom : 0);
        if (d < dist) { dist = d; best = i; }
      });
      activate(best);
    }

    function observe() {
      if (io) { io.disconnect(); io = null; }
      if (mode === 'plain') return;
      var vh = window.innerHeight;
      if (mode === 'top') {                    // below the pinned stage
        var top = parseFloat(getComputedStyle(stage).top) || 0, h = stage.offsetHeight;
        lineY = Math.min(vh - 48, Math.round(top + h + (vh - top - h) * 0.35));
      } else {
        lineY = Math.round(vh * 0.5);
      }
      if ('IntersectionObserver' in window) {  // a one-pixel band at the reading line: fires as steps cross it
        io = new IntersectionObserver(pick, { rootMargin: (-lineY) + 'px 0px ' + (-(vh - lineY - 1)) + 'px 0px', threshold: 0 });
        steps.forEach(function (s) { io.observe(s); });
      }
      pick();
    }
    function later() { cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); }

    /* side: beside the text. top: pinned under the top bar, unless it would take more than half of the window;
       then, or with data-story-narrow="plain", the story stays the plain sequence. A change of height alone (a
       phone's address bar) keeps the choice between top and plain. */
    function layout() {
      var next = WIDE.matches ? 'side' : (root.getAttribute('data-story-narrow') === 'plain' ? 'plain' : 'top');
      var resized = window.innerWidth !== lastWidth;
      lastWidth = window.innerWidth;
      if (next === 'top' && !resized && mode !== 'side' && mode !== null) next = mode;
      if (next !== mode || (next === 'top' && resized)) {
        apply(next);
        if (tooTall()) apply('plain');
      }
      observe();
    }
    function tooTall() {
      return mode === 'top' && (parseFloat(getComputedStyle(stage).top) || 0) + stage.offsetHeight > window.innerHeight * 0.5;
    }
    function apply(next) {
      mode = next;
      root.setAttribute('data-layout', mode);
      root.classList.toggle('is-on', mode !== 'plain');
      frames.forEach(function (f) { move(f, mode === 'side' ? frameBox : null); });
      if (capHolder) {
        if (mode === 'top') {
          stage.parentNode.insertBefore(capHolder, stage.nextSibling);
          caps.forEach(function (c) { move(c, capHolder); });
        } else {
          caps.forEach(function (c) { move(c, null); });
          if (capHolder.parentNode) capHolder.parentNode.removeChild(capHolder);
        }
      }
      if (mode === 'plain') {                  // the plain sequence shows the stage's own state
        if (steps[active]) for (var k in steps[active].dataset) if (!RESERVED[k]) delete stage.dataset[k];
        stage.removeAttribute('data-frames');
        active = -1;
      }
    }

    function unlock() { clearTimeout(lockTimer); lock = null; pick(); }
    function go(i, focus) {                    // bring a step to the reading line
      i = Math.max(0, Math.min(steps.length - 1, i));
      if (mode === 'plain') { steps[i].scrollIntoView(); return; }
      var r = steps[i].getBoundingClientRect();
      var y = window.pageYOffset + r.top - lineY + Math.min(96, r.height / 3);
      lock = null; activate(i); lock = i;      // hold this step while the page travels past the others
      clearTimeout(lockTimer);
      lockTimer = setTimeout(unlock, 'onscrollend' in window ? 1600 : 800);
      try { window.scrollTo({ top: y, behavior: CALM.matches ? 'instant' : 'smooth' }); } catch (e) { window.scrollTo(0, y); }
      if (focus) steps[i].focus({ preventScroll: true });
    }

    root.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('.story-ticks button') : null;
      if (t) { go(+t.getAttribute('data-i')); return; }
      var l = e.target.closest ? e.target.closest('.story-label') : null;
      if (l && !e.target.closest('a')) { var s = l.closest('.story-step'); if (s) go(steps.indexOf(s)); }
    });
    root.addEventListener('keydown', function (e) {
      var i = steps.indexOf(e.target);
      if (i < 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      var d = e.key === 'ArrowDown' ? 1 : (e.key === 'ArrowUp' ? -1 : (e.key === 'Enter' ? 0 : null));
      if (d === null) return;
      try { if (!e.target.matches(':focus-visible')) return; } catch (err) { /* older browsers: any focus counts */ }
      if (i + d < 0 || i + d >= steps.length) return;        // at either end the page scrolls as usual
      e.preventDefault();
      go(i + d, true);
    });
    window.addEventListener('scrollend', function () { if (lock !== null) unlock(); });
    window.addEventListener('resize', later);
    onChange(WIDE, layout);
    if ('ResizeObserver' in window) new ResizeObserver(function () {      // the pinned stage changed size (a redraw, fonts)
      if (mode !== 'top') return;
      if (tooTall()) apply('plain');
      cancelAnimationFrame(raf); raf = requestAnimationFrame(observe);
    }).observe(stage);

    root.story = {
      go: function (step) { go(typeof step === 'number' ? step : names.indexOf(step)); },
      get active() { return names[active]; },
      steps: names.slice()
    };
    layout();
    if (active < 0 && mode !== 'plain') activate(0);
  }

  function init() {
    [].slice.call(document.querySelectorAll('[data-story]')).forEach(function (el) {
      var root = el;
      if (!el.firstElementChild && !el.classList.contains('story')) root = upgradeIfStyled(el);
      if (root && !root.story && styled(root)) Story(root);
    });
  }
  /* story.css sets --story-top on .story. If the stylesheet is not there, leave the page as it is. */
  function styled(root) { return getComputedStyle(root).getPropertyValue('--story-top').trim() !== ''; }
  function upgradeIfStyled(begin) {
    var probe = make('div', 'story');
    probe.style.display = 'none';
    begin.parentNode.insertBefore(probe, begin);
    var ok = styled(probe);
    probe.parentNode.removeChild(probe);
    return ok ? upgrade(begin) : null;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
