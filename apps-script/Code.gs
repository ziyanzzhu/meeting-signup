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
    case 'submit': {
      rateLimit_('submit', 60);
      const res = withLock_(() => submit_(req));
      notify_(res.week, res.response, res.isUpdate);
      receipt_(res.week, res.response, res.isUpdate);
      return { ok: true, response: res.response };
    }
    case 'getMine': rateLimit_('mine', 120); return getMine_(req);
    case 'adminLoad': auth_(req); return adminLoad_(req);
    case 'saveWeek': auth_(req); return withLock_(() => saveWeek_(req));
    case 'saveSettings': auth_(req); return withLock_(() => saveSettings_(req));
    case 'deleteResponse': auth_(req); return withLock_(() => deleteResponse_(req));
    case 'busy': auth_(req); return busy_(req);
    case 'confirm': auth_(req); return confirm_(req);
    default: throw new Error('Unknown action.');
  }
}

function auth_(req) {
  if (!ADMIN_KEY || ADMIN_KEY === 'CHANGE-ME') throw new Error('Set ADMIN_KEY in the Apps Script, then redeploy. (admin key not set)');
  if (String(req.key || '') !== ADMIN_KEY) { Utilities.sleep(1000); throw new Error('Wrong admin key.'); }
}

// Sheet writes are flushed before the lock is released (so the next writer sees them),
// and cached copies are cleared only after that flush.
let pendingForget_ = [];
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    try { SpreadsheetApp.flush(); } catch (e) { /* nothing pending */ }
    if (pendingForget_.length) { forgetNow_(pendingForget_); pendingForget_ = []; }
    lock.releaseLock();
  }
}

function rateLimit_(what, perMinute) {
  try {
    const c = CacheService.getScriptCache();
    const key = 'rate:' + what + ':' + Math.floor(Date.now() / 60000);
    const n = Number(c.get(key) || 0) + 1;
    c.put(key, String(n), 120);
    if (n > perMinute) throw new Error('Lots of sign-ups right now. Please try again in a minute.');
  } catch (e) {
    if (/try again/.test(e.message)) throw e;
  }
}

// ───────────── actions ─────────────
function getWeek_(req) {
  const settings = loadSettings_();
  const id = req.weekId ? String(req.weekId) : currentOpenWeekId_(openWeekIds_(), settings.timezone);
  const w = id && DATE_RE.test(id) ? loadWeek_(id) : null;
  return { ok: true, week: w ? publicWeek(w) : null, settings: publicSettings(settings) };
}

function submit_(req) {
  const w = readWeeks_()[String(req.weekId || '')];
  const r = normalizeResponse(w, req.response);
  const sh = sheet_('Responses');
  const rows = readTable_('Responses');
  const sameWeek = (x) => str_(x[0]) === w.id;
  const sameName = (x) => norm(str_(x[1])) === norm(r.name);
  // Only an edit from the same browser under the same name updates a response. Anything else
  // (another device, a different name on a shared computer) is saved as a new response, so no
  // one can ever replace someone else's answer.
  let idx = rows.findIndex((x) => sameWeek(x) && str_(x[8]) === r.id && sameName(x));
  if (idx < 0 && rows.some((x) => sameWeek(x) && str_(x[8]) === r.id)) r.id = newId();
  if (idx < 0 && rows.filter(sameWeek).length >= 300) throw new Error('This week already has too many responses.');
  if (idx >= 0) r.id = str_(rows[idx][8]) || r.id;
  const now = new Date();
  const submitted = idx >= 0 && rows[idx][6] ? rows[idx][6] : now;
  const row = [
    txt_(w.id), txt_(r.name), txt_(r.email), r.duration, txt_(r.topic),
    txt_(describeSlots_(r.slots, w.increment)), submitted, now, txt_(r.id), txt_(JSON.stringify(r.slots)),
  ];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, row.length).setValues([row]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  forget_(['resp:' + w.id]);
  r.submitted = iso_(submitted);
  r.updated = now.toISOString();
  return { response: r, week: w, isUpdate: idx >= 0 };
}

function adminLoad_(req) {
  const id = String(req.weekId || '');
  if (SITE_RE.test(String(req.site || '')) && loadSettings_().site !== req.site) {
    withLock_(() => { const s = readSettings_(); s.site = req.site; writeSettings_(normalizeSettings(s)); forget_(['settings']); });
  }
  return { ok: true, settings: loadSettings_(), week: DATE_RE.test(id) ? loadWeek_(id) : null, responses: responsesFor_(id) };
}

function saveWeek_(req) {
  const w = normalizeWeek(req.week);
  const old = readWeeks_()[w.id];
  if (old && old.confirmed) w.confirmed = old.confirmed; // editing slots never drops a confirmed schedule
  w.updated = new Date().toISOString();
  writeWeekRow_(w);
  const s = readSettings_();
  s.increment = w.increment;
  s.minMinutes = w.minMinutes;
  if (SITE_RE.test(String(req.site || ''))) s.site = req.site;
  writeSettings_(normalizeSettings(s));
  forget_(['week:' + w.id, 'openIds', 'settings']);
  return { ok: true, week: w };
}

function writeWeekRow_(w) {
  const sh = sheet_('Weeks');
  const idx = readTable_('Weeks').findIndex((x) => str_(x[0]) === w.id);
  const row = [
    txt_(w.id), w.open, w.increment, w.minMinutes, (w.slots.length * w.increment) / 60,
    txt_(w.note), txt_(JSON.stringify(w)), new Date(),
  ];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, row.length).setValues([row]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

// A student's own response, for the private edit link in their receipt email.
function getMine_(req) {
  const weekId = String(req.weekId || ''), id = String(req.id || '');
  if (!DATE_RE.test(weekId) || !id) throw new Error('This edit link isn’t valid.');
  const r = responsesFor_(weekId).find((x) => x.id === id);
  if (!r) throw new Error('This edit link isn’t valid anymore. You can send a new response.');
  return { ok: true, response: r };
}

function saveSettings_(req) {
  const s = normalizeSettings(Object.assign({}, readSettings_(), req.settings || {}, SITE_RE.test(String(req.site || '')) ? { site: req.site } : {}));
  writeSettings_(s);
  forget_(['settings']);
  return { ok: true, settings: s };
}

function deleteResponse_(req) {
  const idx = readTable_('Responses').findIndex((x) => str_(x[0]) === String(req.weekId) && str_(x[8]) === String(req.id));
  if (idx < 0) throw new Error('That response was already deleted.');
  sheet_('Responses').deleteRow(idx + 2);
  forget_(['resp:' + String(req.weekId)]);
  return { ok: true };
}

// ───────────── cache (skips re-reading the Sheet for a few minutes) ─────────────
const CACHE_SECONDS = 120;
function cached_(key, load) {
  const c = CacheService.getScriptCache();
  const got = c.getAll([key, 'gen']);
  if (got[key] != null) { const v = safeJson_(got[key], undefined); if (v !== undefined) return v; }
  const gen = got.gen || '';
  const v = load();
  try { if ((c.get('gen') || '') === gen) c.put(key, JSON.stringify(v), CACHE_SECONDS); } catch (e) { /* too big to cache: fine */ }
  return v;
}
function forget_(keys) { pendingForget_ = pendingForget_.concat(keys); } // applied after the flush in withLock_
function forgetNow_(keys) {
  try {
    const c = CacheService.getScriptCache();
    c.removeAll(keys);
    c.put('gen', String(Date.now()) + Math.random(), 21600);
  } catch (e) { /* ignore */ }
}

// ───────────── calendar events for your admin grid ─────────────
// Calendars shared with "See all event details" (and your own) return event titles.
// Calendars shared as free/busy only fall back to plain "Busy" blocks.
// Answers are kept for 10 minutes so switching weeks doesn't wait on Google Calendar. The cache key
// includes your calendar list and time zone, so changing Settings starts fresh. Answers with errors
// aren't kept, and the admin page's Refresh link sends fresh: true to skip the cache.
const BUSY_CACHE_SECONDS = 600;
function busy_(req) {
  const s = loadSettings_();
  const weekId = String(req.weekId || '');
  if (!DATE_RE.test(weekId)) throw new Error('Invalid week.');
  const ids = calendarIds_(s.calendars);
  if (!ids.length) return { ok: true, busy: [], errors: [] };
  const key = 'busy:' + weekId + ':' + hash_(ids.join(',') + '|' + s.timezone);
  const c = CacheService.getScriptCache();
  if (!req.fresh) {
    try { const hit = safeJson_(c.get(key), null); if (hit && hit.ok) return hit; } catch (e) { /* cache unavailable: fetch */ }
  }
  const out = busyFetch_(ids, weekId, s.timezone);
  if (!out.errors.length) { try { c.put(key, JSON.stringify(out), BUSY_CACHE_SECONDS); } catch (e) { /* too big to cache: fine */ } }
  return out;
}
function hash_(text) { // short, stable cache-key fragment (not for security)
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function busyFetch_(ids, weekId, tz) {
  const timeMin = parseYmd(addDays(weekId, -1)).toISOString();
  const timeMax = parseYmd(addDays(weekId, 8)).toISOString();
  const busy = [], errors = [], busyOnly = [];
  ids.forEach((id) => {
    try {
      eventsFor_(id, timeMin, timeMax, tz).forEach((ev) => busy.push(ev));
    } catch (e) {
      busyOnly.push(id); // no access to details: ask for free/busy instead
    }
  });
  if (busyOnly.length) {
    let res;
    try {
      res = Calendar.Freebusy.query({ timeMin: timeMin, timeMax: timeMax, items: busyOnly.map((id) => ({ id: id })) });
    } catch (e) {
      return { ok: true, busy: busy, errors: [{ id: '', reason: 'Calendar isn’t connected: ' + ((e && e.message) || e) }] };
    }
    busyOnly.forEach((id) => {
      const c = (res.calendars || {})[id] || {};
      (c.errors || []).forEach((er) => errors.push({ id: id, reason: er.reason || 'error' }));
      (c.busy || []).forEach((b) => busy.push({ start: wall_(b.start, tz), end: wall_(b.end, tz), title: '' }));
    });
  }
  return { ok: true, busy: busy, errors: errors };
}

function eventsFor_(id, timeMin, timeMax, tz) {
  const out = [];
  let pageToken;
  do {
    const res = Calendar.Events.list(id, {
      timeMin: timeMin, timeMax: timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 250, pageToken: pageToken,
    });
    (res.items || []).forEach((ev) => {
      if (ev.status === 'cancelled' || ev.transparency === 'transparent') return; // marked "free"
      if (!ev.start || !ev.start.dateTime || !ev.end || !ev.end.dateTime) return;  // all-day events
      const me = (ev.attendees || []).find((a) => a.self);
      if (me && me.responseStatus === 'declined') return;
      out.push({ start: wall_(ev.start.dateTime, tz), end: wall_(ev.end.dateTime, tz), title: clip(ev.summary || '', 120) });
    });
    pageToken = res.nextPageToken;
  } while (pageToken && out.length < 1000);
  return out;
}
function calendarIds_(text) {
  return uniq(String(text || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)).slice(0, 10);
}
function wall_(isoTime, tz) { return Utilities.formatDate(new Date(isoTime), tz, "yyyy-MM-dd'T'HH:mm"); }

// ───────────── email to you when a student responds ─────────────
function notify_(w, r, isUpdate) {
  try {
    const s = loadSettings_();
    if (!s.notify) return;
    const to = s.notifyTo || Session.getEffectiveUser().getEmail();
    if (!to) { Logger.log('Alert not sent: no recipient'); return; }
    const week = niceDate_(w.id);
    const link = s.site ? s.site.replace(/\/?$/, '/') + 'admin.html?week=' + w.id + '&tab=responses' : '';
    const lines = [r.name + (isUpdate ? ' updated their' : ' sent a') + ' meeting request for the week of ' + week + '.'];
    if (link) lines.push('All responses: ' + link);
    lines.push('', 'Time needed: ' + fmtDuration(r.duration), 'Available: ' + describeSlots_(r.slots, w.increment));
    if (r.email) lines.push('Email: ' + r.email);
    lines.push('Topic:', '    ' + r.topic.replace(/\r?\n/g, '\n    '));
    const mail = {
      to: to,
      subject: (isUpdate ? 'Updated: ' : 'New: ') + r.name + ' · ' + fmtDuration(r.duration) + ' · week of ' + week,
      body: lines.join('\n'),
      name: 'Meeting sign-up',
    };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email || '')) mail.replyTo = r.email;
    MailApp.sendEmail(mail);
  } catch (e) {
    Logger.log('Email not sent: ' + ((e && e.message) || e));
  }
}
// Receipt to the student: their times plus a private link to revise them (no free text from the form).
function receipt_(w, r, isUpdate) {
  try {
    if (!EMAIL_RE.test(r.email || '')) return;
    const s = loadSettings_();
    const host = s.name || 'your advisor';
    const link = s.site ? s.site.replace(/\/?$/, '/') + '?week=' + w.id + '&r=' + encodeURIComponent(r.id) : '';
    const tzn = Utilities.formatDate(new Date(), s.timezone, 'zzzz');
    const lines = [
      'Hi ' + r.name.split(/\s+/)[0] + ',',
      '',
      (isUpdate ? 'Your updated availability' : 'Your availability') + ' for the week of ' + niceDate_(w.id) + ' was received' +
        (s.name ? ' by ' + s.name : '') + ':',
    ];
    toRanges(r.slots, w.increment).forEach((x) => lines.push('    ' + niceDay_(x.date) + ' · ' + range12_(x.start, x.end)));
    lines.push('(' + tzn + ')', '', 'Time needed: ' + fmtDuration(r.duration));
    if (link) lines.push('', 'Need to change something? Use your private link:', link);
    lines.push('', 'You’ll get another email once your meeting time is confirmed.');
    MailApp.sendEmail({
      to: r.email,
      subject: (isUpdate ? 'Updated: ' : '') + 'Your meeting times for the week of ' + niceDate_(w.id),
      body: lines.join('\n'),
      name: s.name || 'Meeting sign-up',
    });
  } catch (e) {
    Logger.log('Receipt not sent: ' + ((e && e.message) || e));
  }
}

// ───────────── confirm meetings: email each student their time with a calendar file ─────────────
function confirm_(req) {
  const weekId = String(req.weekId || '');
  if (!DATE_RE.test(weekId)) throw new Error('Invalid week.');
  const w0 = readWeeks_()[weekId];
  if (!w0) throw new Error('Publish this week first.');
  const s = readSettings_();
  const byId = {};
  readResponses_(weekId).forEach((r) => { byId[r.id] = r; });
  const prev = {};
  ((w0.confirmed && w0.confirmed.items) || []).forEach((x) => { prev[x.id] = x; });
  const items = [], emailed = [], skipped = [];
  (Array.isArray(req.items) ? req.items : []).slice(0, 300).forEach((it) => {
    const rec = confirmItem_(it, byId[String(it && it.id)]);
    if (!rec) { skipped.push({ name: (byId[String(it && it.id)] || {}).name || '', reason: 'response not found or invalid time' }); return; }
    const old = prev[rec.id];
    const unchanged = old && old.date === rec.date && old.start === rec.start && old.end === rec.end;
    rec.seq = old ? (unchanged ? (old.seq || 0) : (old.seq || 0) + 1) : 0;
    rec.sentAt = unchanged ? (old.sentAt || '') : '';
    if (!rec.sentAt) {
      if (!EMAIL_RE.test(rec.email)) {
        skipped.push({ name: rec.name, reason: 'no email address' });
      } else {
        try { sendConfirmation_(s, weekId, rec, !!old); rec.sentAt = new Date().toISOString(); emailed.push(rec.name); }
        catch (e) { skipped.push({ name: rec.name, reason: 'email failed: ' + ((e && e.message) || e) }); }
      }
    }
    items.push(rec);
  });
  const week = withLock_(() => {
    const cur = readWeeks_()[weekId] || w0;
    cur.confirmed = { at: new Date().toISOString(), items: items };
    writeWeekRow_(cur);
    forget_(['week:' + weekId, 'openIds']);
    return cur;
  });
  return { ok: true, week: week, emailed: emailed, skipped: skipped };
}
function confirmItem_(it, r) {
  if (!r || !it) return null;
  const date = String(it.date || ''), start = Number(it.start), end = Number(it.end);
  const a = new Date(String(it.startUtc || '')), b = new Date(String(it.endUtc || ''));
  if (!DATE_RE.test(date) || !(start >= 0 && end <= 1440 && end > start) || isNaN(a) || isNaN(b) || b <= a) return null;
  return { id: r.id, name: r.name, email: r.email, date: date, start: start, end: end, startUtc: a.toISOString(), endUtc: b.toISOString() };
}
function sendConfirmation_(s, weekId, rec, isUpdate) {
  const host = s.name || 'your advisor';
  const when = niceDay_(rec.date) + ' · ' + range12_(rec.start, rec.end);
  const tzn = Utilities.formatDate(new Date(rec.startUtc), s.timezone, 'zzzz');
  const body = [
    'Hi ' + rec.name.split(/\s+/)[0] + ',',
    '',
    (isUpdate ? 'Your meeting time has changed. ' : '') + 'Your meeting with ' + host + ' is confirmed:',
    '    ' + when + ' (' + tzn + ')',
    '',
    'A calendar file is attached so you can add it to your calendar.',
  ].join('\n');
  const ics = icsFor_([{ uid: weekId + '-' + rec.id, seq: rec.seq, start: rec.startUtc, end: rec.endUtc, title: 'Meeting with ' + host, desc: '' }]);
  MailApp.sendEmail({
    to: rec.email,
    subject: (isUpdate ? 'Updated meeting time: ' : 'Meeting confirmed: ') + when,
    body: body,
    name: s.name || 'Meeting sign-up',
    attachments: [Utilities.newBlob(ics, 'text/calendar', 'meeting.ics')],
  });
}
function icsFor_(events) {
  const stamp = icsTime_(new Date().toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//meeting-signup//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  events.forEach((e) => lines.push('BEGIN:VEVENT', 'UID:' + e.uid + '@meeting-signup', 'SEQUENCE:' + (e.seq || 0), 'DTSTAMP:' + stamp,
    'DTSTART:' + icsTime_(e.start), 'DTEND:' + icsTime_(e.end), 'SUMMARY:' + icsText_(e.title), 'DESCRIPTION:' + icsText_(e.desc || ''), 'END:VEVENT'));
  lines.push('END:VCALENDAR');
  return lines.map(icsFold_).join('\r\n') + '\r\n';
}
function icsTime_(iso) { return String(iso).replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, ''); }
function icsText_(t) { return String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function icsFold_(line) {
  const out = [];
  while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
  out.push(line);
  return out.join('\r\n');
}
const ampm_ = (m) => (Math.floor(m / 60) % 24 < 12 ? 'am' : 'pm');
const clock_ = (m) => (Math.floor(m / 60) % 12 || 12) + ':' + pad(m % 60);
function range12_(a, b) { return ampm_(a) === ampm_(b) ? clock_(a) + ' – ' + clock_(b) + ampm_(b) : clock_(a) + ampm_(a) + ' – ' + clock_(b) + ampm_(b); }
function niceDay_(ymd) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parseYmd(ymd).getUTCDay()] + ', ' + niceDate_(ymd); }

function niceDate_(ymd) {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = parseYmd(ymd);
  return M[d.getUTCMonth()] + ' ' + d.getUTCDate();
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

function loadWeek_(id) { return cached_('week:' + id, () => readWeeks_()[id] || null); }
function openWeekIds_() {
  return cached_('openIds', () => {
    const weeks = readWeeks_();
    return Object.keys(weeks).filter((id) => weeks[id].open).sort();
  });
}
function readWeeks_() {
  const out = {};
  readTable_('Weeks').forEach((row) => {
    const w = safeJson_(str_(row[6]), null);
    if (w && w.id && !out[w.id]) out[w.id] = w; // first row wins, same row saveWeek_ updates
  });
  return out;
}

function responsesFor_(weekId) { return cached_('resp:' + weekId, () => readResponses_(weekId)); }
function readResponses_(weekId) {
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

function loadSettings_() { return normalizeSettings(cached_('settings', readSettings_)); }
function readSettings_() {
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

function currentOpenWeekId_(openIds, tz) {
  const mon = mondayOf(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'));
  return openIds.filter((id) => id >= mon)[0] || null;
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
const SLOT_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SITE_RE = /^https:\/\/[\w.-]+(\/[\w.~%\/-]*)?$/;
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
    throw new Error('Please choose at least ' + need + ' slot' + (need === 1 ? '' : 's') + ', and as many as possible.');
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
