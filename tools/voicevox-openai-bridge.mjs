import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_ENGINE_BASE_URL = 'http://127.0.0.1:50021/';
const AUTO_MODEL_ID = 'voicevox';
const DEFAULT_MODEL = 'voicevox-tts';
const RAW_MODEL_ID = `${DEFAULT_MODEL}-raw`;
const ENGLISH_MODEL_ID = `${DEFAULT_MODEL}-en`;
const DEFAULT_PORT = 55221;
const MAX_BODY_SIZE = 1024 * 1024;
const SPEAKERS_CACHE_TTL_MS = 30_000;
const ENGINE_BOOT_TIMEOUT_MS = 30_000;
const ENGINE_BOOT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_SPEED_MULTIPLIER = 1.25;
const MAX_RECENT_EVENTS = 40;

const BRIDGE_PORT = toSafePort(process.env.VOICEVOX_BRIDGE_PORT ?? process.env.PORT, DEFAULT_PORT);
const ENGINE_BASE_URL = normalizeBaseUrl(process.env.VOICEVOX_BASE_URL || DEFAULT_ENGINE_BASE_URL);
const MODEL_ID = (process.env.VOICEVOX_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
const TURKISH_MODEL_ID = `${MODEL_ID}-tr`;
const DEFAULT_VOICE = (process.env.VOICEVOX_DEFAULT_VOICE || '').trim();
const AUTO_START_ENGINE = !['0', 'false', 'no'].includes(String(process.env.VOICEVOX_AUTO_START ?? '1').trim().toLowerCase());
const ENGINE_RUN_EXE = (process.env.VOICEVOX_RUN_EXE || getDefaultVoicevoxRunExe()).trim();
const DEFAULT_TEXT_MODE = normalizeTextMode(process.env.VOICEVOX_TEXT_MODE || 'auto');
const DEFAULT_EMOTION_MODE = normalizeEmotionMode(process.env.VOICEVOX_EMOTION_MODE || 'auto');
const SPEED_MULTIPLIER = normalizeSpeedMultiplier(process.env.VOICEVOX_SPEED_MULTIPLIER, DEFAULT_SPEED_MULTIPLIER);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOOLKIT_DIR = path.resolve(SCRIPT_DIR, '..');
const TURKISH_OVERRIDES_PATH = (process.env.VOICEVOX_TR_OVERRIDES_PATH || path.join(TOOLKIT_DIR, 'tr-overrides.json')).trim();
const ENGLISH_OVERRIDES_PATH = (process.env.VOICEVOX_EN_OVERRIDES_PATH || path.join(TOOLKIT_DIR, 'en-overrides.json')).trim();
const JAPANESE_VERBAL_PHRASES_PATH = (process.env.VOICEVOX_JP_PHRASES_PATH || path.join(TOOLKIT_DIR, 'data', 'anime-japanese-phrases.json')).trim();
const DEFAULT_LOG_PATH = path.join(TOOLKIT_DIR, 'voicevox-bridge.log');
const LOG_PATH = (process.env.VOICEVOX_LOG_PATH || DEFAULT_LOG_PATH).trim();

let engineBootPromise = null;
let speakersCache = {
  expiresAt: 0,
  data: null,
};
let turkishOverridesCache = null;
let englishOverridesCache = null;
let japaneseVerbalPatternsCache = null;
let recentEvents = [];
const partialTagCarry = new Map();
const TURKISH_CHAR_PATTERN = /[\u00c2\u00ce\u00db\u00e2\u00ee\u00fb\u00c7\u00d6\u00dc\u00e7\u00f6\u00fc\u011e\u0130\u015e\u011f\u0131\u015f]/u;
const TURKISH_HINT_WORDS = new Set([
  'askim',
  'bugun',
  'cunku',
  'degil',
  'gorusuruz',
  'gunaydin',
  'hosgeldin',
  'lutfen',
  'merhaba',
  'nasilsin',
  'simdi',
  'tesekkur',
  'tesekkurler',
  'turkce',
  'yarin',
]);
const ENGLISH_HINT_WORDS = new Set([
  'a',
  'and',
  'are',
  'can',
  'dont',
  'for',
  'good',
  'hello',
  'help',
  'hey',
  'hi',
  'how',
  'i',
  'im',
  'is',
  'it',
  'love',
  'my',
  'night',
  'no',
  'not',
  'okay',
  'please',
  'really',
  'sorry',
  'thanks',
  'thank',
  'the',
  'this',
  'today',
  'want',
  'what',
  'why',
  'yes',
  'you',
  'your',
  'youre',
]);
const ENGLISH_CONTRACTION_PATTERN = /\b(?:i'm|you're|we're|they're|it's|that's|what's|don't|can't|won't|didn't|isn't|aren't)\b/iu;
const MOOD_TAG_PATTERN = /\[\[\s*(?:mood|emotion|emote)\s*[:=]\s*([a-z_-]+)\s*\]\]/giu;
const STYLE_TAG_PATTERN = /\[\[\s*(?:voice|style)\s*[:=]\s*([^\]]+?)\s*\]\]/giu;
const SEGMENT_TAG_PATTERN = /\[\[\s*(?:(?:mood|emotion|emote)\s*[:=]\s*([a-z_-]+)|(?:voice|style)\s*[:=]\s*([^\]]+?))\s*\]\]/giu;
const HTML_COMMENT_SEGMENT_TAG_PATTERN = /<!--\s*tts\s*:\s*(?:(?:mood|emotion)\s*=\s*([a-z_-]+)|(?:voice|style)\s*=\s*([^-]+?))\s*-->/giu;
const CONTROL_DIRECTIVE_PATTERN = /\|[A-Z_]+(?::[^|]*)?\|/gu;
const PARTIAL_STYLE_OPEN_TAG_AT_END_PATTERN = /\[\[\s*(?:voice|style)\s*[:=]\s*$/iu;
const PARTIAL_MOOD_OPEN_TAG_AT_END_PATTERN = /\[\[\s*(?:mood|emotion|emote)\s*[:=]\s*$/iu;
const ORPHAN_STYLE_TAIL_AT_START_PATTERN = /^\s*(\d+)\]\]\s*/u;
const ORPHAN_MOOD_TAIL_AT_START_PATTERN = /^\s*([a-z_-]+)\]\]\s*/iu;
const PARTIAL_TAG_TTL_MS = 2500;
const JAPANESE_VERBAL_PHRASES = [
  ['ara ara', 'あら、あら'],
  ['nani', 'なに'],
  ['baka', 'ばか'],
  ['kawaii', 'かわいい'],
  ['sugoi', 'すごい'],
  ['yatta', 'やった'],
  ['masaka', 'まさか'],
  ['uso', 'うそ'],
  ['hontou', 'ほんとう'],
  ['naruhodo', 'なるほど'],
  ['yare yare', 'やれやれ'],
  ['maji de', 'マジで'],
  ['hidoi', 'ひどい'],
  ['kowai', 'こわい'],
  ['abunai', 'あぶない'],
  ['ureshii', 'うれしい'],
  ['kanashii', 'かなしい'],
  ['oishii', 'おいしい'],
  ['ohayou', 'おはよう'],
  ['konnichiwa', 'こんにちは'],
  ['konbanwa', 'こんばんは'],
  ['oyasumi', 'おやすみ'],
  ['sayonara', 'さよなら'],
  ['itadakimasu', 'いただきます'],
  ['gochisousama', 'ごちそうさま'],
  ['ittekimasu', 'いってきます'],
  ['itterasshai', 'いってらっしゃい'],
  ['tadaima', 'ただいま'],
  ['okaeri', 'おかえり'],
  ['arigatou', 'ありがとう'],
  ['sumimasen', 'すみません'],
  ['gomen', 'ごめん'],
  ['yoroshiku', 'よろしく'],
  ['omedetou', 'おめでとう'],
  ['ganbatte', 'がんばって'],
  ['ki wo tsukete', 'きをつけて'],
  ['odaiji ni', 'おだいじに'],
  ['yamete', 'やめて'],
  ['dame', 'だめ'],
  ['chotto matte', 'ちょっと、まって'],
  ['tasukete', 'たすけて'],
  ['ike', 'いけ'],
  ['hayaku', 'はやく'],
  ['mou yamete', 'もう、やめて'],
  ['shimatta', 'しまった'],
  ['daijoubu', 'だいじょうぶ'],
  ['muri', 'むり'],
  ['wakarimashita', 'わかりました'],
  ['wakaranai', 'わからない'],
  ['shinjirarenai', 'しんじられない'],
  ['damare', 'だまれ'],
  ['dete ike', 'でていけ'],
  ['ganbare', 'がんばれ'],
  ['abayo', 'あばよ'],
  ['ikuzo', 'いくぞ'],
  ['zettai ni', 'ぜったいに'],
  ['mochiron', 'もちろん'],
  ['suki da', 'すきだ'],
  ['daisuki', 'だいすき'],
  ['aishiteru', 'あいしてる'],
  ['hazukashii', 'はずかしい'],
  ['doki doki', 'ドキ、ドキ'],
  ['waku waku', 'ワク、ワク'],
  ['tuturu', 'トゥットゥルー'],
  ['nico nico nii', 'にっこ、にっこ、にー'],
  ['uguu', 'うぐぅ'],
  ['pika pika', 'ピカ、ピカ'],
  ['kira kira', 'キラ、キラ'],
  ['banzai', 'ばんざい'],
  ['itai', 'いたい'],
  ['kuso', 'くそ'],
  ['ja ne', 'じゃあね'],
];
const MOOD_NAMES = ['normal', 'calm', 'shy', 'strong', 'sad', 'excited', 'whisper', 'serious', 'sleepy'];
const MOOD_ALIASES = new Map([
  ['normal', 'normal'],
  ['neutral', 'normal'],
  ['calm', 'calm'],
  ['gentle', 'calm'],
  ['soft', 'calm'],
  ['shy', 'shy'],
  ['embarrassed', 'shy'],
  ['bashful', 'shy'],
  ['romantic', 'shy'],
  ['strong', 'strong'],
  ['angry', 'strong'],
  ['confident', 'strong'],
  ['dominant', 'strong'],
  ['sad', 'sad'],
  ['crying', 'sad'],
  ['fear', 'sad'],
  ['scared', 'sad'],
  ['excited', 'excited'],
  ['happy', 'excited'],
  ['energetic', 'excited'],
  ['whisper', 'whisper'],
  ['secret', 'whisper'],
  ['serious', 'serious'],
  ['seriously', 'serious'],
  ['sleepy', 'sleepy'],
  ['tired', 'sleepy'],
]);
const STYLE_MOOD_EXACT = new Map([
  ['normal', new Set(['\u30ce\u30fc\u30de\u30eb', '\u3075\u3064\u3046'])],
  ['calm', new Set(['\u304a\u3061\u3064\u304d', '\u306e\u3093\u3073\u308a', '\u3057\u3063\u3068\u308a', '\u697d\u3005', '\u8aad\u307f\u805e\u304b\u305b', '\u4eba\u9593ver.'])],
  ['shy', new Set(['\u4eba\u898b\u77e5\u308a', '\u3042\u307e\u3042\u307e', '\u7518\u3005', '\u3055\u3055\u3084\u304d', '\u30d2\u30bd\u30d2\u30bd', '\u5185\u7dd2\u8a71'])],
  ['strong', new Set(['\u3064\u3088\u3064\u3088', '\u30c4\u30f3\u30c4\u30f3', '\u71b1\u8840', '\u6012\u308a', '\u304a\u3053', '\u899a\u9192', '\u5b9f\u6cc1\u98a8', '\u30bb\u30af\u30b7\u30fc', '\u30af\u30a4\u30fc\u30f3'])],
  ['sad', new Set(['\u304b\u306a\u3057\u3044', '\u304b\u306a\u3057\u307f', '\u60b2\u3057\u307f', '\u54c0\u3057\u307f', '\u3073\u3048\u30fc\u3093', '\u306a\u307f\u3060\u3081', '\u6ce3\u304d', '\u3088\u308f\u3088\u308f', '\u6050\u6016', '\u7d76\u671b\u3068\u6557\u5317'])],
  ['excited', new Set(['\u3046\u304d\u3046\u304d', '\u5143\u6c17', '\u305f\u306e\u3057\u3044', '\u559c\u3073', '\u308f\u30fc\u3044', '\u3076\u308a\u3063\u5b50'])],
  ['whisper', new Set(['\u3055\u3055\u3084\u304d', '\u30d2\u30bd\u30d2\u30bd', '\u5185\u7dd2\u8a71'])],
  ['serious', new Set(['\u30b7\u30ea\u30a2\u30b9', '\u30a2\u30ca\u30a6\u30f3\u30b9'])],
  ['sleepy', new Set(['\u3078\u308d\u3078\u308d', '\u30d8\u30ed\u30d8\u30ed', '\u4f4e\u8840\u5727', '\u3051\u3060\u308b\u3052'])],
]);
const STYLE_PRIORITY_BY_MOOD = new Map([
  ['normal', ['normal']],
  ['calm', ['calm', 'whisper', 'normal', 'serious']],
  ['shy', ['shy', 'whisper', 'calm', 'normal']],
  ['strong', ['strong', 'excited', 'serious', 'normal']],
  ['sad', ['sad', 'whisper', 'sleepy', 'calm', 'normal']],
  ['excited', ['excited', 'strong', 'normal']],
  ['whisper', ['whisper', 'shy', 'calm', 'normal']],
  ['serious', ['serious', 'calm', 'normal', 'strong']],
  ['sleepy', ['sleepy', 'calm', 'sad', 'normal']],
]);
const MOOD_RULES = {
  calm: [
    /\b(sakin|rahat|usul|yavas|dinlen|merak etme|buradayim|yanindayim|iyisin|sorun yok|tamamdir|good night|its okay|calm down)\b/gu,
  ],
  shy: [
    /\b(sey|eeto|eto|umm|uhm|utan(?:iyorum|iyorum)|cekin(?:iyorum|iyorum)|askim|seviyorum|hoslandim)\b/gu,
    /\.{3,}|…/gu,
    /[<3❤💕💗💓]/gu,
  ],
  strong: [
    /\b(hayir|asla|kesin|yeter|simdi|hemen|dinle|sus|pes etmeyecegim|kazanacagim|durduramazsin|farketmez|never|listen)\b/gu,
  ],
  sad: [
    /\b(uzgun(?:um)?|korktum|yalniz(?:im)?|ozur dilerim|ozur|agla(?:mak)?|gozyasi|kaybettim|bittim|hurt|sorry|lonely|cry)\b/gu,
  ],
  excited: [
    /\b(harika|super|muthis|yasasin|hey|wow|cok iyi|sevindim|mutluyum|hadi|amazing|awesome|yay)\b/gu,
  ],
  whisper: [
    /\b(fisil|sessiz|kimseye soyleme|gizli|sir|yaklas|kulagina|whisper|secret)\b/gu,
  ],
  serious: [
    /\b(dikkat|rapor|analiz|tespit|resmi|aciklama|uyari|warning|report|analysis|important)\b/gu,
  ],
  sleepy: [
    /\b(uykulu(?:yum)?|uykum geldi|yorgun(?:um)?|bitkin(?:im)?|offf|esniyorum|sleepy|tired)\b/gu,
  ],
};

function normalizeBaseUrl(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeTextMode(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['auto', 'detect'].includes(normalized)) {
    return 'auto';
  }
  if (['tr', 'turkish'].includes(normalized)) {
    return 'tr';
  }
  if (['en', 'english'].includes(normalized)) {
    return 'en';
  }
  return 'raw';
}

function normalizeEmotionMode(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['0', 'off', 'fixed', 'disabled'].includes(normalized)) {
    return 'off';
  }
  return 'auto';
}

function toSafePort(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
    return parsed;
  }
  return fallback;
}

function normalizeSpeedMultiplier(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ''));
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function getDefaultVoicevoxRunExe() {
  if (process.platform !== 'win32') {
    return '';
  }
  return path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'VOICEVOX', 'vv-engine', 'run.exe');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Expose-Headers',
    [
      'Content-Type',
      'X-Voicevox-Base-Voice-Id',
      'X-Voicevox-Voice-Id',
      'X-Voicevox-Text-Mode',
      'X-Voicevox-Emotion',
      'X-Voicevox-Emotion-Reason',
      'X-Voicevox-Segment-Count',
      'X-Voicevox-Segment-Summary',
      'X-Voicevox-Log-Time',
    ].join(', ')
  );
}

function writeJson(res, statusCode, payload) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function writeError(res, statusCode, message, extra = {}) {
  writeJson(res, statusCode, {
    error: {
      message,
      type: 'voicevox_bridge_error',
      ...extra,
    },
  });
}

function compactTextPreview(value, maxLength = 140) {
  const normalized = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function rememberEvent(event) {
  recentEvents = [event, ...recentEvents].slice(0, MAX_RECENT_EVENTS);
}

function logBridgeEvent(kind, payload) {
  const event = {
    timestamp: new Date().toISOString(),
    kind,
    ...payload,
  };

  rememberEvent(event);

  try {
    appendFileSync(LOG_PATH, `${JSON.stringify(event)}\n`, 'utf8');
  }
  catch {
    // Logging must never break synthesis.
  }

  return event;
}

function buildRecentEventsPayload() {
  return {
    object: 'list',
    data: recentEvents,
  };
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_SIZE) {
      const error = new Error(`Request body is too large. Limit is ${MAX_BODY_SIZE} bytes.`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  }
  catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

async function fetchEngineText(relativePath) {
  const url = new URL(relativePath, ENGINE_BASE_URL);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`VOICEVOX engine returned ${response.status} for ${url.pathname}.`);
  }
  return response.text();
}

async function checkEngineOnline() {
  try {
    const version = (await fetchEngineText('version')).trim();
    return {
      ok: true,
      version,
    };
  }
  catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function tryAutoStartEngine() {
  if (!AUTO_START_ENGINE || !ENGINE_RUN_EXE) {
    return false;
  }

  await access(ENGINE_RUN_EXE);
  spawn(ENGINE_RUN_EXE, ['--output_log_utf8'], {
    cwd: path.dirname(ENGINE_RUN_EXE),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();

  return true;
}

async function ensureEngineReady() {
  const current = await checkEngineOnline();
  if (current.ok) {
    return current;
  }

  if (!AUTO_START_ENGINE) {
    const error = new Error(`VOICEVOX engine is offline: ${current.error}`);
    error.statusCode = 502;
    throw error;
  }

  if (!engineBootPromise) {
    engineBootPromise = (async () => {
      try {
        await tryAutoStartEngine();

        const deadline = Date.now() + ENGINE_BOOT_TIMEOUT_MS;
        while (Date.now() < deadline) {
          const status = await checkEngineOnline();
          if (status.ok) {
            return status;
          }
          await sleep(ENGINE_BOOT_POLL_INTERVAL_MS);
        }

        const error = new Error(`VOICEVOX engine did not become ready within ${ENGINE_BOOT_TIMEOUT_MS / 1000} seconds.`);
        error.statusCode = 504;
        throw error;
      }
      finally {
        engineBootPromise = null;
      }
    })();
  }

  return engineBootPromise;
}

async function fetchJson(relativePath, init) {
  const url = new URL(relativePath, ENGINE_BASE_URL);
  const response = await fetch(url, init);
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    const error = new Error(`VOICEVOX engine returned ${response.status} for ${url.pathname}.${details ? ` ${details}` : ''}`);
    error.statusCode = 502;
    throw error;
  }
  return response.json();
}

async function fetchSpeakers(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && speakersCache.data && speakersCache.expiresAt > now) {
    return speakersCache.data;
  }

  await ensureEngineReady();
  const speakers = await fetchJson('speakers');
  speakersCache = {
    data: Array.isArray(speakers) ? speakers : [],
    expiresAt: now + SPEAKERS_CACHE_TTL_MS,
  };
  return speakersCache.data;
}

function flattenVoices(speakers) {
  return speakers.flatMap((speaker) => {
    const speakerName = String(speaker.name ?? '').trim();
    const speakerUuid = String(speaker.speaker_uuid ?? '').trim();
    const styles = Array.isArray(speaker.styles) ? speaker.styles : [];

    return styles.map((style) => {
      const styleName = String(style.name ?? '').trim();
      const id = Number(style.id);
      return {
        id,
        label: `${speakerName}/${styleName}`,
        speakerName,
        speakerUuid,
        styleName,
        type: String(style.type ?? '').trim(),
      };
    });
  }).filter(voice => Number.isFinite(voice.id));
}

function normalizeVoiceLookup(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[：:]/g, '/')
    .replace(/[()]/g, '')
    .replace(/\s+/g, '');
}

function findVoiceCandidates(voices, voiceValue) {
  if (voiceValue == null || String(voiceValue).trim() === '') {
    return [];
  }

  if (typeof voiceValue === 'number' && Number.isFinite(voiceValue)) {
    return voices.filter(voice => voice.id === voiceValue);
  }

  const raw = String(voiceValue).trim();
  if (/^\d+$/.test(raw)) {
    const numericId = Number(raw);
    return voices.filter(voice => voice.id === numericId);
  }

  const needle = normalizeVoiceLookup(raw);
  const exactMatches = voices.filter((voice) => {
    const aliases = [
      voice.label,
      `${voice.speakerName}:${voice.styleName}`,
      `${voice.speakerName} ${voice.styleName}`,
      `${voice.speakerName}(${voice.styleName})`,
      voice.styleName,
    ];
    return aliases.some(alias => normalizeVoiceLookup(alias) === needle);
  });

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  return voices.filter((voice) => {
    const haystacks = [
      voice.label,
      `${voice.speakerName}:${voice.styleName}`,
      `${voice.speakerName} ${voice.styleName}`,
      voice.styleName,
    ];
    return haystacks.some(value => normalizeVoiceLookup(value).includes(needle));
  });
}

async function resolveVoice(voiceValue) {
  const voices = flattenVoices(await fetchSpeakers());
  if (voices.length === 0) {
    const error = new Error('VOICEVOX engine returned no speakers.');
    error.statusCode = 502;
    throw error;
  }

  const requested = voiceValue ?? DEFAULT_VOICE;
  if (requested == null || String(requested).trim() === '') {
    return voices[0];
  }

  const candidates = findVoiceCandidates(voices, requested);
  if (candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length > 1) {
    const hint = candidates.slice(0, 5).map(voice => `"${voice.label}" (#${voice.id})`).join(', ');
    const error = new Error(`Voice "${requested}" is ambiguous. Try a numeric style id or a full label such as ${hint}.`);
    error.statusCode = 400;
    throw error;
  }

  const error = new Error(`Voice "${requested}" was not found. Open http://127.0.0.1:${BRIDGE_PORT}/v1/voices to inspect available styles.`);
  error.statusCode = 400;
  throw error;
}

function foldEmotionText(value) {
  return String(value ?? '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc']/gu, '')
    .replace(/\u00e2/gu, 'a')
    .replace(/\u00ee/gu, 'i')
    .replace(/\u00fb/gu, 'u')
    .replace(/\u00e7/gu, 'c')
    .replace(/\u011f/gu, 'g')
    .replace(/\u0131/gu, 'i')
    .replace(/\u00f6/gu, 'o')
    .replace(/\u015f/gu, 's')
    .replace(/\u00fc/gu, 'u');
}

function normalizeMoodAlias(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return MOOD_ALIASES.get(normalized) ?? 'normal';
}

function normalizeDirectiveMarkup(input) {
  return String(input ?? '')
    .replace(HTML_COMMENT_SEGMENT_TAG_PATTERN, (_, moodValue, voiceValue) => {
      if (moodValue) {
        return ` [[mood:${String(moodValue).trim()}]] `;
      }
      if (voiceValue) {
        return ` [[voice:${String(voiceValue).trim()}]] `;
      }
      return ' ';
    })
    .replace(CONTROL_DIRECTIVE_PATTERN, ' ')
    .replace(/[ \t]{2,}/g, ' ');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeJapaneseVerbalPhraseLookup(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/gu, ' ')
    .replace(/\s+/gu, ' ');
}

function createJapaneseVerbalPatterns(entries) {
  return entries
    .slice()
    .sort((left, right) => right[0].length - left[0].length)
    .map(([phrase, output]) => {
      const body = phrase
        .split(/\s+/u)
        .map(part => escapeRegExp(part))
        .join('[\\s_-]+');
      return {
        output,
        pattern: new RegExp(`(^|[^\\p{Script=Latin}\\p{Number}])(${body})(?=$|[^\\p{Script=Latin}\\p{Number}])`, 'giu'),
      };
    });
}

function loadJapaneseVerbalPatterns() {
  if (japaneseVerbalPatternsCache != null) {
    return japaneseVerbalPatternsCache;
  }

  let entries = [];

  if (existsSync(JAPANESE_VERBAL_PHRASES_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(JAPANESE_VERBAL_PHRASES_PATH, 'utf8'));
      entries = Object.entries(parsed ?? {})
        .filter(([key, value]) => typeof key === 'string' && typeof value === 'string')
        .map(([key, value]) => [normalizeJapaneseVerbalPhraseLookup(key), value.trim()])
        .filter(([key, value]) => key.length > 0 && value.length > 0);
    }
    catch {
      entries = [];
    }
  }

  if (entries.length === 0) {
    entries = JAPANESE_VERBAL_PHRASES
      .map(([key, value]) => [normalizeJapaneseVerbalPhraseLookup(key), String(value).trim()])
      .filter(([key, value]) => key.length > 0 && value.length > 0);
  }

  japaneseVerbalPatternsCache = createJapaneseVerbalPatterns(Array.from(new Map(entries).entries()));
  return japaneseVerbalPatternsCache;
}

function applyJapaneseVerbalPhraseOverrides(input) {
  let output = String(input ?? '');

  output = output
    .replace(/(^|[^\p{Script=Latin}\p{Number}])(eto+|etto+)(?=$|[^\p{Script=Latin}\p{Number}])/giu, '$1えっと…')
    .replace(/(^|[^\p{Script=Latin}\p{Number}])(eh+h+)(?=$|[^\p{Script=Latin}\p{Number}])/giu, '$1ええーっ')
    .replace(/(^|[^\p{Script=Latin}\p{Number}])(nya+a*[~〜]*)(?=$|[^\p{Script=Latin}\p{Number}])/giu, '$1にゃー、')
    .replace(/(^|[^\p{Script=Latin}\p{Number}])(fufu+[~〜]*)(?=$|[^\p{Script=Latin}\p{Number}])/giu, '$1ふふふ…')
    .replace(/(^|[^\p{Script=Latin}\p{Number}])(hehe+[~〜]*)(?=$|[^\p{Script=Latin}\p{Number}])/giu, '$1へへ…');

  for (const { pattern, output: replacement } of loadJapaneseVerbalPatterns()) {
    output = output.replace(pattern, `$1${replacement}`);
  }

  return output;
}

function getPartialTagCarryKey(requestBody) {
  return [
    typeof requestBody.model === 'string' ? requestBody.model.trim().toLowerCase() : '',
    requestBody.voice == null ? '' : String(requestBody.voice).trim(),
  ].join('|');
}

function repairStreamingTagFragments(input, requestBody) {
  const key = getPartialTagCarryKey(requestBody);
  const now = Date.now();
  const carry = partialTagCarry.get(key);
  let value = String(input ?? '');

  if (carry && now - carry.timestamp <= PARTIAL_TAG_TTL_MS) {
    if (carry.kind === 'style') {
      value = value.replace(ORPHAN_STYLE_TAIL_AT_START_PATTERN, (_, idValue) => {
        return `[[voice:${String(idValue).trim()}]] `;
      });
    }
    else if (carry.kind === 'mood') {
      value = value.replace(ORPHAN_MOOD_TAIL_AT_START_PATTERN, (_, moodValue) => {
        return `[[mood:${String(moodValue).trim()}]] `;
      });
    }
    partialTagCarry.delete(key);
  }
  else if (carry) {
    partialTagCarry.delete(key);
  }

  value = value.replace(ORPHAN_STYLE_TAIL_AT_START_PATTERN, '');
  value = value.replace(ORPHAN_MOOD_TAIL_AT_START_PATTERN, '');

  if (PARTIAL_STYLE_OPEN_TAG_AT_END_PATTERN.test(value)) {
    partialTagCarry.set(key, { kind: 'style', timestamp: now });
    value = value.replace(PARTIAL_STYLE_OPEN_TAG_AT_END_PATTERN, ' ');
  }
  else if (PARTIAL_MOOD_OPEN_TAG_AT_END_PATTERN.test(value)) {
    partialTagCarry.set(key, { kind: 'mood', timestamp: now });
    value = value.replace(PARTIAL_MOOD_OPEN_TAG_AT_END_PATTERN, ' ');
  }

  return value;
}

function stripMoodDirectives(input) {
  const raw = normalizeDirectiveMarkup(input);
  const matches = Array.from(raw.matchAll(MOOD_TAG_PATTERN));
  const explicitMood = matches.length > 0 ? normalizeMoodAlias(matches[matches.length - 1][1]) : null;
  const cleanedInput = raw.replace(MOOD_TAG_PATTERN, '').replace(/[ \t]{2,}/g, ' ').trim();

  return {
    explicitMood,
    cleanedInput,
  };
}

function stripSegmentDirectives(input) {
  const raw = normalizeDirectiveMarkup(input);
  const moodMatches = Array.from(raw.matchAll(MOOD_TAG_PATTERN));
  const styleMatches = Array.from(raw.matchAll(STYLE_TAG_PATTERN));
  const explicitMood = moodMatches.length > 0 ? normalizeMoodAlias(moodMatches[moodMatches.length - 1][1]) : null;
  const explicitVoice = styleMatches.length > 0 ? String(styleMatches[styleMatches.length - 1][1]).trim() : null;
  const cleanedInput = raw
    .replace(MOOD_TAG_PATTERN, ' ')
    .replace(STYLE_TAG_PATTERN, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return {
    explicitMood,
    explicitVoice,
    cleanedInput,
  };
}

function splitMoodTaggedSegments(input) {
  const raw = normalizeDirectiveMarkup(input);
  const matches = Array.from(raw.matchAll(MOOD_TAG_PATTERN));
  if (matches.length === 0) {
    return [];
  }

  const segments = [];
  let activeMood = null;
  let lastIndex = 0;

  for (const match of matches) {
    const textBeforeTag = raw.slice(lastIndex, match.index).replace(/[ \t]{2,}/g, ' ').trim();
    if (textBeforeTag) {
      segments.push({
        explicitMood: activeMood,
        text: textBeforeTag,
      });
    }

    activeMood = normalizeMoodAlias(match[1]);
    lastIndex = match.index + match[0].length;
  }

  const tail = raw.slice(lastIndex).replace(/[ \t]{2,}/g, ' ').trim();
  if (tail) {
    segments.push({
      explicitMood: activeMood,
      text: tail,
    });
  }

  return segments;
}

function splitTaggedSegments(input) {
  const raw = normalizeDirectiveMarkup(input);
  const matches = Array.from(raw.matchAll(SEGMENT_TAG_PATTERN));
  if (matches.length === 0) {
    return [];
  }

  const segments = [];
  let activeMood = null;
  let activeVoice = null;
  let lastIndex = 0;

  for (const match of matches) {
    const textBeforeTag = raw.slice(lastIndex, match.index).replace(/[ \t]{2,}/g, ' ').trim();
    if (textBeforeTag) {
      segments.push({
        explicitMood: activeMood,
        explicitVoice: activeVoice,
        text: textBeforeTag,
      });
    }

    if (match[1]) {
      activeMood = normalizeMoodAlias(match[1]);
      activeVoice = null;
    }
    else if (match[2]) {
      activeVoice = String(match[2]).trim();
      activeMood = null;
    }

    lastIndex = match.index + match[0].length;
  }

  const tail = raw.slice(lastIndex).replace(/[ \t]{2,}/g, ' ').trim();
  if (tail) {
    segments.push({
      explicitMood: activeMood,
      explicitVoice: activeVoice,
      text: tail,
    });
  }

  return segments;
}

function incrementMoodScore(scores, mood, amount) {
  scores.set(mood, (scores.get(mood) ?? 0) + amount);
}

function countRegexMatches(text, expression) {
  const matches = text.match(expression);
  return matches ? matches.length : 0;
}

function analyzeEmotionFromText(input, explicitMood) {
  if (explicitMood && MOOD_NAMES.includes(explicitMood)) {
    return {
      mood: explicitMood,
      reason: 'tag',
      scores: new Map([[explicitMood, 99]]),
    };
  }

  const raw = String(input ?? '');
  const folded = foldEmotionText(raw);
  const scores = new Map(MOOD_NAMES.map(mood => [mood, 0]));
  const exclamationCount = (raw.match(/!/g) ?? []).length;
  const questionCount = (raw.match(/\?/g) ?? []).length;
  const ellipsisCount = (raw.match(/\.{3,}|…/g) ?? []).length;

  if (exclamationCount >= 2) {
    incrementMoodScore(scores, 'strong', 2);
    incrementMoodScore(scores, 'excited', 2);
  }
  else if (exclamationCount === 1) {
    incrementMoodScore(scores, 'excited', 1);
  }

  if (questionCount >= 2) {
    incrementMoodScore(scores, 'shy', 1);
  }

  if (ellipsisCount > 0) {
    incrementMoodScore(scores, 'shy', 2);
    incrementMoodScore(scores, 'sad', 1);
  }

  for (const [mood, expressions] of Object.entries(MOOD_RULES)) {
    for (const expression of expressions) {
      incrementMoodScore(scores, mood, countRegexMatches(folded, expression) * 2);
    }
  }

  const ranked = Array.from(scores.entries()).sort((left, right) => right[1] - left[1]);
  const [topMood, topScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;

  if (topScore < 2 || topScore === secondScore) {
    return {
      mood: 'normal',
      reason: 'heuristic',
      scores,
    };
  }

  return {
    mood: topMood,
    reason: 'heuristic',
    scores,
  };
}

function categorizeStyle(styleName) {
  const categories = new Set();
  for (const [mood, names] of STYLE_MOOD_EXACT.entries()) {
    if (names.has(styleName)) {
      categories.add(mood);
    }
  }
  if (categories.size === 0) {
    categories.add('normal');
  }
  return categories;
}

function chooseVoiceForMood(baseVoice, speakerVoices, mood) {
  const priorities = STYLE_PRIORITY_BY_MOOD.get(mood) ?? STYLE_PRIORITY_BY_MOOD.get('normal');
  for (const category of priorities) {
    const matching = speakerVoices.filter((voice) => categorizeStyle(voice.styleName).has(category));
    if (matching.length > 0) {
      return matching.find(voice => voice.id === baseVoice.id) ?? matching[0];
    }
  }
  return baseVoice;
}

function resolveEmotionMode(model) {
  const requestedModel = typeof model === 'string' ? model.trim().toLowerCase() : '';
  if (requestedModel === RAW_MODEL_ID.toLowerCase()) {
    return 'off';
  }
  return DEFAULT_EMOTION_MODE;
}

async function resolveVoiceContext(voiceValue, model) {
  const voices = flattenVoices(await fetchSpeakers());
  if (voices.length === 0) {
    const error = new Error('VOICEVOX engine returned no speakers.');
    error.statusCode = 502;
    throw error;
  }

  const baseVoice = await resolveVoice(voiceValue);
  return {
    baseVoice,
    emotionMode: resolveEmotionMode(model),
    speakerVoices: voices.filter((voice) => voice.speakerName === baseVoice.speakerName),
  };
}

function resolveTaggedVoiceInContext(context, explicitVoice) {
  if (explicitVoice == null || String(explicitVoice).trim() === '') {
    return null;
  }

  const matches = findVoiceCandidates(context.speakerVoices, explicitVoice);
  if (matches.length === 0) {
    return null;
  }

  return matches[0];
}

function resolveExpressiveVoiceFromContext(context, input, explicitMood = null, explicitVoice = null) {
  const cleanedInput = String(input ?? '').replace(/[ \t]{2,}/g, ' ').trim();

  const taggedVoice = resolveTaggedVoiceInContext(context, explicitVoice);
  if (taggedVoice) {
    return {
      voice: taggedVoice,
      mood: taggedVoice.styleName || 'style',
      baseVoice: context.baseVoice,
      cleanedInput,
      emotionReason: 'style-tag',
    };
  }

  if (context.emotionMode === 'off') {
    return {
      voice: context.baseVoice,
      mood: 'fixed',
      baseVoice: context.baseVoice,
      cleanedInput,
      emotionReason: 'disabled',
    };
  }

  const emotion = analyzeEmotionFromText(cleanedInput, explicitMood);
  const voice = chooseVoiceForMood(context.baseVoice, context.speakerVoices, emotion.mood);

  return {
    voice,
    mood: emotion.mood,
    baseVoice: context.baseVoice,
    cleanedInput,
    emotionReason: emotion.reason,
  };
}

async function resolveExpressiveVoice(voiceValue, input, model) {
  const context = await resolveVoiceContext(voiceValue, model);
  const { explicitMood, explicitVoice, cleanedInput } = stripSegmentDirectives(input);
  return resolveExpressiveVoiceFromContext(context, cleanedInput, explicitMood, explicitVoice);
}

function maybeApplyNumber(target, key, value, transform = x => x) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return;
  }
  target[key] = transform(value);
}

function getSupportedModelIds() {
  return Array.from(new Set([
    AUTO_MODEL_ID,
    MODEL_ID,
    RAW_MODEL_ID,
    TURKISH_MODEL_ID,
    ENGLISH_MODEL_ID,
  ]));
}

function foldTurkishTextForDetection(value) {
  return String(value ?? '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc']/gu, '')
    .replace(/\u00e2/gu, 'a')
    .replace(/\u00ee/gu, 'i')
    .replace(/\u00fb/gu, 'u')
    .replace(/\u00e7/gu, 'c')
    .replace(/\u011f/gu, 'g')
    .replace(/\u0131/gu, 'i')
    .replace(/\u00f6/gu, 'o')
    .replace(/\u015f/gu, 's')
    .replace(/\u00fc/gu, 'u');
}

function looksLikeTurkishText(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return false;
  }

  if (TURKISH_CHAR_PATTERN.test(raw)) {
    return true;
  }

  const words = foldTurkishTextForDetection(raw).match(/[a-z]+/g) ?? [];
  if (words.length === 0) {
    return false;
  }

  let hintHits = 0;
  for (const word of words) {
    if (TURKISH_HINT_WORDS.has(word)) {
      hintHits += 1;
    }
  }

  return hintHits >= Math.min(2, words.length);
}

function foldEnglishTextForDetection(value) {
  return String(value ?? '')
    .toLocaleLowerCase('en-US')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc']/gu, '');
}

function looksLikeEnglishText(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return false;
  }

  if (TURKISH_CHAR_PATTERN.test(raw)) {
    return false;
  }

  if (ENGLISH_CONTRACTION_PATTERN.test(raw)) {
    return true;
  }

  const words = foldEnglishTextForDetection(raw).match(/[a-z]+/g) ?? [];
  if (words.length === 0) {
    return false;
  }

  let hintHits = 0;
  for (const word of words) {
    if (ENGLISH_HINT_WORDS.has(word)) {
      hintHits += 1;
    }
  }

  if (hintHits === 0) {
    return false;
  }

  if (words.length <= 2) {
    return hintHits >= 1;
  }

  return hintHits >= Math.min(3, Math.max(2, Math.ceil(words.length / 3)));
}

function resolveTextMode(model, input) {
  const requestedModel = typeof model === 'string' ? model.trim().toLowerCase() : '';
  if (requestedModel === TURKISH_MODEL_ID.toLowerCase()) {
    return 'tr';
  }
  if (requestedModel === ENGLISH_MODEL_ID.toLowerCase()) {
    return 'en';
  }
  if (requestedModel === RAW_MODEL_ID.toLowerCase()) {
    return 'raw';
  }
  if (DEFAULT_TEXT_MODE === 'tr') {
    return 'tr';
  }
  if (DEFAULT_TEXT_MODE === 'en') {
    return 'en';
  }
  if (DEFAULT_TEXT_MODE === 'auto' || requestedModel === AUTO_MODEL_ID.toLowerCase() || requestedModel === MODEL_ID.toLowerCase() || requestedModel === '') {
    if (looksLikeTurkishText(input)) {
      return 'tr';
    }
    if (looksLikeEnglishText(input)) {
      return 'en';
    }
    return 'raw';
  }
  if (looksLikeTurkishText(input)) {
    return 'tr';
  }
  if (looksLikeEnglishText(input)) {
    return 'en';
  }
  return 'raw';
}

function normalizeTurkishWordLookup(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKC');
}

function normalizeEnglishWordLookup(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('en-US')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc']/gu, '');
}

function loadTurkishOverrides() {
  if (turkishOverridesCache != null) {
    return turkishOverridesCache;
  }

  if (!existsSync(TURKISH_OVERRIDES_PATH)) {
    turkishOverridesCache = new Map();
    return turkishOverridesCache;
  }

  try {
    const parsed = JSON.parse(readFileSync(TURKISH_OVERRIDES_PATH, 'utf8'));
    const entries = Object.entries(parsed ?? {})
      .filter(([key, value]) => typeof key === 'string' && typeof value === 'string')
      .map(([key, value]) => [normalizeTurkishWordLookup(key), value.trim()]);
    turkishOverridesCache = new Map(entries);
  }
  catch {
    turkishOverridesCache = new Map();
  }

  return turkishOverridesCache;
}

function loadEnglishOverrides() {
  if (englishOverridesCache != null) {
    return englishOverridesCache;
  }

  if (!existsSync(ENGLISH_OVERRIDES_PATH)) {
    englishOverridesCache = new Map();
    return englishOverridesCache;
  }

  try {
    const parsed = JSON.parse(readFileSync(ENGLISH_OVERRIDES_PATH, 'utf8'));
    const entries = Object.entries(parsed ?? {})
      .filter(([key, value]) => typeof key === 'string' && typeof value === 'string')
      .map(([key, value]) => [normalizeEnglishWordLookup(key), value.trim()]);
    englishOverridesCache = new Map(entries);
  }
  catch {
    englishOverridesCache = new Map();
  }

  return englishOverridesCache;
}

const ROMAN_TO_KATAKANA = new Map([
  ['kya', 'キャ'], ['kyu', 'キュ'], ['kyo', 'キョ'],
  ['gya', 'ギャ'], ['gyu', 'ギュ'], ['gyo', 'ギョ'],
  ['sha', 'シャ'], ['she', 'シェ'], ['shi', 'シ'], ['shu', 'シュ'], ['sho', 'ショ'],
  ['cha', 'チャ'], ['che', 'チェ'], ['chi', 'チ'], ['chu', 'チュ'], ['cho', 'チョ'],
  ['ja', 'ジャ'], ['je', 'ジェ'], ['ji', 'ジ'], ['ju', 'ジュ'], ['jo', 'ジョ'],
  ['nya', 'ニャ'], ['nyu', 'ニュ'], ['nyo', 'ニョ'],
  ['hya', 'ヒャ'], ['hyu', 'ヒュ'], ['hyo', 'ヒョ'],
  ['bya', 'ビャ'], ['byu', 'ビュ'], ['byo', 'ビョ'],
  ['pya', 'ピャ'], ['pyu', 'ピュ'], ['pyo', 'ピョ'],
  ['mya', 'ミャ'], ['myu', 'ミュ'], ['myo', 'ミョ'],
  ['rya', 'リャ'], ['ryu', 'リュ'], ['ryo', 'リョ'],
  ['fa', 'ファ'], ['fi', 'フィ'], ['fu', 'フ'], ['fe', 'フェ'], ['fo', 'フォ'],
  ['va', 'ヴァ'], ['vi', 'ヴィ'], ['vu', 'ヴ'], ['ve', 'ヴェ'], ['vo', 'ヴォ'],
  ['ti', 'ティ'], ['tu', 'トゥ'], ['di', 'ディ'], ['du', 'ドゥ'],
  ['ye', 'イェ'],
  ['a', 'ア'], ['i', 'イ'], ['u', 'ウ'], ['e', 'エ'], ['o', 'オ'],
  ['ka', 'カ'], ['ki', 'キ'], ['ku', 'ク'], ['ke', 'ケ'], ['ko', 'コ'],
  ['ga', 'ガ'], ['gi', 'ギ'], ['gu', 'グ'], ['ge', 'ゲ'], ['go', 'ゴ'],
  ['sa', 'サ'], ['si', 'シ'], ['su', 'ス'], ['se', 'セ'], ['so', 'ソ'],
  ['za', 'ザ'], ['zi', 'ジ'], ['zu', 'ズ'], ['ze', 'ゼ'], ['zo', 'ゾ'],
  ['ta', 'タ'], ['te', 'テ'], ['to', 'ト'],
  ['da', 'ダ'], ['de', 'デ'], ['do', 'ド'],
  ['na', 'ナ'], ['ni', 'ニ'], ['nu', 'ヌ'], ['ne', 'ネ'], ['no', 'ノ'],
  ['ha', 'ハ'], ['hi', 'ヒ'], ['he', 'ヘ'], ['ho', 'ホ'],
  ['ba', 'バ'], ['bi', 'ビ'], ['bu', 'ブ'], ['be', 'ベ'], ['bo', 'ボ'],
  ['pa', 'パ'], ['pi', 'ピ'], ['pu', 'プ'], ['pe', 'ペ'], ['po', 'ポ'],
  ['ma', 'マ'], ['mi', 'ミ'], ['mu', 'ム'], ['me', 'メ'], ['mo', 'モ'],
  ['ya', 'ヤ'], ['yu', 'ユ'], ['yo', 'ヨ'],
  ['ra', 'ラ'], ['ri', 'リ'], ['ru', 'ル'], ['re', 'レ'], ['ro', 'ロ'],
  ['la', 'ラ'], ['li', 'リ'], ['lu', 'ル'], ['le', 'レ'], ['lo', 'ロ'],
  ['wa', 'ワ'], ['wo', 'ヲ'],
]);

const ROMAN_MATCH_KEYS = Array.from(ROMAN_TO_KATAKANA.keys()).sort((a, b) => b.length - a.length);

function isRomanVowel(char) {
  return ['a', 'e', 'i', 'o', 'u'].includes(char);
}

function fallbackRomanConsonant(char) {
  switch (char) {
    case 'b': return 'ブ';
    case 'c': return 'ク';
    case 'd': return 'ド';
    case 'f': return 'フ';
    case 'g': return 'グ';
    case 'h': return 'フ';
    case 'j': return 'ジ';
    case 'k': return 'ク';
    case 'l': return 'ル';
    case 'm': return 'ム';
    case 'n': return 'ン';
    case 'p': return 'プ';
    case 'q': return 'ク';
    case 'r': return 'ル';
    case 's': return 'ス';
    case 't': return 'ト';
    case 'v': return 'ヴ';
    case 'w': return 'ウ';
    case 'x': return 'クス';
    case 'y': return 'イ';
    case 'z': return 'ズ';
    default: return char;
  }
}

function romanizeTurkishWord(word) {
  const normalized = word.toLocaleLowerCase('tr-TR').normalize('NFKC');
  let output = '';

  for (const char of normalized) {
    const previousRoman = output[output.length - 1] ?? '';

    switch (char) {
      case '\u00e2':
        output += 'a';
        break;
      case '\u00ee':
        output += 'i';
        break;
      case '\u00fb':
        output += 'u';
        break;
      case '\u00e7':
        output += 'ch';
        break;
      case '\u015f':
        output += 'sh';
        break;
      case 'c':
        output += 'j';
        break;
      case '\u011f':
        if (isRomanVowel(previousRoman)) {
          output += ':';
        }
        break;
      case '\u0131':
        output += 'u';
        break;
      case '\u00f6':
        output += 'o';
        break;
      case '\u00fc':
        output += 'u';
        break;
      case '\'':
      case '\u2018':
      case '\u2019':
      case '\u02bc':
        break;
      case 'q':
        output += 'k';
        break;
      case 'w':
        output += 'v';
        break;
      case 'x':
        output += 'ks';
        break;
      default:
        output += char;
        break;
    }
  }

  return output;
}

function romanWordToKatakana(word) {
  let output = '';
  let index = 0;

  while (index < word.length) {
    const current = word[index];
    const next = word[index + 1] ?? '';
    const afterNext = word[index + 2] ?? '';

    if (current === ':') {
      if (output) {
        output += '\u30fc';
      }
      index += 1;
      continue;
    }

    if (word.startsWith('sh', index) && !isRomanVowel(afterNext)) {
      output += '\u30b7\u30e5';
      index += 2;
      continue;
    }

    if (word.startsWith('ch', index) && !isRomanVowel(afterNext)) {
      output += '\u30c1';
      index += 2;
      continue;
    }

    if (
      index + 1 < word.length
      && current === next
      && !isRomanVowel(current)
      && current !== 'n'
    ) {
      output += '\u30c3';
      index += 1;
      continue;
    }

    if (current === 'n' && (index === word.length - 1 || (!isRomanVowel(next) && next !== 'y'))) {
      output += '\u30f3';
      index += 1;
      continue;
    }

    let matched = false;
    for (const key of ROMAN_MATCH_KEYS) {
      if (word.startsWith(key, index)) {
        output += ROMAN_TO_KATAKANA.get(key);
        index += key.length;
        matched = true;
        break;
      }
    }

    if (matched) {
      continue;
    }

    output += fallbackRomanConsonant(current);
    index += 1;
  }

  return output
    .replace(/アア/g, 'アー')
    .replace(/イイ/g, 'イー')
    .replace(/ウウ/g, 'ウー')
    .replace(/エエ/g, 'エー')
    .replace(/オオ/g, 'オー');
}

const ENGLISH_WORD_OVERRIDES = new Map([
  ['ai', 'ai'],
  ['am', 'amu'],
  ['and', 'ando'],
  ['are', 'aa'],
  ['assistant', 'ashisutanto'],
  ['baby', 'beibii'],
  ['beautiful', 'byuutifuru'],
  ['boy', 'booi'],
  ['bye', 'bai'],
  ['can', 'kyan'],
  ['cant', 'kaanto'],
  ['cute', 'kyuuto'],
  ['darling', 'daarin'],
  ['english', 'ingurisshu'],
  ['girl', 'gaaru'],
  ['good', 'guddo'],
  ['goodbye', 'guddobai'],
  ['goodnight', 'guddonaito'],
  ['hello', 'heroo'],
  ['help', 'herupu'],
  ['hey', 'hei'],
  ['hi', 'hai'],
  ['how', 'hau'],
  ['i', 'ai'],
  ['im', 'aimu'],
  ['is', 'izu'],
  ['it', 'itto'],
  ['its', 'ittsu'],
  ['love', 'rabu'],
  ['me', 'mii'],
  ['morning', 'mooningu'],
  ['my', 'mai'],
  ['name', 'neimu'],
  ['night', 'naito'],
  ['no', 'noo'],
  ['not', 'notto'],
  ['okay', 'oukei'],
  ['ok', 'oukei'],
  ['please', 'puriizu'],
  ['pretty', 'puritii'],
  ['really', 'riarii'],
  ['robot', 'robootto'],
  ['sorry', 'sorii'],
  ['sweetheart', 'suiitohaato'],
  ['thank', 'sanku'],
  ['thanks', 'sankusu'],
  ['that', 'zatto'],
  ['the', 'za'],
  ['this', 'disu'],
  ['today', 'tudei'],
  ['turkish', 'taakisshu'],
  ['voice', 'voisu'],
  ['want', 'wanto'],
  ['what', 'watto'],
  ['why', 'wai'],
  ['yes', 'iesu'],
  ['you', 'yuu'],
  ['your', 'yuaa'],
  ['youre', 'yuaa'],
]);

function finalizeEnglishOverrideOutput(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  if (/^[a-z:\s'-]+$/iu.test(normalized)) {
    return romanWordToKatakana(
      normalized
        .toLocaleLowerCase('en-US')
        .replace(/[\s'-]+/gu, '')
    );
  }
  return normalized;
}

function romanizeEnglishWord(word) {
  let normalized = normalizeEnglishWordLookup(word);
  if (!normalized) {
    return '';
  }

  if (ENGLISH_WORD_OVERRIDES.has(normalized)) {
    return ENGLISH_WORD_OVERRIDES.get(normalized);
  }

  normalized = normalized
    .replace(/^kn/gu, 'n')
    .replace(/^wr/gu, 'r')
    .replace(/^wh/gu, 'w')
    .replace(/tion\b/gu, 'shon')
    .replace(/sion\b/gu, 'shon')
    .replace(/ture\b/gu, 'cha')
    .replace(/augh/gu, 'af')
    .replace(/ough/gu, 'of')
    .replace(/eigh/gu, 'ei')
    .replace(/igh/gu, 'ai')
    .replace(/dge/gu, 'ji')
    .replace(/tch/gu, 'ch')
    .replace(/ph/gu, 'f')
    .replace(/ck/gu, 'k')
    .replace(/qu/gu, 'kw')
    .replace(/x/gu, 'ks')
    .replace(/ee/gu, 'ii')
    .replace(/ea/gu, 'ii')
    .replace(/oo/gu, 'uu')
    .replace(/oa/gu, 'ou')
    .replace(/ow\b/gu, 'ou')
    .replace(/ow/gu, 'au')
    .replace(/ou/gu, 'au')
    .replace(/ay\b/gu, 'ei')
    .replace(/ai/gu, 'ei')
    .replace(/oy/gu, 'oi')
    .replace(/oi/gu, 'oi')
    .replace(/ir\b/gu, 'a')
    .replace(/er\b/gu, 'a')
    .replace(/or\b/gu, 'oa')
    .replace(/ar\b/gu, 'aa')
    .replace(/ur\b/gu, 'a')
    .replace(/ly\b/gu, 'rii')
    .replace(/([bcdfghjklmnpqrstvwxyz])y\b/gu, '$1i')
    .replace(/([bcdfghjklmnpqrstvwxyz])e\b/gu, '$1')
    .replace(/c(?=[eiy])/gu, 's')
    .replace(/c/gu, 'k')
    .replace(/g(?=[eiy])/gu, 'j')
    .replace(/th/gu, 's');

  return normalized;
}

function mapSeparatorToken(token) {
  let output = '';
  for (const char of token) {
    if (char === '.') {
      output += '。';
    }
    else if (char === ',') {
      output += '、';
    }
    else if (char === '!') {
      output += '！';
    }
    else if (char === '?') {
      output += '？';
    }
    else if (char === ';' || char === ':' || char === '\n') {
      output += '、';
    }
    else if (['\'', '"', '\u2018', '\u2019', '\u201c', '\u201d', '\u02bc'].includes(char)) {
      output += '';
    }
    else if (/\s/u.test(char) || ['-', '_', '/', '\\', '|'].includes(char)) {
      output += '';
    }
    else {
      output += char;
    }
  }
  return output;
}

function preprocessTurkishText(input) {
  const overrides = loadTurkishOverrides();
  const source = applyJapaneseVerbalPhraseOverrides(input.normalize('NFKC'));
  const tokens = source.match(/[\p{Script=Latin}\p{Number}]+|[^\p{Script=Latin}\p{Number}]+/gu) ?? [];
  const converted = tokens.map((token) => {
    if (/^[\p{Number}]+$/u.test(token)) {
      return token;
    }
    if (/^[\p{Script=Latin}]+$/u.test(token)) {
      const override = overrides.get(normalizeTurkishWordLookup(token));
      if (override) {
        return override;
      }
      return romanWordToKatakana(romanizeTurkishWord(token));
    }
    return mapSeparatorToken(token);
  }).join('');

  return converted
    .replace(/\s+/g, '')
    .replace(/([。？！、])+/g, '$1')
    .trim();
}

function preprocessEnglishText(input) {
  const overrides = loadEnglishOverrides();
  const source = applyJapaneseVerbalPhraseOverrides(input.normalize('NFKC'));
  const tokens = source.match(/[\p{Script=Latin}\p{Number}\u2018\u2019\u02bc']+|[^\p{Script=Latin}\p{Number}\u2018\u2019\u02bc']+/gu) ?? [];
  const converted = tokens.map((token) => {
    if (/^[\p{Number}]+$/u.test(token)) {
      return token;
    }
    if (/^[\p{Script=Latin}\u2018\u2019\u02bc']+$/u.test(token)) {
      const override = overrides.get(normalizeEnglishWordLookup(token));
      if (override) {
        return finalizeEnglishOverrideOutput(override);
      }
      return romanWordToKatakana(romanizeEnglishWord(token));
    }
    return mapSeparatorToken(token);
  }).join('');

  return converted
    .replace(/\s+/g, '')
    .replace(/([\u3002\uff1f\uff01\u3001])+/gu, '$1')
    .trim();
}

function preprocessInputText(rawInput, model) {
  const textMode = resolveTextMode(model, rawInput);
  if (textMode === 'tr') {
    return {
      textMode,
      input: preprocessTurkishText(rawInput),
    };
  }
  if (textMode === 'en') {
    return {
      textMode,
      input: preprocessEnglishText(rawInput),
    };
  }

  return {
    textMode,
    input: rawInput,
  };
}

function buildVoicevoxQuery(baseQuery, requestBody) {
  const query = { ...baseQuery };
  const requestedSpeed = typeof requestBody.speed === 'number' && Number.isFinite(requestBody.speed)
    ? Math.max(0.1, requestBody.speed)
    : Math.max(0.1, Number(query.speedScale) || 1);

  query.speedScale = Math.max(0.1, requestedSpeed * SPEED_MULTIPLIER);
  maybeApplyNumber(query, 'pitchScale', requestBody.pitch, value => Math.abs(value) > 2 ? value / 100 : value);
  maybeApplyNumber(query, 'intonationScale', requestBody.intonation, value => Math.abs(value) > 2 ? 1 + value / 100 : value);
  maybeApplyNumber(query, 'volumeScale', requestBody.volume, value => Math.abs(value) > 2 ? Math.max(0, 1 + value / 100) : Math.max(0, value));

  return query;
}

function parseWavBuffer(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    const error = new Error('VOICEVOX returned an unsupported WAV payload.');
    error.statusCode = 502;
    throw error;
  }

  let fmt = null;
  const dataChunks = [];
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;

    if (chunkEnd > buffer.length) {
      break;
    }

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        numChannels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    }
    else if (chunkId === 'data') {
      dataChunks.push(buffer.subarray(chunkStart, chunkEnd));
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (!fmt || dataChunks.length === 0) {
    const error = new Error('VOICEVOX WAV payload was missing fmt or data chunks.');
    error.statusCode = 502;
    throw error;
  }

  return {
    ...fmt,
    data: Buffer.concat(dataChunks),
  };
}

function buildWavBuffer(format, pcmData) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8, 4, 'ascii');
  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(format.audioFormat, 20);
  header.writeUInt16LE(format.numChannels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.byteRate, 28);
  header.writeUInt16LE(format.blockAlign, 32);
  header.writeUInt16LE(format.bitsPerSample, 34);
  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
}

function buildSilentWavBuffer(durationMs = 120) {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const sampleCount = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const pcmData = Buffer.alloc(sampleCount * blockAlign);

  return buildWavBuffer({
    audioFormat: 1,
    numChannels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
  }, pcmData);
}

function concatWavBuffers(buffers) {
  if (buffers.length === 0) {
    const error = new Error('No audio buffers were available to merge.');
    error.statusCode = 500;
    throw error;
  }

  if (buffers.length === 1) {
    return buffers[0];
  }

  const parsed = buffers.map(parseWavBuffer);
  const base = parsed[0];

  for (const current of parsed.slice(1)) {
    if (
      current.audioFormat !== base.audioFormat
      || current.numChannels !== base.numChannels
      || current.sampleRate !== base.sampleRate
      || current.bitsPerSample !== base.bitsPerSample
      || current.blockAlign !== base.blockAlign
    ) {
      const error = new Error('VOICEVOX returned incompatible WAV segments for multi-emotion synthesis.');
      error.statusCode = 502;
      throw error;
    }
  }

  return buildWavBuffer(base, Buffer.concat(parsed.map((segment) => segment.data)));
}

function toHeaderSafeMoodToken(value, fallback = 'style') {
  const token = String(value ?? '').trim();
  if (token === '') {
    return fallback;
  }
  return /^[\x20-\x7E]+$/u.test(token) ? token : fallback;
}

function buildHeaderSafeSegmentSummary(segmentResults) {
  return segmentResults
    .map((segment) => `${toHeaderSafeMoodToken(segment.mood)}:${segment.voice.id}`)
    .join('|');
}

async function synthesizeVoicevoxSegment(requestBody, voiceSelection) {
  const { input, textMode } = preprocessInputText(voiceSelection.cleanedInput, requestBody.model);
  const voice = voiceSelection.voice;
  const audioQueryUrl = new URL('audio_query', ENGINE_BASE_URL);
  audioQueryUrl.searchParams.set('speaker', String(voice.id));
  audioQueryUrl.searchParams.set('text', input);

  const audioQueryResponse = await fetch(audioQueryUrl, { method: 'POST' });
  if (!audioQueryResponse.ok) {
    const details = await audioQueryResponse.text().catch(() => '');
    const error = new Error(`VOICEVOX audio_query failed with ${audioQueryResponse.status}.${details ? ` ${details}` : ''}`);
    error.statusCode = 502;
    throw error;
  }

  const baseQuery = await audioQueryResponse.json();
  const synthesisQuery = buildVoicevoxQuery(baseQuery, requestBody);
  const synthesisUrl = new URL('synthesis', ENGINE_BASE_URL);
  synthesisUrl.searchParams.set('speaker', String(voice.id));

  const synthesisResponse = await fetch(synthesisUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(synthesisQuery),
  });

  if (!synthesisResponse.ok) {
    const details = await synthesisResponse.text().catch(() => '');
    const error = new Error(`VOICEVOX synthesis failed with ${synthesisResponse.status}.${details ? ` ${details}` : ''}`);
    error.statusCode = 502;
    throw error;
  }

  return {
    audioBuffer: Buffer.from(await synthesisResponse.arrayBuffer()),
    voice,
    textMode,
    mood: voiceSelection.mood,
    baseVoice: voiceSelection.baseVoice,
    emotionReason: voiceSelection.emotionReason,
    synthesizedInput: input,
  };
}

async function synthesizeVoicevoxSpeech(requestBody) {
  const repairedInput = typeof requestBody.input === 'string'
    ? repairStreamingTagFragments(requestBody.input, requestBody)
    : '';
  const rawInput = repairedInput.trim();
  if (!rawInput) {
    const context = await resolveVoiceContext(requestBody.voice, requestBody.model);
    return {
      audioBuffer: buildSilentWavBuffer(),
      voice: context.baseVoice,
      textMode: 'raw',
      mood: 'silent',
      baseVoice: context.baseVoice,
      emotionReason: 'partial-tag',
      synthesizedInput: '',
      originalInput: typeof requestBody.input === 'string' ? requestBody.input : '',
      resolvedVoiceIds: String(context.baseVoice.id),
      segmentSummary: `silent:${context.baseVoice.id}`,
      segmentCount: 0,
    };
  }

  const taggedSegments = splitTaggedSegments(rawInput);
  if (taggedSegments.length > 0) {
    const context = await resolveVoiceContext(requestBody.voice, requestBody.model);
    const segmentResults = [];

    for (const segment of taggedSegments) {
      const voiceSelection = resolveExpressiveVoiceFromContext(
        context,
        segment.text,
        segment.explicitMood,
        segment.explicitVoice,
      );
      if (!voiceSelection.cleanedInput) {
        continue;
      }
      const result = await synthesizeVoicevoxSegment(requestBody, voiceSelection);
      segmentResults.push({
        ...result,
        sourceText: segment.text,
      });
    }

    if (segmentResults.length === 0) {
      return {
        audioBuffer: buildSilentWavBuffer(),
        voice: context.baseVoice,
        textMode: 'raw',
        mood: 'silent',
        baseVoice: context.baseVoice,
        emotionReason: 'tag-only',
        synthesizedInput: '',
        originalInput: rawInput,
        resolvedVoiceIds: String(context.baseVoice.id),
        segmentSummary: `silent:${context.baseVoice.id}`,
        segmentCount: 0,
      };
    }

    const uniqueTextModes = Array.from(new Set(segmentResults.map((segment) => segment.textMode)));
    const segmentSummary = buildHeaderSafeSegmentSummary(segmentResults);
    const resolvedVoiceIds = segmentResults.map((segment) => String(segment.voice.id)).join(',');

    return {
      audioBuffer: concatWavBuffers(segmentResults.map((segment) => segment.audioBuffer)),
      voice: segmentResults[segmentResults.length - 1].voice,
      textMode: uniqueTextModes.length === 1 ? uniqueTextModes[0] : uniqueTextModes.join(','),
      mood: 'segmented',
      baseVoice: context.baseVoice,
      emotionReason: 'segment-tags',
      synthesizedInput: segmentResults.map((segment) => segment.synthesizedInput).join(' / '),
      originalInput: rawInput,
      resolvedVoiceIds,
      segmentSummary,
      segmentCount: segmentResults.length,
    };
  }

  const voiceSelection = await resolveExpressiveVoice(requestBody.voice, rawInput, requestBody.model);
  if (!voiceSelection.cleanedInput) {
    return {
      audioBuffer: buildSilentWavBuffer(),
      voice: voiceSelection.voice,
      textMode: 'raw',
      mood: 'silent',
      baseVoice: voiceSelection.baseVoice,
      emotionReason: 'tag-only',
      synthesizedInput: '',
      originalInput: rawInput,
      resolvedVoiceIds: String(voiceSelection.voice.id),
      segmentSummary: `silent:${voiceSelection.voice.id}`,
      segmentCount: 0,
    };
  }
  const singleResult = await synthesizeVoicevoxSegment(requestBody, voiceSelection);

  return {
    ...singleResult,
    originalInput: rawInput,
    resolvedVoiceIds: String(singleResult.voice.id),
    segmentSummary: buildHeaderSafeSegmentSummary([singleResult]),
    segmentCount: 1,
  };
}

function buildOpenAIModelList() {
  const now = Math.floor(Date.now() / 1000);
  return {
    object: 'list',
    data: getSupportedModelIds().map((id) => {
      return {
        id,
        object: 'model',
        created: now,
        owned_by: 'voicevox',
      };
    }),
  };
}

function buildVoiceListPayload(voices) {
  return {
    object: 'list',
    data: voices.map((voice) => {
      return {
        id: String(voice.id),
        object: 'voice',
        name: voice.label,
        provider: 'voicevox',
        style_name: voice.styleName,
        speaker_name: voice.speakerName,
        type: voice.type || 'talk',
      };
    }),
  };
}

function printHelp() {
  console.log(`VOICEVOX OpenAI Bridge

Exposes VOICEVOX Engine as a minimal OpenAI-compatible speech endpoint.

Routes:
  GET  /healthz
  GET  /v1/models
  GET  /v1/voices
  GET  /v1/debug/recent
  POST /v1/audio/speech

Environment variables:
  VOICEVOX_BASE_URL       Default: ${DEFAULT_ENGINE_BASE_URL}
  VOICEVOX_BRIDGE_PORT    Default: ${DEFAULT_PORT}
  VOICEVOX_MODEL          Default: ${DEFAULT_MODEL}
  VOICEVOX_TEXT_MODE      Default: ${DEFAULT_TEXT_MODE}
  VOICEVOX_EMOTION_MODE   Default: ${DEFAULT_EMOTION_MODE}
  VOICEVOX_SPEED_MULTIPLIER  Default: ${DEFAULT_SPEED_MULTIPLIER}
  VOICEVOX_LOG_PATH       Default: ${LOG_PATH}
  VOICEVOX_TR_OVERRIDES_PATH  Default: ${TURKISH_OVERRIDES_PATH}
  VOICEVOX_EN_OVERRIDES_PATH  Default: ${ENGLISH_OVERRIDES_PATH}
  VOICEVOX_DEFAULT_VOICE  Optional style id or name
  VOICEVOX_AUTO_START     Default: 1
  VOICEVOX_RUN_EXE        Windows auto-start target

Examples:
  node tools/voicevox-openai-bridge.mjs
  node tools/voicevox-openai-bridge.mjs --list-voices
  node tools/voicevox-openai-bridge.mjs --preprocess-tr "Merhaba, nasilsin?"
  node tools/voicevox-openai-bridge.mjs --preprocess-en "Hello, how are you?"

Models:
  ${AUTO_MODEL_ID}     Auto Turkish/English + auto emotion
  ${MODEL_ID}     Auto Turkish/English + auto emotion
  ${RAW_MODEL_ID}  Fixed voice, no text preprocessing
  ${TURKISH_MODEL_ID}  Forced Turkish preprocessing + auto emotion
  ${ENGLISH_MODEL_ID}  Forced English preprocessing + auto emotion
`);
}

async function printVoicesAndExit() {
  const voices = buildVoiceListPayload(flattenVoices(await fetchSpeakers(true)));
  console.log(JSON.stringify(voices, null, 2));
}

function printPreprocessedTurkishAndExit() {
  const optionIndex = process.argv.indexOf('--preprocess-tr');
  const text = optionIndex >= 0 ? process.argv.slice(optionIndex + 1).join(' ') : '';
  if (!text.trim()) {
    throw new Error('Provide text after --preprocess-tr');
  }
  console.log(preprocessTurkishText(text));
}

function printPreprocessedEnglishAndExit() {
  const optionIndex = process.argv.indexOf('--preprocess-en');
  const text = optionIndex >= 0 ? process.argv.slice(optionIndex + 1).join(' ') : '';
  if (!text.trim()) {
    throw new Error('Provide text after --preprocess-en');
  }
  console.log(preprocessEnglishText(text));
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (!req.url) {
    writeError(res, 400, 'Request URL is missing.');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/healthz')) {
      const status = await checkEngineOnline();
      writeJson(res, status.ok ? 200 : 503, {
        bridge: 'voicevox-openai-bridge',
        engineBaseUrl: ENGINE_BASE_URL,
        model: MODEL_ID,
        logPath: LOG_PATH,
        recentEventsCount: recentEvents.length,
        lastEvent: recentEvents[0] ?? null,
        engine: status,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      await ensureEngineReady();
      writeJson(res, 200, buildOpenAIModelList());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/voices') {
      const voices = flattenVoices(await fetchSpeakers());
      writeJson(res, 200, buildVoiceListPayload(voices));
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/debug/recent' || url.pathname === '/v1/debug/recent')) {
      writeJson(res, 200, buildRecentEventsPayload());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/audio/speech') {
      await ensureEngineReady();
      const requestBody = await readJsonBody(req);
      const {
        audioBuffer,
        voice,
        textMode,
        mood,
        baseVoice,
        emotionReason,
        synthesizedInput,
        originalInput,
        resolvedVoiceIds,
        segmentSummary,
        segmentCount,
      } = await synthesizeVoicevoxSpeech(requestBody);

      const event = logBridgeEvent('speech', {
        route: '/v1/audio/speech',
        model: typeof requestBody.model === 'string' ? requestBody.model : MODEL_ID,
        requestedVoice: requestBody.voice == null ? '' : String(requestBody.voice),
        baseVoiceId: String(baseVoice.id),
        baseVoiceLabel: baseVoice.label,
        resolvedVoiceId: resolvedVoiceIds,
        resolvedVoiceLabel: voice.label,
        mood,
        emotionReason,
        textMode,
        inputPreview: compactTextPreview(originalInput),
        synthesizedPreview: compactTextPreview(synthesizedInput),
        segmentSummary,
        segmentCount,
        audioBytes: audioBuffer.length,
      });

      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'X-Voicevox-Voice-Id': resolvedVoiceIds,
        'X-Voicevox-Base-Voice-Id': String(baseVoice.id),
        'X-Voicevox-Voice-Label-Encoded': encodeURIComponent(voice.label),
        'X-Voicevox-Text-Mode': textMode,
        'X-Voicevox-Emotion': toHeaderSafeMoodToken(mood, mood === 'segmented' ? 'segmented' : 'style'),
        'X-Voicevox-Emotion-Reason': emotionReason,
        'X-Voicevox-Segment-Count': String(segmentCount),
        'X-Voicevox-Segment-Summary': segmentSummary,
        'X-Voicevox-Log-Time': event.timestamp,
      });
      res.end(audioBuffer);
      return;
    }

    writeError(res, 404, `Route not found: ${req.method} ${url.pathname}`);
  }
  catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    logBridgeEvent('error', {
      route: req.url ?? '',
      statusCode,
      message: error instanceof Error ? error.message : String(error),
    });
    writeError(res, statusCode, error instanceof Error ? error.message : String(error));
  }
});

const thisFilePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (thisFilePath === invokedPath) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
  }
  else if (process.argv.includes('--list-voices')) {
    printVoicesAndExit().catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
  else if (process.argv.includes('--preprocess-tr')) {
    try {
      printPreprocessedTurkishAndExit();
    }
    catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
  else if (process.argv.includes('--preprocess-en')) {
    try {
      printPreprocessedEnglishAndExit();
    }
    catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
  else {
    server.listen(BRIDGE_PORT, '127.0.0.1', () => {
      console.log(`VOICEVOX bridge listening on http://127.0.0.1:${BRIDGE_PORT}/v1/`);
      console.log(`VOICEVOX engine target: ${ENGINE_BASE_URL}`);
    });
  }
}
