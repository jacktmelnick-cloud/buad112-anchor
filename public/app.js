// Anchor page. The server owns the session; this page renders snapshots from /events,
// reports location, and sends button presses. No user text is ever written as HTML.

const $ = (id) => document.getElementById(id);

const LOCATION_SEND_MS = 4000;

const FEED = Object.freeze([
  { handle: 'dininghall.reviews', art: 'Pasta night. 4/10. Would still eat.', color: '#d9902f', likes: '1,204' },
  { handle: 'campus.fits', art: 'Fit check on the library steps', color: '#4f8a5b', likes: '892' },
  { handle: 'buad.memes', art: 'Me opening Instagram for "one second" at 11:58 pm', color: '#c4553a', likes: '3,410' },
  { handle: 'studytok.daily', art: 'POV: you color-coded the notes instead of reading them', color: '#7a68a6', likes: '12.8K' },
  { handle: 'dogsofcampus', art: 'This is Biscuit. Biscuit does not have a midterm.', color: '#a77b4f', likes: '5,077' },
  { handle: 'golden.hour.club', art: 'Sunset from the parking structure again', color: '#d4644a', likes: '2,331' },
]);

const REMARKS = Object.freeze({
  A: 'Phone stayed down. That is the whole trick.',
  B: 'Solid. A couple of pickups cost you.',
  C: 'Half your attention went to the phone.',
  D: 'The phone won this one.',
  F: 'See me after class.',
});

let rules = null;
let snap = null;
let draggingRange = false;
const geo = { state: 'pending', fix: null, lastSentAt: 0 };

/* ---------- helpers ---------- */

function clock(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

const money = (n) => `$${Math.max(0, n).toFixed(2)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function setText(id, text) {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

function show(id, visible) {
  $(id).hidden = !visible;
}

async function post(path, body = {}) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Anchor is not answering. Is the server still running in Terminal?');
  }
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`Unexpected response (${res.status}).`);
  if (!json.success) throw new Error(json.error);
  return json.data;
}

/** Run an action from a button: busy state while pending, errors into the given slot. */
async function act(button, errorId, path, body) {
  setText(errorId, '');
  button?.setAttribute('aria-busy', 'true');
  try {
    const data = await post(path, body);
    render(data);
    return data;
  } catch (error) {
    setText(errorId, error.message);
    return null;
  } finally {
    button?.removeAttribute('aria-busy');
  }
}

/* ---------- one-time builds ---------- */

function buildRubric() {
  const list = $('rubric-list');
  const items = rules.ladder.map((step, i) => {
    const li = document.createElement('li');
    li.className = 'rubric__item';
    li.dataset.state = 'ahead';

    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mark.setAttribute('class', 'rubric__mark');
    mark.setAttribute('viewBox', '0 0 24 24');
    mark.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    use.setAttribute('d', 'M4 13.5c2.2 1.4 3.6 3.2 4.6 5.2C11 12.6 15 7.6 20.5 4.5');
    mark.append(use);

    const name = document.createElement('span');
    name.className = 'rubric__name';
    name.textContent = step.name;
    const at = document.createElement('span');
    at.className = 'rubric__at';
    at.textContent = clock(i * rules.levelMs);
    const note = document.createElement('span');
    note.className = 'rubric__note';
    note.textContent = step.note;

    li.append(mark, name, at, note);
    return li;
  });
  list.replaceChildren(...items);
}

function buildFeed() {
  const posts = [...FEED, ...FEED].map((post) => {
    const article = document.createElement('div');
    article.className = 'post';
    const head = document.createElement('div');
    head.className = 'post__head';
    const avatar = document.createElement('span');
    avatar.className = 'post__avatar';
    avatar.style.background = post.color;
    head.append(avatar, document.createTextNode(post.handle));
    const image = document.createElement('div');
    image.className = 'post__image';
    image.style.background = post.color;
    image.textContent = post.art;
    const likes = document.createElement('p');
    likes.className = 'post__likes';
    likes.textContent = `${post.likes} likes`;
    article.append(head, image, likes);
    return article;
  });
  $('feed').replaceChildren(...posts);
}

/* ---------- rendering ---------- */

function render(next) {
  snap = next;
  const view = { idle: 'cover', running: 'session', done: 'summary' }[next.status] ?? 'cover';
  if (document.body.dataset.view !== view) {
    document.body.dataset.view = view;
    ['cover', 'session', 'summary'].forEach((id) => show(id, id === view));
  }
  if (view === 'session') renderSession(next);
  if (view === 'summary') renderSummary(next.summary);
  renderPresenter(next);
  renderTitle(next);
  renderFallbackFx(next);
}

function renderAnchorStatus() {
  const el = $('anchor-status');
  const acc = geo.fix?.accuracy;
  const messages = {
    pending: 'Finding where you are…',
    ready: `Ready right here, accurate to about ${acc} m${acc > 50 ? ' (rough indoors, that is normal)' : ''}`,
    blocked: 'Location is blocked, so Stop stays locked until the timer ends. Allow location for this page, or use Presenter.',
    unavailable: 'Location is unavailable, so Stop stays locked until the timer ends.',
  };
  el.dataset.state = geo.state;
  setText('anchor-status-text', messages[geo.state]);
}

function phoneMeta(s) {
  const { phone } = s;
  if (phone.onPhone) {
    const next = phone.nextLevelInMs === null ? 'Top of the rubric.' : `Next step in ${Math.ceil(phone.nextLevelInMs / 1000)} s.`;
    return `Step ${phone.level + 1} of ${phone.maxLevel + 1}: ${phone.levelName}. ${next}`;
  }
  if (phone.pickups === 0) return 'No pickups yet. Keep it that way.';
  const cost = s.cost > 0 ? ` That is ${money(s.cost)} of tuition.` : '';
  return `${plural(phone.pickups, 'pickup')}, ${clock(phone.totalMs)} on your phone.${cost} Your next pickup starts at step ${phone.restingLevel + 1}.`;
}

function renderLock(s) {
  const { location } = s;
  const distance = location.distanceM === null ? null : Math.round(location.distanceM);
  const where = distance === null ? 'location unknown' : `${distance} m from your anchor${location.simulated ? ' (simulated)' : ''}`;
  $('lockline').dataset.locked = String(!s.canStop);
  $('lock-icon').setAttribute('href', s.canStop ? '#i-unlock' : '#i-lock');
  $('stop-icon').setAttribute('href', s.canStop ? '#i-unlock' : '#i-lock');
  setText('lock-text', s.canStop ? `Stop unlocked · ${where}` : `Stop locked · ${where}`);
  $('stop-btn').disabled = !s.canStop;
  const margin = location.unlockAtM > location.radiusM ? ` (${location.radiusM} m plus a GPS margin)` : '';
  const why = s.canStop
    ? 'You walked away from your anchor, so you can end the session.'
    : `Stop unlocks past ${Math.round(location.unlockAtM)} m from where you started${margin}. Or finish the timer.`;
  setText('stop-why', why);
}

function renderRubric(s) {
  const { phone } = s;
  const hasHistory = phone.pickups > 0;
  [...$('rubric-list').children].forEach((li, i) => {
    let state = 'ahead';
    if (phone.onPhone) state = i < phone.level ? 'reached' : i === phone.level ? 'current' : 'ahead';
    else if (hasHistory) state = i < phone.restingLevel ? 'cooling' : i === phone.restingLevel ? 'resting' : 'ahead';
    if (li.dataset.state !== state) li.dataset.state = state;
  });
  const every = `${rules.levelMs / 1000} seconds`;
  setText('rubric-sub', phone.onPhone ? 'Getting off clears every effect at once.' : `One step every ${every} on your phone. Cools down one step per ${every} off it.`);
}

function renderSession(s) {
  const { phone, study } = s;
  setText('course-name', s.config.courseName);
  show('speed-stamp', s.demoSpeed !== 1);
  setText('speed-stamp', `Demo speed ${s.demoSpeed}x`);
  setText('study-time', clock(study.remainingMs));
  show('penalty-note', study.penaltyMs > 0);
  setText('penalty-note', `+${clock(study.penaltyMs)} added for phone time`);

  const control = $('phone-control');
  const btn = $('phone-btn');
  if (control.dataset.on !== String(phone.onPhone)) {
    control.dataset.on = String(phone.onPhone);
    $('phone').dataset.on = String(phone.onPhone);
    btn.setAttribute('aria-pressed', String(phone.onPhone));
    btn.classList.toggle('btn--pen', !phone.onPhone);
    btn.classList.toggle('btn--ink', phone.onPhone);
    setText('phone-btn-text', phone.onPhone ? "I'm off my phone" : "I'm on my phone");
  }
  setText('stint-time', clock(phone.stintMs));
  setText('phone-meta', phoneMeta(s));

  show('confess', s.confession.required);
  setText('confess-phrase', s.confession.phrase);

  renderLock(s);
  renderRubric(s);

  const now = new Date();
  setText('phone-clock', now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, ''));
  setText('phone-date', now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
}

function renderSummary(summary) {
  if (!summary) return;
  setText('grade', summary.grade);
  setText('score', String(summary.focusScore));
  setText('sum-course', summary.courseName);
  setText('sum-studied', clock(summary.studiedMs));
  setText('sum-phone', clock(summary.phoneMs));
  setText('sum-pickups', String(summary.pickups));
  setText('sum-penalty', `+${clock(summary.penaltyMs)}`);
  setText('sum-cost', money(summary.cost));
  setText('sum-worst', summary.maxLevelName ?? 'None');
  setText('summary-sub', summary.endedEarly ? 'Ended early: you walked away from your anchor.' : 'Timer finished. Handed back.');
  setText('remark', REMARKS[summary.grade[0]] ?? '');
}

function renderPresenter(s) {
  document.querySelectorAll('.seg__btn').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s.demoSpeed));
  });
  if (draggingRange) return;
  const { location } = s;
  if (location.simulated) {
    $('sim-range').value = String(Math.round(location.distanceM));
    setText('sim-value', `${Math.round(location.distanceM)} m away (simulated)`);
  } else {
    setText('sim-value', 'Real location');
  }
}

function renderTitle(s) {
  let title = 'Anchor';
  if (s.status === 'running') {
    title = s.phone.onPhone ? `📵 ${clock(s.phone.stintMs)} on your phone` : `${clock(s.study.remainingMs)} left · Anchor`;
  } else if (s.status === 'done' && s.summary) {
    title = `Graded ${s.summary.grade} · Anchor`;
  }
  if (document.title !== title) document.title = title;
}

/** Draw the effects inside the tab only when the Mac-wide overlay is not running. */
function renderFallbackFx(s) {
  const body = document.body;
  const fx = !s.overlayAvailable && s.fx?.active ? s.fx : null;
  body.dataset.fx = fx ? 'on' : 'off';
  body.dataset.fxPulse = fx && fx.pulseAlpha > 0 ? 'on' : 'off';
  body.dataset.fxBlur = fx && fx.blur > 0 ? 'on' : 'off';
  body.dataset.fxShake = fx?.shake ? 'on' : 'off';
  if (!fx) return;
  body.style.setProperty('--fx-alpha', String(fx.pulseAlpha));
  body.style.setProperty('--fx-half-period', `${(fx.pulsePeriodMs ?? 3000) / 2}ms`);
  body.style.setProperty('--fx-blur', `${(fx.blur * 7).toFixed(1)}px`);
  body.style.setProperty('--shake-amp', `${fx.shakeAmp}px`);
}

/* ---------- location ---------- */

function sendLocation() {
  if (!geo.fix || Date.now() - geo.lastSentAt < LOCATION_SEND_MS) return;
  geo.lastSentAt = Date.now();
  post('/api/location', geo.fix).catch((error) => setText('session-error', error.message));
}

function startLocation() {
  if (!('geolocation' in navigator)) {
    geo.state = 'unavailable';
    renderAnchorStatus();
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      geo.state = 'ready';
      geo.fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
      renderAnchorStatus();
      sendLocation();
    },
    (error) => {
      geo.state = error.code === error.PERMISSION_DENIED ? 'blocked' : 'unavailable';
      renderAnchorStatus();
    },
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
  );
}

/* ---------- events ---------- */

/** Plain digits, US thousands groups, optional cents, optional "k": "$70,000", "70000", "70k". */
const TUITION_PATTERN = /^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?k?$/;

/** Returns whole dollars a year, or null when the text isn't a usable yearly amount. */
function parseTuition(raw) {
  const text = String(raw ?? '').trim().toLowerCase().replace(/[$\s]/g, '');
  if (!TUITION_PATTERN.test(text)) return null;
  const amount = Number(text.replace(/[,k]/g, '')) * (text.endsWith('k') ? 1000 : 1);
  return amount >= 1 && amount <= rules.maxTuitionPerYear ? Math.round(amount) : null;
}

function renderTuitionHint() {
  if (!rules) return;
  const tuition = parseTuition(document.querySelector('input[name=tuitionPerYear]').value);
  const hours = rules.classMinutesPerYear / 60;
  setText(
    'tuition-hint',
    tuition === null
      ? 'What does your college charge a year? Anchor turns it into what one minute of class costs you.'
      : `$${tuition.toLocaleString('en-US')} a year ÷ ${hours} class hours = ${money(tuition / rules.classMinutesPerYear)} for every minute of class.`,
  );
}

function readStartForm(form) {
  const data = new FormData(form);
  const studyMinutes = Number(data.get('studyMinutes'));
  const tuitionPerYear = parseTuition(data.get('tuitionPerYear'));
  if (!Number.isInteger(studyMinutes) || studyMinutes < 1 || studyMinutes > 240) {
    return { error: 'Minutes must be a whole number from 1 to 240.' };
  }
  if (tuitionPerYear === null) {
    return { error: "Enter your college's yearly tuition, like 70,000." };
  }
  return { value: { studyMinutes, tuitionPerYear, courseName: String(data.get('courseName') ?? '').trim() } };
}

function wireEvents() {
  document.querySelector('input[name=tuitionPerYear]').addEventListener('input', renderTuitionHint);

  $('start-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const parsed = readStartForm(event.currentTarget);
    if (parsed.error) {
      setText('start-error', parsed.error);
      return;
    }
    geo.lastSentAt = 0;
    sendLocation();
    await act($('start-btn'), 'start-error', '/api/start', parsed.value);
  });

  $('phone-btn').addEventListener('click', (event) => {
    act(event.currentTarget, 'session-error', '/api/phone', { onPhone: !snap?.phone.onPhone });
  });

  $('stop-btn').addEventListener('click', (event) => act(event.currentTarget, 'session-error', '/api/stop'));

  $('again-btn').addEventListener('click', (event) => act(event.currentTarget, 'summary-error', '/api/reset'));

  $('confess-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('confess-input');
    const data = await act(null, 'session-error', '/api/confess', { text: input.value });
    input.value = '';
    if (data?.confession.required) {
      input.setAttribute('aria-invalid', 'true');
      setText('session-error', 'Not quite. Type the red sentence exactly.');
      setTimeout(() => input.removeAttribute('aria-invalid'), 400);
    }
  });

  $('presenter-toggle').addEventListener('click', (event) => {
    const open = event.currentTarget.getAttribute('aria-expanded') !== 'true';
    event.currentTarget.setAttribute('aria-expanded', String(open));
    show('presenter-body', open);
  });

  document.querySelectorAll('.seg__btn').forEach((b) => {
    b.addEventListener('click', () => act(null, 'session-error', '/api/demo', { speed: Number(b.dataset.speed) }));
  });

  const range = $('sim-range');
  range.addEventListener('input', () => {
    draggingRange = true;
    setText('sim-value', `${range.value} m away (simulated)`);
  });
  range.addEventListener('change', async () => {
    await act(null, 'session-error', '/api/demo', { simulatedM: Number(range.value) });
    draggingRange = false;
  });
  $('sim-reset').addEventListener('click', () => {
    range.value = '0';
    act(null, 'session-error', '/api/demo', { simulatedM: null });
  });

  window.addEventListener('beforeunload', (event) => {
    if (snap?.status !== 'running') return;
    event.preventDefault();
    event.returnValue = '';
  });
}

function connect() {
  const events = new EventSource('/events');
  events.onopen = () => show('offline', false);
  events.onerror = () => show('offline', true);
  events.onmessage = (message) => {
    try {
      render(JSON.parse(message.data));
    } catch (error) {
      setText('session-error', `Could not read an update: ${error.message}`);
    }
  };
}

async function init() {
  try {
    const res = await fetch('/api/rules');
    rules = (await res.json()).data;
  } catch {
    document.body.dataset.view = 'cover';
    show('cover', true);
    setText('start-error', 'Anchor is not answering. Start it with npm start, then reload.');
    return;
  }
  buildRubric();
  buildFeed();
  wireEvents();
  renderAnchorStatus();
  startLocation();
  connect();
}

init();
