// Run: node lexis/test_fsrs.mjs
import assert from 'node:assert/strict';
import { newCardState, review, previewLabel, retrievability } from './fsrs.js';
const DAY = 86400000; let now = Date.UTC(2026, 10, 18);
let c = newCardState();
c = review(c, 3, now); assert.equal(c.state, 'learning'); assert.equal(c.due - now, 10 * 60000);
c = review(c, 3, now + 10 * 60000); assert.equal(c.state, 'review'); const i1 = (c.due - c.last) / DAY; assert.ok(i1 >= 1, 'graduates to days');
const goodLater = review(c, 3, c.due); const i2 = (goodLater.due - goodLater.last) / DAY; assert.ok(i2 > i1, 'interval grows');
const again = review(c, 1, c.due); assert.equal(again.state, 'relearning'); assert.equal(again.lapses, 1); assert.ok(again.s <= c.s);
const easy = review(newCardState(), 4, now); assert.equal(easy.state, 'review'); assert.ok(easy.due - now >= 7 * DAY);
assert.ok(Math.abs(retrievability(5, 5) - 0.9) < 1e-9);
assert.equal(previewLabel(newCardState(), 1, now), '1 min');
let d = newCardState(), t = now; for (let k = 0; k < 6; k++) { d = review(d, 3, t); t = d.due; }
assert.ok((d.due - d.last) / DAY > 20, 'six Goods reach weeks');
console.log('fsrs ok; intervals', i1, i2, 'six goods ->', Math.round((d.due - d.last) / DAY), 'days');
