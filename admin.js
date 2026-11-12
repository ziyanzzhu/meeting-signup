/* Admin page: paint weekly availability, publish a link, read responses, suggest a schedule. */
(function () {
  'use strict';
  const M = window.Meet;
  const { esc, icon } = M;
  const root = document.getElementById('app');
  // Muted, earthy meeting colors (white text stays readable on each).
  const COLORS = ['#a06e6e', '#6e8569', '#6e7f91', '#9c7c48', '#8a6d8b', '#7c7850', '#93604f', '#5f7e7c', '#8a7563', '#a07888'];

  const A = {
    key: M.DEMO ? 'demo' : (M.store.get('meet-admin-key') || ''),
    settings: null,
    weekId: null,
    week: null,        // saved week (null = not published)
    draft: null,       // editable copy: { increment, minMinutes, slots:Set, open, note }
    responses: [],
    dirty: false,
    tab: 'avail',      // avail | resp
    view: 'heat',      // heat | schedule
    focus: null,       // response id highlighted on the heatmap
    schedule: null,    // { items, unfit, byCell }
    who: new Map(),    // slot -> names (for tooltips)
    busy: {},          // weekId -> { list: [{start, end}], errors, set, inc } from your calendars
  };

  const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); // phones/tablets: tap, don't drag
  let loadSeq = 0; // ignores slow replies for a week you've already navigated away from
  const cacheKey = (id) => 'meet-admin-cache-' + id;

  const qs = new URLSearchParams(location.search);
  const qWeek = qs.get('week');
  A.weekId = qWeek && /^\d{4}-\d{2}-\d{2}$/.test(qWeek) ? M.mondayOf(qWeek) : defaultWeek();
  if (qs.get('tab') === 'responses') A.tab = 'resp';

  window.addEventListener('beforeunload', (e) => { if (A.dirty) { e.preventDefault(); e.returnValue = ''; } });


  // ───────────── helpers ─────────────
  function defaultWeek() {
    const t = M.localToday();
    const w = M.mondayOf(t);
    return [0, 6].includes(M.dow(t)) ? M.addDays(w, 7) : w; // on weekends, plan next week
  }
  function studentLink() {
    const base = location.protocol === 'file:' ? 'index.html' : './';
    return new URL(base + '?week=' + A.weekId, location.href).href;
  }
  function syncUrl() {
    history.replaceState(null, '', '?week=' + A.weekId + (A.tab === 'resp' ? '&tab=responses' : ''));
  }
  function makeDraft(w) {
    return w
      ? { increment: w.increment, minMinutes: w.minMinutes, slots: new Set(w.slots), open: w.open, note: w.note || '' }
      : { increment: 15, minMinutes: A.settings.minMinutes, slots: new Set(), open: true, note: '' };
  }
  function sortedResponses() {
    return A.responses.slice().sort((a, b) => String(a.submitted).localeCompare(String(b.submitted)));
  }
  function colorOf(id) {
    const i = sortedResponses().findIndex((r) => r.id === id);
    return COLORS[(i < 0 ? 0 : i) % COLORS.length];
  }
  function setBusy(b) { const m = document.getElementById('main'); if (m) m.classList.toggle('busy', b); }
  function hideTip() { const t = document.getElementById('tip'); if (t) t.hidden = true; }

  // ───────────── loading ─────────────
  // Shows this week's data from the last visit instantly (if any), then refreshes from the server.
  function cacheNow() {
    if (M.DEMO || !A.weekId) return;
    M.store.set(cacheKey(A.weekId), { ok: true, settings: A.settings, week: A.week, responses: A.responses });
  }
  function clearAdminCache() {
    try { Object.keys(localStorage).filter((k) => k.indexOf('meet-admin-cache-') === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
  }
  // True while the week a request started on is still the one on screen.
  const stillOn = (id, seq) => A.weekId === id && loadSeq === seq;
  const draftKey = (d) => JSON.stringify([d.increment, d.minMinutes, Array.from(d.slots).sort(), d.open, d.note]);

  function applyLoaded(id, d) {
    A.settings = d.settings;
    A.weekId = id;
    A.week = d.week;
    A.responses = d.responses || [];
    A.draft = makeDraft(d.week);
    A.dirty = false; A.focus = null; A.placing = null;
    A.schedule = d.week && d.week.confirmed ? fromConfirmed() : null;
    A.view = A.schedule ? 'schedule' : 'heat';
    syncUrl();
  }

  // The weeks before and after the one on screen are fetched in the background, so the arrows
  // open them instantly. A prefetch is used once, within a minute; saving anything drops them all.
  let prefetched = {};
  const loadedAt = {};
  function dropPrefetch() { prefetched = {}; }
  function prefetch(id) {
    if (M.DEMO || prefetched[id] || id === A.weekId || Date.now() - (loadedAt[id] || 0) < 60000) return;
    const entry = { at: Date.now() };
    entry.p = M.api.adminLoad(A.key, id).then((d) => {
      if (prefetched[id] === entry) M.store.set(cacheKey(id), d);
      return d;
    });
    entry.p.catch(() => { if (prefetched[id] === entry) delete prefetched[id]; });
    prefetched[id] = entry;
    loadBusy(id);
  }
  function takePrefetch(id) {
    const e = prefetched[id];
    delete prefetched[id];
    return e && Date.now() - e.at < 60000 ? e.p : null;
  }
  function prefetchAround(id) {
    if (M.DEMO) return;
    setTimeout(() => { if (A.weekId === id) { prefetch(M.addDays(id, 7)); prefetch(M.addDays(id, -7)); } }, 300);
  }

  async function load(id) {
    const seq = ++loadSeq;
    const first = !A.settings;
    const trusted = M.DEMO || M.store.get('meet-admin-key') === A.key; // key already verified here
    if (trusted) loadBusy(id); // your calendar, in parallel with the week itself
    const cached = M.DEMO || !trusted ? null : M.store.get(cacheKey(id));
    if (cached) { applyLoaded(id, cached); render(); }
    else if (first) root.innerHTML = '<div class="center"><div class="spinner" aria-label="Loading"></div></div>';
    else setBusy(true);
    try {
      const d = await (takePrefetch(id) || M.api.adminLoad(A.key, id));
      if (seq !== loadSeq) return; // a newer week was opened meanwhile
      if (!M.DEMO) { M.store.set('meet-admin-key', A.key); M.store.set(cacheKey(id), d); }
      loadedAt[id] = Date.now();
      prefetchAround(id);
      if (cached && JSON.stringify(cached) === JSON.stringify(d)) return;
      const lockedInc = (d.responses || []).length && d.week && A.draft && A.draft.increment !== d.week.increment;
      if (cached && A.dirty && !lockedInc) {
        // You started editing before fresh data arrived: keep your edits, refresh everything else.
        A.settings = d.settings; A.week = d.week; A.responses = d.responses || [];
        A.schedule = null; A.focus = null;
        if (A.tab === 'resp') render();
        return;
      }
      applyLoaded(id, d);
      render();
    } catch (e) {
      if (seq !== loadSeq) return;
      if (/admin key/i.test(e.message)) {
        A.key = ''; M.store.del('meet-admin-key'); clearAdminCache();
        A.busy = {}; dropPrefetch();
        renderLogin(e.message);
      } else if (cached) {
        M.toast('Showing saved data. Couldn’t refresh: ' + e.message);
      } else if (first) {
        root.innerHTML = '<div class="msg-card"><h1>Couldn’t load</h1><p class="muted">' + esc(e.message) + '</p><button class="btn" onclick="location.reload()">Try again</button></div>';
      } else {
        setBusy(false);
        M.toast(e.message);
      }
    }
  }

  function renderLogin(msg) {
    root.innerHTML =
      '<form class="login" id="login">' +
        '<div class="avatar">' + icon('lock') + '</div>' +
        '<h1>Admin sign-in</h1>' +
        '<p class="muted">Enter the admin key you set in the Apps Script (<code>ADMIN_KEY</code>). This browser will remember it.</p>' +
        (msg ? '<div class="error">' + esc(msg) + '</div>' : '') +
        '<div class="field"><input class="input" type="password" name="key" autocomplete="current-password" placeholder="Admin key" aria-label="Admin key"></div>' +
        '<button class="btn primary block" type="submit">Continue</button>' +
      '</form>';
    const f = document.getElementById('login');
    f.elements.namedItem('key').focus();
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const k = f.elements.namedItem('key').value.trim();
      if (!k) return;
      A.key = k;
      load(A.weekId);
    });
  }

  // ───────────── render ─────────────
  function render() {
    hideTip();
    root.innerHTML = topbar() +
      '<main class="admin" id="main">' + callout() + tabs() + (A.tab === 'avail' ? availView() : respView()) + '</main>';
    mountGrid();
  }

  function topbar() {
    return '<header class="topbar">' +
      '<div class="brand"><span class="logo">' + icon('calendar') + '</span><span>Meetings</span>' +
        (M.DEMO ? '<span class="badge warn" title="No backend connected: data is saved in this browser only. See README.md.">Demo</span>' : '') +
      '</div>' +
      '<nav class="weeknav" aria-label="Week">' +
        '<button class="btn ghost icon" data-act="prev" aria-label="Previous week" title="Previous week">' + icon('left') + '</button>' +
        '<div class="week-label">' + esc(M.fmtWeekRange(A.weekId)) + '</div>' +
        '<button class="btn ghost icon" data-act="next" aria-label="Next week" title="Next week">' + icon('right') + '</button>' +
        '<button class="btn sm" data-act="this-week"' + (A.weekId === defaultWeek() ? ' disabled' : '') + '>This week</button>' +
      '</nav>' +
      '<div class="top-actions">' +
        '<a class="btn sm ghost" href="' + esc(studentLink()) + '" target="_blank" rel="noopener">' + icon('external') + 'Student view</a>' +
        '<button class="btn ghost icon" data-act="settings" aria-label="Settings" title="Settings">' + icon('sliders') + '</button>' +
      '</div>' +
    '</header>';
  }

  function callout() {
    if (A.settings.name) return '';
    return '<div class="callout"><span>Add your name so students know who they’re signing up with.</span>' +
      '<button class="btn sm" data-act="settings">Open settings</button></div>';
  }

  function statusInfo() {
    if (A.dirty) return { cls: 'dirty', text: 'Unsaved changes' };
    if (!A.week) return { cls: '', text: 'Not published' };
    return A.week.open ? { cls: 'live', text: 'Open for sign-ups' } : { cls: '', text: 'Closed' };
  }

  function tabs() {
    const st = statusInfo();
    return '<div class="tabs" role="tablist">' +
      '<button class="tab" role="tab" data-tab="avail" aria-selected="' + (A.tab === 'avail') + '">Availability</button>' +
      '<button class="tab" role="tab" data-tab="resp" aria-selected="' + (A.tab === 'resp') + '">Responses<span class="count">' + A.responses.length + '</span></button>' +
      '<span class="status ' + st.cls + '" id="status"><span class="dot"></span>' + st.text + '</span>' +
    '</div>';
  }

  // ───────────── availability tab ─────────────
  function minHint() {
    const d = A.draft;
    const n = Math.max(1, Math.ceil(d.minMinutes / d.increment));
    return 'Students see: “Choose at least ' + n + ' slot' + (n === 1 ? '' : 's') + ' and as many as possible.”';
  }

  function availView() {
    const d = A.draft;
    const locked = A.responses.length > 0;
    const mins = [30, 45, 60, 75, 90, 120, 150, 180].filter((m) => m % d.increment === 0);
    if (!mins.includes(d.minMinutes)) { mins.push(d.minMinutes); mins.sort((a, b) => a - b); }
    return '<div class="layout">' +
      '<section class="panel">' +
        '<div class="toolbar">' +
          '<div class="seg" role="group" aria-label="Slot length">' +
            [15, 30].map((n) => '<button data-inc="' + n + '" aria-pressed="' + (d.increment === n) + '"' +
              (locked && d.increment !== n ? ' disabled title="Students already responded using ' + d.increment + '-min slots"' : '') +
              '>' + n + ' min</button>').join('') +
          '</div>' +
          '<span class="hint muted">' + (coarse ? 'Tap to mark when you’re free' : 'Click and drag to mark when you’re free') + '</span>' +
          '<span class="spacer"></span>' +
          '<button class="btn sm ghost" data-act="copy-last">' + icon('copy') + 'Copy last week</button>' +
          '<button class="btn sm ghost" data-act="clear">Clear</button>' +
          '<button class="btn sm primary" data-act="save" id="save"' + (A.week && !A.dirty ? ' disabled' : '') + '>' + (A.week ? 'Save' : 'Publish') + '</button>' +
        '</div>' +
        '<div class="busy-legend' + (busyErrors().length ? ' warn' : '') + '" id="busy-legend">' + busyLegend() + '</div>' +
        '<div id="grid"></div>' +
      '</section>' +
      '<aside class="panel side">' +
        '<div class="side-sec"><h3>Link for students</h3>' +
          (A.week
            ? '<div class="linkbox"><input class="input" readonly value="' + esc(studentLink()) + '" aria-label="Student link" onclick="this.select()">' +
              '<button class="btn sm" data-act="copy-link">Copy</button></div>'
            : '<p class="muted small">Mark your free times, then publish to get this week’s link.</p>') +
        '</div>' +
        '<div class="side-sec side-row">' +
          '<div><h3>Accepting responses</h3><p class="muted small">Turn off to close sign-ups.</p></div>' +
          '<button class="switch" role="switch" aria-checked="' + d.open + '" data-act="toggle-open" aria-label="Accepting responses"></button>' +
        '</div>' +
        '<div class="side-sec"><h3><label for="minsel">Minimum per student</label></h3>' +
          '<select class="input" id="minsel" data-field="minMinutes">' +
            mins.map((m) => '<option value="' + m + '"' + (m === d.minMinutes ? ' selected' : '') + '>' + Math.ceil(m / d.increment) + (Math.ceil(m / d.increment) === 1 ? ' slot (' : ' slots (') + M.fmtDuration(m) + ')</option>').join('') +
          '</select>' +
          '<p class="muted small" id="minhint" style="margin-top:6px">' + minHint() + '</p>' +
        '</div>' +
        '<div class="side-sec"><h3><label for="note">Note to students</label><span class="opt">optional</span></h3>' +
          '<textarea class="input" id="note" data-field="note" rows="3" maxlength="1000" placeholder="e.g. I’m traveling Thursday, so times are tight this week.">' + esc(d.note) + '</textarea>' +
        '</div>' +
      '</aside>' +
    '</div>';
  }

  function markDirty() {
    A.dirty = true;
    A.schedule = null;
    const st = statusInfo();
    const el = document.getElementById('status');
    if (el) { el.className = 'status ' + st.cls; el.innerHTML = '<span class="dot"></span>' + st.text; }
    const sv = document.getElementById('save');
    if (sv) sv.disabled = false;
  }

  function setIncrement(n) {
    const d = A.draft;
    if (d.increment === n) return;
    if (A.responses.length) { M.toast('Students already responded using ' + d.increment + '-min slots.'); return; }
    d.slots = new Set(M.convertSlots(Array.from(d.slots), d.increment, n));
    d.increment = n;
    if (d.minMinutes % n) d.minMinutes = Math.ceil(d.minMinutes / n) * n;
    markDirty();
    render();
  }

  async function save() {
    const d = A.draft;
    if (!d.slots.size && !A.week) { M.toast('Mark at least one free time first.'); return; }
    const need = Math.ceil(d.minMinutes / d.increment);
    if (d.slots.size && d.slots.size < need &&
        !confirm('You’re offering ' + d.slots.size + ' slot' + (d.slots.size === 1 ? '' : 's') + ', fewer than the minimum of ' + need + '. Students will be asked to pick all of them. Continue?')) return;
    const btn = document.getElementById('save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    const first = !A.week;
    const id = A.weekId, seq = loadSeq, sent = draftKey(d);
    try {
      const res = await M.api.saveWeek(A.key, {
        id: id, increment: d.increment, minMinutes: d.minMinutes, slots: Array.from(d.slots), open: d.open, note: d.note,
      });
      dropPrefetch(); // other weeks' prefetched copies carry the old defaults
      if (!stillOn(id, seq)) { M.store.del(cacheKey(id)); M.toast('Saved ' + M.fmtWeekRange(id)); return; }
      A.week = res.week;
      if (draftKey(A.draft) === sent) { A.draft = makeDraft(res.week); A.dirty = false; } // else keep edits made while saving
      A.settings.increment = res.week.increment;
      A.settings.minMinutes = res.week.minMinutes;
      cacheNow();
      render();
      if (first) {
        const ok = await M.copyText(studentLink());
        M.toast(ok ? 'Published. Link copied to your clipboard' : 'Published. Copy the link to send to students');
      } else {
        M.toast('Saved');
      }
    } catch (e) {
      M.toast(e.message);
      if (btn) { btn.disabled = false; btn.textContent = A.week ? 'Save' : 'Publish'; }
    }
  }

  async function copyLast() {
    const id = A.weekId, seq = loadSeq, prev = M.addDays(id, -7);
    try {
      const d = await M.api.adminLoad(A.key, prev);
      if (!stillOn(id, seq)) return;
      if (!d.week || !d.week.slots.length) { M.toast('Last week has no times to copy.'); return; }
      if (A.draft.slots.size && !confirm('Replace this week’s times with last week’s?')) return;
      const shifted = d.week.slots.map((k) => M.addDays(k.slice(0, 10), 7) + k.slice(10));
      A.draft.slots = new Set(M.convertSlots(shifted, d.week.increment, A.draft.increment));
      markDirty();
      render();
      M.toast('Copied last week’s times');
    } catch (e) {
      M.toast(e.message);
    }
  }

  // ───────────── responses tab ─────────────
  function respView() {
    if (!A.week) {
      return '<div class="panel empty"><h3>Not published yet</h3>' +
        '<p>Publish this week’s availability to start collecting responses.</p><br>' +
        '<button class="btn" data-tab="avail">Go to availability</button></div>';
    }
    const n = A.responses.length;
    return '<div class="layout">' +
      '<section class="panel">' +
        '<div class="toolbar">' +
          '<div class="seg" role="group" aria-label="View">' +
            '<button data-view="heat" aria-pressed="' + (A.view === 'heat') + '">Availability</button>' +
            '<button data-view="schedule" aria-pressed="' + (A.view === 'schedule') + '"' + (A.schedule ? '' : ' disabled title="Click Suggest schedule first"') + '>Schedule</button>' +
          '</div>' +
          (A.view === 'heat' && !A.focus ? '<span class="legend">fewer<span class="ramp"></span>more students</span>' : '') +
          '<span class="spacer"></span>' +
          '<button class="btn sm ghost icon" data-act="refresh" aria-label="Refresh responses" title="Refresh responses">' + icon('refresh') + '</button>' +
          '<button class="btn sm primary" data-act="suggest"' + (n ? '' : ' disabled') + '>' + icon('sparkles') + (A.schedule ? 'Suggest again' : 'Suggest schedule') + '</button>' +
        '</div>' +
        '<div id="grid"></div>' +
      '</section>' +
      '<aside class="panel side">' +
        (A.schedule && A.view === 'schedule' ? scheduleSec() : '') +
        '<div class="side-sec">' +
          '<div class="sec-head"><h3>' + n + ' response' + (n === 1 ? '' : 's') + '</h3>' +
            (A.focus ? '<button class="linkbtn" data-act="unfocus">Show everyone</button>' : '') + '</div>' +
          (n
            ? '<div class="resp-list">' + sortedResponses().map(respCard).join('') + '</div>'
            : '<p class="muted small">No responses yet. Send students the link from the Availability tab.</p>') +
          (M.DEMO
            ? '<button class="btn sm block" data-act="samples" style="margin-top:12px">' + icon('users') + 'Add sample students (demo)</button>'
            : '') +
        '</div>' +
      '</aside>' +
    '</div>';
  }

  function respCard(r) {
    const offered = new Set(A.week.slots);
    const mine = r.slots.filter((k) => offered.has(k));
    const days = M.uniq(mine.map((k) => k.slice(0, 10))).sort().map((d) => M.DOW[M.dow(d)]).join(', ');
    const showColor = A.view === 'schedule' && A.schedule;
    const edited = r.updated && r.submitted && r.updated !== r.submitted;
    return '<div class="resp' + (A.focus === r.id ? ' focus' : '') + '" data-rid="' + esc(r.id) + '" tabindex="0" role="button" aria-pressed="' + (A.focus === r.id) + '" title="Show only ' + esc(r.name) + '’s times">' +
      '<div class="resp-top">' + (showColor ? '<span class="cdot" style="--c:' + colorOf(r.id) + '"></span>' : '') +
        '<b>' + esc(r.name) + '</b><span class="chip" title="Time needed">' + M.fmtDuration(r.duration) + '</span></div>' +
      '<p class="topic">' + esc(r.topic) + '</p>' +
      '<div class="rmeta">' + M.fmtDuration(mine.length * A.week.increment) + ' free' + (days ? ' · ' + days : '') +
        (r.email ? ' · <a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a>' : '') +
        '<br>' + (edited ? 'Updated ' : 'Sent ') + esc(M.fmtStamp(edited ? r.updated : r.submitted)) + '</div>' +
      '<button class="btn ghost icon del" data-act="delete" data-id="' + esc(r.id) + '" aria-label="Delete response from ' + esc(r.name) + '" title="Delete">' + icon('trash') + '</button>' +
    '</div>';
  }

  const needFor = (r) => Math.max(A.week.increment, Math.ceil((Number(r.duration) || 30) / A.week.increment) * A.week.increment);
  const respById = () => new Map(A.responses.map((r) => [r.id, r]));
  const confirmedItems = () => (A.week && A.week.confirmed && A.week.confirmed.items) || [];
  const utcOf = (d, m) => new Date(M.slotIn(M.slotKey(d, m), A.settings.timezone, A.settings.timezone).t).toISOString();

  // Status of one meeting compared with what students were last emailed.
  function statusOf(it) {
    const c = confirmedItems().find((x) => x.id === it.id);
    if (!c) return 'new';
    if (c.date !== it.date || c.start !== it.start || c.end !== it.end) return 'changed';
    return c.sentAt ? 'sent' : 'unsent';
  }
  const STATUS = { sent: '✓ Emailed', unsent: 'Not emailed (no email address)', changed: 'Moved · will email the new time', new: '' };

  function scheduleSec() {
    const sc = A.schedule;
    const st = sc.items.map(statusOf);
    const toSend = st.filter((x) => x === 'new' || x === 'changed').length;
    const isConfirmed = confirmedItems().length && !toSend;
    return '<div class="side-sec">' +
      '<div class="sec-head"><h3>' + (isConfirmed ? 'Confirmed schedule' : 'Schedule') + '</h3>' +
        '<span class="sec-actions"><button class="btn sm ghost icon" data-act="copy-schedule" title="Copy as text" aria-label="Copy as text">' + icon('copy') + '</button>' +
        '<button class="btn sm ghost" data-act="ics" title="Download a calendar file to import into Google Calendar">' + icon('calendar') + '.ics</button></span></div>' +
      (A.placing
        ? '<div class="placing">Click a start time on the grid for <b>' + esc((respById().get(A.placing) || {}).name || '') + '</b>. <button class="linkbtn" data-act="cancel-place">Cancel</button></div>'
        : '<p class="muted small" style="margin-bottom:8px">Drag a meeting on the grid to move it.</p>') +
      (sc.items.length
        ? '<ol class="sched">' + sc.items.map((it, i) =>
            '<li><span class="cdot" style="--c:' + it.color + '"></span><div><b>' + esc(it.name) + '</b>' +
            '<span>' + esc(M.fmtDay(it.date)) + ' · ' + esc(M.fmtRange(it.start, it.end)) + '</span>' +
            (it.outside ? '<span class="warn-t">Outside the times they picked</span>' : '') +
            (STATUS[st[i]] ? '<span class="st st-' + st[i] + '">' + STATUS[st[i]] + '</span>' : '') +
            '</div><button class="btn ghost icon x" data-act="unschedule" data-id="' + esc(it.id) + '" title="Take out of the schedule" aria-label="Take ' + esc(it.name) + ' out of the schedule">' + icon('x') + '</button></li>').join('') + '</ol>'
        : '<p class="muted small">No one is scheduled.</p>') +
      (sc.unfit.length
        ? '<div class="unfit"><b>Not scheduled</b><ul>' + sc.unfit.map((u) =>
            '<li>' + esc(u.name) + ' <span>(' + esc(u.reason) + ')</span> <button class="linkbtn" data-act="place" data-id="' + esc(u.id) + '">Place</button></li>').join('') + '</ul></div>'
        : '') +
      (sc.partial ? '<p class="muted small" style="margin-top:10px">Big group: this is the best arrangement found quickly, and a better one may exist.</p>' : '') +
      '<button class="btn primary block" data-act="confirm" style="margin-top:14px"' + (toSend ? '' : ' disabled') + '>' +
        (toSend ? icon('check') + 'Confirm & email ' + toSend + ' student' + (toSend === 1 ? '' : 's') : 'Everyone has been emailed') + '</button>' +
      '<p class="muted small" style="margin-top:8px">Each student gets their time by email with a calendar file. If you move someone later, only they get an update.</p>' +
    '</div>';
  }

  // Cells, colors and warnings for a list of meetings.
  function finalizeSchedule(items, unfit, partial) {
    const inc = A.week.increment, rmap = respById();
    items.forEach((it) => {
      it.cells = [];
      for (let m = it.start; m < it.end; m += inc) it.cells.push(M.slotKey(it.date, m));
      const mine = new Set((rmap.get(it.id) || { slots: [] }).slots);
      it.outside = it.cells.some((k) => !mine.has(k));
      it.color = colorOf(it.id);
    });
    items.sort((a, b) => (a.date + M.fromMin(a.start)).localeCompare(b.date + M.fromMin(b.start)));
    const byCell = new Map();
    items.forEach((it) => it.cells.forEach((k) => byCell.set(k, it)));
    return { items: items, unfit: unfit, byCell: byCell, partial: !!partial };
  }

  function fromConfirmed() {
    const rmap = respById();
    const items = confirmedItems().filter((x) => rmap.has(x.id))
      .map((x) => ({ id: x.id, name: rmap.get(x.id).name, date: x.date, start: x.start, end: x.end }));
    const placed = new Set(items.map((x) => x.id));
    const unfit = sortedResponses().filter((r) => !placed.has(r.id)).map((r) => ({ id: r.id, name: r.name, reason: 'not scheduled' }));
    return finalizeSchedule(items, unfit, false);
  }

  // Fit each student's requested length into times they marked, with no overlaps, placing as many as
  // possible; among equally full schedules, prefer back-to-back meetings (fewest separate blocks, least idle time).
  function suggest() {
    const w = A.week, offered = new Set(w.slots);
    const people = sortedResponses().map((r) => {
      const set = new Set(r.slots.filter((k) => offered.has(k)));
      const need = needFor(r), inc = w.increment;
      const cands = [];
      Array.from(set).sort().forEach((s0) => {
        const [d, m] = M.splitKey(s0);
        const cells = [];
        for (let i = 0; i < need / inc; i++) {
          const key = M.slotKey(d, m + i * inc);
          if (!set.has(key)) return;
          cells.push(key);
        }
        cands.push({ date: d, start: m, end: m + need, cells: cells });
      });
      return { r: r, need: need, cands: cands, any: set.size > 0 };
    });
    const order = people.filter((p) => p.cands.length).sort((a, b) => a.cands.length - b.cands.length);
    const used = new Set(), cur = [];
    // 1. Most students possible: greedy start, then a bounded exhaustive search.
    const greedy = [];
    order.slice().sort((a, b) => a.need - b.need || a.cands.length - b.cands.length).forEach((p) => {
      const c = p.cands.find((x) => !x.cells.some((k) => used.has(k)));
      if (c) { c.cells.forEach((k) => used.add(k)); greedy.push({ p: p, c: c }); }
    });
    used.clear();
    let best = { n: greedy.length, pick: greedy }, nodes = 0, partial = false;
    (function dfs(i, n) {
      if (best.n === order.length) return;
      if (nodes++ > 1500000) { partial = true; return; }
      if (n + (order.length - i) <= best.n) return;
      if (i === order.length) { best = { n: n, pick: cur.slice() }; return; }
      const p = order[i];
      for (const c of p.cands) {
        if (c.cells.some((x) => used.has(x))) continue;
        c.cells.forEach((x) => used.add(x));
        cur.push({ p: p, c: c });
        dfs(i + 1, n + 1);
        cur.pop();
        c.cells.forEach((x) => used.delete(x));
        if (best.n === order.length) return;
      }
      dfs(i + 1, n); // leave this student out
    })(0, 0);

    // 2. Same number of students, but as back-to-back as possible.
    const score = (pick) => {
      const xs = pick.map((x) => x.c).sort((a, b) => (a.date + M.fromMin(a.start)).localeCompare(b.date + M.fromMin(b.start)));
      let blocks = 0, idle = 0;
      xs.forEach((c, i) => {
        const prev = xs[i - 1];
        if (!prev || prev.date !== c.date || prev.end !== c.start) blocks++;
        if (prev && prev.date === c.date) idle += c.start - prev.end;
      });
      return blocks * 10000 + idle;
    };
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const touches = (c, placed) => placed.some((x) => x.date === c.date && (x.end === c.start || x.start === c.end));
    let bestPick = best.pick, bestScore = score(best.pick);
    const t0 = Date.now();
    for (let it = 0; it < 600 && Date.now() - t0 < 400; it++) {
      const ord = order.slice().sort((a, b) => a.cands.length - b.cands.length + (rand() - 0.5) * 4);
      const occ = new Set(), placed = [], pick = [];
      ord.forEach((p) => {
        const free = p.cands.filter((c) => !c.cells.some((k) => occ.has(k)));
        if (!free.length) return;
        const adj = free.filter((c) => touches(c, placed));
        const pool = adj.length ? adj : free;
        const c = it === 0 ? pool[0] : pool[Math.floor(rand() * Math.min(pool.length, 3))];
        c.cells.forEach((k) => occ.add(k));
        placed.push(c); pick.push({ p: p, c: c });
      });
      if (pick.length === best.n) { const sc = score(pick); if (sc < bestScore) { bestScore = sc; bestPick = pick; } }
    }
    // 3. Polish: move single meetings to any free spot that makes the schedule tighter.
    for (let round = 0, improved = true; improved && round < 60; round++) {
      improved = false;
      for (let i = 0; i < bestPick.length && !improved; i++) {
        const occ = new Set();
        bestPick.forEach((x, j) => { if (j !== i) x.c.cells.forEach((k) => occ.add(k)); });
        for (const c of bestPick[i].p.cands) {
          if (c === bestPick[i].c || c.cells.some((k) => occ.has(k))) continue;
          const trial = bestPick.slice();
          trial[i] = { p: bestPick[i].p, c: c };
          const sc = score(trial);
          if (sc < bestScore) { bestScore = sc; bestPick = trial; improved = true; break; }
        }
      }
    }

    const items = bestPick.map((x) => ({ id: x.p.r.id, name: x.p.r.name, date: x.c.date, start: x.c.start, end: x.c.end }));
    const placedIds = new Set(items.map((x) => x.id));
    const unfit = people.filter((p) => !placedIds.has(p.r.id)).map((p) => ({
      id: p.r.id,
      name: p.r.name,
      reason: !p.any ? 'no times selected' : !p.cands.length ? 'no ' + M.fmtDuration(p.need) + ' stretch free' : 'overlaps with others',
    }));
    return finalizeSchedule(items, unfit, partial);
  }

  // ── editing the schedule by hand ──
  function rangeFree(date, start, end, ignoreId) {
    const inc = A.week.increment;
    for (let m = start; m < end; m += inc) {
      const o = A.schedule.byCell.get(M.slotKey(date, m));
      if (o && o.id !== ignoreId) return false;
    }
    return start >= 0 && end <= 1440;
  }
  function moveItem(id, date, start) {
    const items = A.schedule.items.map((x) => (x.id === id ? { id: x.id, name: x.name, date: date, start: start, end: start + (x.end - x.start) } : x));
    A.schedule = finalizeSchedule(items, A.schedule.unfit, A.schedule.partial);
    render();
  }
  function placeAt(date, start) {
    const r = respById().get(A.placing);
    if (!r) { A.placing = null; render(); return; }
    const end = start + needFor(r);
    if (!rangeFree(date, start, end, null)) { M.toast('That overlaps another meeting.'); return; }
    const items = A.schedule.items.concat([{ id: r.id, name: r.name, date: date, start: start, end: end }]);
    const unfit = A.schedule.unfit.filter((u) => u.id !== r.id);
    A.placing = null;
    A.schedule = finalizeSchedule(items, unfit, A.schedule.partial);
    render();
  }
  function unschedule(id) {
    const it = A.schedule.items.find((x) => x.id === id);
    if (!it) return;
    const items = A.schedule.items.filter((x) => x.id !== id);
    const unfit = A.schedule.unfit.concat([{ id: it.id, name: it.name, reason: 'taken out by you' }]);
    A.schedule = finalizeSchedule(items, unfit, A.schedule.partial);
    render();
  }

  // Drag a meeting to a new start time on the schedule grid (or click a time while placing someone).
  function attachMove(cal) {
    const body = cal.querySelector('.cal-body');
    let mv = null;
    const cellAt = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); const c = el && el.closest('.cell'); return c && body.contains(c) ? c : null; };
    const clear = () => body.querySelectorAll('.drop, .drop-bad').forEach((c) => c.classList.remove('drop', 'drop-bad'));
    const plan = (cell) => {
      const [d, m] = M.splitKey(cell.dataset.k);
      const len = mv.item.end - mv.item.start, start = m - mv.offset;
      const cells = [];
      for (let t = start; t < start + len; t += A.week.increment) {
        const c = body.querySelector('.cell[data-k="' + M.slotKey(d, t) + '"]');
        if (!c) return { ok: false, cells: [cell] };
        cells.push(c);
      }
      return { ok: rangeFree(d, start, start + len, mv.item.id), cells: cells, date: d, start: start };
    };
    body.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell || e.button !== 0) return;
      if (A.placing) { e.preventDefault(); const [d, m] = M.splitKey(cell.dataset.k); placeAt(d, m); return; }
      const it = A.schedule.byCell.get(cell.dataset.k);
      if (!it) return;
      e.preventDefault();
      body.setPointerCapture(e.pointerId);
      mv = { item: it, offset: M.splitKey(cell.dataset.k)[1] - it.start, last: null, plan: null };
      cal.classList.add('grabbing');
    });
    body.addEventListener('pointermove', (e) => {
      if (!mv) return;
      const c = cellAt(e);
      if (!c || c === mv.last) return;
      mv.last = c;
      clear();
      mv.plan = plan(c);
      mv.plan.cells.forEach((x) => x.classList.add(mv.plan.ok ? 'drop' : 'drop-bad'));
    });
    const end = () => {
      if (!mv) return;
      const p = mv.plan, it = mv.item;
      mv = null; clear(); cal.classList.remove('grabbing');
      if (!p) return;
      if (!p.ok) { M.toast('That time overlaps another meeting or runs off the grid.'); return; }
      if (p.date !== it.date || p.start !== it.start) moveItem(it.id, p.date, p.start);
    };
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', () => { mv = null; clear(); cal.classList.remove('grabbing'); });
  }

  // ── confirm & export ──
  async function confirmSchedule() {
    const sc = A.schedule;
    if (!sc || !sc.items.length) return;
    const toSend = sc.items.filter((it) => ['new', 'changed'].includes(statusOf(it)));
    if (!toSend.length) { M.toast('Everyone already has their current time.'); return; }
    const lines = toSend.map((it) => '• ' + it.name + ': ' + M.fmtDay(it.date) + ', ' + M.fmtRange(it.start, it.end) + (statusOf(it) === 'changed' ? ' (moved)' : ''));
    if (!confirm('Email ' + toSend.length + ' student' + (toSend.length === 1 ? '' : 's') + ' their meeting time?\n\n' + lines.join('\n') +
      (sc.unfit.length ? '\n\nNot scheduled, no email: ' + sc.unfit.map((u) => u.name).join(', ') : ''))) return;
    const id = A.weekId, seq = loadSeq;
    const items = sc.items.map((it) => ({ id: it.id, date: it.date, start: it.start, end: it.end, startUtc: utcOf(it.date, it.start), endUtc: utcOf(it.date, it.end) }));
    setBusy(true);
    try {
      const res = await M.api.confirm(A.key, id, items);
      if (!stillOn(id, seq)) return;
      A.week = res.week;
      cacheNow();
      A.schedule = fromConfirmed();
      A.view = 'schedule';
      render();
      M.toast(M.DEMO ? 'Demo: confirmed (no emails in demo mode)' : 'Emailed ' + res.emailed.length + ' student' + (res.emailed.length === 1 ? '' : 's'));
      if (res.skipped && res.skipped.length) alert('Not emailed:\n' + res.skipped.map((x) => '• ' + (x.name || '?') + ': ' + x.reason).join('\n'));
    } catch (e) {
      setBusy(false);
      M.toast(e.message);
    }
  }

  function downloadIcs() {
    const sc = A.schedule, rmap = respById();
    if (!sc || !sc.items.length) return;
    const events = sc.items.map((it) => {
      const r = rmap.get(it.id) || {};
      return {
        uid: A.weekId + '-' + it.id + '-host', start: utcOf(it.date, it.start), end: utcOf(it.date, it.end),
        title: 'Meeting: ' + it.name,
        desc: ['Topic: ' + (r.topic || ''), 'Time needed: ' + M.fmtDuration(r.duration || 0), r.email ? 'Email: ' + r.email : ''].filter(Boolean).join('\n'),
      };
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([M.ics(events)], { type: 'text/calendar' }));
    a.download = 'meetings-' + A.weekId + '.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    M.toast('Downloaded. In Google Calendar: Settings → Import & export → Import');
  }

  function scheduleText() {
    const sc = A.schedule;
    const lines = [A.settings.title + ' · ' + M.fmtWeekRange(A.weekId) + ' (' + M.tzLabel(A.settings.timezone) + ')', ''];
    sc.items.forEach((it) => lines.push(M.fmtDay(it.date) + '  ' + M.fmtRange(it.start, it.end) + '  ' + it.name));
    if (sc.unfit.length) lines.push('', 'Not scheduled: ' + sc.unfit.map((u) => u.name).join(', '));
    return lines.join('\n');
  }

  async function refresh(msg) {
    const id = A.weekId, seq = loadSeq;
    setBusy(true);
    try {
      const d = await M.api.adminLoad(A.key, id);
      if (!stillOn(id, seq)) return;
      A.responses = d.responses || [];
      if (!A.dirty) { A.week = d.week; A.draft = makeDraft(d.week); }
      A.focus = null; A.placing = null;
      A.schedule = A.week && A.week.confirmed ? fromConfirmed() : null;
      A.view = A.schedule ? 'schedule' : 'heat';
      cacheNow();
      render();
      M.toast(msg || 'Up to date');
    } catch (e) {
      setBusy(false);
      M.toast(e.message);
    }
  }

  async function deleteResp(id) {
    const r = A.responses.find((x) => x.id === id);
    if (!r || !confirm('Delete ' + r.name + '’s response? This can’t be undone.')) return;
    const week = A.weekId, seq = loadSeq;
    try {
      await M.api.deleteResponse(A.key, week, id);
      if (!stillOn(week, seq)) { M.store.del(cacheKey(week)); return; }
      A.responses = A.responses.filter((x) => x.id !== id);
      if (A.focus === id) A.focus = null;
      A.schedule = A.week && A.week.confirmed ? fromConfirmed() : null;
      A.view = A.schedule ? 'schedule' : 'heat';
      cacheNow();
      render();
      M.toast('Response deleted');
    } catch (e) {
      M.toast(e.message);
    }
  }

  // ───────────── events from your calendars (drawn as solid blocks on the grid) ─────────────
  async function loadBusy(id, fresh) {
    if (M.DEMO || (A.busy[id] && (!fresh || A.busy[id].loading))) return;
    A.busy[id] = { list: [], errors: [], loading: true };
    let entry;
    try {
      const d = await M.api.busy(A.key, id, fresh); // the server keeps answers for 10 minutes unless fresh
      entry = { list: d.busy || [], errors: d.errors || [] };
    } catch (e) {
      // An older backend without calendar support answers "Unknown action": just show nothing.
      entry = { list: [], errors: /unknown action/i.test(e.message) ? [] : [{ id: '', reason: e.message }] };
    }
    A.busy[id] = entry;
    if (A.weekId === id && A.tab === 'avail') {
      renderBusyBlocks();
      const lg = document.getElementById('busy-legend');
      if (lg) { lg.innerHTML = busyLegend(); lg.classList.toggle('warn', !!entry.errors.length); }
    }
  }

  // One block per event (split at midnight), positioned over the day's column.
  function renderBusyBlocks() {
    const cal = document.querySelector('.cal.paint');
    if (!cal) return;
    cal.querySelectorAll('.bz').forEach((el) => el.remove());
    const b = A.busy[A.weekId];
    if (!b || !b.list.length) return;
    const r0 = Number(cal.dataset.start), r1 = Number(cal.dataset.end), inc = Number(cal.dataset.inc), rh = Number(cal.dataset.rh);
    const px = (min) => ((min - r0) / inc) * rh;
    cal.querySelectorAll('.col').forEach((col) => {
      const d = col.dataset.date, next = M.addDays(d, 1);
      b.list.forEach((ev) => {
        if (ev.end <= d + 'T00:00' || ev.start >= next + 'T00:00') return;
        const s0 = ev.start.slice(0, 10) < d ? 0 : M.toMin(ev.start.slice(11, 16));
        const e0 = ev.end.slice(0, 10) > d ? 1440 : M.toMin(ev.end.slice(11, 16));
        const a = Math.max(s0, r0), z = Math.min(e0, r1);
        if (z <= a) return;
        const h = px(z) - px(a);
        const el = document.createElement('div');
        el.className = 'bz' + (h < 26 ? ' short' : '');
        el.style.top = px(a) + 'px';
        el.style.height = Math.max(h - 2, 6) + 'px';
        el.dataset.s = M.slotKey(d, s0);
        el.dataset.e = d + 'T' + M.fromMin(e0);
        el.innerHTML = '<span class="bz-t">' + esc(ev.title || 'Busy') + '</span>' +
          (h >= 26 ? '<span class="bz-time">' + esc(M.fmtRange(s0, e0)) + '</span>' : '');
        col.appendChild(el);
      });
    });
    updateBusyConflicts();
  }
  // Red edge on events that overlap times you're offering.
  function updateBusyConflicts() {
    const inc = A.draft.increment;
    document.querySelectorAll('.cal.paint .bz').forEach((el) => {
      const s0 = el.dataset.s, e0 = el.dataset.e;
      let hit = false;
      A.draft.slots.forEach((k) => {
        if (hit) return;
        const [d, m] = M.splitKey(k);
        if (k < e0 && d + 'T' + M.fromMin(m + inc) > s0) hit = true;
      });
      el.classList.toggle('conflict', hit);
    });
  }
  function busyErrors() { return (A.busy[A.weekId] || {}).errors || []; }
  const BUSY_REFRESH = '<button type="button" class="linkbtn" data-act="busy-refresh" title="Calendar events are kept for up to 10 minutes">Refresh</button>';
  function busyLegend() {
    const b = A.busy[A.weekId];
    if (!b || b.loading) return '';
    if (b.errors.length) {
      const e = b.errors[0];
      const msg = e.reason === 'notFound' || e.reason === 'notAuthorized'
        ? 'Can’t see ' + e.id + '. Share it with this Google account (“See all event details” shows titles)'
        : e.reason;
      return icon('calendar') + '<span title="' + esc(msg) + '">' + esc(msg.length > 90 ? msg.slice(0, 90) + '…' : msg) + '</span>' + BUSY_REFRESH;
    }
    if (!b.list.length) return String(A.settings.calendars || '').trim() ? '<span>No calendar events this week.</span>' + BUSY_REFRESH : '';
    return '<span class="sw"></span><span>Shaded blocks are events on your calendar. A red edge means one overlaps time you’re offering.</span>' + BUSY_REFRESH;
  }

  // ───────────── week grid ─────────────
  function gridDays(slots) {
    const weekend = A.settings.weekends || slots.some((k) => [0, 6].includes(M.dow(k.slice(0, 10))));
    return Array.from({ length: weekend ? 7 : 5 }, (_, i) => M.addDays(A.weekId, i));
  }
  function gridRange(slots, inc) {
    let s = M.toMin(A.settings.dayStart), e = M.toMin(A.settings.dayEnd);
    slots.forEach((k) => {
      const m = M.toMin(k.slice(11));
      s = Math.min(s, m - (m % 60));
      e = Math.max(e, Math.ceil((m + inc) / 60) * 60);
    });
    return [s, Math.min(e, 1440)];
  }

  function dayHead(d, today) {
    const hol = M.holiday(d);
    return '<div class="dh' + (d === today ? ' today' : '') + (hol ? ' hol" title="' + esc(hol) + ' (US federal holiday)' : '') + '">' +
      M.DOW[M.dow(d)] + '<b>' + Number(d.slice(8)) + '</b>' + (hol ? '<span class="hol-tag">' + esc(hol) + '</span>' : '') + '</div>';
  }

  function mountGrid() {
    const host = document.getElementById('grid');
    if (!host) return;
    const isAvail = A.tab === 'avail';
    const inc = isAvail ? A.draft.increment : A.week.increment;
    const slots = isAvail ? Array.from(A.draft.slots) : A.week.slots;
    const days = gridDays(slots);
    const range = gridRange(slots, inc);
    const today = M.localToday();
    let h = '<div class="cal' + (isAvail ? ' paint' : '') + (inc === 15 ? ' small' : '') + '" data-start="' + range[0] + '" data-end="' + range[1] +
      '" data-inc="' + inc + '" data-rh="' + (inc === 15 ? 13 : 24) + '" style="--days:' + days.length + ';--rh:' + (inc === 15 ? 13 : 24) + 'px">';
    h += '<div class="cal-head"><div class="tzc" title="Times in ' + esc(M.tzLabel(A.settings.timezone)) + '">' + esc(M.tzShort(A.settings.timezone)) + '</div>' + days.map((d) =>
      dayHead(d, today)).join('') + '</div>';
    h += '<div class="cal-body"><div class="tcol">';
    for (let m = range[0]; m < range[1]; m += inc) h += '<div class="t">' + (m % 60 === 0 ? '<span>' + M.fmtHour(m) + '</span>' : '') + '</div>';
    h += '</div>';
    days.forEach((d) => {
      h += '<div class="col' + (M.holiday(d) ? ' hol' : '') + '" data-date="' + d + '">';
      for (let m = range[0]; m < range[1]; m += inc) {
        h += '<div class="cell' + (m % 60 === 0 ? ' h' : m % 30 === 0 ? ' hh' : '') + '" data-k="' + M.slotKey(d, m) + '"></div>';
      }
      h += '</div>';
    });
    h += '</div></div>';
    host.innerHTML = h;

    const cal = host.firstChild;
    if (isAvail) {
      cal.querySelectorAll('.col').forEach(paintAvailCol);
      if (!A.busy[A.weekId]) loadBusy(A.weekId); else renderBusyBlocks();
      M.drag.attach(cal.querySelector('.cal-body'), {
        selector: '.cell',
        touch: !coarse,
        isOn: (el) => A.draft.slots.has(el.dataset.k),
        set: (el, on) => {
          A.dirty = true;
          if (on) A.draft.slots.add(el.dataset.k); else A.draft.slots.delete(el.dataset.k);
        },
        after: () => { cal.querySelectorAll('.col').forEach(paintAvailCol); updateBusyConflicts(); },
        onEnd: () => markDirty(),
      });
    } else {
      paintResp(cal);
      attachTooltip(cal);
      if (A.view === 'schedule' && A.schedule) { cal.classList.add('sched'); attachMove(cal); }
    }
  }

  function paintAvailCol(col) {
    const cells = col.querySelectorAll(':scope > .cell'), inc = A.draft.increment;
    const on = (i) => i >= 0 && i < cells.length && A.draft.slots.has(cells[i].dataset.k);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], o = on(i);
      c.classList.toggle('on', o);
      c.classList.toggle('top', o && !on(i - 1));
      c.classList.toggle('bot', o && !on(i + 1));
      let lbl = '';
      if (o && !on(i - 1)) {
        let j = i;
        while (on(j + 1)) j++;
        const len = (j - i + 1) * inc;
        if (len >= 30) { const s = M.splitKey(c.dataset.k)[1]; lbl = '<span class="lbl">' + M.fmtRange(s, s + len) + '</span>'; }
      }
      if (c.innerHTML !== lbl) c.innerHTML = lbl;
    }
  }

  function paintResp(cal) {
    const offered = new Set(A.week.slots);
    const who = new Map();
    A.responses.forEach((r) => r.slots.forEach((k) => {
      if (!offered.has(k)) return;
      if (!who.has(k)) who.set(k, []);
      who.get(k).push(r.name);
    }));
    A.who = who;
    const max = Math.max(1, A.responses.length);
    const focus = A.focus && A.responses.find((r) => r.id === A.focus);
    const focusSet = focus ? new Set(focus.slots) : null;
    const sched = A.view === 'schedule' && A.schedule ? A.schedule.byCell : null;
    // Group identity per cell decides where blocks get rounded ends.
    const grp = (k) => (sched && sched.has(k) ? sched.get(k) : offered.has(k) ? 'free' : null);

    cal.querySelectorAll('.col').forEach((col) => {
      const cells = col.querySelectorAll(':scope > .cell');
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i], k = c.dataset.k, g = grp(k);
        c.classList.remove('offer', 'as', 'top', 'bot', 'mine');
        c.innerHTML = '';
        if (!g) continue;
        const prev = i > 0 ? grp(cells[i - 1].dataset.k) : null;
        const next = i < cells.length - 1 ? grp(cells[i + 1].dataset.k) : null;
        if (prev !== g) c.classList.add('top');
        if (next !== g) c.classList.add('bot');
        if (g !== 'free') {
          c.classList.add('as');
          c.style.setProperty('--c', g.color);
          if (prev !== g) c.innerHTML = '<span class="lbl">' + (g.outside ? '⚠ ' : '') + esc(g.name) + '</span>';
          continue;
        }
        c.classList.add('offer');
        let p = 0;
        if (sched) p = 0;
        else if (focusSet) p = focusSet.has(k) ? 100 : 0;
        else { const n = (who.get(k) || []).length; p = n ? Math.round(25 + (75 * n) / max) : 0; }
        c.style.setProperty('--p', p + '%');
      }
    });
  }

  function attachTooltip(cal) {
    let tip = document.getElementById('tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'tip'; tip.className = 'tip'; tip.hidden = true;
      document.body.appendChild(tip);
    }
    const body = cal.querySelector('.cal-body');
    body.addEventListener('pointermove', (e) => {
      const c = e.target.closest('.cell');
      if (!c || !(c.classList.contains('offer') || c.classList.contains('as'))) { tip.hidden = true; return; }
      const k = c.dataset.k;
      const [d, m] = M.splitKey(k);
      let html = '<b>' + esc(M.fmtDay(d)) + ' · ' + esc(M.fmtRange(m, m + A.week.increment)) + '</b><br>';
      const a = A.schedule && A.view === 'schedule' && A.schedule.byCell.get(k);
      if (a) {
        html += esc(a.name) + ' · ' + esc(M.fmtRange(a.start, a.end));
      } else {
        const names = A.who.get(k) || [];
        html += names.length + ' of ' + A.responses.length + ' free';
        if (names.length) html += '<br>' + names.map(esc).join(', ');
        const not = A.responses.map((r) => r.name).filter((n) => !names.includes(n));
        if (names.length && not.length) html += '<br><span class="dim">Not: ' + not.map(esc).join(', ') + '</span>';
      }
      tip.innerHTML = html;
      tip.hidden = false;
      tip.style.left = Math.max(8, Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8)) + 'px';
      tip.style.top = Math.max(8, Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 8)) + 'px';
    });
    body.addEventListener('pointerleave', () => { tip.hidden = true; });
  }

  // ───────────── settings dialog ─────────────
  function openSettings() {
    const s = A.settings;
    const old = document.getElementById('settings-dlg');
    if (old) old.remove();
    const dlg = document.createElement('dialog');
    dlg.id = 'settings-dlg';
    let tzs = [];
    try { tzs = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []; } catch (e) { tzs = []; }
    if (tzs.length && !tzs.includes(s.timezone)) tzs.unshift(s.timezone);
    const hourOpts = (sel, from, to) => {
      let o = '';
      for (let h = from; h <= to; h++) {
        const v = M.pad(h) + ':00';
        o += '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + (h === 24 ? 'Midnight' : M.fmtHour(h * 60)) + '</option>';
      }
      return o;
    };
    dlg.innerHTML =
      '<form method="dialog">' +
        '<div class="dlg-head"><h2>Settings</h2><button type="button" class="btn ghost icon" data-dact="close" aria-label="Close">' + icon('x') + '</button></div>' +
        '<div class="dlg-body">' +
          '<div class="field"><label for="s-name">Your name <span class="opt">shown to students</span></label>' +
            '<input class="input" id="s-name" name="name" maxlength="80" value="' + esc(s.name) + '" placeholder="e.g. Prof. Smith"></div>' +
          '<div class="field"><label for="s-title">Meeting title</label>' +
            '<input class="input" id="s-title" name="title" maxlength="80" value="' + esc(s.title) + '"></div>' +
          '<div class="field"><label for="s-tz">Time zone</label>' +
            (tzs.length
              ? '<select class="input" id="s-tz" name="timezone">' + tzs.map((z) => '<option' + (z === s.timezone ? ' selected' : '') + '>' + esc(z) + '</option>').join('') + '</select>'
              : '<input class="input" id="s-tz" name="timezone" value="' + esc(s.timezone) + '">') +
            '<span class="help">Your times are set in this zone; students see them converted to their own. Changing it keeps the clock times of weeks you’ve already published, so students would see those weeks shifted.</span>' +
          '</div>' +
          '<div class="row2">' +
            '<div class="field"><label for="s-start">Calendar starts</label><select class="input" id="s-start" name="dayStart">' + hourOpts(s.dayStart, 0, 23) + '</select></div>' +
            '<div class="field"><label for="s-end">Calendar ends</label><select class="input" id="s-end" name="dayEnd">' + hourOpts(s.dayEnd, 1, 24) + '</select></div>' +
          '</div>' +
          '<label class="check"><input type="checkbox" name="weekends"' + (s.weekends ? ' checked' : '') + '> Show weekends</label>' +
          (M.DEMO ? '' :
            '<div class="field"><label for="s-cal">Calendars to show as busy</label>' +
              '<input class="input" id="s-cal" name="calendars" maxlength="500" value="' + esc(s.calendars) + '" placeholder="primary">' +
              '<span class="help">“primary” is this Google account’s own calendar. To add another calendar (e.g. BC), share it with this Google account, then add its address here, separated by commas. Share with “See all event details” to see event titles, or “See only free/busy” to see just busy blocks.</span></div>' +
            '<label class="check"><input type="checkbox" name="notify"' + (s.notify ? ' checked' : '') + '> Email me when a student responds</label>' +
            '<div class="field"><label for="s-notify">Send these alerts to</label>' +
              '<input class="input" id="s-notify" name="notifyTo" type="email" maxlength="120" value="' + esc(s.notifyTo || '') + '" placeholder="The Google account that owns the script">' +
              '<span class="help">Leave empty to use the Google account that owns the script.</span></div>') +
        '</div>' +
        '<div class="dlg-foot">' +
          (M.DEMO
            ? '<button type="button" class="linkbtn" data-dact="reset">Reset demo data</button>'
            : '<button type="button" class="linkbtn" data-dact="signout">Sign out on this browser</button>') +
          '<div class="right"><button type="button" class="btn ghost" data-dact="close">Cancel</button><button class="btn primary" value="save">Save</button></div>' +
        '</div>' +
      '</form>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dact]');
      if (!b) return;
      if (b.dataset.dact === 'reset' && confirm('Delete all demo weeks and responses saved in this browser?')) {
        M.store.del('meet-demo-db');
        A.dirty = false;
        location.reload();
      }
      if (b.dataset.dact === 'signout') { M.store.del('meet-admin-key'); clearAdminCache(); A.dirty = false; location.reload(); }
      if (b.dataset.dact === 'close') dlg.close('cancel');
    });
    dlg.addEventListener('close', async () => {
      if (dlg.returnValue !== 'save') return;
      const f = dlg.querySelector('form').elements;
      const next = {
        name: f.namedItem('name').value,
        title: f.namedItem('title').value,
        timezone: f.namedItem('timezone').value,
        dayStart: f.namedItem('dayStart').value,
        dayEnd: f.namedItem('dayEnd').value,
        weekends: f.namedItem('weekends').checked,
        ...(M.DEMO ? {} : { calendars: f.namedItem('calendars').value, notify: f.namedItem('notify').checked, notifyTo: f.namedItem('notifyTo').value }),
      };
      if (M.toMin(next.dayEnd) <= M.toMin(next.dayStart)) { M.toast('The calendar has to end after it starts.'); return; }
      if (next.timezone !== s.timezone && !confirm('Change your time zone to ' + M.tzLabel(next.timezone) + '? Weeks you’ve already published keep their clock times, so students will see them shifted by the time difference.')) return;
      try {
        const res = await M.api.saveSettings(A.key, next);
        A.settings = res.settings;
        A.busy = {}; // calendars may have changed
        dropPrefetch();
        cacheNow();
        render();
        M.toast('Settings saved');
      } catch (e) {
        M.toast(e.message);
      }
    });
    dlg.showModal();
  }

  // ───────────── events ─────────────
  function go(id) {
    if (A.dirty && !confirm('You have unsaved changes for this week. Leave without saving?')) return;
    load(id);
  }

  root.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { A.tab = tab.dataset.tab; syncUrl(); render(); return; }
    const inc = e.target.closest('[data-inc]');
    if (inc) { if (!inc.disabled) setIncrement(Number(inc.dataset.inc)); return; }
    const view = e.target.closest('[data-view]');
    if (view) { if (!view.disabled) { A.view = view.dataset.view; A.focus = null; render(); } return; }
    const act = e.target.closest('[data-act]');
    if (act) { onAct(act.dataset.act, act, e); return; }
    if (e.target.closest('a')) return;
    const card = e.target.closest('[data-rid]');
    if (card) {
      A.focus = A.focus === card.dataset.rid ? null : card.dataset.rid;
      if (A.focus) A.view = 'heat';
      render();
    }
  });
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-rid]')) { e.preventDefault(); e.target.click(); }
  });
  root.addEventListener('input', (e) => {
    const f = e.target.dataset && e.target.dataset.field;
    if (!f) return;
    if (f === 'note') A.draft.note = e.target.value;
    if (f === 'minMinutes') {
      A.draft.minMinutes = Number(e.target.value);
      const hint = document.getElementById('minhint');
      if (hint) hint.textContent = minHint();
    }
    markDirty();
  });

  function onAct(name, el, e) {
    switch (name) {
      case 'prev': return go(M.addDays(A.weekId, -7));
      case 'next': return go(M.addDays(A.weekId, 7));
      case 'this-week': return go(defaultWeek());
      case 'settings': return openSettings();
      case 'save': return save();
      case 'copy-last': return copyLast();
      case 'clear':
        if (A.draft.slots.size && confirm('Clear all of this week’s times?')) { A.draft.slots.clear(); markDirty(); render(); }
        return;
      case 'copy-link':
        M.copyText(studentLink()).then((ok) => M.toast(ok ? 'Link copied' : 'Couldn’t copy. Select the link and copy it.'));
        return;
      case 'toggle-open':
        A.draft.open = !A.draft.open;
        el.setAttribute('aria-checked', A.draft.open);
        markDirty();
        return;
      case 'busy-refresh': {
        loadBusy(A.weekId, true); // replaces this week's events with a loading entry right away
        renderBusyBlocks();
        const lg = document.getElementById('busy-legend');
        if (lg) { lg.classList.remove('warn'); lg.innerHTML = '<span>Checking your calendar…</span>'; }
        return;
      }
      case 'refresh':
        return refresh();
      case 'samples':
        try { M.demoAddSamples(A.weekId); } catch (err) { M.toast(err.message); return; }
        return refresh('Added 4 sample students. Try Suggest schedule');
      case 'suggest':
        if (A.schedule && confirmedItems().length && !confirm('Replace your schedule with a new suggestion? Nothing is emailed until you confirm.')) return;
        A.schedule = suggest(); A.view = 'schedule'; A.focus = null; A.placing = null; render();
        return;
      case 'confirm':
        return confirmSchedule();
      case 'ics':
        return downloadIcs();
      case 'unschedule':
        return unschedule(el.dataset.id);
      case 'place':
        A.placing = el.dataset.id; A.view = 'schedule'; render();
        return;
      case 'cancel-place':
        A.placing = null; render();
        return;
      case 'copy-schedule':
        M.copyText(scheduleText()).then((ok) => M.toast(ok ? 'Schedule copied' : 'Couldn’t copy'));
        return;
      case 'unfocus':
        A.focus = null; render();
        return;
      case 'delete':
        e.stopPropagation();
        return deleteResp(el.dataset.id);
    }
  }

  // Start last, so every helper above is defined before the first render.
  if (!A.key) renderLogin(); else load(A.weekId);
})();
