/** 리더 TTS — Web Speech API + 캐릭터 등장 시 배경 전환 + 문단 하이라이트 */

import { on } from '../core/events.js';
import * as project from '../core/project.js';
import { getCurrentStoryMarkdownSync, tagReaderBlocksForTts } from './reader.js';
import { setTtsWallpaper } from './canvas-wallpaper.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const TTS_MAX_CHUNK = 200;

let voicesReady = false;
let koreanVoice = null;
let playing = false;
let paused = false;
let chunkIndex = 0;
/** @type {Array<{ text: string, paraIndex: number }>} */
let chunks = [];
let nameEntries = [];
let statusTimer = null;
let statusRestore = '';
let keepAliveTimer = null;
let startGuardTimer = null;
let heardAnySpeech = false;

/** @type {SpeechSynthesisUtterance | null} */
let currentUtterance = null;

export function initReaderTts() {
  const playBtn = document.querySelector('[data-action="tts-play"]');
  const stopBtn = document.querySelector('[data-action="tts-stop"]');
  const pauseBtn = document.querySelector('[data-action="tts-pause"]');

  initVoices();

  playBtn?.addEventListener('click', () => {
    if (playing && paused) {
      resume();
      return;
    }
    start();
  });

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
}

function initVoices() {
  if (!synth) return;

  const refresh = () => {
    const voices = synth.getVoices();
    koreanVoice = voices.find((v) => v.lang.startsWith('ko')) || null;
    voicesReady = voices.length > 0;
  };

  refresh();
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.addEventListener('voiceschanged', refresh);
  }
}

/** 클릭 제스처 컨텍스트 안에서 synthesis 큐를 깨우고, warm utterance 종료까지 대기 */
function primeSpeechOnGesture() {
  if (!synth) return Promise.resolve();

  initVoices();
  if (synth.paused) synth.resume();

  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const warm = new SpeechSynthesisUtterance('\u200b');
    warm.volume = 0.01;
    warm.lang = 'ko-KR';
    if (koreanVoice) warm.voice = koreanVoice;
    warm.onend = done;
    warm.onerror = done;
    window.setTimeout(done, 180);
    synth.speak(warm);
  });
}

function start() {
  if (!synth) {
    showStatus('이 브라우저는 음성 읽기를 지원하지 않습니다.', { persist: true });
    return;
  }

  initVoices();

  const inner = document.querySelector('#reader-content .reader-inner');
  tagReaderBlocksForTts(inner);
  chunks = buildTtsChunksFromReaderDom(inner);

  if (!chunks.length) {
    const markdown = getCurrentStoryMarkdownSync();
    if (markdown != null && typeof markdown === 'object' && typeof markdown.then === 'function') {
      showStatus('소설 본문을 불러오지 못했습니다. 페이지를 새로고침 후 다시 시도해 주세요.', { persist: true });
      return;
    }
    const plain = markdownToSpeakableText(markdown);
    chunks = chunkSpeakableText(plain);
  }

  if (!chunks.length) {
    showStatus('읽을 내용이 없습니다.', { persist: true });
    return;
  }

  nameEntries = buildCharacterNameEntries(project.getCache().characters || []);

  const needsCancel = playing || synth.speaking || synth.pending;
  resetPlaybackState({ silent: true });

  playing = true;
  paused = false;
  chunkIndex = 0;
  heardAnySpeech = false;
  updateButtons();
  showStatus('준비 중…', { persist: true });

  const begin = async () => {
    if (!playing) return;
    await primeSpeechOnGesture();
    if (!playing) return;
    showStatus(`음성 준비 ${chunks.length}구간`, { persist: true });
    window.setTimeout(() => {
      if (playing) speakNextChunk();
    }, 50);
  };

  if (needsCancel) {
    synth.cancel();
    window.setTimeout(begin, 80);
  } else {
    begin();
  }
}

function speakNextChunk() {
  if (!playing || !synth) return;

  while (chunkIndex < chunks.length && !chunks[chunkIndex]?.text?.trim()) {
    chunkIndex += 1;
  }

  if (chunkIndex >= chunks.length) {
    finish();
    return;
  }

  const chunk = chunks[chunkIndex];
  onChunkStart(chunk);

  const utterance = new SpeechSynthesisUtterance(chunk.text);
  utterance.lang = 'ko-KR';
  if (koreanVoice) utterance.voice = koreanVoice;
  utterance.rate = 1;
  utterance.pitch = 1;

  let chunkStarted = false;

  clearTimeout(startGuardTimer);
  startGuardTimer = window.setTimeout(() => {
    if (!playing || paused || currentUtterance !== utterance || chunkStarted) return;
    handleSpeakFailure('음성 재생이 시작되지 않았습니다. 다시 시도해 주세요.');
  }, 4500);

  utterance.onstart = () => {
    if (!playing) return;
    chunkStarted = true;
    heardAnySpeech = true;
    clearTimeout(startGuardTimer);
    startKeepAlive();
    updateButtons();
    showStatus('읽는 중…');
  };

  utterance.onend = () => {
    if (!playing) return;
    clearTimeout(startGuardTimer);
    if (!chunkStarted) {
      handleSpeakFailure('음성 재생이 시작되지 않았습니다. 다시 시도해 주세요.');
      return;
    }
    chunkIndex += 1;
    speakNextChunk();
  };

  utterance.onerror = (e) => {
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    clearTimeout(startGuardTimer);
    handleSpeakFailure(ttsErrorMessage(e.error));
  };

  currentUtterance = utterance;
  synth.speak(utterance);
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

function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = window.setInterval(() => {
    if (!playing || paused || !synth) {
      stopKeepAlive();
      return;
    }
    if (synth.speaking) synth.resume();
  }, 8000);
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function handleSpeakFailure(message) {
  playing = false;
  paused = false;
  currentUtterance = null;
  heardAnySpeech = false;
  stopKeepAlive();
  clearHighlight();
  synth?.cancel();
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
  heardAnySpeech = false;
  clearTimeout(startGuardTimer);
  stopKeepAlive();
  clearHighlight();
  updateButtons();
  if (!opts.silent && wasPlaying) {
    showStatus('읽기를 정지했습니다.');
  }
}

function stop(opts = {}) {
  const wasPlaying = playing;
  resetPlaybackState({ silent: true });
  synth?.cancel();
  if (!opts.silent && wasPlaying) {
    showStatus('읽기를 정지했습니다.');
  }
}

function togglePause() {
  if (!playing || !synth) return;
  if (paused) {
    resume();
  } else {
    pause();
  }
}

function pause() {
  if (!playing || !synth || paused) return;
  synth.pause();
  paused = true;
  stopKeepAlive();
  updateButtons();
  showStatus('일시정지');
}

function resume() {
  if (!playing || !synth || !paused) return;
  synth.resume();
  paused = false;
  startKeepAlive();
  updateButtons();
  showStatus('읽는 중…');
}

function finish() {
  if (playing && chunks.length > 0 && !heardAnySpeech) {
    handleSpeakFailure('음성 재생이 시작되지 않았습니다. 다시 시도해 주세요.');
    return;
  }

  playing = false;
  paused = false;
  currentUtterance = null;
  heardAnySpeech = false;
  clearTimeout(startGuardTimer);
  stopKeepAlive();
  clearHighlight();
  updateButtons();
  showStatus('읽기 완료');
}

function ttsErrorMessage(error) {
  switch (error) {
    case 'not-allowed':
      return '음성 재생 권한이 거부되었습니다.';
    case 'network':
      return '네트워크 음성 로드에 실패했습니다.';
    case 'synthesis-unavailable':
      return '음성 합성을 사용할 수 없습니다.';
    case 'audio-busy':
      return '다른 앱이 오디오를 사용 중입니다.';
    case 'language-unavailable':
      return '한국어 음성을 사용할 수 없습니다.';
    default:
      return '음성 읽기 오류가 발생했습니다.';
  }
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
  if (stopBtn) {
    stopBtn.disabled = !isActive;
  }
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

  statusTimer = setTimeout(() => {
    el.textContent = statusRestore;
    el.classList.remove('is-visible');
    statusRestore = '';
  }, 3200);
}

/** DOM에 표시된 블록(p/h1)과 동일한 순서·인덱스로 TTS 구간 생성 */
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
