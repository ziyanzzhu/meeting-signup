/* Student sign-up page: pick ≥ minimum slots → details → done. */
(function () {
  'use strict';
  const M = window.Meet;
  const { esc, icon } = M;
  const app = document.getElementById('app');
  const qs = new URLSearchParams(location.search);

  const S = {
    step: 'loading',          // loading | select | details | done | none | closed | error
    settings: null,
    week: null,
    sel: new Set(),
    form: { name: '', email: '', topic: '', duration: null },
    saved: null,              // the response on file for this browser
    justSubmitted: false,
    busy: false,
    formError: '',
    error: '',
  };

  start();

  async function start() {
    render();
    try {
      const d = await M.api.getWeek(qs.get('week'));
      S.settings = d.settings;
      S.week = d.week;
      if (S.settings && S.settings.title) document.title = S.settings.title + (S.settings.name ? ' · ' + S.settings.name : '');
      if (!S.week) S.step = 'none';
      else if (!S.week.open) S.step = 'closed';
      else {
        const me = M.store.get('meet-me') || {};
        S.form.name = me.name || '';
        S.form.email = me.email || '';
        const saved = M.store.get('meet-resp-' + S.week.id);
        if (saved) {
          S.saved = saved;
          loadSaved();
          S.step = 'done';
        } else {
          S.step = 'select';
        }
      }
    } catch (e) {
      S.step = 'error';
      S.error = e.message;
    }
    render();
  }

  function loadSaved() {
    const offered = new Set(S.week.slots);
    S.sel = new Set(S.saved.slots.filter((k) => offered.has(k)));
    Object.assign(S.form, { name: S.saved.name, email: S.saved.email || '', topic: S.saved.topic, duration: S.saved.duration });
  }

  // ───────────── derived values ─────────────
  const inc = () => S.week.increment;
  const needSlots = () => Math.max(1, Math.ceil(S.week.minMinutes / inc()));
  const firstName = () => (S.form.name || '').trim().split(/\s+/)[0] || '';
  const hostName = () => (S.settings && S.settings.name) || '';
  function weekSpan() {
    const weekend = S.week.slots.some((k) => [0, 6].includes(M.dow(k.slice(0, 10))));
    return M.fmtWeekRange(S.week.id, weekend ? 7 : 5);
  }

  // ───────────── render ─────────────
  function render() {
    const banner = M.DEMO
      ? '<div class="demo-banner">Demo mode: responses are saved only in this browser. <a href="admin.html">Open the admin page</a> to set up a week.</div>'
      : '';
    if (S.step === 'loading') { app.innerHTML = '<div class="center"><div class="spinner" aria-label="Loading"></div></div>'; return; }
    if (S.step === 'none' || S.step === 'closed' || S.step === 'error') { app.innerHTML = banner + messageCard(); return; }
    app.innerHTML = banner + '<main class="booker">' + infoPanel() + '<section class="booker-main">' + mainPanel() + '</section></main>';
    if (S.step === 'select') bindSelect();
    if (S.step === 'details') bindDetails();
  }

  function avatar() {
    const ini = M.initials(hostName());
    return '<div class="avatar">' + (ini ? esc(ini) : icon('calendar')) + '</div>';
  }

  function messageCard() {
    let title, body;
    if (S.step === 'closed') {
      title = 'Sign-ups are closed';
      body = 'Sign-ups for the week of ' + esc(M.fmtWeekRange(S.week.id)) + ' are closed. Watch for next week’s link.';
    } else if (S.step === 'none') {
      title = qs.get('week') ? 'This link isn’t active' : 'No sign-up is open right now';
      body = qs.get('week') ? 'There’s no sign-up for this week yet. Check that you have the latest link.' : 'Check back when you get this week’s link.';
    } else {
      title = 'Something went wrong';
      body = esc(S.error) + '<br><br><button class="btn" onclick="location.reload()">Try again</button>';
    }
    return '<div class="msg-card">' + avatar() + '<h1>' + title + '</h1><p class="muted">' + body + '</p></div>';
  }

  function infoPanel() {
    const s = S.settings, w = S.week;
    const tzDiff = M.browserTz() && M.browserTz() !== s.timezone;
    const ranges = M.toRanges(Array.from(S.sel), inc());
    const showPicked = S.step !== 'select' && ranges.length;
    return '<aside class="booker-info">' +
      avatar() +
      (s.name ? '<div class="host">' + esc(s.name) + '</div>' : '') +
      '<h1>' + esc(s.title) + '</h1>' +
      '<ul class="meta">' +
        '<li>' + icon('calendar') + '<span>' + esc(weekSpan()) + '</span></li>' +
        '<li>' + icon('clock') + '<span>' + w.increment + '-minute slots</span></li>' +
        '<li>' + icon('globe') + '<span>' + esc(M.tzLabel(s.timezone)) + (tzDiff ? '<small>Not your computer’s time zone</small>' : '') + '</span></li>' +
      '</ul>' +
      (w.note ? '<p class="note">' + esc(w.note) + '</p>' : '') +
      (showPicked
        ? '<div class="picked"><h4>Your availability</h4><ul>' +
          ranges.map((r) => '<li>' + esc(M.fmtDay(r.date)) + ' · ' + esc(M.fmtRange(r.start, r.end)) + '</li>').join('') +
          '</ul></div>'
        : '') +
      '</aside>';
  }

  function mainPanel() {
    if (S.step === 'select') return selectView();
    if (S.step === 'details') return detailsView();
    return doneView();
  }

  // ───────────── step 1: pick times ─────────────
  function selectView() {
    const byDay = new Map();
    S.week.slots.forEach((k) => {
      const [d, m] = M.splitKey(k);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(m);
    });
    const days = Array.from(byDay.keys()).sort();
    const need = needSlots();
    const intro = 'Choose at least <b>' + need + ' slot' + (need === 1 ? '' : 's') + '</b> and as many as possible. ' +
      'Click and drag to select several at once.';

    if (!days.length) {
      return '<div class="main-head"><h2>No times posted yet</h2><p class="muted">Check back soon.</p></div>';
    }
    const cols = days.map((d) => {
      const mins = byDay.get(d).sort((a, b) => a - b);
      const pills = mins.map((m, i) => {
        const k = M.slotKey(d, m);
        const on = S.sel.has(k);
        const gap = i > 0 && m !== mins[i - 1] + inc();
        return '<button type="button" class="pill' + (on ? ' on' : '') + (gap ? ' gap' : '') + '" data-k="' + k + '" aria-pressed="' + on + '">' + M.fmtTime(m) + '</button>';
      }).join('');
      const dd = M.parseYmd(d);
      return '<div class="day">' +
        '<button type="button" class="day-head" data-day="' + d + '" title="Select all of ' + esc(M.fmtDay(d, true)) + '">' +
          '<span class="dow">' + M.DOW[dd.getUTCDay()] + '</span><span class="dom">' + dd.getUTCDate() + '</span>' +
        '</button>' +
        '<div class="pills">' + pills + '</div></div>';
    }).join('');

    return '<div class="main-head"><h2>When are you free?</h2><p class="muted">' + intro + '</p></div>' +
      '<div class="days" style="--cols:' + days.length + '">' + cols + '</div>' +
      '<div class="bar">' +
        '<div class="progress"><div class="meter" id="meter"><span></span></div><span id="ptext" class="ptext"></span></div>' +
        '<div class="bar-actions">' +
          '<button type="button" class="btn ghost" data-act="clear" id="clear">Clear</button>' +
          '<button type="button" class="btn primary" data-act="continue" id="cont">Continue</button>' +
        '</div>' +
      '</div>';
  }

  function bindSelect() {
    const days = app.querySelector('.days');
    if (!days) return;
    M.drag.attach(days, {
      selector: '.pill',
      isOn: (el) => S.sel.has(el.dataset.k),
      set: (el, on) => setPill(el, on),
      onEnd: updateBar,
    });
    updateBar();
  }

  function setPill(el, on) {
    if (on) S.sel.add(el.dataset.k); else S.sel.delete(el.dataset.k);
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', on);
    updateBar();
  }

  function updateBar() {
    const n = S.sel.size, need = needSlots();
    const meter = document.getElementById('meter');
    const text = document.getElementById('ptext');
    if (!meter) return;
    meter.firstChild.style.width = Math.min(100, (n / need) * 100) + '%';
    meter.classList.toggle('full', n >= need);
    text.innerHTML = n >= need
      ? icon('check') + '<span><b>' + n + '</b> slots selected</span>'
      : '<span><b>' + n + '</b> of ' + need + ' selected</span>';
    document.getElementById('cont').disabled = n < need;
    document.getElementById('clear').hidden = n === 0;
  }

  // ───────────── step 2: details ─────────────
  function detailsView() {
    const opts = M.durationOptions(inc());
    const f = S.form;
    return '<div class="main-head"><h2>A few details</h2><p class="muted">This helps plan the meeting.</p></div>' +
      '<form class="form" id="details" novalidate>' +
        '<div class="field"><label for="f-name">Your name</label>' +
          '<input class="input" id="f-name" name="name" autocomplete="name" maxlength="80" value="' + esc(f.name) + '"></div>' +
        '<div class="field"><label for="f-email">Email <span class="opt">optional</span></label>' +
          '<input class="input" id="f-email" name="email" type="email" autocomplete="email" maxlength="120" value="' + esc(f.email) + '"></div>' +
        '<div class="field"><label for="f-topic">What would you like to talk about this week?</label>' +
          '<textarea class="input" id="f-topic" name="topic" rows="5" maxlength="4000" placeholder="Progress since last time, results to look at, questions, anything you’re stuck on…">' + esc(f.topic) + '</textarea></div>' +
        '<div class="field"><span class="label" id="dur-l">How much time do you think you need?</span>' +
          '<div class="seg" role="radiogroup" aria-labelledby="dur-l">' +
            opts.map((m) => '<button type="button" role="radio" data-dur="' + m + '" aria-checked="' + (f.duration === m) + '">' + M.fmtDuration(m) + '</button>').join('') +
          '</div></div>' +
        (S.formError ? '<div class="error" role="alert">' + esc(S.formError) + '</div>' : '') +
        '<div class="actions">' +
          '<button type="button" class="btn ghost" data-act="back">' + icon('left') + 'Back</button>' +
          '<button type="submit" class="btn primary"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Sending…' : (S.saved ? 'Update response' : 'Submit')) + '</button>' +
        '</div>' +
      '</form>';
  }

  function bindDetails() {
    const form = document.getElementById('details');
    form.addEventListener('input', readForm);
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    if (!S.form.name) document.getElementById('f-name').focus();
  }

  function readForm() {
    const form = document.getElementById('details');
    if (!form) return;
    S.form.name = form.elements.name.value;
    S.form.email = form.elements.email.value;
    S.form.topic = form.elements.topic.value;
  }

  async function submit() {
    readForm();
    const f = S.form;
    if (!f.name.trim()) return fail('Please enter your name.');
    if (!f.topic.trim()) return fail('Please say what you would like to talk about.');
    if (!f.duration) return fail('Please choose how much time you think you need.');
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return fail('That email address doesn’t look right.');
    S.busy = true; S.formError = ''; render();
    try {
      let id = (S.saved && S.saved.id) || M.store.get('meet-id');
      if (!id) { id = M.newId(); M.store.set('meet-id', id); }
      const res = await M.api.submit(S.week.id, {
        id: id, name: f.name.trim(), email: f.email.trim(), topic: f.topic.trim(), duration: f.duration, slots: Array.from(S.sel),
      });
      S.saved = res.response;
      M.store.set('meet-resp-' + S.week.id, res.response);
      M.store.set('meet-me', { name: f.name.trim(), email: f.email.trim() });
      S.step = 'done';
      S.justSubmitted = true;
      window.scrollTo(0, 0);
    } catch (e) {
      S.formError = e.message;
    }
    S.busy = false;
    render();
  }

  function fail(msg) {
    S.formError = msg;
    render();
    const err = app.querySelector('.error');
    if (err) err.scrollIntoView({ block: 'nearest' });
  }

  // ───────────── step 3: done ─────────────
  function doneView() {
    const r = S.saved;
    const days = new Set(r.slots.map((k) => k.slice(0, 10))).size;
    const who = hostName() || 'Your advisor';
    const head = S.justSubmitted
      ? '<h2>You’re all set' + (firstName() ? ', ' + esc(firstName()) : '') + '</h2><p class="muted">' + esc(who) + ' will confirm a meeting time with you.</p>'
      : '<h2>You’ve already responded</h2><p class="muted">You can update your times or notes until sign-ups close.</p>';
    return '<div class="done">' +
      '<div class="done-icon">' + icon('check') + '</div>' + head +
      '<dl class="summary">' +
        '<div><dt>Name</dt><dd>' + esc(r.name) + '</dd></div>' +
        '<div><dt>Topic</dt><dd>' + esc(r.topic) + '</dd></div>' +
        '<div><dt>Time needed</dt><dd>' + esc(M.fmtDuration(r.duration)) + '</dd></div>' +
        '<div><dt>Available</dt><dd>' + r.slots.length + ' slot' + (r.slots.length === 1 ? '' : 's') + ' across ' + days + ' day' + (days === 1 ? '' : 's') + '</dd></div>' +
      '</dl>' +
      '<button type="button" class="btn" data-act="edit">Edit response</button>' +
      '</div>';
  }

  // ───────────── actions ─────────────
  app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act], [data-day], [data-dur]');
    if (!t) return;
    if (t.dataset.day) return toggleDay(t.dataset.day);
    if (t.dataset.dur) {
      S.form.duration = Number(t.dataset.dur);
      t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', b === t));
      return;
    }
    switch (t.dataset.act) {
      case 'continue':
        if (S.sel.size >= needSlots()) { S.step = 'details'; S.formError = ''; render(); window.scrollTo(0, 0); }
        break;
      case 'clear':
        S.sel.clear(); render();
        break;
      case 'back':
        readForm(); S.step = 'select'; S.formError = ''; render();
        break;
      case 'edit':
        if (S.saved) loadSaved();
        S.justSubmitted = false; S.step = 'select'; render(); window.scrollTo(0, 0);
        break;
    }
  });

  function toggleDay(d) {
    const pills = Array.from(app.querySelectorAll('.pill')).filter((p) => p.dataset.k.startsWith(d));
    const allOn = pills.every((p) => S.sel.has(p.dataset.k));
    pills.forEach((p) => setPill(p, !allOn));
  }
})();
