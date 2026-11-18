import { STARTER, TOPICS, HEARD } from './phrases.js';
import { newCardState, review, previewLabel } from './fsrs.js';
import { canListen, canSpeak, makeListener, listenOnce, speak, similarity } from './speech.js';
import { MODELS, DEFAULT_MODEL, callClaude, livePrompt, sayPrompt, cardsPrompt } from './ai.js';
import { publish as hudPublish } from './hud-link.js';

// ---------- storage ----------
const KEY = 'lexis.v1';
const today = () => new Date().toISOString().slice(0, 10);
const defaults = () => ({
  profile: { name: 'Okan', from: 'Austria', interests: ['food', 'travel', 'videos'], about: '' },
  settings: { apiKey: '', model: DEFAULT_MODEL, capUsd: 0.5, newPerDay: 8, rate: 0.85, myLang: 'en', autoSpeak: false },
  cards: {},   // id -> { phrase fields + schedule }
  stats: { day: today(), newDone: 0, reviews: 0, usd: 0, streak: 0, lastDay: '' },
  history: [], // live conversation lines
});

function load() {
  let s;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
  const d = defaults();
  s = s ? { ...d, ...s, profile: { ...d.profile, ...s.profile }, settings: { ...d.settings, ...s.settings }, stats: { ...d.stats, ...s.stats } } : d;
  for (const p of STARTER) if (!s.cards[p.id]) s.cards[p.id] = { ...p, ...newCardState(), order: STARTER.indexOf(p) };
  for (const p of STARTER) Object.assign(s.cards[p.id], { zh: p.zh, py: p.py, say: p.say, en: p.en, topic: p.topic });
  syncNameCard(s);
  if (s.stats.day !== today()) s.stats = { ...s.stats, day: today(), newDone: 0, reviews: 0, usd: 0 };
  return s;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save on this phone.'); } }

function syncNameCard(s) {
  const n = (s.profile.name || '').trim() || 'Okan';
  const base = s.cards.me1 || { ...newCardState(), order: 3.5, src: 'me', topic: 'talk' };
  s.cards.me1 = { ...base, id: 'me1', zh: `我叫${n}`, py: `wǒ jiào ${n}`, say: `woh jyow ${n}`, en: `My name is ${n}` };
}

let S = load();

// ---------- tiny DOM helpers ----------
const $ = (sel) => document.querySelector(sel);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') continue; // never set raw HTML
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
const play = (zh, slow) => speak(zh, { rate: slow ? 0.55 : S.settings.rate });

// ---------- AI wrapper with daily cap ----------
function aiReady() { return !!S.settings.apiKey; }
async function ai(kind, prompt) {
  if (!aiReady()) throw new Error('Add your Claude API key in "Me" to use this.');
  if (S.stats.usd >= S.settings.capUsd) throw new Error(`Today's AI budget ($${S.settings.capUsd.toFixed(2)}) is used up. You can raise it in "Me".`);
  const { data, usd } = await callClaude(kind, prompt, S.settings, S.profile);
  S.stats.usd += usd;
  save();
  renderSpend();
  return data;
}
function friendlyError(e) {
  const m = String(e && e.message || e);
  if (/401|authentication|invalid x-api-key/i.test(m)) return 'The API key was not accepted. Check it in "Me".';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No internet connection right now.';
  if (/429|rate/i.test(m)) return 'Too many requests at once. Wait a moment.';
  return m.length > 160 ? m.slice(0, 160) + '…' : m;
}

// ---------- tabs ----------
const VIEWS = ['learn', 'live', 'me'];
function show(view) {
  for (const v of VIEWS) {
    $('#view-' + v).hidden = v !== view;
    $(`[data-tab="${v}"]`).setAttribute('aria-current', v === view ? 'page' : 'false');
  }
  if (view !== 'live' && live.on) stopLive();
  if (view === 'learn') renderLearn();
  if (view === 'me') renderMe();
  if (view === 'live') renderLive();
  try { sessionStorage.setItem('lexis.tab', view); } catch (e) {}
}

// ---------- Learn ----------
let current = null;
let revealed = false;
let extraNew = 0;

function queue() {
  const now = Date.now();
  const all = Object.values(S.cards);
  const due = all.filter((c) => c.state !== 'new' && c.due <= now).sort((a, b) => a.due - b.due);
  const newLeft = Math.max(0, S.settings.newPerDay + extraNew - S.stats.newDone);
  const fresh = all.filter((c) => c.state === 'new').sort((a, b) => (a.order ?? 999) - (b.order ?? 999)).slice(0, newLeft);
  return { due, fresh, learned: all.filter((c) => c.state !== 'new').length, total: all.length };
}

function pickNext() {
  const q = queue();
  // Mix: show a due card first, otherwise a new one.
  return q.due[0] || q.fresh[0] || null;
}

function renderLearn() {
  const root = $('#view-learn');
  root.replaceChildren();
  const q = queue();
  root.append(h('div', { class: 'meta-row' },
    h('span', {}, `${q.due.length} to review`), h('span', {}, `${q.fresh.length} new today`),
    h('span', {}, `${q.learned}/${q.total} known`)));
  current = pickNext();
  revealed = false;
  if (!current) {
    const soon = Object.values(S.cards).filter((c) => c.state !== 'new').sort((a, b) => a.due - b.due)[0];
    root.append(h('section', { class: 'card done' },
      h('h2', {}, 'Done for now'),
      h('p', {}, `${S.stats.reviews} answers today. Come back ${soon ? 'at ' + new Date(soon.due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (soon.due - Date.now() > 86400000 ? ' on ' + new Date(soon.due).toLocaleDateString() : '') : 'tomorrow'}.`),
      h('button', { class: 'btn', onclick: () => { extraNew += 5; renderLearn(); } }, '+5 more new phrases')));
    return;
  }
  const c = current;
  const card = h('section', { class: 'card', id: 'learn-card' },
    h('div', { class: 'tag' }, (TOPICS[c.topic] || 'My phrases') + (c.state === 'new' ? ' · new' : '')),
    h('p', { class: 'prompt' }, c.en),
    h('p', { class: 'hint' }, 'Say it out loud in Chinese, then check.'));
  const heardBox = h('p', { class: 'heard', id: 'heard' });
  const actions = h('div', { class: 'row' },
    canListen ? h('button', { class: 'btn ghost', onclick: practiseSay }, '🎤 Say it') : null,
    h('button', { class: 'btn', onclick: reveal }, 'Show answer'));
  card.append(heardBox, actions);
  root.append(card);
}

async function practiseSay() {
  const box = $('#heard');
  box.textContent = 'Listening… speak now';
  try {
    const got = await listenOnce('zh-CN');
    if (!got) { box.textContent = "I didn't catch that. Try again a bit louder."; return; }
    const score = similarity(got, current.zh);
    box.replaceChildren(h('span', {}, 'I heard: '), h('span', { class: 'zh' }, got), ' ',
      h('b', { class: score >= 0.8 ? 'ok' : score >= 0.5 ? 'mid' : 'low' },
        score >= 0.8 ? '✓ Great!' : score >= 0.5 ? 'Close!' : 'Not quite'));
    if (!revealed) reveal();
  } catch (e) { box.textContent = friendlyError(e); }
}

function reveal() {
  if (revealed || !current) return;
  revealed = true;
  const c = current;
  const card = $('#learn-card');
  card.querySelector('.row').remove();
  card.append(lineBlock(c, true),
    h('div', { class: 'grades' }, [1, 2, 3, 4].map((g) =>
      h('button', { class: 'grade g' + g, onclick: () => grade(g) },
        h('b', {}, ['Again', 'Hard', 'Good', 'Easy'][g - 1]), h('small', {}, previewLabel(c, g))))));
  play(c.zh);
}

function grade(g) {
  const c = current;
  const wasNew = c.state === 'new';
  S.cards[c.id] = { ...c, ...review(c, g) };
  if (wasNew) S.stats.newDone += 1;
  S.stats.reviews += 1;
  if (S.stats.lastDay !== today()) {
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    S.stats.streak = S.stats.lastDay === y ? S.stats.streak + 1 : 1;
    S.stats.lastDay = today();
  }
  save();
  renderLearn();
  renderStreak();
}

// A phrase shown big: "say it like", sound guide, characters, play buttons.
function lineBlock(line, withPlay) {
  return h('div', { class: 'line' },
    h('p', { class: 'say' }, line.say),
    h('p', { class: 'py' }, line.py),
    h('p', { class: 'zh' }, line.zh),
    withPlay ? h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => play(line.zh) }, '▶ Play'),
      h('button', { class: 'btn ghost', onclick: () => play(line.zh, true) }, '🐢 Slow')) : null);
}

function addCard(line, src = 'live') {
  const exists = Object.values(S.cards).find((c) => c.zh === line.zh);
  if (exists) { toast('Already in your phrases.'); return false; }
  const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  S.cards[id] = { id, topic: 'mine', zh: line.zh, py: line.py, say: line.say, en: line.en, src, ...newCardState(), order: -1 };
  save();
  toast('Saved to Learn. It comes up as a new phrase.');
  return true;
}

// ---------- Live ----------
const live = { on: false, listener: null, busy: 0 };

function renderLive() {
  const root = $('#view-live');
  if (root.dataset.built) { renderTranscript(); return; }
  root.dataset.built = '1';
  root.append(
    h('div', { class: 'live-top' },
      h('button', { class: 'mic', id: 'mic', onclick: toggleLive, 'aria-label': 'Start listening' }, h('span', { id: 'mic-label' }, 'Listen')),
      h('p', { class: 'status', id: 'live-status' }, canListen ? 'Tap Listen, then let the other person talk.' : 'This browser cannot listen. Use Chrome (Android) or Safari (iPhone).'),
      h('p', { class: 'interim zh', id: 'interim' })),
    h('div', { id: 'transcript', class: 'transcript' }),
    h('form', { class: 'say-form', onsubmit: (e) => { e.preventDefault(); wantToSay($('#say-input').value); } },
      h('input', { id: 'say-input', placeholder: S.settings.myLang === 'de' ? 'Ich möchte sagen…' : 'I want to say…', autocomplete: 'off', enterkeyhint: 'go' }),
      canListen ? h('button', { type: 'button', class: 'btn ghost', 'aria-label': 'Speak in your language', onclick: dictate }, '🎤') : null,
      h('button', { class: 'btn' }, 'Go')),
    h('div', { class: 'row small' },
      h('button', { class: 'link', onclick: () => window.open('hud.html', 'lexis-hud') }, 'Open glasses view'),
      h('button', { class: 'link', onclick: () => { S.history = []; save(); renderTranscript(); } }, 'Clear conversation')));
  renderTranscript();
}

function toggleLive() { live.on ? stopLive() : startLive(); }
function startLive() {
  live.listener = live.listener || makeListener('zh-CN', {
    onInterim: (t) => { $('#interim').textContent = t; },
    onFinal: heard,
    onState: (s) => setMic(s === 'on'),
    onError: (m) => { toast(m); setMic(false); live.on = false; },
  });
  live.on = true;
  live.listener.start();
  setMic(true);
  $('#live-status').textContent = 'Listening for Chinese…';
}
function stopLive() {
  live.on = false;
  live.listener && live.listener.stop();
  setMic(false);
  const st = $('#live-status');
  if (st) st.textContent = 'Paused. Tap Listen to continue.';
}
function setMic(on) {
  const m = $('#mic');
  if (!m) return;
  m.classList.toggle('on', on && live.on);
  $('#mic-label').textContent = live.on ? 'Stop' : 'Listen';
}

function offlineMatch(zh) {
  const clean = zh.replace(/[\s，。！？、,.!?]/g, '');
  const hit = HEARD.find((x) => x.zh.some((k) => clean.includes(k)));
  const card = Object.values(S.cards).find((c) => c.zh.replace(/[，。！？、?!]/g, '') === clean);
  const replies = (hit ? hit.replies : []).map((id) => S.cards[id]).filter(Boolean);
  return { en: card ? card.en : hit ? hit.en : '', replies };
}

let pinyinFn = null;
async function toPinyin(zh) {
  try {
    if (!pinyinFn) pinyinFn = (await import('./vendor/pinyin.js')).pinyin;
    return pinyinFn(zh);
  } catch (e) { return ''; }
}

async function heard(zh) {
  const item = { who: 'them', zh, py: '', say: '', en: '', replies: [], pending: true, t: Date.now() };
  S.history.push(item);
  if (S.history.length > 60) S.history.shift();
  renderTranscript();
  const off = offlineMatch(zh);
  item.py = await toPinyin(zh);
  item.en = off.en;
  item.replies = off.replies.map(({ zh, py, say, en }) => ({ zh, py, say, en }));
  if (aiReady()) {
    live.busy += 1;
    renderTranscript();
    try {
      const d = await ai('live', livePrompt(zh, S.history.slice(0, -1), S.settings.myLang));
      Object.assign(item, { py: d.heard.py || item.py, say: d.heard.say, en: d.heard.en, replies: d.replies, tip: d.tip });
    } catch (e) { item.err = friendlyError(e); }
    live.busy -= 1;
  } else if (!item.en) {
    item.err = 'Add an API key in "Me" for full translation.';
  }
  item.pending = false;
  save();
  renderTranscript();
  hudPublish({ heard: item.zh, meaning: item.en, reply: item.replies[0] || null });
}

function renderTranscript() {
  const box = $('#transcript');
  if (!box) return;
  box.replaceChildren();
  if (!S.history.length) {
    box.append(h('p', { class: 'empty' }, 'What they say appears here with the meaning, plus answers you can say back.'));
    return;
  }
  const last = S.history.length - 1;
  S.history.forEach((it, i) => {
    const el = h('div', { class: 'msg ' + it.who },
      h('p', { class: 'zh' }, it.zh),
      it.py ? h('p', { class: 'py' }, it.py) : null,
      it.en ? h('p', { class: 'en' }, it.en) : null,
      it.pending ? h('p', { class: 'muted' }, 'Translating…') : null,
      it.err ? h('p', { class: 'muted' }, it.err) : null,
      it.tip ? h('p', { class: 'tip' }, '💡 ' + it.tip) : null,
      h('div', { class: 'row small' },
        h('button', { class: 'link', onclick: () => play(it.zh) }, '▶ Play'),
        it.say ? h('button', { class: 'link', onclick: () => addCard(it) }, '+ Learn this') : null));
    if (it.who === 'them' && it.replies && it.replies.length && i >= last - 1) {
      el.append(h('div', { class: 'replies' }, h('p', { class: 'label' }, 'Say back:'),
        it.replies.map((r) => h('button', { class: 'reply', onclick: () => prompter(r) },
          h('b', {}, r.say), h('span', {}, r.en)))));
    }
    box.append(el);
  });
  box.lastElementChild.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

async function dictate() {
  const lang = S.settings.myLang === 'de' ? 'de-AT' : 'en-US';
  const wasOn = live.on;
  if (wasOn) live.listener.pause();
  try {
    toast('Speak now…');
    const t = await listenOnce(lang, 7000);
    if (t) { $('#say-input').value = t; wantToSay(t); }
  } catch (e) { toast(friendlyError(e)); }
  if (wasOn) live.listener.resume();
}

async function wantToSay(text) {
  text = (text || '').trim();
  if (!text) return;
  const known = Object.values(S.cards).find((c) => c.en.toLowerCase().replace(/[^a-z ]/g, '') === text.toLowerCase().replace(/[^a-z ]/g, ''));
  if (known) { prompter(known); return; }
  if (!aiReady()) { toast('Add your Claude API key in "Me" to translate anything you type.'); return; }
  toast('Finding the words…');
  try {
    const d = await ai('say', sayPrompt(text));
    $('#say-input').value = '';
    prompter(d.simpler, d.best);
  } catch (e) { toast(friendlyError(e)); }
}

// ---------- Teleprompter ----------
let promptLine = null;
function prompter(line, alt) {
  promptLine = line;
  const p = $('#prompter');
  p.replaceChildren(...[
    h('button', { class: 'close', onclick: closePrompter, 'aria-label': 'Close' }, '✕'),
    h('p', { class: 'label' }, 'Say:'),
    h('p', { class: 'say xl' }, line.say),
    h('p', { class: 'py' }, line.py),
    h('p', { class: 'zh big' }, line.zh),
    h('p', { class: 'en' }, line.en),
    alt && alt.zh !== line.zh ? h('button', { class: 'link', onclick: () => prompter(alt, line) }, `More natural: ${alt.say}`) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => sayAloud(line.zh) }, '▶ Play for them'),
      h('button', { class: 'btn ghost', onclick: () => p.classList.toggle('show-them') }, '👀 Show them')),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => addCard(line) }, '+ Learn this'),
      h('button', { class: 'btn', onclick: () => { said(line); closePrompter(); } }, '✓ I said it'))].filter(Boolean));
  p.classList.remove('show-them');
  p.hidden = false;
  hudPublish({ reply: line });
  if (S.settings.autoSpeak) sayAloud(line.zh);
}
async function sayAloud(zh) {
  if (live.on) live.listener.pause();
  await play(zh);
  if (live.on) live.listener.resume();
}
function said(line) {
  S.history.push({ who: 'me', zh: line.zh, py: line.py, say: line.say, en: line.en, t: Date.now() });
  save();
  renderTranscript();
}
function closePrompter() { $('#prompter').hidden = true; promptLine = null; }

// ---------- Me ----------
function field(label, input, note) {
  return h('label', { class: 'field' }, h('span', {}, label), input, note ? h('small', {}, note) : null);
}
function renderMe() {
  const root = $('#view-me');
  root.replaceChildren();
  const P = S.profile, T = S.settings;
  const name = h('input', { value: P.name });
  const from = h('input', { value: P.from });
  const about = h('textarea', { rows: 3, placeholder: 'e.g. I make videos, love street food, travel to Shanghai and Chengdu in Sept 2027' });
  about.value = P.about || '';
  const interests = h('input', { value: (P.interests || []).join(', ') });
  const myLang = h('select', {}, h('option', { value: 'en' }, 'English'), h('option', { value: 'de' }, 'Deutsch'));
  myLang.value = T.myLang;
  const newPerDay = h('input', { type: 'number', min: 1, max: 30, value: T.newPerDay });
  const rate = h('input', { type: 'range', min: 0.5, max: 1.1, step: 0.05, value: T.rate });
  const key = h('input', { type: 'password', value: T.apiKey, placeholder: 'sk-ant-…', autocomplete: 'off' });
  const model = h('select', {}, Object.entries(MODELS).map(([id, m]) => h('option', { value: id }, m.name)));
  model.value = T.model;
  const cap = h('input', { type: 'number', min: 0, step: 0.1, value: T.capUsd });
  const autoSpeak = h('input', { type: 'checkbox' });
  autoSpeak.checked = !!T.autoSpeak;

  function saveMe() {
    Object.assign(P, { name: name.value.trim(), from: from.value.trim(), about: about.value.trim(),
      interests: interests.value.split(',').map((s) => s.trim()).filter(Boolean) });
    Object.assign(T, { myLang: myLang.value, newPerDay: Math.max(1, Math.min(30, +newPerDay.value || 8)),
      rate: +rate.value, apiKey: key.value.trim(), model: model.value, capUsd: Math.max(0, +cap.value || 0), autoSpeak: autoSpeak.checked });
    syncNameCard(S);
    save();
    toast('Saved.');
    renderSpend();
  }

  const source = h('textarea', { rows: 4, placeholder: 'Paste anything: your trip plan, a menu, a message, a list of things you want to say…' });
  const count = h('input', { type: 'number', min: 3, max: 20, value: 8 });
  async function makeCards() {
    const text = source.value.trim() || `My interests: ${P.interests.join(', ')}. ${P.about}`;
    try {
      toast('Making phrases…');
      const d = await ai('cards', cardsPrompt(text, Math.max(3, Math.min(20, +count.value || 8))));
      let n = 0;
      for (const c of d.cards) if (addCardQuiet(c)) n++;
      save();
      toast(`${n} new phrases added to Learn.`);
      source.value = '';
    } catch (e) { toast(friendlyError(e)); }
  }

  root.append(
    h('section', { class: 'card' }, h('h2', {}, 'About me'),
      field('Name', name), field('From', from), field('Interests (comma separated)', interests),
      field('About my trip', about, 'The AI uses this to suggest replies that fit you.'),
      field('My language', myLang), h('button', { class: 'btn', onclick: saveMe }, 'Save')),
    h('section', { class: 'card' }, h('h2', {}, 'Practice'),
      field('New phrases per day', newPerDay), field('Speaking speed', rate),
      h('label', { class: 'check' }, autoSpeak, ' Play the reply aloud automatically in the teleprompter'),
      h('button', { class: 'btn', onclick: saveMe }, 'Save')),
    h('section', { class: 'card' }, h('h2', {}, 'AI (Claude)'),
      h('p', { class: 'muted' }, 'Needed for live translation, "I want to say…" and making new phrases. Your key stays only on this phone.'),
      field('API key', key, 'Create one at console.anthropic.com → API keys.'),
      field('Model', model), field('Daily budget in US$', cap),
      h('p', { id: 'spend', class: 'muted' }),
      h('button', { class: 'btn', onclick: saveMe }, 'Save')),
    h('section', { class: 'card' }, h('h2', {}, 'Make phrases from my stuff'),
      h('p', { class: 'muted' }, 'Leave empty to use your interests and trip notes.'),
      source, field('How many', count),
      h('button', { class: 'btn', onclick: makeCards }, 'Make phrases')),
    h('section', { class: 'card' }, h('h2', {}, 'Backup'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: exportData }, 'Download backup'),
        h('label', { class: 'btn ghost file' }, 'Restore', h('input', { type: 'file', accept: '.json,application/json', onchange: importData })))),
  );
  renderSpend();
}
function addCardQuiet(line) {
  if (!line || !line.zh || Object.values(S.cards).some((c) => c.zh === line.zh)) return false;
  const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  S.cards[id] = { id, topic: 'mine', zh: line.zh, py: line.py, say: line.say, en: line.en, src: 'ai', ...newCardState(), order: -1 };
  return true;
}
function renderSpend() {
  const el = $('#spend');
  if (el) el.textContent = `Used today: $${S.stats.usd.toFixed(3)} of $${S.settings.capUsd.toFixed(2)}.`;
}
function exportData() {
  const copy = { ...S, settings: { ...S.settings, apiKey: '' } };
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(copy, null, 1)], { type: 'application/json' })), download: `lexis-backup-${today()}.json` });
  document.body.append(a); a.click(); a.remove();
}
async function importData(e) {
  try {
    const d = JSON.parse(await e.target.files[0].text());
    if (!d.cards) throw new Error('bad file');
    const key = S.settings.apiKey;
    localStorage.setItem(KEY, JSON.stringify({ ...d, settings: { ...d.settings, apiKey: key } }));
    S = load();
    toast('Backup restored.');
    renderMe();
  } catch (err) { toast('That file is not a Lexis backup.'); }
}

function renderStreak() {
  $('#streak').textContent = S.stats.streak > 0 && S.stats.lastDay === today() ? `🔥 ${S.stats.streak}` : '';
}

// ---------- start ----------
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#prompter').hidden) closePrompter(); });
if (!canSpeak) toast('This browser cannot play Chinese audio.');
let start = 'learn';
try { start = sessionStorage.getItem('lexis.tab') || new URLSearchParams(location.search).get('tab') || 'learn'; } catch (e) {}
show(VIEWS.includes(start) ? start : 'learn');
renderStreak();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// For tests and the console.
window.lexis = { get state() { return S; }, heard, prompter, wantToSay };
