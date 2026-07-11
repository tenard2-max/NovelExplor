/** 스토리 → 인물/관계도/타임라인/네비 동기화 UI */

import { on, emit } from '../core/events.js';
import * as project from '../core/project.js';
import * as autosave from '../core/autosave.js';
import { showDialog, showAlert } from './dialog.js';
import {
  analyzeStorySync,
  buildCharacterCardMarkdown,
  buildTimelineMarkdown,
  buildStoryNavMarkdown,
  buildEpisodeSummary,
} from '../core/story-sync-engine.js';
import { scheduleGithubSync } from '../core/github-sync.js';
import { switchView } from './nav-menu.js';
import { canUpload } from '../core/auth.js';

const STORY_NAV_VIEWS = new Set(['story-nav', 'timeline']);

export function initStorySync() {
  document.querySelectorAll('[data-action="story-sync"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!canUpload()) {
        showAlert('권한', '일반 사용자는 스토리 동기화(업로드 계열)를 사용할 수 없습니다.');
        return;
      }
      runStorySync().catch(console.error);
    });
  });

  document.querySelectorAll('[data-action="timeline-sync"]').forEach((btn) => {
    btn.addEventListener('click', () => runTimelineSync({ interactive: true }).catch(console.error));
  });

  document.querySelectorAll('[data-action="story-nav-sync"]').forEach((btn) => {
    btn.addEventListener('click', () => runStoryNavSync({ interactive: true }).catch(console.error));
  });

  document.querySelectorAll('[data-action="open-timeline"]').forEach((btn) => {
    btn.addEventListener('click', () => switchView('timeline'));
  });

  document.querySelectorAll('[data-action="open-story-nav"]').forEach((btn) => {
    btn.addEventListener('click', () => switchView('story-nav'));
  });

  // 스토리(ST)·에피소드(EP) 등록 후 타임라인·네비 자동 반영
  on('upload:committed', (payload) => {
    if (!payload?.storyOrEpisodeCount) return;
    (async () => {
      await runTimelineSync({ interactive: false, fromUpload: true });
      await runStoryNavSync({ interactive: false, fromUpload: true });
    })().catch(console.error);
  });

  on('view:changed', (viewId) => {
    toggleStoryNavControls(viewId);
    syncStoryNavToolbarActive(viewId);
  });
  toggleStoryNavControls('master');
  syncStoryNavToolbarActive('master');
}

function toggleStoryNavControls(viewId) {
  const el = document.getElementById('story-nav-controls');
  if (el) el.hidden = !STORY_NAV_VIEWS.has(viewId);
}

function syncStoryNavToolbarActive(viewId) {
  document.querySelectorAll('[data-action="open-story-nav"]').forEach((btn) => {
    btn.classList.toggle('is-active', viewId === 'story-nav');
  });
  document.querySelectorAll('[data-action="open-timeline"]').forEach((btn) => {
    btn.classList.toggle('is-active', viewId === 'timeline');
  });
}

async function persistTimelineMarkdown() {
  const md = buildTimelineMarkdown(project.getCache().timeline || []);
  await project.upsertWorkspaceMarkdown('05_TIMELINE.md', md, { folder: 'NovelMD', docType: 'timeline' });
}

async function persistStoryNavMarkdown() {
  const md = buildStoryNavMarkdown(project.getCache().episodes || []);
  await project.upsertWorkspaceMarkdown('11_STORY_NAV.md', md, { folder: 'NovelMD', docType: 'story-nav' });
}

/**
 * 스토리 기준 타임라인만 동기화
 * @param {{ interactive?: boolean, fromUpload?: boolean }} opts
 */
export async function runTimelineSync(opts = {}) {
  const { interactive = false, fromUpload = false } = opts;
  const proj = project.getCurrentProject();
  if (!proj) {
    if (interactive) await showAlert('타임라인 업데이트', '열린 프로젝트가 없습니다.');
    return { added: 0, candidates: 0 };
  }

  const cache = project.getCache();
  if (!(cache.stories || []).length && !(cache.episodes || []).length) {
    if (interactive) {
      await showAlert('타임라인 업데이트', '등록된 스토리(ST) 또는 에피소드가 없습니다.');
    }
    return { added: 0, candidates: 0 };
  }

  await project.ensureEpisodesFromStories(cache, proj.projectId);
  const analysis = analyzeStorySync(project.getCache());
  const candidates = analysis.timelineCandidates || [];

  if (!candidates.length) {
    if (interactive) {
      await showAlert(
        '타임라인 업데이트',
        `EP ${analysis.episodesSynced}화 기준으로 키워드 사건 후보가 없습니다.`
      );
    }
    return { added: 0, candidates: 0 };
  }

  let selected = candidates;
  if (interactive) {
    let picked = null;
    const confirmed = await showDialog({
      title: '타임라인 업데이트 — 후보 확인',
      bodyHtml: buildTimelinePreviewHtml(candidates),
      onConfirm: () => {
        picked = [...document.querySelectorAll('.sync-tl-only:checked')]
          .map((el) => candidates[Number(el.value)])
          .filter(Boolean);
      },
    });
    if (!confirmed || !picked) return { added: 0, candidates: candidates.length };
    selected = picked;
  }

  if (!selected.length) return { added: 0, candidates: candidates.length };

  const added = await project.replaceStorySyncTimeline(selected);
  await persistTimelineMarkdown();
  autosave.markDirty();
  emit('project:loaded', proj);
  scheduleGithubSync(fromUpload ? 'file-upload-timeline' : 'timeline-sync');

  if (interactive) {
    await showAlert(
      '타임라인 업데이트 완료',
      `사건 ${added}건 반영 · 05_TIMELINE.md 갱신 · GitHub 동기화 예약`
    );
  } else if (fromUpload && added > 0) {
    await showAlert(
      '타임라인 자동 반영',
      `스토리 등록에 맞춰 타임라인 사건 ${added}건을 업데이트했습니다.`
    );
  }

  return { added, candidates: candidates.length };
}

/**
 * ST→EP 덮어쓰기 + 에피소드 요약 생성 + 네비 MD
 */
export async function runStoryNavSync(opts = {}) {
  const { interactive = false, fromUpload = false } = opts;
  const proj = project.getCurrentProject();
  if (!proj) {
    if (interactive) await showAlert('스토리 네비 업데이트', '열린 프로젝트가 없습니다.');
    return { episodes: 0 };
  }

  const cache = project.getCache();
  if (!(cache.stories || []).length && !(cache.episodes || []).length) {
    if (interactive) {
      await showAlert('스토리 네비 업데이트', '등록된 스토리(ST) 또는 에피소드가 없습니다.');
    }
    return { episodes: 0 };
  }

  await project.ensureEpisodesFromStories(cache, proj.projectId);

  let updated = 0;
  for (const ep of [...(project.getCache().episodes || [])]) {
    const summary = buildEpisodeSummary(ep.content, ep.title);
    const rec = await project.updateEpisodeSummary(ep.id, summary);
    if (rec) updated += 1;
  }

  await persistStoryNavMarkdown();
  autosave.markDirty();
  emit('story-nav:updated', { episodes: updated });
  emit('project:loaded', proj);
  scheduleGithubSync(fromUpload ? 'file-upload-story-nav' : 'story-nav-sync');

  if (interactive) {
    await showAlert(
      '스토리 네비 업데이트 완료',
      `EP ${updated}화 요약 갱신 · 11_STORY_NAV.md 저장 · GitHub 동기화 예약`
    );
  }

  return { episodes: updated };
}

function buildTimelinePreviewHtml(candidates) {
  const rows = candidates.map((t, i) => `
    <label class="autoadd-row">
      <input type="checkbox" class="sync-tl-only" value="${i}" checked>
      <span class="autoadd-name">EP${String(t.episode).padStart(3, '0')} ${esc(t.date || '—')} ${esc(t.title || '')}</span>
      <span class="autoadd-meta">년월일·제목</span>
    </label>`).join('');

  return `
    <p class="autoadd-desc">스토리 키워드(붕괴, 회귀, 투자, 만남…) 구간에서 추출한 후보입니다. 적용할 항목을 선택하세요. 기존 수동 타임라인은 유지되고, 스토리 동기화 항목만 교체됩니다.</p>
    <div class="autoadd-list">${rows}</div>`;
}

async function runStorySync() {
  const proj = project.getCurrentProject();
  if (!proj) {
    await showAlert('스토리 동기화', '열린 프로젝트가 없습니다.');
    return;
  }

  // 1) ST → EP 항상 덮어쓰기
  const cache = project.getCache();
  await project.ensureEpisodesFromStories(cache, proj.projectId);

  const analysis = analyzeStorySync(project.getCache());
  if (
    !analysis.characterCandidates.length
    && !analysis.characterUpdates.length
    && !analysis.relationPairs.length
    && !analysis.timelineCandidates.length
  ) {
    await showAlert(
      '스토리 동기화',
      `네비게이터 EP ${analysis.episodesSynced}화 동기화 완료.\n추가로 반영할 인물·관계·타임라인 후보가 없습니다.`
    );
    emit('project:loaded', proj);
    autosave.markDirty();
    return;
  }

  const bodyHtml = buildPreviewHtml(analysis);
  let selected = null;
  const confirmed = await showDialog({
    title: '스토리 동기화 — 후보 확인',
    bodyHtml,
    onConfirm: () => {
      selected = readSelection(analysis);
    },
  });

  if (!confirmed || !selected) return;

  const summary = await applySelection(selected, analysis);
  autosave.markDirty();
  emit('project:loaded', proj);
  scheduleGithubSync('story-sync');

  await showAlert(
    '스토리 동기화 완료',
    [
      `네비 EP: ${analysis.episodesSynced}화 반영`,
      `인물 추가: ${summary.addedChars}`,
      `인물 갱신: ${summary.updatedChars}`,
      `관계선: ${summary.relations}`,
      `타임라인: ${summary.timeline}`,
      `인물 MD: ${summary.mdFiles}`,
    ].join('\n')
  );
}

function buildPreviewHtml(analysis) {
  const charNew = analysis.characterCandidates.map((c, i) => `
    <label class="autoadd-row">
      <input type="checkbox" class="sync-char-new" value="${i}" checked>
      <span class="autoadd-name">＋ ${esc(c.name)}</span>
      <span class="autoadd-meta">${c.count}회 · EP${c.firstEpisode}~${c.lastEpisode}</span>
    </label>`).join('');

  const charUp = analysis.characterUpdates.map((c, i) => `
    <label class="autoadd-row">
      <input type="checkbox" class="sync-char-up" value="${i}" checked>
      <span class="autoadd-name">↻ ${esc(c.name)}</span>
      <span class="autoadd-meta">EP${c.firstEpisode}~${c.lastEpisode} · 설명 덮어씀</span>
    </label>`).join('');

  const rels = analysis.relationPairs.slice(0, 40).map((p, i) => `
    <label class="autoadd-row">
      <input type="checkbox" class="sync-rel" value="${i}" checked>
      <span class="autoadd-name">${esc(p.fromName)} ↔ ${esc(p.toName)}</span>
      <span class="autoadd-meta">${p.count}회 공동등장</span>
    </label>`).join('');

  const tls = analysis.timelineCandidates.map((t, i) => `
    <label class="autoadd-row">
      <input type="checkbox" class="sync-tl" value="${i}" checked>
      <span class="autoadd-name">EP${String(t.episode).padStart(3, '0')} ${esc(t.date || '—')} ${esc(t.title || '')}</span>
      <span class="autoadd-meta">년월일·제목</span>
    </label>`).join('');

  return `
    <p class="autoadd-desc">ST→EP 덮어쓰기 후 분석한 후보입니다. 복선(FS)은 변경하지 않습니다. 적용할 항목을 선택하세요.</p>
    <h4 class="sync-section-title">인물 추가 (${analysis.characterCandidates.length})</h4>
    <div class="autoadd-list">${charNew || '<p class="autoadd-desc">없음</p>'}</div>
    <h4 class="sync-section-title">인물 갱신 · 덮어쓰기 (${analysis.characterUpdates.length})</h4>
    <div class="autoadd-list">${charUp || '<p class="autoadd-desc">없음</p>'}</div>
    <h4 class="sync-section-title">관계도 (${Math.min(40, analysis.relationPairs.length)})</h4>
    <div class="autoadd-list">${rels || '<p class="autoadd-desc">없음</p>'}</div>
    <h4 class="sync-section-title">타임라인 키워드 사건 (${analysis.timelineCandidates.length})</h4>
    <div class="autoadd-list">${tls || '<p class="autoadd-desc">없음</p>'}</div>`;
}

function readSelection(analysis) {
  const charNew = [...document.querySelectorAll('.sync-char-new:checked')]
    .map((el) => analysis.characterCandidates[Number(el.value)])
    .filter(Boolean);
  const charUp = [...document.querySelectorAll('.sync-char-up:checked')]
    .map((el) => analysis.characterUpdates[Number(el.value)])
    .filter(Boolean);
  const relations = [...document.querySelectorAll('.sync-rel:checked')]
    .map((el) => analysis.relationPairs[Number(el.value)])
    .filter(Boolean);
  const timeline = [...document.querySelectorAll('.sync-tl:checked')]
    .map((el) => analysis.timelineCandidates[Number(el.value)])
    .filter(Boolean);
  return { charNew, charUp, relations, timeline };
}

async function applySelection(selected) {
  let addedChars = 0;
  let updatedChars = 0;
  let relations = 0;
  let timeline = 0;
  let mdFiles = 0;

  const nameToId = new Map();
  for (const ch of project.getCache().characters || []) {
    if (ch.name) nameToId.set(ch.name, ch.id);
  }

  for (const c of selected.charNew) {
    const rec = await project.addCharacter({
      name: c.name,
      description: c.description,
      firstEpisode: c.firstEpisode,
      lastEpisode: c.lastEpisode,
    });
    if (rec) {
      addedChars += 1;
      nameToId.set(rec.name, rec.id);
      const md = buildCharacterCardMarkdown(rec, []);
      if (await project.upsertCharacterCardMarkdown(rec, md)) mdFiles += 1;
    }
  }

  for (const c of selected.charUp) {
    const ch = project.getCache().characters.find((x) => x.id === c.id);
    if (!ch) continue;
    await project.updateCharacter({
      ...ch,
      firstEpisode: c.firstEpisode,
      lastEpisode: c.lastEpisode,
      description: c.description,
      updatedAt: new Date().toISOString(),
    });
    updatedChars += 1;
    const md = buildCharacterCardMarkdown(
      { ...ch, firstEpisode: c.firstEpisode, lastEpisode: c.lastEpisode, description: c.description },
      []
    );
    if (await project.upsertCharacterCardMarkdown(ch, md)) mdFiles += 1;
  }

  for (const p of selected.relations) {
    const fromId = nameToId.get(p.fromName);
    const toId = nameToId.get(p.toName);
    if (!fromId || !toId) continue;

    const existing = (project.getCache().characterRelations || []).find((e) => {
      const a = e.fromId;
      const b = e.toId;
      return (a === fromId && b === toId) || (a === toId && b === fromId);
    });

    const desc = `스토리 공동 등장 ${p.count}회 · EP${p.episodes.join(',')}`;
    if (existing) {
      await project.updateCharacterRelation(existing.fromId, existing.toId, {
        description: desc,
        type: existing.type || 'ally',
        lineWidth: existing.lineWidth || 3,
      });
    } else {
      await project.addCharacterRelation(fromId, toId, {
        manual: false,
        type: 'ally',
        lineWidth: 3,
        description: desc,
      });
    }
    relations += 1;
  }

  if (selected.timeline.length) {
    timeline = await project.replaceStorySyncTimeline(selected.timeline);
    await persistTimelineMarkdown();
  }

  // ST→EP 후 네비 요약·MD도 갱신
  for (const ep of [...(project.getCache().episodes || [])]) {
    const summary = buildEpisodeSummary(ep.content, ep.title);
    await project.updateEpisodeSummary(ep.id, summary);
  }
  await persistStoryNavMarkdown();

  // 관계 반영 후 MD 재생성 (관계 표 포함)
  const chars = project.getCache().characters || [];
  const rels = project.getCache().characterRelations || [];
  for (const ch of chars) {
    if (!selected.charNew.some((c) => c.name === ch.name)
      && !selected.charUp.some((c) => c.id === ch.id)) {
      continue;
    }
    const linked = rels
      .filter((r) => r.fromId === ch.id || r.toId === ch.id)
      .map((r) => {
        const otherId = r.fromId === ch.id ? r.toId : r.fromId;
        const other = chars.find((x) => x.id === otherId);
        return {
          lineNo: r.lineNo,
          otherName: other?.name || otherId,
          type: r.type,
          lineWidth: r.lineWidth,
          description: r.description,
        };
      });
    const md = buildCharacterCardMarkdown(ch, linked);
    if (await project.upsertCharacterCardMarkdown(ch, md)) {
      /* already counted for new/up */
    }
  }

  return { addedChars, updatedChars, relations, timeline, mdFiles };
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
