/** 리더 TTS — Web Speech API + 캐릭터 등장 시 배경 전환 */

import { on } from '../core/events.js';
import * as project from '../core/project.js';
import { getCurrentStoryMarkdown } from './reader.js';
import { setTtsWallpaper } from './canvas-wallpaper.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

let voicesReady = false;
let koreanVoice = null;
let playing = false;
let paused = false;
let chunkIndex = 0;
let chunks = [];
let nameEntries = [];
let statusTimer = null;
let statusRestore = '';

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

async function start() {
  if (!synth) {
    showStatus('이 브라우저는 음성 읽기를 지원하지 않습니다.');
    return;
  }

  if (!voicesReady) initVoices();
  if (!koreanVoice) {
    showStatus('한국어 음성이 없습니다. 시스템 TTS 설정을 확인하세요.');
  }

  const markdown = await getCurrentStoryMarkdown();
  const plain = markdownToSpeakableText(markdown);
  if (!plain.trim()) {
    showStatus('읽을 내용이 없습니다.');
    return;
  }

  nameEntries = buildCharacterNameEntries(project.getCache().characters || []);
  chunks = chunkSpeakableText(plain);
  if (!chunks.length) {
    showStatus('읽을 내용이 없습니다.');
    return;
  }

  stop({ silent: true });
  playing = true;
  paused = false;
  chunkIndex = 0;
  updateButtons();
  showStatus('읽는 중…');

  speakNextChunk();
}

function speakNextChunk() {
  if (!playing || !synth) return;

  if (chunkIndex >= chunks.length) {
    finish();
    return;
  }

  const chunk = chunks[chunkIndex];
  onChunkStart(chunk);

  const utterance = new SpeechSynthesisUtterance(chunk);
  utterance.lang = 'ko-KR';
  if (koreanVoice) utterance.voice = koreanVoice;
  utterance.rate = 1;
  utterance.pitch = 1;

  utterance.onstart = () => {
    if (!playing) return;
    updateButtons();
  };

  utterance.onend = () => {
    if (!playing) return;
    chunkIndex += 1;
    speakNextChunk();
  };

  utterance.onerror = (e) => {
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    playing = false;
    paused = false;
    currentUtterance = null;
    updateButtons();
    showStatus('음성 읽기 오류가 발생했습니다.');
  };

  currentUtterance = utterance;
  synth.speak(utterance);
}

function onChunkStart(chunk) {
  const match = findCharacterInText(chunk, nameEntries);
  if (match?.avatar) {
    setTtsWallpaper(match.avatar);
  }
}

function stop(opts = {}) {
  const wasPlaying = playing;
  playing = false;
  paused = false;
  chunkIndex = 0;
  chunks = [];
  currentUtterance = null;
  synth?.cancel();
  updateButtons();
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
  updateButtons();
  showStatus('일시정지');
}

function resume() {
  if (!playing || !synth || !paused) return;
  synth.resume();
  paused = false;
  updateButtons();
  showStatus('읽는 중…');
}

function finish() {
  playing = false;
  paused = false;
  currentUtterance = null;
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
  if (stopBtn) {
    stopBtn.disabled = !isActive;
  }
  if (pauseBtn) {
    pauseBtn.disabled = !isActive || paused;
    pauseBtn.hidden = !isActive;
  }
}

function showStatus(message) {
  const el = document.getElementById('reader-tts-status');
  if (!el) return;

  clearTimeout(statusTimer);
  if (!statusRestore) statusRestore = el.textContent;

  el.textContent = message;
  el.classList.add('is-visible');

  statusTimer = setTimeout(() => {
    el.textContent = statusRestore;
    el.classList.remove('is-visible');
    statusRestore = '';
  }, 3200);
}

export function markdownToSpeakableText(md) {
  if (!md) return '';

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

export function chunkSpeakableText(text) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!paragraphs.length) return text.trim() ? [text.trim()] : [];

  const chunks = [];
  const maxLen = 280;

  for (const para of paragraphs) {
    if (para.length <= maxLen) {
      chunks.push(para);
      continue;
    }

    const sentences = para.split(/(?<=[.!?。！？…])\s+/).filter(Boolean);
    let buf = '';
    for (const sentence of sentences) {
      const next = buf ? `${buf} ${sentence}` : sentence;
      if (next.length > maxLen && buf) {
        chunks.push(buf);
        buf = sentence;
      } else {
        buf = next;
      }
    }
    if (buf) chunks.push(buf);
  }

  return chunks;
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
