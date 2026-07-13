/** TTS Voice 카탈로그 — Web Speech API getVoices / voiceschanged
 * Chrome · Edge 권장. Firefox/Safari는 가능하면 동일 API, 없으면 graceful fallback.
 */

const VOICE_STORAGE_KEY = 'ne-tts-voice-uri';
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

/** @type {SpeechSynthesisVoice[]} */
let voices = [];
/** @type {SpeechSynthesisVoice | null} */
let selectedVoice = null;
let voicesListenerBound = false;
/** @type {Set<() => void>} */
const listeners = new Set();

export function isSpeechSupported() {
  return Boolean(synth && typeof window.SpeechSynthesisUtterance === 'function');
}

/** Chrome / Edge (Chromium) — 권장 브라우저 */
export function isPreferredTtsBrowser() {
  const ua = navigator.userAgent || '';
  const isChromium = /\bChrome\//.test(ua) || /\bEdg\//.test(ua) || /\bEdgA\//.test(ua);
  const isEdge = /\bEdg\//.test(ua) || /\bEdgA\//.test(ua);
  const isChrome = /\bChrome\//.test(ua) && !/\bEdg\//.test(ua) && !/OPR\//.test(ua);
  return isEdge || isChrome || isChromium;
}

export function getSelectedVoice() {
  return selectedVoice;
}

export function getVoiceList() {
  return [...voices];
}

export function onVoicesChanged(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => {
    try { fn(voices, selectedVoice); } catch (err) { console.warn('[tts-voices]', err); }
  });
}

function voiceKey(v) {
  return `${v.name}||${v.lang}||${v.voiceURI || ''}`;
}

function dedupeVoices(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const name = String(v.name || '').trim();
    if (!name) continue;
    // 동일 이름 중복 제거 (요구사항 5)
    const dupKey = name.toLowerCase();
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);
    out.push(v);
  }
  return out;
}

function langRank(lang) {
  const l = String(lang || '').toLowerCase();
  if (l === 'ko-kr' || l.startsWith('ko-kr')) return 0;
  if (l === 'ko' || l.startsWith('ko')) return 1;
  if (l.startsWith('en')) return 2;
  return 3;
}

function sortVoices(list) {
  return [...list].sort((a, b) => {
    const ra = langRank(a.lang);
    const rb = langRank(b.lang);
    if (ra !== rb) return ra - rb;
    if (a.default && !b.default) return -1;
    if (!a.default && b.default) return 1;
    return String(a.name).localeCompare(String(b.name), 'ko');
  });
}

function findDefaultVoice(list) {
  return list.find((v) => v.default)
    || list.find((v) => String(v.lang || '').toLowerCase().startsWith('ko'))
    || list[0]
    || null;
}

function restoreSelectedVoice() {
  let saved = '';
  try {
    saved = localStorage.getItem(VOICE_STORAGE_KEY) || '';
  } catch {
    saved = '';
  }

  if (saved && voices.length) {
    const match = voices.find((v) => v.voiceURI === saved || voiceKey(v) === saved);
    if (match) {
      selectedVoice = match;
      return;
    }
  }

  // 없거나 삭제된 경우 default
  selectedVoice = findDefaultVoice(voices);
  if (selectedVoice) {
    persistSelectedVoice(selectedVoice);
  }
}

function persistSelectedVoice(voice) {
  if (!voice) return;
  try {
    localStorage.setItem(VOICE_STORAGE_KEY, voice.voiceURI || voiceKey(voice));
  } catch {
    /* ignore */
  }
}

export function loadVoices() {
  if (!synth) {
    voices = [];
    selectedVoice = null;
    notify();
    return voices;
  }

  const raw = synth.getVoices() || [];
  voices = sortVoices(dedupeVoices(raw));
  restoreSelectedVoice();
  notify();
  return voices;
}

export function refreshVoices() {
  return loadVoices();
}

/**
 * @param {string} voiceURI
 * @returns {SpeechSynthesisVoice | null}
 */
export function selectVoiceByUri(voiceURI) {
  if (!voiceURI || !voices.length) {
    selectedVoice = findDefaultVoice(voices);
    if (selectedVoice) persistSelectedVoice(selectedVoice);
    notify();
    return selectedVoice;
  }

  const match = voices.find((v) => v.voiceURI === voiceURI || voiceKey(v) === voiceURI);
  if (match) {
    selectedVoice = match;
    persistSelectedVoice(match);
    notify();
    return match;
  }

  // 삭제·미존재 → default
  selectedVoice = findDefaultVoice(voices);
  if (selectedVoice) persistSelectedVoice(selectedVoice);
  notify();
  return selectedVoice;
}

/** Dropdown용 라벨: Name (lang) ★ */
export function formatVoiceLabel(voice) {
  if (!voice) return '';
  const star = voice.default ? ' ★' : '';
  return `${voice.name} (${voice.lang})${star}`;
}

/**
 * Utterance에 선택 음성 적용
 * @param {SpeechSynthesisUtterance} utterance
 */
export function applySelectedVoice(utterance) {
  if (!utterance) return;
  if (!selectedVoice || !voices.includes(selectedVoice)) {
    restoreSelectedVoice();
  }
  if (selectedVoice) {
    utterance.voice = selectedVoice;
    utterance.lang = selectedVoice.lang || utterance.lang || 'ko-KR';
  } else {
    utterance.lang = utterance.lang || 'ko-KR';
  }
}

export function getTtsDebugInfo() {
  const list = synth ? (synth.getVoices() || []) : [];
  return {
    browser: navigator.userAgent || '',
    preferredBrowser: isPreferredTtsBrowser(),
    supported: isSpeechSupported(),
    voiceCount: list.length,
    catalogCount: voices.length,
    selected: selectedVoice
      ? {
        name: selectedVoice.name,
        lang: selectedVoice.lang,
        default: !!selectedVoice.default,
        localService: !!selectedVoice.localService,
        voiceURI: selectedVoice.voiceURI,
      }
      : null,
    voices: list.map((v, i) => ({
      index: i,
      name: v.name,
      lang: v.lang,
      default: !!v.default,
      localService: !!v.localService,
      voiceURI: v.voiceURI,
    })),
  };
}

/** 앱 시작 시 1회 — voiceschanged 중복 등록 금지 */
export function initTtsVoices() {
  if (!synth) return;

  loadVoices();

  if (!voicesListenerBound) {
    voicesListenerBound = true;
    synth.addEventListener('voiceschanged', () => {
      loadVoices();
    });
  }

  // Chrome: 첫 getVoices가 비어 있을 수 있어 짧은 지연 재시도
  if (!voices.length) {
    setTimeout(() => loadVoices(), 250);
    setTimeout(() => loadVoices(), 1000);
  }
}
