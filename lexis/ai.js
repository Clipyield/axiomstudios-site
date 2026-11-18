// Claude calls for Live translate, "I want to say", and making new cards.
// The API key is kept only in this phone's local storage and sent only to Anthropic.

export const MODELS = {
  'claude-opus-5-5': { name: 'Claude Opus 5.5 (smartest)', inUsd: 4, outUsd: 20 },
  'claude-haiku-5-5': { name: 'Claude Haiku 5.5 (fast, cheap)', inUsd: 0.10, outUsd: 0.50 },
};
export const DEFAULT_MODEL = 'claude-haiku-5-5'; // Okan's choice (18 Nov 2026): fast and cheap for live use

let clientPromise = null;
let clientKey = null;

async function getClient(apiKey) {
  if (!clientPromise || clientKey !== apiKey) {
    clientKey = apiKey;
    clientPromise = import('./vendor/anthropic.js').then(({ Anthropic }) =>
      new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 45000 }));
  }
  return clientPromise;
}

const LINE = {
  type: 'object',
  properties: {
    zh: { type: 'string', description: 'Simplified Chinese characters' },
    py: { type: 'string', description: 'Pinyin with tone marks' },
    say: { type: 'string', description: 'Easy English-letter pronunciation, e.g. "nee how"' },
    en: { type: 'string', description: 'English meaning' },
  },
  required: ['zh', 'py', 'say', 'en'],
  additionalProperties: false,
};

const SCHEMAS = {
  live: {
    type: 'object',
    properties: {
      heard: LINE,
      replies: { type: 'array', items: LINE, description: '2-3 short replies the learner could say back' },
      tip: { type: 'string', description: 'One short plain-English tip, or empty' },
    },
    required: ['heard', 'replies', 'tip'],
    additionalProperties: false,
  },
  say: {
    type: 'object',
    properties: { best: LINE, simpler: LINE },
    required: ['best', 'simpler'],
    additionalProperties: false,
  },
  cards: {
    type: 'object',
    properties: { cards: { type: 'array', items: LINE } },
    required: ['cards'],
    additionalProperties: false,
  },
};

function systemPrompt(profile) {
  return [
    'You help a complete beginner speak Mandarin Chinese while travelling in mainland China.',
    `Learner: ${profile.name || 'the learner'}, from ${profile.from || 'Austria'}. Interests: ${(profile.interests || []).join(', ') || 'travel'}.`,
    profile.about ? `About them: ${profile.about}` : '',
    'Rules: use Simplified Chinese; keep replies short (2-8 characters when possible) and polite; standard Mandarin as spoken in mainland China.',
    'The "say" field spells the sound with plain English letters a beginner can read aloud (no tone marks), hyphens between syllables of one word.',
    'Never invent facts about places or prices. If speech-recognition text looks garbled, give your best guess of what was meant.',
  ].filter(Boolean).join('\n');
}

export async function callClaude(kind, userText, settings, profile) {
  const client = await getClient(settings.apiKey);
  const model = settings.model || DEFAULT_MODEL;
  const req = {
    model,
    max_tokens: 4000,
    system: systemPrompt(profile),
    messages: [{ role: 'user', content: userText }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMAS[kind] } },
  };
  let res;
  if (model === 'claude-opus-5-5') {
    // Server-side fallback: if Opus declines, the API retries on a suitable model in the same call.
    res = await client.beta.messages.create({ ...req, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } else {
    res = await client.messages.create(req);
  }
  if (res.stop_reason === 'refusal') throw new Error('Claude declined this one. Try rephrasing.');
  if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut off. Try a shorter sentence.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const price = MODELS[res.model] || MODELS[model] || MODELS[DEFAULT_MODEL];
  const usd = (res.usage.input_tokens * price.inUsd + res.usage.output_tokens * price.outUsd) / 1e6;
  return { data: JSON.parse(text), usd };
}

export function livePrompt(heardZh, history, lang) {
  const ctx = history.slice(-6).map((h) => `${h.who === 'them' ? 'They' : 'Me'}: ${h.zh}`).join('\n');
  return `${ctx ? 'Conversation so far:\n' + ctx + '\n\n' : ''}They just said (speech recognition, may contain errors): "${heardZh}"\n` +
    `Translate it into ${lang === 'de' ? 'German' : 'English'} (put that in heard.en), give its Chinese, pinyin and "say" spelling, ` +
    `and suggest 2-3 short natural replies I could say back (put the meaning of each in ${lang === 'de' ? 'German' : 'English'}).`;
}

export function sayPrompt(myText) {
  return `I want to say this in Chinese: "${myText}"\nGive the most natural way (best) and an easier, shorter way a beginner can manage (simpler).`;
}

export function cardsPrompt(source, count) {
  return `Make ${count} useful phrase flashcards for my China trip from the material below. ` +
    `Prefer short phrases I would actually say or hear. Skip anything I already have in the starter deck basics.\n\nMaterial:\n${source}`;
}
