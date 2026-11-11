/**
 * Weekly meeting sign-up: backend (Google Apps Script + Google Sheets).
 *
 * Students never see this or the Sheet. The website sends requests here behind the scenes.
 *
 * Setup (details in README.md):
 *   1. Change ADMIN_KEY below to a long passphrase only you know.
 *   2. Select the `setup` function in the toolbar and press ▶ Run. Approve the permissions.
 *   3. Deploy → New deployment → type "Web app" → Execute as: Me, Who has access: Anyone.
 *   4. Copy the Web app URL into config.js on the website.
 *
 * After editing this code later: Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy
 * (keeps the same URL).
 *
 * @OnlyCurrentDoc  (asks Google for access to this one spreadsheet only)
 */

const ADMIN_KEY = 'CHANGE-ME';

const COLS = {
  Weeks: ['Week', 'Open', 'Slot length (min)', 'Minimum (min)', 'Hours offered', 'Note', 'Data', 'Updated'],
  Responses: ['Week', 'Name', 'Email', 'Time needed (min)', 'Topic', 'Availability', 'Submitted', 'Updated', 'ID', 'Slots'],
  Settings: ['Key', 'Value'],
};

// ───────────── entry points ─────────────
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = route_(req);
  } catch (err) {
    out = { ok: false, error: (err && err.message) || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'meeting-signup' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor: creates the sheets and triggers the permission prompt. */
function setup() {
  Object.keys(COLS).forEach(sheet_);
  if (ADMIN_KEY === 'CHANGE-ME') Logger.log('Sheets are ready. Now change ADMIN_KEY at the top of this file.');
  else Logger.log('Sheets are ready. Next: Deploy → New deployment → Web app.');
}

function route_(req) {
  switch (req.action) {
    case 'getWeek': return getWeek_(req);
    case 'submit': return withLock_(() => submit_(req));
    case 'adminLoad': auth_(req); return adminLoad_(req);
    case 'saveWeek': auth_(req); return withLock_(() => saveWeek_(req));
    case 'saveSettings': auth_(req); return withLock_(() => saveSettings_(req));
    case 'deleteResponse': auth_(req); return withLock_(() => deleteResponse_(req));
    default: throw new Error('Unknown action.');
  }
}

function auth_(req) {
  if (!ADMIN_KEY || ADMIN_KEY === 'CHANGE-ME') throw new Error('Set ADMIN_KEY in the Apps Script, then redeploy. (admin key not set)');
  if (String(req.key || '') !== ADMIN_KEY) throw new Error('Wrong admin key.');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ───────────── actions ─────────────
function getWeek_(req) {
  const settings = loadSettings_();
  const weeks = loadWeeks_();
  const id = req.weekId ? String(req.weekId) : currentOpenWeekId_(weeks, settings.timezone);
  const w = id && weeks[id];
  return { ok: true, week: w ? publicWeek(w) : null, settings: publicSettings(settings) };
}

function submit_(req) {
  const weeks = loadWeeks_();
  const w = weeks[String(req.weekId || '')];
  const r = normalizeResponse(w, req.response);
  const sh = sheet_('Responses');
  const rows = readTable_('Responses');
  let idx = rows.findIndex((x) => str_(x[0]) === w.id && str_(x[8]) === r.id);
  if (idx < 0) idx = rows.findIndex((x) => str_(x[0]) === w.id && norm(str_(x[1])) === norm(r.name));
  const now = new Date();
  const submitted = idx >= 0 && rows[idx][6] ? rows[idx][6] : now;
  const row = [
    txt_(w.id), txt_(r.name), txt_(r.email), r.duration, txt_(r.topic),
    txt_(describeSlots_(r.slots, w.increment)), submitted, now, txt_(r.id), txt_(JSON.stringify(r.slots)),
  ];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, row.length).setValues([row]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  r.submitted = iso_(submitted);
  r.updated = now.toISOString();
  return { ok: true, response: r };
}

function adminLoad_(req) {
  const weeks = loadWeeks_();
  const id = String(req.weekId || '');
  return { ok: true, settings: loadSettings_(), week: weeks[id] || null, responses: responsesFor_(id) };
}

function saveWeek_(req) {
  const w = normalizeWeek(req.week);
  w.updated = new Date().toISOString();
  const sh = sheet_('Weeks');
  const idx = readTable_('Weeks').findIndex((x) => str_(x[0]) === w.id);
  const row = [
    txt_(w.id), w.open, w.increment, w.minMinutes, (w.slots.length * w.increment) / 60,
    txt_(w.note), txt_(JSON.stringify(w)), new Date(),
  ];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, row.length).setValues([row]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  const s = loadSettings_();
  s.increment = w.increment;
  s.minMinutes = w.minMinutes;
  writeSettings_(s);
  return { ok: true, week: w };
}

function saveSettings_(req) {
  const s = normalizeSettings(Object.assign({}, loadSettings_(), req.settings || {}));
  writeSettings_(s);
  return { ok: true, settings: s };
}

function deleteResponse_(req) {
  const idx = readTable_('Responses').findIndex((x) => str_(x[0]) === String(req.weekId) && str_(x[8]) === String(req.id));
  if (idx < 0) throw new Error('That response was already deleted.');
  sheet_('Responses').deleteRow(idx + 2);
  return { ok: true };
}

// ───────────── sheet storage ─────────────
function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, COLS[name].length).setValues([COLS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readTable_(name) {
  const sh = sheet_(name);
  const n = sh.getLastRow() - 1;
  return n < 1 ? [] : sh.getRange(2, 1, n, COLS[name].length).getValues();
}

// A leading apostrophe stores the cell as plain text: no date guessing, no formulas.
function txt_(v) { v = v == null ? '' : String(v); return v === '' ? '' : "'" + v; }

function str_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v == null ? '' : String(v);
}

function iso_(v) {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return isNaN(d) ? '' : d.toISOString();
}

function safeJson_(s, dflt) { try { return JSON.parse(s); } catch (e) { return dflt; } }

function loadWeeks_() {
  const out = {};
  readTable_('Weeks').forEach((row) => {
    const w = safeJson_(str_(row[6]), null);
    if (w && w.id) out[w.id] = w;
  });
  return out;
}

function responsesFor_(weekId) {
  return readTable_('Responses')
    .filter((x) => str_(x[0]) === weekId)
    .map((x) => ({
      id: str_(x[8]),
      name: str_(x[1]),
      email: str_(x[2]),
      duration: Number(x[3]) || 30,
      topic: str_(x[4]),
      slots: safeJson_(str_(x[9]), []),
      submitted: iso_(x[6]),
      updated: iso_(x[7]),
    }));
}

function loadSettings_() {
  const raw = {};
  readTable_('Settings').forEach((row) => {
    const k = str_(row[0]);
    if (k) raw[k] = safeJson_(str_(row[1]), undefined);
  });
  return normalizeSettings(Object.assign({}, DEFAULT_SETTINGS, raw));
}

function writeSettings_(s) {
  const sh = sheet_('Settings');
  const rows = Object.keys(s).map((k) => [txt_(k), txt_(JSON.stringify(s[k]))]);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
}

function currentOpenWeekId_(weeks, tz) {
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const mon = mondayOf(today);
  return Object.keys(weeks).filter((id) => weeks[id].open && id >= mon).sort()[0] || null;
}

function describeSlots_(slots, inc) {
  const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return toRanges(slots, inc).map((r) => {
    const d = parseYmd(r.date);
    return D[d.getUTCDay()] + ' ' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + fromMin(r.start) + '–' + fromMin(r.end);
  }).join('; ');
}

// ───────────── shared logic (same as core.js) ─────────────
const pad = (n) => String(n).padStart(2, '0');
const uniq = (a) => Array.from(new Set(a));
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}
function newId() { return Utilities.getUuid(); }
function parseYmd(s) { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
function fmtYmd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
function addDays(s, n) { const d = parseYmd(s); d.setUTCDate(d.getUTCDate() + n); return fmtYmd(d); }
function dow(s) { return parseYmd(s).getUTCDay(); }
function mondayOf(s) { return addDays(s, -((dow(s) + 6) % 7)); }
const toMin = (hm) => { const p = hm.split(':').map(Number); return p[0] * 60 + p[1]; };
const fromMin = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const splitKey = (k) => [k.slice(0, 10), toMin(k.slice(11, 16))];
const SLOT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function fmtDuration(m) {
  m = Math.round(m);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
}
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

const DEFAULT_SETTINGS = {
  name: '',
  title: 'Weekly meeting',
  timezone: Session.getScriptTimeZone() || 'America/New_York',
  increment: 15,
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
