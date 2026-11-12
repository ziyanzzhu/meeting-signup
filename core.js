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
  const SLOT_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const SITE_RE = /^https:\/\/[\w.-]+(\/[\w.~%\/-]*)?$/;
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
    return fmtDateSpan(weekId, addDays(weekId, (nDays || 5) - 1));
  }
  function fmtDateSpan(from, to) {
    const a = parseYmd(from), b = parseYmd(to);
    const y = b.getUTCFullYear();
    if (from === to) return MON[a.getUTCMonth()] + ' ' + a.getUTCDate() + ', ' + y;
    if (a.getUTCFullYear() !== y) return MON[a.getUTCMonth()] + ' ' + a.getUTCDate() + ', ' + a.getUTCFullYear() + ' – ' + MON[b.getUTCMonth()] + ' ' + b.getUTCDate() + ', ' + y;
    if (a.getUTCMonth() !== b.getUTCMonth()) return MON[a.getUTCMonth()] + ' ' + a.getUTCDate() + ' – ' + MON[b.getUTCMonth()] + ' ' + b.getUTCDate() + ', ' + y;
    return MON[a.getUTCMonth()] + ' ' + a.getUTCDate() + ' – ' + b.getUTCDate() + ', ' + y;
  }
  function fmtDuration(m) {
    m = Math.round(m);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
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
  function tzShort(tz) { // e.g. "EST"
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
      return p ? p.value : '';
    } catch (e) { return ''; }
  }
  function browserTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } }

  // ───────────── time-zone conversion (for showing students their own local time) ─────────────
  const tzFmt = {};
  function zonedParts(tz, t) { // wall clock in tz at instant t (ms) → { date, min }
    const f = tzFmt[tz] || (tzFmt[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }));
    const p = {};
    f.formatToParts(new Date(t)).forEach((x) => { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
  }
  function wallToUtc(date, min, tz) { // instant (ms) when the wall clock in tz reads date + min
    const want = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 0, min);
    let t = want;
    for (let i = 0; i < 3; i++) {
      const p = zonedParts(tz, t);
      const seen = Date.UTC(Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)) - 1, Number(p.date.slice(8, 10)), 0, p.min);
      if (seen === want) break;
      t -= seen - want;
    }
    return t;
  }
  // A slot key written in hostTz, as { date, min, t } on the wall clock of viewTz.
  function slotIn(key, hostTz, viewTz) {
    const [d, m] = splitKey(key);
    let t;
    try { t = wallToUtc(d, m, hostTz); } catch (e) { return { date: d, min: m, t: Date.UTC(2000, 0, 1, 0, m) }; }
    if (!viewTz || viewTz === hostTz) return { date: d, min: m, t: t };
    try { const p = zonedParts(viewTz, t); return { date: p.date, min: p.min, t: t }; } catch (e) { return { date: d, min: m, t: t }; }
  }
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
    return [15, 30, 60].filter((m) => m % inc === 0);
  }

  // ───────────── validation (kept identical to apps-script/Code.gs) ─────────────
  const DEFAULT_SETTINGS = {
    name: '',
    title: 'Weekly meeting',
    timezone: browserTz() || 'America/New_York',
    increment: 15,
    minMinutes: 90,
    dayStart: '09:00',
    dayEnd: '18:00',
    weekends: false,
    calendars: 'primary',
    notify: true,
    site: '',
    notifyTo: '',
  };
  function validTz(tz) {
    if (typeof tz !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+)*$/.test(tz)) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return typeof Intl === 'undefined'; }
  }
  function canonTz(tz) { // 'america/new_york' → 'America/New_York'
    try { return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone || tz; } catch (e) { return tz; }
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
      timezone: validTz(s.timezone) ? canonTz(s.timezone) : DEFAULT_SETTINGS.timezone,
      increment: Number(s.increment) === 15 ? 15 : 30,
      minMinutes: clampInt(s.minMinutes, 0, 600, 90),
      dayStart: dayStart,
      dayEnd: dayEnd,
      weekends: s.weekends === true,
      calendars: clip(s.calendars == null ? DEFAULT_SETTINGS.calendars : s.calendars, 500).trim(),
      notify: s.notify !== false,
      site: SITE_RE.test(String(s.site || '')) ? String(s.site).slice(0, 300) : '',
      notifyTo: EMAIL_RE.test(String(s.notifyTo || '').trim()) ? String(s.notifyTo).trim().slice(0, 120) : '',
      invites: s.invites === true,
      inviteCopy: EMAIL_RE.test(String(s.inviteCopy || '').trim()) ? String(s.inviteCopy).trim().slice(0, 120) : '',
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
    const name = clip(r.name, 80).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    if (!name) throw new Error('Please enter your name.');
    const topic = clip(r.topic, 4000).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
    if (!topic) throw new Error('Please say what you would like to talk about.');
    const email = clip(r.email, 120).replace(/[\s\u0000-\u001f\u007f]/g, '');
    if (!EMAIL_RE.test(email)) throw new Error('Please enter your email so you can get your meeting time.');
    const duration = Number(r.duration);
    if (!(duration >= 5 && duration <= 480)) throw new Error('Please choose how much time you need.');
    if (Array.isArray(r.slots) && r.slots.length > 2000) throw new Error('Too many times selected.');
    const offered = new Set(week.slots);
    const slots = uniq((Array.isArray(r.slots) ? r.slots : []).map(String)).filter((k) => offered.has(k)).sort();
    const need = Math.max(1, Math.min(week.slots.length, Math.ceil(week.minMinutes / week.increment)));
    if (slots.length < need) {
      throw new Error('Please choose at least ' + need + ' slot' + (need === 1 ? '' : 's') + '.');
    }
    return {
      id: String(r.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || newId(),
      name: name,
      email: email,
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
          const i = list.findIndex((x) => x.id === r.id && norm(x.name) === norm(r.name));
          if (i < 0 && list.some((x) => x.id === r.id)) r.id = newId();
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
          if (db.weeks[w.id] && db.weeks[w.id].confirmed) w.confirmed = db.weeks[w.id].confirmed;
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
        case 'busy':
          return { ok: true, busy: [], errors: [] };
        case 'getMine': {
          const r = (db.responses[req.weekId] || []).find((x) => x.id === req.id);
          if (!r) throw new Error('This edit link isn’t valid anymore. You can send a new response.');
          return { ok: true, response: r };
        }
        case 'confirm': {
          const w = db.weeks[req.weekId];
          if (!w) throw new Error('Publish this week first.');
          const byId = {};
          (db.responses[req.weekId] || []).forEach((r) => { byId[r.id] = r; });
          const items = (req.items || []).filter((it) => byId[it.id]).map((it) => ({
            id: it.id, name: byId[it.id].name, email: byId[it.id].email, date: it.date, start: it.start, end: it.end,
            startUtc: it.startUtc, endUtc: it.endUtc, seq: 0, sentAt: now,
          }));
          w.confirmed = { at: now, items: items };
          store.set(DB_KEY, db);
          return { ok: true, week: w, emailed: [], skipped: [] };
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

  // Demo only: fill a published week with a few made-up students so the Responses tab has
  // something to show (in demo mode every "student" shares one browser, so you can't add several yourself).
  function demoAddSamples(weekId) {
    const db = store.get(DB_KEY) || {};
    const w = db.weeks && db.weeks[weekId];
    if (!w || !w.slots.length) throw new Error('Publish this week first.');
    const people = [
      ['Alex Rivera', 'Draft of the methods section, and whether the convergence test is enough.', 30],
      ['Bea Novak', 'New results from this week; want feedback on the main figure.', 60],
      ['Chen Li', 'Stuck on a bug in the fitting code. A quick check-in is fine.', 15],
      ['Dana Okafor', 'Planning next semester and the conference abstract.', 60],
    ];
    const need = Math.max(1, Math.ceil(w.minMinutes / w.increment));
    const blocks = toRanges(w.slots, w.increment);
    db.responses = db.responses || {};
    const list = (db.responses[weekId] || []).filter((r) => !/^sample-/.test(r.id));
    people.forEach((p, i) => {
      let picked = [];
      const order = blocks.slice().sort(() => Math.random() - 0.5);
      for (const b of order) {
        if (picked.length >= need && Math.random() < 0.4) break;
        const n = (b.end - b.start) / w.increment;
        const len = Math.max(1, Math.ceil(n * (0.5 + Math.random() * 0.5)));
        const off = Math.floor(Math.random() * (n - len + 1));
        for (let j = 0; j < len; j++) picked.push(slotKey(b.date, b.start + (off + j) * w.increment));
      }
      if (picked.length < need) picked = w.slots.slice();
      const t = new Date(Date.now() - (people.length - i) * 60000).toISOString();
      list.push({ id: 'sample-' + (i + 1), name: p[0], email: p[0].split(' ')[0].toLowerCase() + '@example.edu', topic: p[1], duration: p[2], slots: uniq(picked).sort(), submitted: t, updated: t });
    });
    db.responses[weekId] = list;
    store.set(DB_KEY, db);
    return people.length;
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
  function siteBase() { try { return new URL('./', location.href).href; } catch (e) { return ''; } }
  const api = {
    getWeek: (weekId) => call('getWeek', { weekId: weekId || null }),
    submit: (weekId, response) => call('submit', { weekId: weekId, response: response }),
    adminLoad: (key, weekId) => call('adminLoad', { key: key, weekId: weekId, site: siteBase() }),
    getMine: (weekId, id) => call('getMine', { weekId: weekId, id: id }),
    confirm: (key, weekId, items) => call('confirm', { key: key, weekId: weekId, items: items }),
    saveWeek: (key, week) => call('saveWeek', { key: key, week: week, site: siteBase() }),
    saveSettings: (key, settings) => call('saveSettings', { key: key, settings: settings, site: siteBase() }),
    busy: (key, weekId, fresh) => call('busy', { key: key, weekId: weekId, fresh: !!fresh }),
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
      const pos = c.o.coords || ((el) => splitKey(el.dataset.k)); // [day, minutes] as shown on screen
      const a = pos(c.anchor), b = pos(target);
      const d0 = a[0] < b[0] ? a[0] : b[0], d1 = a[0] < b[0] ? b[0] : a[0];
      const m0 = Math.min(a[1], b[1]), m1 = Math.max(a[1], b[1]);
      c.items.forEach((el) => {
        const k = pos(el);
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

  function ics(events) {
    const stamp = icsTime(new Date().toISOString());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//meeting-signup//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    events.forEach((e) => lines.push('BEGIN:VEVENT', 'UID:' + e.uid + '@meeting-signup', 'SEQUENCE:' + (e.seq || 0), 'DTSTAMP:' + stamp,
      'DTSTART:' + icsTime(e.start), 'DTEND:' + icsTime(e.end), 'SUMMARY:' + icsText(e.title), 'DESCRIPTION:' + icsText(e.desc || ''), 'END:VEVENT'));
    lines.push('END:VCALENDAR');
    return lines.map((line) => { const out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); } out.push(line); return out.join('\r\n'); }).join('\r\n') + '\r\n';
  }
  // ───────────── US federal holidays ─────────────
  // {'YYYY-MM-DD': name} for one year (5 U.S.C. 6103). A fixed-date holiday that falls on a
  // weekend is also marked on the weekday it is observed (Saturday → Friday, Sunday → Monday).
  function usHolidays(year) {
    const out = {};
    const ymd = (m, d) => year + '-' + pad(m) + '-' + pad(d);
    const nth = (m, wd, n) => { // n-th weekday wd (0 = Sun) of month m; n = -1 → the last one
      if (n > 0) return ymd(m, 1 + ((wd - dow(ymd(m, 1)) + 7) % 7) + 7 * (n - 1));
      const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
      return ymd(m, last - ((dow(ymd(m, last)) - wd + 7) % 7));
    };
    const fixed = (m, d, name) => {
      const k = ymd(m, d), w = dow(k);
      out[k] = name;
      if (w === 6) out[addDays(k, -1)] = name + ' (observed)';
      if (w === 0) out[addDays(k, 1)] = name + ' (observed)';
    };
    fixed(1, 1, "New Year's Day");
    out[nth(1, 1, 3)] = 'MLK Day';
    out[nth(2, 1, 3)] = "Presidents' Day";
    out[nth(5, 1, -1)] = 'Memorial Day';
    fixed(6, 19, 'Juneteenth');
    fixed(7, 4, 'Independence Day');
    out[nth(9, 1, 1)] = 'Labor Day';
    out[nth(10, 1, 2)] = "Columbus / Indigenous Peoples' Day";
    fixed(11, 11, 'Veterans Day');
    out[nth(11, 4, 4)] = 'Thanksgiving';
    fixed(12, 25, 'Christmas Day');
    return out;
  }
  const holidayCache = {};
  function holiday(date) { // '' when none; next year's list covers New Year's observed on Dec 31
    const y = Number(String(date).slice(0, 4));
    if (!y) return '';
    const a = holidayCache[y] || (holidayCache[y] = usHolidays(y));
    const b = holidayCache[y + 1] || (holidayCache[y + 1] = usHolidays(y + 1));
    return a[date] || b[date] || '';
  }

  function icsTime(iso) { return String(iso).replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, ''); }
  function icsText(t) { return String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }

  window.Meet = {
    DEMO, api, store, drag, icon, toast, copyText, esc, newId, uniq, demoAddSamples, ics,
    pad, parseYmd, fmtYmd, addDays, dow, mondayOf, localToday, todayIn, toMin, fromMin, slotKey, splitKey,
    DOW, DOW_LONG, MON, fmtTime, fmtHour, fmtRange, fmtDay, fmtWeekRange, fmtDateSpan, fmtDuration, fmtStamp, tzLabel, tzShort, browserTz, initials,
    slotIn, holiday, usHolidays,
    toRanges, convertSlots, durationOptions,
    DEFAULT_SETTINGS, normalizeSettings, normalizeWeek, normalizeResponse,
  };
})();
