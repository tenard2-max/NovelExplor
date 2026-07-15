/** 리더 TTS — Web Speech API + Voice 선택 + 캐릭터 배경 + 문단 하이라이트 */

import { on } from '../core/events.js';
import * as project from '../core/project.js';
import { getCurrentStoryMarkdownSync, tagReaderBlocksForTts } from './reader.js';
import { setTtsWallpaper } from './canvas-wallpaper.js';
import {
  initTtsVoices,
  applySelectedVoice,
  selectVoiceByUri,
  formatVoiceLabel,
  getVoiceList,
  getSelectedVoice,
  onVoicesChanged,
  refreshVoices,
  getTtsDebugInfo,
  isSpeechSupported,
  isPreferredTtsBrowser,
  describeVoiceForStatus,
  probeAllVoices,
  abortVoiceProbe,
  isVoiceProbeRunning,
  getCandidateVoiceList,
} from './tts-voices.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const TTS_MAX_CHUNK = 200;

let playing = false;
let paused = false;
let chunkIndex = 0;
/** @type {Array<{ text: string, paraIndex: number }>} */
let chunks = [];
let nameEntries = [];
let statusTimer = null;
let statusRestore = '';
let uiBound = false;

/** @type {SpeechSynthesisUtterance | null} */
let currentUtterance = null;

export function initReaderTts() {
  if (uiBound) return;
  uiBound = true;

  initTtsVoices();
  bindVoiceUi();
  renderVoiceSelect();
  renderTtsDebug();

  onVoicesChanged(() => {
    renderVoiceSelect();
    renderTtsDebug();
  });

  const playBtn = document.querySelector('[data-action="tts-play"]');
  const testBtn = document.querySelector('[data-action="tts-test"]');
  const stopBtn = document.querySelector('[data-action="tts-stop"]');
  const pauseBtn = document.querySelector('[data-action="tts-pause"]');
  const nextBtn = document.querySelector('[data-action="tts-next"]');

  playBtn?.addEventListener('click', () => {
    if (playing && paused) {
      resume();
      return;
    }
    start();
  });

  testBtn?.addEventListener('click', () => runFullVoiceProbe());
  stopBtn?.addEventListener('click', () => {
    if (isVoiceProbeRunning()) abortVoiceProbe();
    stop();
  });
  pauseBtn?.addEventListener('click', () => togglePause());
  nextBtn?.addEventListener('click', () => skipToNextChunk());

  on('reader:story-changed', () => stop({ silent: true }));
  on('view:changed', (viewId) => {
    if (viewId !== 'reader') stop({ silent: true });
  });
  on('project:loaded', () => {
    nameEntries = [];
    stop({ silent: true });
  });

  updateButtons();
  maybeShowBrowserHint();
}

function bindVoiceUi() {
  const select = document.getElementById('tts-voice-select');
  const refreshBtn = document.querySelector('[data-action="tts-voice-refresh"]');
  const debugToggle = document.querySelector('[data-action="tts-debug-toggle"]');

  select?.addEventListener('change', () => {
    selectVoiceByUri(select.value);
    renderTtsDebug();
    const v = getSelectedVoice();
    if (v) showStatus(`음성: ${formatVoiceLabel(v)}`);
  });

  refreshBtn?.addEventListener('click', () => {
    if (isVoiceProbeRunning()) {
      showStatus('Voice 테스트 중에는 새로고침할 수 없습니다.');
      return;
    }
    refreshVoices();
    renderVoiceSelect();
    renderTtsDebug();
    showStatus(`Voice 후보 ${getCandidateVoiceList().length}개 다시 표시 (검증 초기화)`);
  });

  debugToggle?.addEventListener('click', () => {
    const panel = document.getElementById('tts-debug-panel');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderTtsDebug();
  });
}

function renderVoiceSelect() {
  const select = document.getElementById('tts-voice-select');
  if (!select) return;

  const list = getVoiceList();
  const selected = getSelectedVoice();
  const prev = select.value;

  select.innerHTML = '';

  if (!isSpeechSupported()) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'TTS 미지원 브라우저';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  if (!list.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Voice 로딩 중… (새로고침 가능)';
    select.appendChild(opt);
    select.disabled = false;
    return;
  }

  select.disabled = false;
  for (const v of list) {
    const opt = document.createElement('option');
    opt.value = v.voiceURI || `${v.name}||${v.lang}`;
    opt.textContent = formatVoiceLabel(v);
    select.appendChild(opt);
  }

  const want = selected
    ? (selected.voiceURI || `${selected.name}||${selected.lang}`)
    : prev;
  if (want && [...select.options].some((o) => o.value === want)) {
    select.value = want;
  } else if (select.options.length) {
    select.selectedIndex = 0;
    selectVoiceByUri(select.value);
  }
}

function renderTtsDebug() {
  const panel = document.getElementById('tts-debug-panel');
  if (!panel) return;

  const info = getTtsDebugInfo();
  const lines = info.voices.map((v) =>
    `${v.index} ${v.name} ${v.lang} ${v.default} ${v.localService}`
  );

  panel.innerHTML = `
    <div class="tts-debug-meta"><strong>Browser :</strong> ${esc(info.browser)}</div>
    <div class="tts-debug-meta"><strong>Preferred (Chrome/Edge) :</strong> ${info.preferredBrowser}</div>
    <div class="tts-debug-meta"><strong>Filter :</strong> ${esc(info.filter || 'ko/en/zh')}</div>
    <div class="tts-debug-meta"><strong>Voice Count :</strong> raw ${info.voiceCount} / 후보 ${info.candidateCount ?? '—'} / 표시 ${info.catalogCount}${
      info.verified != null ? ` / 검증통과 ${info.verified}` : ''
    }</div>
    <div class="tts-debug-meta"><strong>Selected :</strong> ${
      info.selected
        ? esc(`${info.selected.name} (${info.selected.lang}) localService=${info.selected.localService}`)
        : '—'
    }</div>
    <pre class="tts-debug-list" aria-label="Voice List">${esc(
      ['번호 이름 언어 Default LocalService', ...lines].join('\n') || '(empty)'
    )}</pre>`;
}

function maybeShowBrowserHint() {
  if (isSpeechSupported() && isPreferredTtsBrowser()) return;
  const hint = document.getElementById('tts-browser-hint');
  if (!hint) return;
  hint.hidden = false;
  if (!isSpeechSupported()) {
    hint.textContent = '이 브라우저는 Web Speech TTS를 지원하지 않습니다.';
  } else {
    hint.textContent = '권장: Chrome 또는 Edge. 다른 브라우저는 Voice 목록이 제한될 수 있습니다.';
  }
}

/** Edge/Chrome 동작 패턴 + 선택 Voice 적용 */
function createUtterance(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  applySelectedVoice(utterance);
  if (!utterance.lang) utterance.lang = 'ko-KR';
  return utterance;
}

function speakTestVoice() {
  // 하위 호환 — 전체 프로브로 위임
  return runFullVoiceProbe();
}

/** 테스트 음성: 전체 Voice 1초씩 검증 → 정상만 드롭다운에 남김 */
async function runFullVoiceProbe() {
  if (!synth) {
    showStatus('이 브라우저는 음성 읽기를 지원하지 않습니다.', { persist: true });
    return;
  }
  if (isVoiceProbeRunning()) {
    showStatus('이미 Voice 테스트 중입니다.');
    return;
  }

  // 소설 읽기 중이면 정지
  stop({ silent: true });

  const testBtn = document.querySelector('[data-action="tts-test"]');
  const select = document.getElementById('tts-voice-select');
  if (testBtn) testBtn.disabled = true;
  if (select) select.disabled = true;

  try {
    showStatus('Voice 전체 테스트 시작…', { persist: true });
    const result = await probeAllVoices({
      onProgress: ({ index, total, label }) => {
        showStatus(`테스트 ${index}/${total}: ${label}`, { persist: true });
        updateButtons();
      },
    });

    renderVoiceSelect();
    renderTtsDebug();
    updateButtons();

    if (result.aborted) {
      showStatus(`테스트 중단 — 정상 ${result.ok}/${result.total}`, { persist: true });
      return;
    }

    if (!result.ok) {
      showStatus(`정상 Voice 없음 (${result.total}개 실패). 후보 목록을 유지합니다.`, { persist: true });
      return;
    }

    const selected = getSelectedVoice();
    showStatus(
      `테스트 완료 — 정상 ${result.ok}/${result.total}`
      + (selected ? ` · 선택: ${describeVoiceForStatus(selected)}` : ''),
      { persist: true }
    );
  } catch (err) {
    showStatus(`Voice 테스트 실패: ${err.message || err}`, { persist: true });
  } finally {
    if (testBtn) testBtn.disabled = false;
    if (select) select.disabled = false;
    renderVoiceSelect();
    updateButtons();
  }
}

function start() {
  if (!synth) {
    showStatus('이 브라우저는 음성 읽기를 지원하지 않습니다.', { persist: true });
    return;
  }

  stopPreviousPlayback();

  const inner = document.querySelector('#reader-content .reader-inner');
  tagReaderBlocksForTts(inner);
  let nextChunks = buildTtsChunksFromReaderDom(inner);

  if (!nextChunks.length) {
    const markdown = getCurrentStoryMarkdownSync();
    if (markdown != null && typeof markdown === 'object' && typeof markdown.then === 'function') {
      showStatus('소설 본문을 불러오지 못했습니다. 페이지를 새로고침 후 다시 시도해 주세요.', { persist: true });
      return;
    }
    const plain = markdownToSpeakableText(markdown);
    nextChunks = chunkSpeakableText(plain);
  }

  if (!nextChunks.length) {
    showStatus('읽을 내용이 없습니다.', { persist: true });
    return;
  }

  nameEntries = buildCharacterNameEntries(project.getCache().characters || []);

  chunks = nextChunks;
  playing = true;
  paused = false;
  chunkIndex = 0;
  currentUtterance = null;
  clearHighlight();
  updateButtons();

  speakNextChunk();
}

function stopPreviousPlayback() {
  if (synth?.speaking || synth?.pending) {
    synth.cancel();
  }
  playing = false;
  paused = false;
  currentUtterance = null;
  clearHighlight();
}

function speakNextChunk() {
  if (!playing || !synth || paused) return;

  while (chunkIndex < chunks.length && !chunks[chunkIndex]?.text?.trim()) {
    chunkIndex += 1;
  }

  if (chunkIndex >= chunks.length) {
    finish();
    return;
  }

  speakChunk(chunks[chunkIndex]);
}

function speakChunk(chunk) {
  if (!playing || !synth) return;

  const text = chunk.text?.trim();
  if (!text) {
    chunkIndex += 1;
    speakNextChunk();
    return;
  }

  const utterance = createUtterance(text);
  currentUtterance = utterance;

  utterance.onstart = () => {
    if (!playing) return;
    onChunkStart(chunk);
    updateButtons();
    showStatus('읽는 중…');
  };

  utterance.onend = () => {
    if (!playing) return;
    currentUtterance = null;
    chunkIndex += 1;
    speakNextChunk();
  };

  utterance.onerror = (e) => {
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    const v = getSelectedVoice();
    const hint = v && !v.localService
      ? ' — online 음성 실패. Voice에서 · local 항목을 선택해 보세요.'
      : '';
    handleSpeakFailure(`음성 재생 실패 (${e.error || 'unknown'})${hint}`);
  };

  speechSynthesis.speak(utterance);
}

function onChunkStart(chunk) {
  highlightChunk(chunk.paraIndex);
  const match = findCharacterInText(chunk.text, nameEntries);
  if (match?.avatar) {
    setTtsWallpaper(match.avatar);
  }
}

function highlightChunk(paraIndex) {
  clearHighlight();
  if (paraIndex == null || paraIndex < 0) return;

  const el = document.querySelector(`#reader-content .reader-inner [data-tts-idx="${paraIndex}"]`);
  if (!el) return;

  el.classList.add('tts-active');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearHighlight() {
  document.querySelectorAll('#reader-content .tts-active').forEach((el) => {
    el.classList.remove('tts-active');
  });
}

function handleSpeakFailure(message) {
  playing = false;
  paused = false;
  currentUtterance = null;
  clearHighlight();
  speechSynthesis.cancel();
  updateButtons();
  showStatus(message, { persist: true });
}

function resetPlaybackState(opts = {}) {
  const wasPlaying = playing;
  playing = false;
  paused = false;
  chunkIndex = 0;
  chunks = [];
  currentUtterance = null;
  clearHighlight();
  updateButtons();
  if (!opts.silent && wasPlaying) {
    showStatus('읽기를 정지했습니다.');
  }
}

function stop(opts = {}) {
  const wasPlaying = playing;
  resetPlaybackState({ silent: true });
  speechSynthesis.cancel();
  if (!opts.silent && wasPlaying) {
    showStatus('읽기를 정지했습니다.');
  }
}

function togglePause() {
  if (!playing || !synth) return;
  if (paused) resume();
  else pause();
}

function pause() {
  if (!playing || !synth || paused) return;
  synth.pause();
  paused = true;
  updateButtons();
  showStatus('일시정지');
}

function resume() {
  if (!playing || !synth || !paused) return;
  if (synth.paused) synth.resume();
  paused = false;
  updateButtons();
  showStatus('읽는 중…');
}

function findNextChunkIndex(fromIndex) {
  let i = fromIndex + 1;
  while (i < chunks.length && !chunks[i]?.text?.trim()) {
    i += 1;
  }
  return i;
}

function skipToNextChunk() {
  if (!playing || !synth) return;

  const nextIdx = findNextChunkIndex(chunkIndex);
  if (nextIdx >= chunks.length) {
    synth.cancel();
    currentUtterance = null;
    playing = false;
    paused = false;
    clearHighlight();
    updateButtons();
    showStatus('마지막 구간입니다');
    return;
  }

  synth.cancel();
  currentUtterance = null;
  paused = false;
  chunkIndex = nextIdx;
  speakNextChunk();
}

function finish() {
  playing = false;
  paused = false;
  currentUtterance = null;
  clearHighlight();
  updateButtons();
  showStatus('읽기 완료');
}

function updateButtons() {
  const playBtn = document.querySelector('[data-action="tts-play"]');
  const stopBtn = document.querySelector('[data-action="tts-stop"]');
  const pauseBtn = document.querySelector('[data-action="tts-pause"]');
  const nextBtn = document.querySelector('[data-action="tts-next"]');
  const testBtn = document.querySelector('[data-action="tts-test"]');

  const probing = isVoiceProbeRunning();
  const canPlay = !!synth && !probing;
  const isActive = playing;

  if (playBtn) {
    playBtn.disabled = !canPlay;
    playBtn.textContent = playing && paused ? '▶ 재개' : '🔊 재생';
    playBtn.classList.toggle('is-active', isActive && !paused);
  }
  if (stopBtn) stopBtn.disabled = !isActive && !probing;
  if (pauseBtn) {
    pauseBtn.disabled = !isActive || paused || probing;
    pauseBtn.hidden = !isActive;
  }
  if (nextBtn) {
    nextBtn.disabled = !isActive || probing;
    nextBtn.hidden = !isActive;
  }
  if (testBtn) testBtn.disabled = probing;
}

function showStatus(message, opts = {}) {
  const el = document.getElementById('reader-tts-status');
  if (!el) return;

  clearTimeout(statusTimer);
  if (!statusRestore) statusRestore = el.textContent;

  el.textContent = message;
  el.classList.add('is-visible');

  if (opts.persist) return;

  const duration = opts.duration ?? 3200;
  statusTimer = setTimeout(() => {
    el.textContent = statusRestore;
    el.classList.remove('is-visible');
    statusRestore = '';
  }, duration);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildTtsChunksFromReaderDom(inner) {
  if (!inner) return [];

  const blocks = [...inner.querySelectorAll('[data-tts-idx]')].sort(
    (a, b) => Number(a.dataset.ttsIdx) - Number(b.dataset.ttsIdx)
  );

  const result = [];
  for (const el of blocks) {
    const paraIndex = parseInt(el.dataset.ttsIdx, 10);
    if (Number.isNaN(paraIndex)) continue;

    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    for (const piece of splitLongSpeakableText(text, TTS_MAX_CHUNK)) {
      result.push({ text: piece, paraIndex });
    }
  }
  return result;
}

export function markdownToSpeakableText(md) {
  if (!md) return '';
  if (typeof md === 'object' && typeof md.then === 'function') return '';

  let text = String(md);
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function splitLongSpeakableText(text, maxLen) {
  if (text.length <= maxLen) return [text];

  const sentences = text.split(/(?<=[.!?。！？…])\s+/).filter(Boolean);
  if (sentences.length <= 1) {
    return splitByLength(text, maxLen);
  }

  const result = [];
  let buf = '';
  for (const sentence of sentences) {
    const next = buf ? `${buf} ${sentence}` : sentence;
    if (next.length > maxLen && buf) {
      result.push(buf);
      buf = sentence;
    } else if (next.length > maxLen) {
      result.push(...splitByLength(sentence, maxLen));
      buf = '';
    } else {
      buf = next;
    }
  }
  if (buf) result.push(buf);
  return result;
}

function splitByLength(text, maxLen) {
  const parts = [];
  for (let i = 0; i < text.length; i += maxLen) {
    parts.push(text.slice(i, i + maxLen));
  }
  return parts;
}

/** @returns {Array<{ text: string, paraIndex: number }>} */
export function chunkSpeakableText(text) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!paragraphs.length) {
    const trimmed = text.trim();
    return trimmed
      ? splitLongSpeakableText(trimmed, TTS_MAX_CHUNK).map((t) => ({ text: t, paraIndex: 0 }))
      : [];
  }

  const result = [];
  for (let paraIndex = 0; paraIndex < paragraphs.length; paraIndex += 1) {
    for (const piece of splitLongSpeakableText(paragraphs[paraIndex], TTS_MAX_CHUNK)) {
      result.push({ text: piece, paraIndex });
    }
  }
  return result;
}

function resolveAvatarSrc(src) {
  const raw = String(src || '').trim();
  if (!raw) return '';
  if (
    raw.startsWith('data:')
    || raw.startsWith('blob:')
    || /^https?:\/\//i.test(raw)
    || raw.startsWith('/')
  ) {
    return raw;
  }
  try {
    return new URL(raw.replace(/^\.\//, ''), document.baseURI || location.href).href;
  } catch {
    return raw;
  }
}

function defaultCharacterOverlayPath(ch) {
  const cid = ch?.characterId
    || String(ch?.id || '').split('-').filter(Boolean).pop()
    || '';
  if (!cid || !/^CHR\d+/i.test(cid)) return '';
  return `data/workspace/overlays/characters/${cid}.png`;
}

function characterAvatarUrl(ch) {
  // TTS 월페이퍼는 큰 data URL보다 정적 overlay 경로가 안정적이다
  const pathLike = String(ch.avatarPath || '').trim()
    || (Array.isArray(ch.imagePaths) ? String(ch.imagePaths.find((u) => String(u || '').trim()) || '').trim() : '')
    || defaultCharacterOverlayPath(ch);

  if (pathLike && !pathLike.startsWith('data:') && !pathLike.startsWith('blob:')) {
    return resolveAvatarSrc(pathLike);
  }

  const fromFields = String(
    ch.avatarDataUrl || ch.image || ch.avatar || ch.avatarUrl || ch.photo || ''
  ).trim()
    || (Array.isArray(ch.images) ? String(ch.images.find((u) => String(u || '').trim()) || '').trim() : '');

  return resolveAvatarSrc(fromFields || pathLike);
}

/** 이름 변형 — 예: 가은이 → 가은 */
function nameVariants(name) {
  const n = String(name || '').trim();
  if (!n) return [];
  const out = [n];
  if (n.length >= 3 && /[이가]$/.test(n)) {
    const short = n.slice(0, -1);
    if (short.length >= 2) out.push(short);
  }
  return out;
}

export function buildCharacterNameEntries(characters) {
  const entries = [];
  const seen = new Set();

  for (const ch of characters) {
    const avatar = characterAvatarUrl(ch);
    if (!avatar) continue;

    const names = new Set();
    for (const variant of nameVariants(ch.name)) names.add(variant);
    for (const alias of ch.alias || []) {
      for (const variant of nameVariants(alias)) names.add(variant);
    }

    for (const name of names) {
      const key = `${name}::${avatar}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ name, character: ch, avatar });
    }
  }

  entries.sort((a, b) => b.name.length - a.name.length);
  return entries;
}

export function findCharacterInText(text, entries) {
  if (!text || !entries?.length) return null;
  for (const entry of entries) {
    if (entry.name && text.includes(entry.name)) return entry;
  }
  return null;
}
