// FSRS-5 spaced repetition scheduler (small, dependency-free).
// A card remembers two numbers: stability (S, days until recall drops to 90%)
// and difficulty (D, 1..10). Each rating (1 Again, 2 Hard, 3 Good, 4 Easy)
// updates them and picks the next due time.

export const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5;
const FACTOR = 19 / 81;
const RETENTION = 0.9;
const DAY = 86400000;
const MIN = 60000;
// Short steps while a phrase is new or was just forgotten.
const LEARN_STEPS = { 1: 1 * MIN, 2: 5 * MIN, 3: 10 * MIN };

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function retrievability(elapsedDays, s) {
  return Math.pow(1 + FACTOR * elapsedDays / s, DECAY);
}

export function intervalDays(s, retention = RETENTION) {
  const d = (s / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(Math.round(d), 1, 3650);
}

const initS = (g) => Math.max(W[g - 1], 0.1);
const initD = (g) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);

function nextD(d, g) {
  const delta = -W[6] * (g - 3);
  const damped = d + delta * (10 - d) / 9;
  return clamp(W[7] * initD(4) + (1 - W[7]) * damped, 1, 10);
}

function recallS(d, s, r, g) {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return s * (Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy + 1);
}

function forgetS(d, s, r) {
  const f = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
  return Math.min(f, s);
}

function shortTermS(s, g) {
  return s * Math.exp(W[17] * (g - 3 + W[18]));
}

export function newCardState() {
  return { state: 'new', s: 0, d: 0, due: 0, last: 0, reps: 0, lapses: 0 };
}

// Returns a new state object; does not mutate the input.
export function review(card, grade, now = Date.now()) {
  const g = clamp(Math.round(grade), 1, 4);
  const c = { ...card };
  if (c.state === 'new') {
    c.s = initS(g);
    c.d = initD(g);
    c.reps = 1;
    if (g === 4) { c.state = 'review'; c.due = now + intervalDays(c.s) * DAY; }
    else { c.state = 'learning'; c.due = now + LEARN_STEPS[g]; }
    c.last = now;
    return c;
  }
  const elapsed = Math.max(0, (now - (c.last || now)) / DAY);
  const r = retrievability(elapsed, c.s);
  c.d = nextD(c.d, g);
  c.reps += 1;
  if (c.state === 'learning' || c.state === 'relearning') {
    c.s = elapsed < 1 ? shortTermS(c.s, g) : (g === 1 ? forgetS(c.d, c.s, r) : recallS(c.d, c.s, r, g));
    if (g >= 3) { c.state = 'review'; c.due = now + intervalDays(c.s) * DAY; }
    else { c.due = now + LEARN_STEPS[g]; }
  } else if (g === 1) {
    c.s = forgetS(c.d, c.s, r);
    c.lapses += 1;
    c.state = 'relearning';
    c.due = now + LEARN_STEPS[1];
  } else {
    c.s = recallS(c.d, c.s, r, g);
    c.due = now + intervalDays(c.s) * DAY;
  }
  c.s = Math.max(c.s, 0.1);
  c.last = now;
  return c;
}

// Human label for the button: "1 min", "10 min", "3 days".
export function previewLabel(card, grade, now = Date.now()) {
  const ms = review(card, grade, now).due - now;
  if (ms < 60 * MIN) return Math.max(1, Math.round(ms / MIN)) + ' min';
  if (ms < DAY) return Math.round(ms / (60 * MIN)) + ' h';
  const d = Math.round(ms / DAY);
  if (d < 31) return d + (d === 1 ? ' day' : ' days');
  const m = Math.round(d / 30);
  return m + (m === 1 ? ' month' : ' months');
}
