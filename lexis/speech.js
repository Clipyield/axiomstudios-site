// Phone speech: listening (speech recognition) and speaking (text to speech). Both are free browser features.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;
export const canSpeak = 'speechSynthesis' in window;

// Continuous listener that restarts itself when the browser stops after a pause.
export function makeListener(lang, { onInterim, onFinal, onState, onError }) {
  let rec = null;
  let wanted = false;
  let paused = false;

  function start() {
    if (!SR) { onError && onError('This browser cannot listen. Use Chrome on Android or Safari on iPhone.'); return; }
    wanted = true;
    paused = false;
    spin();
  }
  function spin() {
    if (!wanted || paused) return;
    rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0].transcript.trim();
        if (r.isFinal) { if (t) onFinal && onFinal(t); } else interim += t;
      }
      onInterim && onInterim(interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wanted = false;
        onError && onError('Microphone blocked. Allow the microphone for this site in your browser settings.');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        onError && onError('Listening problem: ' + e.error);
      }
    };
    rec.onend = () => {
      onInterim && onInterim('');
      if (wanted && !paused) setTimeout(spin, 250); else onState && onState(wanted && !paused ? 'on' : 'off');
    };
    try { rec.start(); onState && onState('on'); } catch (err) { /* already started */ }
  }
  function stop() { wanted = false; try { rec && rec.stop(); } catch (e) {} onState && onState('off'); }
  // Pause while the phone speaks, so it does not hear itself.
  function pause() { if (!wanted) return; paused = true; try { rec && rec.abort(); } catch (e) {} }
  function resume() { if (!wanted) return; paused = false; spin(); }
  return { start, stop, pause, resume, get on() { return wanted; } };
}

// One-shot listener for "say it" practice. Resolves with the text heard ('' if nothing).
export function listenOnce(lang, ms = 6000) {
  return new Promise((resolve, reject) => {
    if (!SR) { reject(new Error('This browser cannot listen.')); return; }
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    let best = '';
    const timer = setTimeout(() => { try { rec.stop(); } catch (e) {} }, ms);
    rec.onresult = (e) => { best = e.results[0][0].transcript; };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') reject(new Error('Microphone blocked. Allow it in your browser settings.'));
    };
    rec.onend = () => { clearTimeout(timer); resolve(best.trim()); };
    rec.start();
  });
}

let zhVoice = null;
function pickVoice() {
  if (!canSpeak) return null;
  const voices = speechSynthesis.getVoices();
  zhVoice = voices.find((v) => /zh[-_]CN/i.test(v.lang)) || voices.find((v) => /^zh/i.test(v.lang)) || null;
  return zhVoice;
}
if (canSpeak) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

export function speak(text, { rate = 0.85, lang = 'zh-CN' } = {}) {
  return new Promise((resolve) => {
    if (!canSpeak || !text) { resolve(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    if (lang === 'zh-CN' && (zhVoice || pickVoice())) u.voice = zhVoice;
    u.rate = rate;
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

// How close the heard Chinese is to the target (0..1), by shared characters in order.
export function similarity(heard, target) {
  const clean = (s) => (s || '').replace(/[\s，。！？、,.!?~…'"“”‘’]/g, '');
  const a = clean(heard), b = clean(target);
  if (!a || !b) return 0;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length] / b.length;
}
