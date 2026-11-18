// Sends the latest line to the glasses view (hud.html) on the same device.
// Today: open hud.html on a mirrored screen or the glasses' browser. Later a glasses
// app can listen to the same messages.
const ch = 'BroadcastChannel' in window ? new BroadcastChannel('lexis-hud') : null;
let last = {};
export function publish(update) {
  last = { ...last, ...update, t: Date.now() };
  if (ch) ch.postMessage(last);
  try { localStorage.setItem('lexis.hud', JSON.stringify(last)); } catch (e) {}
}
