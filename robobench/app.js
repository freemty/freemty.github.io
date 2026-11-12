// Robobench review site: gallery, task review (design + animation feedback), pipeline, design standard.
// Talks to dashboard/server.py (JSON API, SQLite). Static data comes from pack.sh: data/scenes.json, pipeline.yaml, docs/.
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (s) => (window.marked ? marked.parse(s || '') : `<pre>${esc(s)}</pre>`);
const when = (iso) => (iso ? iso.replace('T', ' ').slice(0, 16) : '');
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600); };

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const CATS = { contact_person: 'Touches a person', pass_through: 'Passes through', floats: 'Floats', overload: 'Too heavy',
  unrealistic: 'Not physical', fall_risk: 'Fall risk', other: 'Other' };
const DSTATE = { draft: ['Design draft', ''], formalized: ['Design formalized', 'warn'], changes: ['Design: changes asked', 'bad'],
  approved: ['Design approved', 'ok'], none: ['No design yet', ''] };
const ASTATE = { unreviewed: ['Animation unreviewed', ''], flagged: ['Animation flagged', 'bad'], approved: ['Animation approved', 'ok'] };

// ---- data -------------------------------------------------------------------------------------------------------
let TASKS = [];          // merged rows, gallery order
let GROUPS = [];
let API_OK = true;

async function load() {
  const [scenes, pipe, rev] = await Promise.all([
    fetch('data/scenes.json').then((r) => r.json()).catch(() => []),
    fetch('pipeline.yaml').then((r) => r.text()).then((t) => jsyaml.load(t)).catch(() => ({ tasks: [], groups: [] })),
    api('/api/tasks').catch(() => { API_OK = false; return []; }),
  ]);
  GROUPS = pipe.groups || [];
  const sc = Object.fromEntries(scenes.map((s) => [s.id, s]));
  const rv = Object.fromEntries(rev.map((r) => [r.scene, r]));
  const seen = new Set();
  const rows = [];
  for (const t of pipe.tasks || []) {
    if (!t.scene || seen.has(t.scene)) continue;
    seen.add(t.scene);
    rows.push({ scene: t.scene, name: t.id, group: t.group, what: t.what, agents: t.agents, anim: sc[t.scene], rev: rv[t.scene] });
  }
  for (const s of scenes) if (!seen.has(s.id)) { seen.add(s.id); rows.push({ scene: s.id, name: s.label, group: '', anim: s, rev: rv[s.id] }); }
  for (const r of rows) {
    r.title = r.rev?.title || r.anim?.label || r.name;
    r.summary = r.rev?.summary || r.what || '';
    r.dstate = r.rev ? r.rev.design_state : 'none';
    r.astate = r.rev ? r.rev.anim_state : 'unreviewed';
    r.flags = r.rev?.flags || 0;
  }
  TASKS = rows;
  $('dbinfo').textContent = API_OK ? `${rev.length} designs in review` : 'read-only: review server not reachable';
  const gs = $('fgroup');
  gs.innerHTML = '<option value="">All groups</option>' + GROUPS.filter((g) => rows.some((r) => r.group === g.key))
    .map((g) => `<option value="${esc(g.key)}">${esc(g.label)}</option>`).join('');
  gs.value = FILTER.group;
}

// ---- gallery ----------------------------------------------------------------------------------------------------
const FILTER = { q: '', group: '', state: '' };
const groupLabel = (k) => GROUPS.find((g) => g.key === k)?.label || '';

function animChips(a) {
  if (!a) return '<span class="chip">Clip only</span>';
  const out = [];
  if (a.robots) out.push(`<span class="chip">${a.robots} G1</span>`);
  if (a.arm_miss_s > 0) out.push(`<span class="chip bad" title="Seconds where an arm target is out of reach">Reach miss ${a.arm_miss_s.toFixed(1)} s</span>`);
  if (a.over_limit_s > 0) out.push(`<span class="chip bad" title="Seconds over 3 kg per hand">Over 3 kg/hand ${a.over_limit_s.toFixed(1)} s</span>`);
  else if (a.load_kg > 0) out.push(`<span class="chip" title="Heaviest load on one hand">${a.load_kg.toFixed(1)} kg/hand</span>`);
  return out.join('');
}
function reviewChips(r) {
  const [dl, dc] = DSTATE[r.dstate] || DSTATE.none;
  const [al, ac] = ASTATE[r.astate] || ASTATE.unreviewed;
  return `<span class="chip ${dc}">${dl}</span><span class="chip ${ac}">${al}${r.flags ? ` · ${r.flags}` : ''}</span>`;
}
const needsReview = (r) => r.dstate !== 'approved' || r.astate !== 'approved';

function visible() {
  const q = FILTER.q.toLowerCase();
  return TASKS.filter((r) => (!FILTER.group || r.group === FILTER.group)
    && (!q || `${r.title} ${r.name} ${r.scene} ${r.summary}`.toLowerCase().includes(q))
    && (!FILTER.state || (FILTER.state === 'todo' ? needsReview(r) : FILTER.state === 'flagged'
      ? (r.astate === 'flagged' || r.dstate === 'changes') : (r.dstate === 'approved' && r.astate === 'approved'))));
}

function renderGallery() {
  const rows = visible();
  $('count').textContent = `${rows.length} of ${TASKS.length} tasks`;
  $('grid').innerHTML = rows.length ? rows.map((r) => `
    <a class="gcard" href="/robobench/task/${esc(r.scene)}" data-scene="${esc(r.scene)}">
      <div class="media">
        <div class="ph">Preview clip not rendered yet</div>
        <img loading="lazy" alt="" src="clips/${esc(r.scene)}.jpg" onerror="this.remove()">
        ${r.anim ? `<span class="dur">${r.anim.duration.toFixed(0)} s</span>` : ''}
      </div>
      <div class="gbody">
        <span class="grp">${esc(groupLabel(r.group))}${r.agents ? ` · ${esc(r.agents)}` : ''}</span>
        <h3>${esc(r.title)}</h3>
        <p>${esc(r.summary)}</p>
        <div class="chips">${reviewChips(r)}${animChips(r.anim)}</div>
      </div>
    </a>`).join('') : '<p class="empty">No tasks match.</p>';
}

// Hover or keyboard focus plays the clip. The video element is made on first use so the grid stays light.
function preview(card, on) {
  const r = TASKS.find((x) => x.scene === card.dataset.scene); if (!r) return;
  let v = card.querySelector('video');
  if (!v && on) {
    v = document.createElement('video');
    Object.assign(v, { muted: true, loop: true, playsInline: true, preload: 'auto', src: `clips/${r.scene}.webm` });
    v.addEventListener('canplay', () => { v.classList.add('ready'); if (card.dataset.live) v.play().catch(() => {}); }, { once: true });
    v.onerror = () => v.remove();
    card.querySelector('.media').appendChild(v);
  }
  if (on) card.dataset.live = 1; else delete card.dataset.live;
  if (!v) return;
  if (on) { v.currentTime = 0; v.play().catch(() => {}); } else v.pause();
}
$('grid').addEventListener('mouseover', (e) => { const c = e.target.closest('.gcard'); if (c && !c.contains(e.relatedTarget)) preview(c, true); });
$('grid').addEventListener('mouseout', (e) => { const c = e.target.closest('.gcard'); if (c && !c.contains(e.relatedTarget) && c !== document.activeElement) preview(c, false); });
$('grid').addEventListener('focusin', (e) => { const c = e.target.closest('.gcard'); if (c) preview(c, true); });
$('grid').addEventListener('focusout', (e) => { const c = e.target.closest('.gcard'); if (c && !c.matches(':hover')) preview(c, false); });

$('q').oninput = (e) => { FILTER.q = e.target.value; renderGallery(); };
$('fgroup').onchange = (e) => { FILTER.group = e.target.value; renderGallery(); };
$('fstate').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  FILTER.state = b.dataset.v; [...$('fstate').children].forEach((x) => x.classList.toggle('on', x === b)); renderGallery();
};

// ---- task review ------------------------------------------------------------------------------------------------
let CUR = null;         // { scene, design, versions, shown }

function viewerDoc() { try { return $('viewer').contentWindow.document; } catch { return null; } }
function viewerTime() {
  const el = viewerDoc()?.getElementById('time');
  const m = el && el.textContent.match(/([\d.]+)/); return m ? +m[1] : null;
}
function seek(s) {
  const d = viewerDoc(); const sc = d?.getElementById('scrub'); const r = TASKS.find((x) => x.scene === CUR?.scene);
  if (!sc || !r?.anim) return;
  sc.value = Math.min(1, s / r.anim.duration); sc.dispatchEvent(new Event('input'));
}

async function openTask(scene) {
  const r = TASKS.find((x) => x.scene === scene);
  CUR = { scene };
  $('ttitle').textContent = r?.title || scene;
  $('tline').textContent = [groupLabel(r?.group), r?.agents, r?.what].filter(Boolean).join(' · ');
  // embed=1: the player's controls sit below the scene, not over it. Same page, new hash: the viewer swaps scenes itself.
  const f = $('viewer');
  if (!f.dataset.loaded) { f.dataset.loaded = 1; f.contentWindow.location.replace((r?.anim ? `/robobench/viewer.html?embed=1#${scene}` : `/robobench/clip.html#${scene}`)); }
  // replace(): switching scenes inside the player must not add browser history entries (Back would walk through them)
  else if (true) f.contentWindow.location.replace((r?.anim ? `/robobench/viewer.html?embed=1#${scene}` : `/robobench/clip.html#${scene}`));
  $('checks').innerHTML = r?.anim ? `${esc(r.anim.check)}. ${r.anim.load_kg ? `Heaviest load on one hand: ${r.anim.load_kg.toFixed(1)} kg.` : ''}`
    : 'Preview clip only: the interactive three.js scene for this task is not in the repository yet.';
  $('fat').value = ''; $('fnote').value = ''; $('fmsg').textContent = '';
  $('editor').hidden = true; $('changes').hidden = true; $('doc').hidden = false;
  for (const id of ['animok', 'dapprove', 'dchanges', 'dedit']) $(id).disabled = !API_OK;
  $('flag').querySelector('button.warnbtn').disabled = !API_OK || !r?.anim;
  await Promise.all([loadDesign(), loadReviews()]);
}

async function loadDesign(pick) {
  let d = null;
  if (API_OK) d = await api(`/api/design/${CUR.scene}`).catch(() => null);
  if (!d || !d.versions.length) {   // fall back to the packed file
    const body = await fetch(`docs/${CUR.scene}.md`).then((x) => (x.ok ? x.text() : '')).catch(() => '');
    d = { versions: body ? [{ version: 0, author: 'claude', body_md: body, created_at: '' }] : [], state: null };
  }
  CUR.design = d;
  const vs = d.versions;
  const st = d.state?.design_state || (vs.length ? 'draft' : 'none');
  const [l, c] = DSTATE[st]; $('dstate').className = `chip ${c}`;
  $('dstate').textContent = st === 'approved' ? `${l} (v${d.state.approved_version})` : l;
  const by = { claude: 'Claude draft', agy: 'formalized by Gemini', codex: 'formalized by Codex', human: 'edited by you', you: 'edited by you' };
  $('vpick').innerHTML = vs.map((v) => `<option value="${v.version}">v${v.version} · ${esc(by[v.author] || v.author)}${v.created_at ? ` · ${when(v.created_at)}` : ''}</option>`).reverse().join('');
  $('vpick').hidden = vs.length < 2;
  showVersion(pick ?? vs.at(-1)?.version);
  $('dactions').hidden = !vs.length;
}
function showVersion(v) {
  const vs = CUR.design.versions; const x = vs.find((y) => y.version === +v) || vs.at(-1);
  CUR.shown = x; $('vpick').value = x ? x.version : '';
  $('doc').innerHTML = x ? md(x.body_md) : '<p class="mute">No design written yet.</p>';
  const appr = CUR.design.state?.approved_version;
  $('dapprove').textContent = x && appr === x.version ? 'Approved' : `Approve v${x?.version ?? ''}`;
  $('dapprove').disabled = !API_OK || !x || appr === x.version;
}
$('vpick').onchange = (e) => showVersion(e.target.value);

async function loadReviews() {
  const rs = API_OK ? await api(`/api/reviews/${CUR.scene}`).catch(() => []) : [];
  const a = rs.filter((x) => x.target === 'animation'), d = rs.filter((x) => x.target === 'design');
  const r = TASKS.find((x) => x.scene === CUR.scene);
  const st = a.length ? (a[0].verdict === 'approve' ? 'approved' : 'flagged') : (r?.astate || 'unreviewed');
  const [l, c] = ASTATE[st]; $('animstate').className = `chip ${c}`; $('animstate').textContent = l;
  $('animlog').innerHTML = a.map((x) => `<li>${x.verdict === 'approve' ? '<b>Approved</b>'
    : `<a href="#" class="at" data-at="${x.at_s ?? ''}">${x.at_s != null ? `${(+x.at_s).toFixed(1)} s` : '—'}</a> <b>${esc(CATS[x.category] || x.category || 'Flag')}</b>`}
    ${x.comment ? ` · ${esc(x.comment)}` : ''} <span class="when">${when(x.created_at)}</span></li>`).join('');
  $('dlog').innerHTML = d.map((x) => `<li><b>${x.verdict === 'approve' ? `Approved v${x.version}` : `Changes asked on v${x.version}`}</b>
    ${x.comment ? ` · ${esc(x.comment)}` : ''} <span class="when">${when(x.created_at)}</span></li>`).join('') || '<li class="mute">No design reviews yet.</li>';
}
$('animlog').onclick = (e) => { const a = e.target.closest('a.at'); if (!a) return; e.preventDefault(); if (a.dataset.at !== '') seek(+a.dataset.at); };

async function review(body, msg) {
  try { await api('/api/review', { scene: CUR.scene, ...body }); toast(msg); await refreshRow(); await loadReviews(); }
  catch (err) { toast(`Not saved: ${err.message}`); }
}
async function refreshRow() {
  const rev = await api('/api/tasks').catch(() => null); if (!rev) return;
  const rv = Object.fromEntries(rev.map((x) => [x.scene, x]));
  for (const r of TASKS) if (rv[r.scene]) {
    Object.assign(r, { rev: rv[r.scene], dstate: rv[r.scene].design_state, astate: rv[r.scene].anim_state, flags: rv[r.scene].flags });
    r.title = rv[r.scene].title || r.title;
  }
}

$('animok').onclick = () => review({ target: 'animation', verdict: 'approve' }, 'Animation approved');
$('fnow').onclick = () => { const t = viewerTime(); if (t != null) $('fat').value = t.toFixed(1); };
$('flag').onsubmit = async (e) => {
  e.preventDefault();
  if ($('fat').value === '') { const t = viewerTime(); if (t != null) $('fat').value = t.toFixed(1); }
  if (!$('fnote').value.trim()) { $('fmsg').textContent = 'Add a short note first.'; return; }
  await review({ target: 'animation', verdict: 'flag', category: $('fcat').value, at_s: +$('fat').value || 0, comment: $('fnote').value },
    'Flag saved');
  $('fnote').value = ''; $('fmsg').textContent = '';
};

$('dapprove').onclick = async () => { await review({ target: 'design', verdict: 'approve', version: CUR.shown.version }, `Design v${CUR.shown.version} approved`); await loadDesign(CUR.shown.version); };
$('dchanges').onclick = () => { $('changes').hidden = false; $('cnote').focus(); };
$('ccancel').onclick = () => { $('changes').hidden = true; };
$('changes').onsubmit = async (e) => {
  e.preventDefault(); if (!$('cnote').value.trim()) return;
  await review({ target: 'design', verdict: 'changes', version: CUR.shown.version, comment: $('cnote').value }, 'Change request saved');
  $('cnote').value = ''; $('changes').hidden = true; await loadDesign(CUR.shown.version);
};
$('dedit').onclick = () => {
  $('etext').value = CUR.shown?.body_md || `# ${$('ttitle').textContent}\n\n`; $('enote').value = '';
  $('eprev').innerHTML = md($('etext').value); $('editor').hidden = false; $('doc').hidden = true; $('etext').focus();
};
$('etext').oninput = () => { clearTimeout($('etext').h); $('etext').h = setTimeout(() => ($('eprev').innerHTML = md($('etext').value)), 150); };
$('ecancel').onclick = () => { $('editor').hidden = true; $('doc').hidden = false; };
$('esave').onclick = async () => {
  try {
    const j = await api(`/api/design/${CUR.scene}`, { body_md: $('etext').value, note: $('enote').value, author: 'human' });
    toast(`Saved as v${j.version}`); $('editor').hidden = true; $('doc').hidden = false;
    await refreshRow(); await loadDesign(j.version);
  } catch (err) { toast(`Not saved: ${err.message}`); }
};

function step(d) {
  const rows = visible(); const i = rows.findIndex((r) => r.scene === CUR?.scene);
  // next/previous task replaces the history entry, so Back still returns to where you came from
  const n = rows[(i + d + rows.length) % rows.length]; if (n) go(`/robobench/task/${n.scene}`, { replace: true });
}
$('prev').onclick = () => step(-1); $('next').onclick = () => step(1);

// ---- keyboard ---------------------------------------------------------------------------------------------------
const KEYS = [
  ['Anywhere', [['?', 'Show or hide this list'], ['1 2 3', 'Gallery, Pipeline, Design standard'], ['Esc', 'Close a panel, or go back to the gallery']]],
  ['Gallery', [['← → ↑ ↓', 'Move between cards (plays the clip)'], ['Enter', 'Open the task'], ['/', 'Search'],
    ['r', 'Show only tasks that need review']]],
  ['Task', [['← →  or  k j', 'Previous or next task'], ['Space', 'Play or pause'], [', .', 'Back or forward 1 s'],
    ['W A S D', 'Move the camera over the floor'], ['Q E', 'Camera down or up (Shift: faster)'], ['R', 'Reset the camera view'],
    ['[ ]', 'Darker or brighter'], ['f', 'Flag the animation at the current second'], ['i', 'Edit the design'], ['Shift A', 'Approve the animation'],
    ['Shift D', 'Approve the design version shown']]],
];
function help(show) {
  let h = $('help');
  if (!h) {
    h = document.createElement('div'); h.id = 'help'; h.hidden = true;
    h.innerHTML = `<div class="hbox" role="dialog" aria-label="Keyboard shortcuts"><h2>Keyboard shortcuts</h2>${KEYS.map(([g, ks]) =>
      `<h3>${g}</h3><dl>${ks.map(([k, d]) => `<dt>${k.split('  ').map((x) => x.split(' ').map((y) => `<kbd>${esc(y)}</kbd>`).join(' ')).join(' or ')}</dt><dd>${esc(d)}</dd>`).join('')}</dl>`).join('')}
      <p class="mute small">In the player: drag rotates, right-drag or Shift-drag moves, scroll zooms; ← → step one frame.</p></div>`;
    h.onclick = (e) => { if (e.target === h) help(false); };
    document.body.appendChild(h);
  }
  h.hidden = !(show ?? h.hidden);
}
function viewerCall(fn) { const d = viewerDoc(); if (d) fn(d); }
function moveCard(key) {
  const cards = [...document.querySelectorAll('#grid .gcard')]; if (!cards.length) return;
  const cols = getComputedStyle($('grid')).gridTemplateColumns.split(' ').length;
  let i = cards.indexOf(document.activeElement);
  if (i < 0) i = Math.max(0, cards.findIndex((c) => c.dataset.scene === CUR?.scene));
  else i += { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[key];
  const c = cards[Math.max(0, Math.min(cards.length - 1, i))];
  c.focus({ preventScroll: true }); c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (e.key === 'Escape') {
    if ($('help') && !$('help').hidden) return help(false);
    if (typing) return e.target.blur();
    if (!$('task').hidden) {
      if (!$('editor').hidden) return $('ecancel').click();
      if (!$('changes').hidden) return $('ccancel').click();
      backToGallery();
    }
    return;
  }
  if (typing) return;
  const k = e.key, inTask = !$('task').hidden, inGallery = !$('gallery').hidden;
  if (k === '?') return help();
  if (k === '1' || k === '2' || k === '3') { go(['/gallery', '/pipeline', '/standard'][+k - 1]); return; }
  if (inGallery) {
    if (k.startsWith('Arrow')) { e.preventDefault(); return moveCard(k); }
    if (k === '/') { e.preventDefault(); return $('q').focus(); }
    if (k === 'r') return $('fstate').querySelector(`button[data-v="${FILTER.state === 'todo' ? '' : 'todo'}"]`).click();
  }
  if (!inTask) return;
  if (k === 'ArrowRight' || k === 'j') { e.preventDefault(); return step(1); }
  if (k === 'ArrowLeft' || k === 'k') { e.preventDefault(); return step(-1); }
  if (k === ' ') { e.preventDefault(); return viewerCall((d) => d.getElementById('play')?.click()); }
  if (k === ',' || k === '.') { const t = viewerTime(); if (t != null) seek(Math.max(0, t + (k === '.' ? 1 : -1))); return; }
  if (k === 'f') { e.preventDefault(); $('fnow').click(); $('fnote').focus(); $('flag').scrollIntoView({ block: 'nearest' }); return; }
  if (k === 'i' && !$('dedit').disabled) { e.preventDefault(); return $('dedit').click(); }
  if ('wasdqer[]'.includes(k.toLowerCase()) && k.length === 1) {   // camera keys go to the player
    const vk = $('viewer').contentWindow?.viewerKey; if (vk && vk('down', k, e.shiftKey)) e.preventDefault(); return;
  }
  if (k === 'A' && !$('animok').disabled) return $('animok').click();
  if (k === 'D' && !$('dapprove').disabled) return $('dapprove').click();
}
addEventListener('keydown', onKey);
addEventListener('keyup', (e) => { if ('wasdqe'.includes(e.key.toLowerCase())) $('viewer').contentWindow?.viewerKey?.('up', e.key, e.shiftKey); });
// Keys pressed while the player has focus: keep its own (space, ← → frame step), pass the site's on to this page.
$('viewer').addEventListener('load', () => {
  try {
    $('viewer').contentWindow.addEventListener('keydown', (e) => {
      if (['?', 'Escape', 'j', 'k', 'f', 'i', 'A', 'D', '1', '2', '3', ',', '.'].includes(e.key)) { onKey(e); window.focus(); }
    });
  } catch { /* cross-origin: no forwarding */ }
});

// ---- router -----------------------------------------------------------------------------------------------------
// Real paths: /gallery, /task/<scene>, /pipeline, /standard (server.py serves index.html for them). Opening a task from
// the gallery pushes one history entry; next/previous task replaces it; Back (browser, Esc, "← Gallery") pops it.
const PATH_RE = /^\/robobench\/(?:(gallery|pipeline|standard)|task\/([a-z0-9_]+))\/?$/;
function go(path, { replace = false, state = {} } = {}) {
  if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState']({ ...(replace ? history.state : {}), ...state }, '', path);
  route();
}
function backToGallery() { if (history.state?.fromGallery) history.back(); else go('/robobench/gallery'); }
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || a.target) return;
  const p = new URL(a.href).pathname; if (!PATH_RE.test(p) && p !== '/robobench/') return;
  e.preventDefault();
  if (a.classList.contains('back')) return backToGallery();
  go(p === '/robobench/' ? '/robobench/gallery' : p, { state: { fromGallery: !$('gallery').hidden && p.startsWith('/robobench/task/') } });
});
async function route() {
  // old #task/<scene> links still work
  const old = location.hash.match(/^#(gallery|pipeline|standard|task\/[a-z0-9_]+)$/);
  if (old) history.replaceState(history.state, '', `/robobench/${old[1]}`);
  const m = location.pathname.match(PATH_RE) || [null, 'gallery'];
  const tab = m[2] ? 'task' : (m[1] || 'gallery'), arg = m[2];
  for (const s of document.querySelectorAll('main > .tab')) s.hidden = s.id !== tab;
  for (const a of document.querySelectorAll('.top nav a')) a.classList.toggle('on', a.dataset.tab === (tab === 'task' ? 'gallery' : tab));
  document.title = tab === 'task' ? `${TASKS.find((r) => r.scene === arg)?.title || arg} · Robobench Review` : 'Robobench Review';
  if (tab === 'task' && arg) return openTask(arg);
  if (tab === 'pipeline' && !$('pipeframe').src) $('pipeframe').src = '/robobench/pipeline.html';
  if (tab === 'standard' && !$('stddoc').innerHTML) $('stddoc').innerHTML = md(await fetch('/robobench/docs/_standard.md').then((r) => r.text()).catch(() => ''));
  if (tab === 'gallery') {
    renderGallery();
    // coming back from a task: land on its card so arrow keys continue from there
    const c = CUR && document.querySelector(`#grid .gcard[data-scene="${CUR.scene}"]`);
    if (c) { c.focus({ preventScroll: true }); c.scrollIntoView({ block: 'center' }); return; }
  }
  scrollTo(0, 0);
}
addEventListener('popstate', route);
load().then(route).catch((e) => { $('grid').innerHTML = `<p class="empty">Could not load: ${esc(e.message)}</p>`; });
$('keys').onclick = (e) => { e.preventDefault(); help(); };
