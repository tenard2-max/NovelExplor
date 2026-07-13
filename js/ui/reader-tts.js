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
} from './tts-voices.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const TTS_MAX_CHUNK = 200;
const TEST_VOICE_TEXT = '안녕하세요. TN Motion Engine 테스트입니다.';

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

  playBtn?.addEventListener('click', () => {
    if (playing && paused) {
      resume();
      return;
    }
    start();
  });

  testBtn?.addEventListener('click', () => speakTestVoice());
  stopBtn?.addEventListener('click', () => stop());
  pauseBtn?.addEventListener('click', () => togglePause());

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
    refreshVoices();
    renderVoiceSelect();
    renderTtsDebug();
    showStatus(`Voice ${getVoiceList().length}개 새로고침`);
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
    <div class="tts-debug-meta"><strong>Voice Count :</strong> ${info.voiceCount}</div>
    <div class="tts-debug-meta"><strong>Selected :</strong> ${
      info.selected
        ? esc(`${info.selected.name} (${info.selected.lang})`)
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
  if (!synth) {
    showStatus('이 브라우저는 음성 읽기를 지원하지 않습니다.', { persist: true });
    return;
  }

  if (synth.speaking || synth.pending) {
    synth.cancel();
  }

  const utterance = createUtterance(TEST_VOICE_TEXT);
  speechSynthesis.speak(utterance);
  const v = getSelectedVoice();
  showStatus(v ? `테스트: ${formatVoiceLabel(v)}` : '테스트 음성 재생 중…');
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
    handleSpeakFailure(`음성 재생 실패 (${e.error || 'unknown'})`);
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

  const canPlay = !!synth;
  const isActive = playing;

  if (playBtn) {
    playBtn.disabled = !canPlay;
    playBtn.textContent = playing && paused ? '▶ 재개' : '🔊 재생';
    playBtn.classList.toggle('is-active', isActive && !paused);
  }
  if (stopBtn) stopBtn.disabled = !isActive;
  if (pauseBtn) {
    pauseBtn.disabled = !isActive || paused;
    pauseBtn.hidden = !isActive;
  }
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

function characterAvatarUrl(ch) {
  return String(ch.avatarDataUrl || ch.image || ch.avatar || ch.avatarUrl || ch.photo || '').trim()
    || (Array.isArray(ch.images) ? String(ch.images.find((u) => String(u || '').trim()) || '').trim() : '');
}

export function buildCharacterNameEntries(characters) {
  const entries = [];

  for (const ch of characters) {
    const avatar = characterAvatarUrl(ch);
    if (!avatar) continue;

    if (ch.name) entries.push({ name: String(ch.name).trim(), character: ch, avatar });
    for (const alias of ch.alias || []) {
      const name = String(alias || '').trim();
      if (name) entries.push({ name, character: ch, avatar });
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
