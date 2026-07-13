/** TTS Voice 카탈로그 — Web Speech API getVoices / voiceschanged
 * 목록: 한국어·영어·중국어만. 테스트 음성으로 검증 후 정상 Voice만 표시.
 */

const VOICE_STORAGE_KEY = 'ne-tts-voice-uri';
const VOICE_OK_STORAGE_KEY = 'ne-tts-voice-ok';
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const PROBE_MS = 1000;
const PROBE_GAP_MS = 80;

/** @type {SpeechSynthesisVoice[]} 후보(언어 필터 후) */
let allVoices = [];
/** @type {SpeechSynthesisVoice[]} UI에 보이는 목록 */
let voices = [];
/** @type {string} */
let selectedVoiceKey = '';
/** @type {Set<string>|null} null이면 미검증(전체 표시) */
let verifiedKeys = null;
let voicesListenerBound = false;
let probeRunning = false;
let probeAbort = false;
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

export function isVoiceProbeRunning() {
  return probeRunning;
}

export function getSelectedVoice() {
  return resolveVoiceByKey(selectedVoiceKey) || findDefaultVoice(voices);
}

export function getVoiceList() {
  return [...voices];
}

export function getCandidateVoiceList() {
  return [...allVoices];
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

export function voiceKey(v) {
  return v?.voiceURI || `${v?.name || ''}||${v?.lang || ''}`;
}

function resolveVoiceByKey(key, list = voices) {
  if (!key || !list.length) return null;
  return list.find((v) => voiceKey(v) === key || v.voiceURI === key) || null;
}

export function resolveFreshVoice(voiceOrKey) {
  if (!synth) return null;
  const freshAll = buildCatalog(synth.getVoices() || []);
  const pool = verifiedKeys
    ? freshAll.filter((v) => verifiedKeys.has(voiceKey(v)))
    : freshAll;
  const key = typeof voiceOrKey === 'string'
    ? voiceOrKey
    : (voiceOrKey ? voiceKey(voiceOrKey) : selectedVoiceKey);
  if (!key) return findDefaultVoice(pool.length ? pool : freshAll);
  return pool.find((v) => voiceKey(v) === key || v.voiceURI === key)
    || findDefaultVoice(pool.length ? pool : freshAll);
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
    if (a.localService && !b.localService) return -1;
    if (!a.localService && b.localService) return 1;
    if (a.default && !b.default) return -1;
    if (!a.default && b.default) return 1;
    return String(a.name).localeCompare(String(b.name), 'ko');
  });
}

function buildCatalog(raw) {
  return sortVoices(dedupeVoices(filterAllowedLangs(raw)));
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

function applyVerifiedFilter() {
  if (verifiedKeys && verifiedKeys.size) {
    voices = allVoices.filter((v) => verifiedKeys.has(voiceKey(v)));
    if (!voices.length) {
      // 검증 결과 전부 실패면 후보 전체 유지
      voices = [...allVoices];
      verifiedKeys = null;
    }
  } else {
    voices = [...allVoices];
  }
}

function restoreSelectedVoice() {
  let saved = '';
  try {
    saved = localStorage.getItem(VOICE_STORAGE_KEY) || '';
  } catch {
    saved = '';
  }

  const match = saved ? resolveVoiceByKey(saved, voices) : null;
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

function loadVerifiedKeys() {
  try {
    const raw = localStorage.getItem(VOICE_OK_STORAGE_KEY);
    if (!raw) {
      verifiedKeys = null;
      return;
    }
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) verifiedKeys = new Set(arr.map(String));
    else verifiedKeys = null;
  } catch {
    verifiedKeys = null;
  }
}

function persistVerifiedKeys() {
  try {
    if (!verifiedKeys || !verifiedKeys.size) {
      localStorage.removeItem(VOICE_OK_STORAGE_KEY);
      return;
    }
    localStorage.setItem(VOICE_OK_STORAGE_KEY, JSON.stringify([...verifiedKeys]));
  } catch {
    /* ignore */
  }
}

export function clearVoiceVerification() {
  verifiedKeys = null;
  persistVerifiedKeys();
  applyVerifiedFilter();
  restoreSelectedVoice();
  notify();
}

export function loadVoices() {
  if (!synth) {
    allVoices = [];
    voices = [];
    selectedVoiceKey = '';
    notify();
    return voices;
  }

  const raw = synth.getVoices() || [];
  allVoices = buildCatalog(raw);
  applyVerifiedFilter();
  restoreSelectedVoice();
  notify();
  return voices;
}

export function refreshVoices() {
  clearVoiceVerification();
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

  const match = resolveVoiceByKey(voiceURI, voices);
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

export function formatVoiceLabel(voice) {
  if (!voice) return '';
  const star = voice.default ? ' ★' : '';
  const svc = voice.localService ? 'local' : 'online';
  return `${voice.name} (${voice.lang})${star} · ${svc}`;
}

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

function sampleTextForLang(lang) {
  const l = String(lang || '').toLowerCase();
  if (l.startsWith('en')) return 'Hello. This is a voice test.';
  if (l.startsWith('zh') || l.startsWith('cmn') || l.startsWith('yue')) return '你好。这是语音测试。';
  return '안녕하세요. 음성 테스트입니다.';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 단일 Voice 약 1초 재생 프로브
 * @returns {Promise<{ ok: boolean, key: string, reason: string, voice: SpeechSynthesisVoice }>}
 */
function probeOneVoice(voice) {
  return new Promise((resolve) => {
    if (!synth || probeAbort) {
      resolve({ ok: false, key: voiceKey(voice), reason: 'aborted', voice });
      return;
    }

    const fresh = resolveFreshVoice(voice) || voice;
    const utter = new SpeechSynthesisUtterance(sampleTextForLang(fresh.lang));
    utter.voice = fresh;
    utter.lang = fresh.lang || 'ko-KR';
    utter.rate = 1;
    utter.pitch = 1;
    utter.volume = 1;

    let started = false;
    let settled = false;
    let timer = null;

    const finish = (ok, reason) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { synth.cancel(); } catch { /* ignore */ }
      resolve({ ok, key: voiceKey(fresh), reason, voice: fresh });
    };

    utter.onstart = () => { started = true; };
    utter.onerror = (e) => {
      const err = e?.error || 'error';
      if (err === 'interrupted' || err === 'canceled') {
        // 1초 후 cancel이면 시작했으면 성공으로 간주
        finish(started, started ? 'canceled-ok' : 'canceled');
        return;
      }
      finish(false, err);
    };
    utter.onend = () => finish(true, 'end');

    timer = setTimeout(() => {
      try { synth.cancel(); } catch { /* ignore */ }
      // cancel 이벤트 대기
      setTimeout(() => {
        finish(started, started ? 'timeout-ok' : 'no-start');
      }, 60);
    }, PROBE_MS);

    try {
      synth.speak(utter);
    } catch (err) {
      finish(false, err?.message || 'speak-throw');
    }
  });
}

/**
 * 후보 Voice 전체를 1초씩 테스트 → 정상만 목록에 남김
 * @param {{ onProgress?: (p: object) => void }} [opts]
 */
export async function probeAllVoices(opts = {}) {
  if (!synth) throw new Error('TTS 미지원');
  if (probeRunning) throw new Error('이미 Voice 테스트 중입니다.');

  loadVoices();
  const candidates = [...allVoices];
  if (!candidates.length) {
    return { total: 0, ok: 0, fail: 0, okKeys: [] };
  }

  probeRunning = true;
  probeAbort = false;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const okKeys = [];
  const failList = [];

  try {
    synth.cancel();
    await sleep(PROBE_GAP_MS);

    for (let i = 0; i < candidates.length; i += 1) {
      if (probeAbort) break;
      const voice = candidates[i];
      onProgress?.({
        index: i + 1,
        total: candidates.length,
        voice,
        label: formatVoiceLabel(voice),
      });

      const result = await probeOneVoice(voice);
      if (result.ok) okKeys.push(result.key);
      else failList.push({ key: result.key, reason: result.reason, name: voice.name });

      await sleep(PROBE_GAP_MS);
    }

    if (okKeys.length) {
      verifiedKeys = new Set(okKeys);
      persistVerifiedKeys();
      applyVerifiedFilter();
      restoreSelectedVoice();
      notify();
    } else if (!probeAbort) {
      // 전부 실패 — 목록은 유지하되 검증 저장 안 함
      verifiedKeys = null;
      persistVerifiedKeys();
      applyVerifiedFilter();
      notify();
    }

    return {
      total: candidates.length,
      ok: okKeys.length,
      fail: failList.length,
      okKeys,
      failList,
      aborted: probeAbort,
    };
  } finally {
    probeRunning = false;
    probeAbort = false;
    try { synth.cancel(); } catch { /* ignore */ }
  }
}

export function abortVoiceProbe() {
  if (!probeRunning) return;
  probeAbort = true;
  try { synth?.cancel(); } catch { /* ignore */ }
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
    candidateCount: allVoices.length,
    verified: verifiedKeys ? verifiedKeys.size : null,
    filter: 'ko / en / zh · verified-only after test',
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

  loadVerifiedKeys();
  loadVoices();

  if (!voicesListenerBound) {
    voicesListenerBound = true;
    synth.addEventListener('voiceschanged', () => {
      // 프로브 중이면 목록 재빌드만 하고 UI 갱신은 notify
      if (probeRunning) return;
      loadVoices();
    });
  }

  if (!allVoices.length) {
    setTimeout(() => loadVoices(), 250);
    setTimeout(() => loadVoices(), 1000);
  }
}
