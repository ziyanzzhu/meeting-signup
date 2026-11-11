/* Shared helpers for the student and admin pages.
 * Times are wall-clock strings in the host's time zone ("2026-11-16T10:30"),
 * so no time-zone or daylight-saving arithmetic is ever needed. */
(function () {
  'use strict';

  const cfg = window.MEET_CONFIG || {};
  const DEMO = !cfg.apiUrl;

  // ───────────── small utils ─────────────
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uniq = (a) => Array.from(new Set(a));
  const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function clampInt(v, lo, hi, dflt) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  }
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ───────────── date math (UTC-based so DST never interferes) ─────────────
  function parseYmd(s) { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
  function fmtYmd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(s, n) { const d = parseYmd(s); d.setUTCDate(d.getUTCDate() + n); return fmtYmd(d); }
  function dow(s) { return parseYmd(s).getUTCDay(); } // 0 = Sunday
  function mondayOf(s) { return addDays(s, -((dow(s) + 6) % 7)); }
  function localToday() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayIn(tz) {
    try {
      const p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
      return p.year + '-' + p.month + '-' + p.day;
    } catch (e) { return localToday(); }
  }
  const toMin = (hm) => { const p = hm.split(':').map(Number); return p[0] * 60 + p[1]; };
  const fromMin = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  const slotKey = (date, min) => date + 'T' + fromMin(min);
  const splitKey = (k) => [k.slice(0, 10), toMin(k.slice(11, 16))];
  const SLOT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // ───────────── formatting ─────────────
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ampm = (m) => (Math.floor(m / 60) % 24 < 12 ? 'am' : 'pm');
  const clock = (m) => (Math.floor(m / 60) % 12 || 12) + ':' + pad(m % 60);
  const fmtTime = (m) => clock(m) + ampm(m);                       // 9:30am
  const fmtHour = (m) => (Math.floor(m / 60) % 12 || 12) + ampm(m); // 9am
  function fmtRange(a, b) {                                         // 9:00 – 10:30am
    return ampm(a) === ampm(b) ? clock(a) + ' – ' + clock(b) + ampm(b) : fmtTime(a) + ' – ' + fmtTime(b);
  }
  function fmtDay(date, long) {
    const d = parseYmd(date);
    return (long ? DOW_LONG : DOW)[d.getUTCDay()] + ', ' + MON[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }
  function fmtWeekRange(weekId, nDays) {
    const a = parseYmd(weekId), b = parseYmd(addDays(weekId, (nDays || 5) - 1));
    const y = b.getUTCFullYear();
    if (a.getUTCFullYear() !== y) return MON[a.getUTCMonth()] + ' ' + a.getUTCDate() + ', ' + a.getUTCFullYear() + ' – ' + MON[b.getUTCMonth()] + ' ' + b.getUTCDate() + ', ' + y;
    if (a.getUTCMonth() !== b.getUTCMonth()) return MON[a.getUTCMonth()] + ' ' + a.getUTCDate() + ' – ' + MON[b.getUTCMonth()] + ' ' + b.getUTCDate() + ', ' + y;
    return MON[a.getUTCMonth()] + ' ' + a.getUTCDate() + ' – ' + b.getUTCDate() + ', ' + y;
  }
  function fmtDuration(m) {
    m = Math.round(m);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  }
  function fmtStamp(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + fmtTime(d.getHours() * 60 + d.getMinutes());
  }
  function tzLabel(tz) {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' })
        .formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
      return p ? p.value : tz;
    } catch (e) { return tz; }
  }
  function browserTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } }
  function initials(name) {
    const words = String(name || '').replace(/\b(prof|professor|dr|mr|ms|mrs)\.?\s+/gi, '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  }

  // ───────────── slot helpers ─────────────
  function toRanges(slots, inc) {
    const out = [];
    slots.slice().sort().forEach((k) => {
      const [d, m] = splitKey(k);
      const last = out[out.length - 1];
      if (last && last.date === d && last.end === m) last.end = m + inc;
      else out.push({ date: d, start: m, end: m + inc });
    });
    return out;
  }
  function convertSlots(slots, from, to) {
    if (from === to) return slots.slice();
    const out = [];
    if (to < from) {
      slots.forEach((k) => { const [d, m] = splitKey(k); for (let t = m; t < m + from; t += to) out.push(slotKey(d, t)); });
    } else {
      const set = new Set(slots);
      slots.forEach((k) => {
        const [d, m] = splitKey(k);
        const s = m - (m % to);
        let full = true;
        for (let t = s; t < s + to; t += from) if (!set.has(slotKey(d, t))) full = false;
        if (full) out.push(slotKey(d, s));
      });
    }
    return uniq(out).sort();
  }
  function durationOptions(inc) {
    return [15, 30, 45, 60, 90, 120].filter((m) => m % inc === 0);
  }

  // ───────────── validation (kept identical to apps-script/Code.gs) ─────────────
  const DEFAULT_SETTINGS = {
    name: '',
    title: 'Weekly meeting',
    timezone: browserTz() || 'America/New_York',
    increment: 30,
    minMinutes: 90,
    dayStart: '09:00',
    dayEnd: '18:00',
    weekends: false,
  };
  function validTz(tz) {
    if (typeof tz !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+)*$/.test(tz)) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return typeof Intl === 'undefined'; }
  }
  function hourStr(v, dflt) {
    const m = /^(\d{1,2}):00$/.exec(String(v || ''));
    return m && Number(m[1]) <= 24 ? pad(Number(m[1])) + ':00' : dflt;
  }
  function normalizeSettings(s) {
    s = s || {};
    let dayStart = hourStr(s.dayStart, DEFAULT_SETTINGS.dayStart);
    let dayEnd = hourStr(s.dayEnd, DEFAULT_SETTINGS.dayEnd);
    if (toMin(dayEnd) <= toMin(dayStart)) { dayStart = DEFAULT_SETTINGS.dayStart; dayEnd = DEFAULT_SETTINGS.dayEnd; }
    return {
      name: clip(s.name, 80).trim(),
      title: clip(s.title, 80).trim() || DEFAULT_SETTINGS.title,
      timezone: validTz(s.timezone) ? s.timezone : DEFAULT_SETTINGS.timezone,
      increment: Number(s.increment) === 15 ? 15 : 30,
      minMinutes: clampInt(s.minMinutes, 0, 600, 90),
      dayStart: dayStart,
      dayEnd: dayEnd,
      weekends: s.weekends === true,
    };
  }
  function normalizeWeek(w) {
    w = w || {};
    const id = String(w.id || '');
    if (!DATE_RE.test(id)) throw new Error('Invalid week.');
    const increment = Number(w.increment) === 15 ? 15 : 30;
    const days = new Set([0, 1, 2, 3, 4, 5, 6].map((i) => addDays(id, i)));
    const slots = uniq((Array.isArray(w.slots) ? w.slots : []).map(String))
      .filter((k) => SLOT_RE.test(k) && days.has(k.slice(0, 10)) && toMin(k.slice(11)) % increment === 0 && toMin(k.slice(11)) < 1440)
      .sort();
    return {
      id: id,
      increment: increment,
      minMinutes: clampInt(w.minMinutes, 0, 600, 90),
      slots: slots,
      open: w.open !== false,
      note: clip(w.note, 1000).trim(),
    };
  }
  function normalizeResponse(week, r) {
    if (!week) throw new Error('This sign-up link is not active.');
    if (!week.open) throw new Error('Sign-ups for this week are closed.');
    r = r || {};
    const name = clip(r.name, 80).trim();
    if (!name) throw new Error('Please enter your name.');
    const topic = clip(r.topic, 4000).trim();
    if (!topic) throw new Error('Please say what you would like to talk about.');
    const duration = Number(r.duration);
    if (!(duration >= 5 && duration <= 480)) throw new Error('Please choose how much time you need.');
    const offered = new Set(week.slots);
    const slots = uniq((Array.isArray(r.slots) ? r.slots : []).map(String)).filter((k) => offered.has(k)).sort();
    if (!slots.length || slots.length * week.increment < week.minMinutes) {
      const need = Math.max(1, Math.ceil(week.minMinutes / week.increment));
      throw new Error('Please choose at least ' + need + ' slot' + (need === 1 ? '' : 's') + ', and as many as possible.');
    }
    return {
      id: String(r.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || newId(),
      name: name,
      email: clip(r.email, 120).trim(),
      topic: topic,
      duration: Math.round(duration),
      slots: slots,
    };
  }
  function publicWeek(w) {
    return { id: w.id, increment: w.increment, minMinutes: w.minMinutes, slots: w.slots, open: w.open, note: w.note };
  }
  function publicSettings(s) {
    return { name: s.name, title: s.title, timezone: s.timezone };
  }
  function currentOpenWeekId(weeks, tz) {
    const mon = mondayOf(todayIn(tz));
    return Object.keys(weeks).filter((id) => weeks[id].open && id >= mon).sort()[0] || null;
  }

  // ───────────── storage helpers (browser) ─────────────
  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  // ───────────── demo backend (localStorage) ─────────────
  const DB_KEY = 'meet-demo-db';
  function demoHandle(req) {
    const db = store.get(DB_KEY) || {};
    db.weeks = db.weeks || {};
    db.responses = db.responses || {};
    const settings = normalizeSettings(Object.assign({}, DEFAULT_SETTINGS, db.settings || {}));
    const now = new Date().toISOString();
    try {
      switch (req.action) {
        case 'getWeek': {
          const id = req.weekId || currentOpenWeekId(db.weeks, settings.timezone);
          const w = id && db.weeks[id];
          return { ok: true, week: w ? publicWeek(w) : null, settings: publicSettings(settings) };
        }
        case 'submit': {
          const w = db.weeks[String(req.weekId || '')];
          const r = normalizeResponse(w, req.response);
          const list = db.responses[w.id] = db.responses[w.id] || [];
          let i = list.findIndex((x) => x.id === r.id);
          if (i < 0) i = list.findIndex((x) => norm(x.name) === norm(r.name));
          r.submitted = i >= 0 ? list[i].submitted : now;
          r.updated = now;
          if (i >= 0) list[i] = r; else list.push(r);
          store.set(DB_KEY, db);
          return { ok: true, response: r };
        }
        case 'adminLoad':
          return { ok: true, settings: settings, week: db.weeks[req.weekId] || null, responses: db.responses[req.weekId] || [] };
        case 'saveWeek': {
          const w = normalizeWeek(req.week);
          w.updated = now;
          db.weeks[w.id] = w;
          db.settings = Object.assign({}, settings, { increment: w.increment, minMinutes: w.minMinutes });
          store.set(DB_KEY, db);
          return { ok: true, week: w };
        }
        case 'saveSettings': {
          db.settings = normalizeSettings(Object.assign({}, settings, req.settings || {}));
          store.set(DB_KEY, db);
          return { ok: true, settings: db.settings };
        }
        case 'deleteResponse': {
          const list = db.responses[req.weekId] || [];
          db.responses[req.weekId] = list.filter((x) => x.id !== req.id);
          store.set(DB_KEY, db);
          return { ok: true };
        }
        default:
          throw new Error('Unknown action.');
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ───────────── API client ─────────────
  async function call(action, payload) {
    const body = Object.assign({ action: action }, payload || {});
    if (DEMO) {
      await sleep(120);
      const r = demoHandle(clone(body));
      if (!r.ok) throw new Error(r.error);
      return clone(r);
    }
    let res;
    try {
      // text/plain body = "simple" request, so Apps Script needs no CORS preflight.
      res = await fetch(cfg.apiUrl, { method: 'POST', body: JSON.stringify(body) });
    } catch (e) {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    let data;
    try { data = await res.json(); } catch (e) { throw new Error('The server sent an unexpected reply. Try again in a moment.'); }
    if (!data.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }
  const api = {
    getWeek: (weekId) => call('getWeek', { weekId: weekId || null }),
    submit: (weekId, response) => call('submit', { weekId: weekId, response: response }),
    adminLoad: (key, weekId) => call('adminLoad', { key: key, weekId: weekId }),
    saveWeek: (key, week) => call('saveWeek', { key: key, week: week }),
    saveSettings: (key, settings) => call('saveSettings', { key: key, settings: settings }),
    deleteResponse: (key, weekId, id) => call('deleteResponse', { key: key, weekId: weekId, id: id }),
  };

  // ───────────── click / drag selection ─────────────
  // Items carry data-k slot keys. Pressing on one and dragging selects (or clears) the whole
  // time rectangle between the start item and the item under the pointer, like When2Meet:
  // drag from Mon 10:00 to Fri 12:00 to fill Mon–Fri 10–12. Fast drags never skip items.
  // Plain taps on touch screens (unless opts.touch) and keyboard activation fall back to click.
  // opts: { selector, touch, isOn(el), set(el, on), after(), onEnd() }
  const drag = (function () {
    let cur = null;
    let lastType = 'mouse';
    function applyRect(c, target) {
      const a = splitKey(c.anchor.dataset.k), b = splitKey(target.dataset.k);
      const d0 = a[0] < b[0] ? a[0] : b[0], d1 = a[0] < b[0] ? b[0] : a[0];
      const m0 = Math.min(a[1], b[1]), m1 = Math.max(a[1], b[1]);
      c.items.forEach((el) => {
        const k = splitKey(el.dataset.k);
        const inside = k[0] >= d0 && k[0] <= d1 && k[1] >= m0 && k[1] <= m1;
        const want = inside ? c.mode : c.before.get(el);
        if (c.o.isOn(el) !== want) c.o.set(el, want);
      });
      c.last = target;
      if (c.o.after) c.o.after();
    }
    window.addEventListener('pointermove', (e) => {
      if (!cur) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const t = el && el.closest(cur.o.selector);
      if (t && t !== cur.last && cur.root.contains(t)) applyRect(cur, t);
    });
    const end = () => { if (cur) { const c = cur; cur = null; if (c.o.onEnd) c.o.onEnd(); } };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    function attach(root, o) {
      root.addEventListener('pointerdown', (e) => {
        lastType = e.pointerType || 'mouse';
        const t = e.target.closest(o.selector);
        if (!t || !root.contains(t) || e.button !== 0) return;
        if (lastType === 'touch' && !o.touch) return;
        e.preventDefault();
        const items = Array.from(root.querySelectorAll(o.selector));
        const before = new Map(items.map((el) => [el, o.isOn(el)]));
        cur = { root: root, o: o, items: items, before: before, anchor: t, last: null, mode: !o.isOn(t) };
        applyRect(cur, t);
      });
      root.addEventListener('click', (e) => {
        const t = e.target.closest(o.selector);
        if (!t || !root.contains(t)) return;
        if (e.detail === 0 || (lastType === 'touch' && !o.touch)) {
          o.set(t, !o.isOn(t));
          if (o.after) o.after();
          if (o.onEnd) o.onEnd();
        }
      });
    }
    return { attach: attach };
  })();

  // ───────────── UI bits ─────────────
  const ICONS = {
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
    external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  };
  const icon = (n) => '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>';

  let toastTimer;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  window.Meet = {
    DEMO, api, store, drag, icon, toast, copyText, esc, newId, uniq,
    pad, parseYmd, fmtYmd, addDays, dow, mondayOf, localToday, todayIn, toMin, fromMin, slotKey, splitKey,
    DOW, DOW_LONG, MON, fmtTime, fmtHour, fmtRange, fmtDay, fmtWeekRange, fmtDuration, fmtStamp, tzLabel, browserTz, initials,
    toRanges, convertSlots, durationOptions,
    DEFAULT_SETTINGS, normalizeSettings, normalizeWeek, normalizeResponse,
  };
})();
