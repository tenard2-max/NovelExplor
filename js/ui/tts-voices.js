/** TTS Voice 카탈로그 — Web Speech API getVoices / voiceschanged
 * Chrome · Edge 권장. 목록은 한국어·영어·중국어만 표시.
 */

const VOICE_STORAGE_KEY = 'ne-tts-voice-uri';
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

/** @type {SpeechSynthesisVoice[]} */
let voices = [];
/** @type {string} voiceURI 또는 name||lang 키 */
let selectedVoiceKey = '';
let voicesListenerBound = false;
/** @type {Set<() => void>} */
const listeners = new Set();

export function isSpeechSupported() {
  return Boolean(synth && typeof window.SpeechSynthesisUtterance === 'function');
}

export function isPreferredTtsBrowser() {
  const ua = navigator.userAgent || '';
  const isChromium = /\bChrome\//.test(ua) || /\bEdg\//.test(ua) || /\bEdgA\//.test(ua);
  const isEdge = /\bEdg\//.test(ua) || /\bEdgA\//.test(ua);
  const isChrome = /\bChrome\//.test(ua) && !/\bEdg\//.test(ua) && !/OPR\//.test(ua);
  return isEdge || isChrome || isChromium;
}

export function getSelectedVoice() {
  return resolveVoiceByKey(selectedVoiceKey) || findDefaultVoice(voices);
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
    try { fn(voices, getSelectedVoice()); } catch (err) { console.warn('[tts-voices]', err); }
  });
}

function voiceKey(v) {
  return v?.voiceURI || `${v?.name || ''}||${v?.lang || ''}`;
}

function resolveVoiceByKey(key) {
  if (!key || !voices.length) return null;
  return voices.find((v) => voiceKey(v) === key || v.voiceURI === key) || null;
}

/** 최신 getVoices()에서 URI로 다시 찾기 — stale Voice 참조 방지 */
export function resolveFreshVoice(voiceOrKey) {
  if (!synth) return null;
  const freshList = sortVoices(dedupeVoices(filterAllowedLangs(synth.getVoices() || [])));
  const key = typeof voiceOrKey === 'string'
    ? voiceOrKey
    : (voiceOrKey ? voiceKey(voiceOrKey) : selectedVoiceKey);
  if (!key) return findDefaultVoice(freshList);
  return freshList.find((v) => voiceKey(v) === key || v.voiceURI === key)
    || findDefaultVoice(freshList);
}

function isAllowedLang(lang) {
  const l = String(lang || '').toLowerCase();
  return l.startsWith('ko')
    || l.startsWith('en')
    || l.startsWith('zh')
    || l.startsWith('cmn')
    || l.startsWith('yue');
}

function filterAllowedLangs(list) {
  return list.filter((v) => isAllowedLang(v.lang));
}

function dedupeVoices(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const name = String(v.name || '').trim();
    if (!name) continue;
    // 이름+lang+localService 로 구분 (동명 로컬/온라인 둘 다 유지)
    const dupKey = `${name.toLowerCase()}|${String(v.lang || '').toLowerCase()}|${v.localService ? 'L' : 'O'}`;
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
  if (l.startsWith('zh') || l.startsWith('cmn') || l.startsWith('yue')) return 3;
  return 9;
}

function sortVoices(list) {
  return [...list].sort((a, b) => {
    const ra = langRank(a.lang);
    const rb = langRank(b.lang);
    if (ra !== rb) return ra - rb;
    // 같은 언어: 로컬 음성 우선 (온라인 실패 잦음)
    if (a.localService && !b.localService) return -1;
    if (!a.localService && b.localService) return 1;
    if (a.default && !b.default) return -1;
    if (!a.default && b.default) return 1;
    return String(a.name).localeCompare(String(b.name), 'ko');
  });
}

function findDefaultVoice(list) {
  if (!list?.length) return null;
  return list.find((v) => v.localService && String(v.lang || '').toLowerCase().startsWith('ko'))
    || list.find((v) => String(v.lang || '').toLowerCase().startsWith('ko') && v.default)
    || list.find((v) => String(v.lang || '').toLowerCase().startsWith('ko'))
    || list.find((v) => v.default)
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

  const match = saved ? resolveVoiceByKey(saved) : null;
  if (match) {
    selectedVoiceKey = voiceKey(match);
    return;
  }

  const fallback = findDefaultVoice(voices);
  selectedVoiceKey = fallback ? voiceKey(fallback) : '';
  if (fallback) persistSelectedKey(selectedVoiceKey);
}

function persistSelectedKey(key) {
  if (!key) return;
  try {
    localStorage.setItem(VOICE_STORAGE_KEY, key);
  } catch {
    /* ignore */
  }
}

export function loadVoices() {
  if (!synth) {
    voices = [];
    selectedVoiceKey = '';
    notify();
    return voices;
  }

  const raw = synth.getVoices() || [];
  voices = sortVoices(dedupeVoices(filterAllowedLangs(raw)));
  restoreSelectedVoice();
  notify();
  return voices;
}

export function refreshVoices() {
  return loadVoices();
}

export function selectVoiceByUri(voiceURI) {
  if (!voiceURI || !voices.length) {
    const fallback = findDefaultVoice(voices);
    selectedVoiceKey = fallback ? voiceKey(fallback) : '';
    if (selectedVoiceKey) persistSelectedKey(selectedVoiceKey);
    notify();
    return getSelectedVoice();
  }

  const match = resolveVoiceByKey(voiceURI);
  if (match) {
    selectedVoiceKey = voiceKey(match);
    persistSelectedKey(selectedVoiceKey);
    notify();
    return match;
  }

  const fallback = findDefaultVoice(voices);
  selectedVoiceKey = fallback ? voiceKey(fallback) : '';
  if (selectedVoiceKey) persistSelectedKey(selectedVoiceKey);
  notify();
  return getSelectedVoice();
}

/** Dropdown 라벨: Name (lang) ★ · local|online */
export function formatVoiceLabel(voice) {
  if (!voice) return '';
  const star = voice.default ? ' ★' : '';
  const svc = voice.localService ? 'local' : 'online';
  return `${voice.name} (${voice.lang})${star} · ${svc}`;
}

/**
 * Utterance에 선택 음성 적용 — 매 speak마다 fresh Voice 객체 사용
 * @param {SpeechSynthesisUtterance} utterance
 */
export function applySelectedVoice(utterance) {
  if (!utterance) return;
  const fresh = resolveFreshVoice(selectedVoiceKey);
  if (fresh) {
    selectedVoiceKey = voiceKey(fresh);
    utterance.voice = fresh;
    utterance.lang = fresh.lang || 'ko-KR';
  } else {
    utterance.lang = utterance.lang || 'ko-KR';
  }
}

export function describeVoiceForStatus(voice) {
  if (!voice) return 'default';
  const svc = voice.localService ? 'local' : 'online';
  return `${voice.name} (${voice.lang}, ${svc})`;
}

export function getTtsDebugInfo() {
  const raw = synth ? (synth.getVoices() || []) : [];
  const selected = getSelectedVoice();
  return {
    browser: navigator.userAgent || '',
    preferredBrowser: isPreferredTtsBrowser(),
    supported: isSpeechSupported(),
    voiceCount: raw.length,
    catalogCount: voices.length,
    filter: 'ko / en / zh only',
    selected: selected
      ? {
        name: selected.name,
        lang: selected.lang,
        default: !!selected.default,
        localService: !!selected.localService,
        voiceURI: selected.voiceURI,
      }
      : null,
    voices: voices.map((v, i) => ({
      index: i,
      name: v.name,
      lang: v.lang,
      default: !!v.default,
      localService: !!v.localService,
      voiceURI: v.voiceURI,
    })),
  };
}

export function initTtsVoices() {
  if (!synth) return;

  loadVoices();

  if (!voicesListenerBound) {
    voicesListenerBound = true;
    synth.addEventListener('voiceschanged', () => {
      loadVoices();
    });
  }

  if (!voices.length) {
    setTimeout(() => loadVoices(), 250);
    setTimeout(() => loadVoices(), 1000);
  }
}
