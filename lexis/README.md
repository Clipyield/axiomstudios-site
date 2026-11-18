# AXIOM.lexis

Personal Chinese app for Okan's 2027 China trip. Phone first, smart glasses later.
Plain HTML/JS, no build step. Served at `/lexis/` (hidden page, `noindex`).

- **Learn**: travel phrases (`phrases.js`) scheduled with FSRS-5 (`fsrs.js`). Speak first, then check.
- **Live**: phone listens for Chinese (browser speech recognition, `speech.js`), Claude translates and
  suggests 2-3 replies (`ai.js`). Without an API key, known phrases are still recognised.
- **Teleprompter**: big "say it like" text, sound guide, characters, play-aloud, "show them" mode.
- **Glasses view**: `hud.html` mirrors the latest line (BroadcastChannel). Open it on a mirrored
  display or a glasses browser; a native glasses app can subscribe to the same messages later.
- **Me**: profile, interests, API key (stored only on the phone), model, daily US$ budget,
  "make phrases from my stuff", backup/restore.

Default AI model: Claude Haiku 5.5 (Okan's choice, fast and cheap). Claude Opus 5.5 selectable in Me.
`vendor/` holds browser bundles of `@anthropic-ai/sdk@1.10.0` and `pinyin-pro@3.29.5` (MIT), made with esbuild.

Test the scheduler: `node lexis/test_fsrs.mjs`
