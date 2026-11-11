/* Admin page: paint weekly availability, publish a link, read responses, suggest a schedule. */
(function () {
  'use strict';
  const M = window.Meet;
  const { esc, icon } = M;
  const root = document.getElementById('app');
  const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#84cc16', '#f97316'];

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
  };

  const qs = new URLSearchParams(location.search);
  const qWeek = qs.get('week');
  A.weekId = qWeek && /^\d{4}-\d{2}-\d{2}$/.test(qWeek) ? M.mondayOf(qWeek) : defaultWeek();
  if (qs.get('tab') === 'responses') A.tab = 'resp';

  window.addEventListener('beforeunload', (e) => { if (A.dirty) { e.preventDefault(); e.returnValue = ''; } });

  if (!A.key) renderLogin(); else load(A.weekId);

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
      : { increment: A.settings.increment, minMinutes: A.settings.minMinutes, slots: new Set(), open: true, note: '' };
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
  async function load(id) {
    const first = !A.settings;
    if (first) root.innerHTML = '<div class="center"><div class="spinner" aria-label="Loading"></div></div>';
    else setBusy(true);
    try {
      const d = await M.api.adminLoad(A.key, id);
      if (!M.DEMO) M.store.set('meet-admin-key', A.key);
      A.settings = d.settings;
      A.weekId = id;
      A.week = d.week;
      A.responses = d.responses || [];
      A.draft = makeDraft(d.week);
      A.dirty = false; A.focus = null; A.schedule = null; A.view = 'heat';
      syncUrl();
      render();
    } catch (e) {
      if (/admin key/i.test(e.message)) {
        A.key = ''; M.store.del('meet-admin-key');
        renderLogin(e.message);
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
  function offeredStats() {
    const s = Array.from(A.draft.slots);
    return { total: M.fmtDuration(s.length * A.draft.increment), days: new Set(s.map((k) => k.slice(0, 10))).size };
  }

  function availView() {
    const d = A.draft;
    const locked = A.responses.length > 0;
    const mins = [30, 45, 60, 75, 90, 120, 150, 180].filter((m) => m % d.increment === 0);
    if (!mins.includes(d.minMinutes)) { mins.push(d.minMinutes); mins.sort((a, b) => a - b); }
    const st = offeredStats();
    return '<div class="layout">' +
      '<section class="panel">' +
        '<div class="toolbar">' +
          '<div class="seg" role="group" aria-label="Slot length">' +
            [15, 30].map((n) => '<button data-inc="' + n + '" aria-pressed="' + (d.increment === n) + '"' +
              (locked && d.increment !== n ? ' disabled title="Students already responded using ' + d.increment + '-min slots"' : '') +
              '>' + n + ' min</button>').join('') +
          '</div>' +
          '<span class="hint muted">Click and drag to mark when you’re free</span>' +
          '<span class="spacer"></span>' +
          '<button class="btn sm ghost" data-act="copy-last">' + icon('copy') + 'Copy last week</button>' +
          '<button class="btn sm ghost" data-act="clear">Clear</button>' +
          '<button class="btn sm primary" data-act="save" id="save"' + (A.week && !A.dirty ? ' disabled' : '') + '>' + (A.week ? 'Save' : 'Publish') + '</button>' +
        '</div>' +
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
            mins.map((m) => '<option value="' + m + '"' + (m === d.minMinutes ? ' selected' : '') + '>' + Math.ceil(m / d.increment) + ' slots (' + M.fmtDuration(m) + ')</option>').join('') +
          '</select>' +
          '<p class="muted small" id="minhint" style="margin-top:6px">' + minHint() + '</p>' +
        '</div>' +
        '<div class="side-sec"><h3><label for="note">Note to students</label><span class="opt">optional</span></h3>' +
          '<textarea class="input" id="note" data-field="note" rows="3" maxlength="1000" placeholder="e.g. I’m traveling Thursday, so times are tight this week.">' + esc(d.note) + '</textarea>' +
        '</div>' +
        '<div class="side-sec stats">' +
          '<div class="stat"><b id="st-total">' + st.total + '</b><span>offered</span></div>' +
          '<div class="stat"><b id="st-days">' + st.days + '</b><span>day' + (st.days === 1 ? '' : 's') + '</span></div>' +
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
  function updateStats() {
    const st = offeredStats();
    const t = document.getElementById('st-total'), d = document.getElementById('st-days');
    if (t) t.textContent = st.total;
    if (d) { d.textContent = st.days; d.nextElementSibling.textContent = st.days === 1 ? 'day' : 'days'; }
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
    const btn = document.getElementById('save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    const first = !A.week;
    try {
      const res = await M.api.saveWeek(A.key, {
        id: A.weekId, increment: d.increment, minMinutes: d.minMinutes, slots: Array.from(d.slots), open: d.open, note: d.note,
      });
      A.week = res.week;
      A.draft = makeDraft(res.week);
      A.dirty = false;
      A.settings.increment = res.week.increment;
      A.settings.minMinutes = res.week.minMinutes;
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
    const prev = M.addDays(A.weekId, -7);
    try {
      const d = await M.api.adminLoad(A.key, prev);
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
          '<button class="btn sm primary" data-act="suggest"' + (n ? '' : ' disabled') + '>' + icon('sparkles') + 'Suggest schedule</button>' +
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

  function scheduleSec() {
    const sc = A.schedule;
    return '<div class="side-sec">' +
      '<div class="sec-head"><h3>Suggested schedule</h3><button class="btn sm ghost" data-act="copy-schedule">' + icon('copy') + 'Copy</button></div>' +
      (sc.items.length
        ? '<ol class="sched">' + sc.items.map((it) =>
            '<li><span class="cdot" style="--c:' + it.color + '"></span><div><b>' + esc(it.name) + '</b>' +
            '<span>' + esc(M.fmtDay(it.date)) + ' · ' + esc(M.fmtRange(it.start, it.end)) + '</span></div></li>').join('') + '</ol>'
        : '<p class="muted small">No one could be placed.</p>') +
      (sc.unfit.length ? '<div class="unfit"><b>Couldn’t fit:</b> ' + sc.unfit.map((u) => esc(u.name) + ' (' + esc(u.reason) + ')').join('; ') + '</div>' : '') +
      '<p class="muted small" style="margin-top:10px">A starting point only. Students aren’t notified, so send them their times.</p>' +
    '</div>';
  }

  // Fit each student's requested length into times they marked, with no overlaps, placing as many as possible.
  function suggest() {
    const w = A.week, inc = w.increment, offered = new Set(w.slots);
    const people = sortedResponses().map((r, idx) => {
      const set = new Set(r.slots.filter((k) => offered.has(k)));
      const need = Math.max(inc, Math.ceil((Number(r.duration) || 30) / inc) * inc);
      const cands = [];
      Array.from(set).sort().forEach((s) => {
        const [d, m] = M.splitKey(s);
        const cells = [];
        for (let i = 0; i < need / inc; i++) {
          const key = M.slotKey(d, m + i * inc);
          if (!set.has(key)) return;
          cells.push(key);
        }
        cands.push({ date: d, start: m, end: m + need, cells: cells });
      });
      return { r: r, need: need, cands: cands, color: COLORS[idx % COLORS.length], any: set.size > 0 };
    });
    const order = people.filter((p) => p.cands.length).sort((a, b) => a.cands.length - b.cands.length);
    const used = new Set(), cur = [];
    let best = { n: -1, pick: [] }, nodes = 0;
    (function dfs(i, n) {
      if (best.n === order.length || nodes++ > 300000) return;
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

    const items = best.pick
      .map((x) => ({ id: x.p.r.id, name: x.p.r.name, date: x.c.date, start: x.c.start, end: x.c.end, cells: x.c.cells, color: x.p.color }))
      .sort((a, b) => (a.date + M.fromMin(a.start)).localeCompare(b.date + M.fromMin(b.start)));
    const placed = new Set(items.map((x) => x.id));
    const unfit = people.filter((p) => !placed.has(p.r.id)).map((p) => ({
      name: p.r.name,
      reason: !p.any ? 'no times selected' : !p.cands.length ? 'no ' + M.fmtDuration(p.need) + ' stretch free' : 'overlaps with others',
    }));
    const byCell = new Map();
    items.forEach((it) => it.cells.forEach((k) => byCell.set(k, it)));
    return { items: items, unfit: unfit, byCell: byCell };
  }

  function scheduleText() {
    const sc = A.schedule;
    const lines = [A.settings.title + ' · ' + M.fmtWeekRange(A.weekId), ''];
    sc.items.forEach((it) => lines.push(M.fmtDay(it.date) + '  ' + M.fmtRange(it.start, it.end) + '  ' + it.name));
    if (sc.unfit.length) lines.push('', 'Not scheduled: ' + sc.unfit.map((u) => u.name).join(', '));
    return lines.join('\n');
  }

  async function refresh(msg) {
    setBusy(true);
    try {
      const d = await M.api.adminLoad(A.key, A.weekId);
      A.responses = d.responses || [];
      if (!A.dirty) { A.week = d.week; A.draft = makeDraft(d.week); }
      A.schedule = null; A.focus = null; A.view = 'heat';
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
    try {
      await M.api.deleteResponse(A.key, A.weekId, id);
      A.responses = A.responses.filter((x) => x.id !== id);
      if (A.focus === id) A.focus = null;
      A.schedule = null; A.view = 'heat';
      render();
      M.toast('Response deleted');
    } catch (e) {
      M.toast(e.message);
    }
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

  function mountGrid() {
    const host = document.getElementById('grid');
    if (!host) return;
    const isAvail = A.tab === 'avail';
    const inc = isAvail ? A.draft.increment : A.week.increment;
    const slots = isAvail ? Array.from(A.draft.slots) : A.week.slots;
    const days = gridDays(slots);
    const range = gridRange(slots, inc);
    const today = M.localToday();
    let h = '<div class="cal' + (isAvail ? ' paint' : '') + (inc === 15 ? ' small' : '') + '" style="--days:' + days.length + ';--rh:' + (inc === 15 ? 13 : 24) + 'px">';
    h += '<div class="cal-head"><div></div>' + days.map((d) =>
      '<div class="dh' + (d === today ? ' today' : '') + '">' + M.DOW[M.dow(d)] + '<b>' + Number(d.slice(8)) + '</b></div>').join('') + '</div>';
    h += '<div class="cal-body"><div class="tcol">';
    for (let m = range[0]; m < range[1]; m += inc) h += '<div class="t">' + (m % 60 === 0 ? '<span>' + M.fmtHour(m) + '</span>' : '') + '</div>';
    h += '</div>';
    days.forEach((d) => {
      h += '<div class="col" data-date="' + d + '">';
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
      M.drag.attach(cal.querySelector('.cal-body'), {
        selector: '.cell',
        touch: true,
        isOn: (el) => A.draft.slots.has(el.dataset.k),
        set: (el, on) => {
          if (on) A.draft.slots.add(el.dataset.k); else A.draft.slots.delete(el.dataset.k);
        },
        after: () => cal.querySelectorAll('.col').forEach(paintAvailCol),
        onEnd: () => { markDirty(); updateStats(); },
      });
    } else {
      paintResp(cal);
      attachTooltip(cal);
    }
  }

  function paintAvailCol(col) {
    const cells = col.children, inc = A.draft.increment;
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
      const cells = col.children;
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
          if (prev !== g) c.innerHTML = '<span class="lbl">' + esc(g.name) + '</span>';
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
        '<div class="dlg-head"><h2>Settings</h2><button class="btn ghost icon" value="cancel" aria-label="Close">' + icon('x') + '</button></div>' +
        '<div class="dlg-body">' +
          '<div class="field"><label for="s-name">Your name <span class="opt">shown to students</span></label>' +
            '<input class="input" id="s-name" name="name" maxlength="80" value="' + esc(s.name) + '" placeholder="e.g. Prof. Smith"></div>' +
          '<div class="field"><label for="s-title">Meeting title</label>' +
            '<input class="input" id="s-title" name="title" maxlength="80" value="' + esc(s.title) + '"></div>' +
          '<div class="field"><label for="s-tz">Time zone</label>' +
            (tzs.length
              ? '<select class="input" id="s-tz" name="timezone">' + tzs.map((z) => '<option' + (z === s.timezone ? ' selected' : '') + '>' + esc(z) + '</option>').join('') + '</select>'
              : '<input class="input" id="s-tz" name="timezone" value="' + esc(s.timezone) + '">') +
          '</div>' +
          '<div class="row2">' +
            '<div class="field"><label for="s-start">Calendar starts</label><select class="input" id="s-start" name="dayStart">' + hourOpts(s.dayStart, 0, 23) + '</select></div>' +
            '<div class="field"><label for="s-end">Calendar ends</label><select class="input" id="s-end" name="dayEnd">' + hourOpts(s.dayEnd, 1, 24) + '</select></div>' +
          '</div>' +
          '<label class="check"><input type="checkbox" name="weekends"' + (s.weekends ? ' checked' : '') + '> Show weekends</label>' +
        '</div>' +
        '<div class="dlg-foot">' +
          (M.DEMO
            ? '<button type="button" class="linkbtn" data-dact="reset">Reset demo data</button>'
            : '<button type="button" class="linkbtn" data-dact="signout">Sign out on this browser</button>') +
          '<div class="right"><button class="btn ghost" value="cancel">Cancel</button><button class="btn primary" value="save">Save</button></div>' +
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
      if (b.dataset.dact === 'signout') { M.store.del('meet-admin-key'); A.dirty = false; location.reload(); }
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
      };
      if (M.toMin(next.dayEnd) <= M.toMin(next.dayStart)) { M.toast('The calendar has to end after it starts.'); return; }
      try {
        const res = await M.api.saveSettings(A.key, next);
        A.settings = res.settings;
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
      case 'refresh':
        return refresh();
      case 'samples':
        try { M.demoAddSamples(A.weekId); } catch (err) { M.toast(err.message); return; }
        return refresh('Added 4 sample students. Try Suggest schedule');
      case 'suggest':
        A.schedule = suggest(); A.view = 'schedule'; A.focus = null; render();
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
})();
