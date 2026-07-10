/** 앱 진입점 */

import { on, emit } from './core/events.js';
import * as project from './core/project.js';
import * as autosave from './core/autosave.js';
import { initNav, switchView } from './ui/nav-menu.js';
import { initWorkspace } from './ui/workspace.js';
import { initUploadPanel, logImport, emitSelectedFiles } from './ui/upload-panel.js';
import { initGraph } from './graph/canvas-graph.js';
import { initEditor, getEditorSelection, getCurrentEpisodeNumber, flushPendingSave } from './ui/editor.js';
import { initReader } from './ui/reader.js';
import { initInspector } from './ui/inspector.js';
import { initCanvasLayout } from './ui/canvas-layout.js';
import { initCanvasWallpaper } from './ui/canvas-wallpaper.js';
import { initCharacterPanel } from './ui/character-panel.js';
import { initCharacterActions } from './ui/character-actions.js';
import { initBackup, offerLocalRecovery } from './core/backup.js';
import { loadWorkspaceManifest } from './core/workspace-xml.js';
import { searchAll } from './search/search.js';
import {
  analyzeForeshadowCandidates,
  detectContradictions,
  findUnresolvedForeshadows,
} from './foreshadow/engine.js';
import { classifyImportFilename, FORESHADOW_GRADES } from './core/utils.js';
import * as storage from './core/storage.js';
import { showDialog, showAlert } from './ui/dialog.js';

async function boot() {
  initNav();
  initWorkspace();
  initUploadPanel();
  initGraph();
  initEditor();
  initReader();
  initInspector();
  initCanvasLayout();
  initCanvasWallpaper();
  initCharacterPanel();
  initCharacterActions();
  initActions();
  initBackup();
  initSearch();
  initKeyboard();
  initStatus();
  initUploadHandler();

  try {
    await loadWorkspaceManifest();
    console.info('[NovelExplor] workspace.xml 매니페스트 로드 완료');
  } catch (err) {
    console.warn('[NovelExplor] workspace.xml 없음/실패 — IndexedDB 모드만 사용:', err.message);
  }

  const projects = await project.listProjects();
  if (projects.length) {
    await project.loadProject(projects[0].id);
  } else {
    const recovered = await offerLocalRecovery();
    if (!recovered) {
      await project.createProject('인류 생존 프로젝트', true);
    }
  }
  warnIfWrongOrigin();
  switchView('master');
}

/** IndexedDB는 host:port(origin)별로 분리됨 — 9000 고정 안내 */
function warnIfWrongOrigin() {
  const { hostname, port, href } = window.location;
  const expectedPort = '9000';
  if (hostname === '127.0.0.1' && port && port !== expectedPort) {
    console.warn(
      `[NovelExplor] 현재 포트 ${port} — 저장 데이터는 127.0.0.1:${expectedPort} 에 있습니다. ` +
      `Live Server 포트를 ${expectedPort}으로 맞추고 http://127.0.0.1:${expectedPort}/index.html 로 접속하세요.`
    );
  }
  if (hostname === 'localhost' && port === expectedPort) {
    console.warn(
      '[NovelExplor] localhost 와 127.0.0.1 은 IndexedDB가 다릅니다. ' +
      `http://127.0.0.1:${expectedPort}/index.html 로 접속하세요. (현재: ${href})`
    );
  }
}

function initActions() {
  bindAction('new-project', async () => {
    const title = prompt('프로젝트 제목:', '새 프로젝트');
    if (title === null) return;
    await project.createProject(title, false);
    switchView('master');
  });

  bindAction('open-project', async () => {
    const list = await project.listProjects();
    if (!list.length) { alert('저장된 프로젝트가 없습니다.'); return; }
    const names = list.map((p, i) => `${i + 1}. ${p.title}`).join('\n');
    const pick = prompt(`프로젝트 번호를 선택하세요:\n${names}`);
    const idx = parseInt(pick, 10) - 1;
    if (idx >= 0 && idx < list.length) {
      await project.loadProject(list[idx].id);
      switchView('master');
    }
  });

  bindAction('save', () => saveCurrentProject());
  bindAction('save-project', () => saveCurrentProject());
  bindAction('export-json', exportJson);

  bindAction('toggle-theme', () => {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = next;
    localStorage.setItem('fft-theme', next);
  });

  bindAction('analyze-foreshadow', runForeshadowAnalysis);
  bindAction('add-foreshadow', addForeshadowFromSelection);
  bindAction('about', () => showAlert('NovelExplor', '인류 생존 프로젝트 — 복선·스토리·세계관 워크스페이스'));

  const savedTheme = localStorage.getItem('fft-theme');
  if (savedTheme) document.body.dataset.theme = savedTheme;
}

async function saveCurrentProject() {
  try {
    await flushPendingSave();
    await autosave.flushSave(true);
  } catch (err) {
    alert(`프로젝트 저장 실패: ${err.message}`);
  }
}

function bindAction(action, handler) {
  document.querySelectorAll(`[data-action="${action}"]`).forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      handler();
    });
  });
}

function initUploadHandler() {
  const fileInput = document.getElementById('import-file');

  on('upload:limit', ({ total, max }) => {
    alert(`한 번에 최대 ${max}개까지 등록할 수 있습니다. (${total}개 중 ${max}개만 처리)`);
  });

  on('upload:files', async (files) => {
    let lastView = null;
    let successCount = 0;
    const errors = [];

    for (const file of files) {
      try {
        const view = await importSingleFile(file);
        if (view) lastView = view;
        logImport(file.name, true);
        successCount += 1;
      } catch (err) {
        logImport(file.name, false);
        errors.push(`${file.name}: ${err.message}`);
      }
    }

    if (successCount > 0) {
      emit('project:loaded', project.getCurrentProject());
      autosave.markDirty();
      if (lastView) switchView(lastView);
    }

    if (errors.length) {
      const preview = errors.slice(0, 5).join('\n');
      const more = errors.length > 5 ? `\n... 외 ${errors.length - 5}개` : '';
      alert(`Import 실패 ${errors.length}건 (${successCount}건 성공)\n\n${preview}${more}`);
    }
  });

  fileInput?.addEventListener('change', async (e) => {
    emitSelectedFiles(e.target.files);
    e.target.value = '';
  });
}

async function importSingleFile(file) {
  const text = await file.text();
  if (file.name.endsWith('.json')) {
    await project.importProjectJson(text);
    return 'master';
  }
  if (file.name.endsWith('.zip')) {
    throw new Error('ZIP Import는 STEP 2에서 지원됩니다.');
  }
  return importTextFile(file, text, { batch: true });
}

async function exportJson() {
  const json = await project.exportProjectJson();
  if (!json) return;
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `NovelProject_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importTextFile(file, text, opts = {}) {
  const classified = classifyImportFilename(file.name);
  let viewId = 'reader';

  if (classified.type === 'setting') {
    await project.importSettingMdFile(text, file.name);
    const viewByIndex = { 0: 'master', 1: 'story-bible', 2: 'world' };
    viewId = viewByIndex[classified.index] ?? 'world';
  } else if (classified.type === 'episode') {
    await project.importEpisodeFile(text, file.name, classified.number);
    viewId = 'story-nav';
  } else {
    await project.importStoryFile(text, file.name, classified.number);
    viewId = 'reader';
  }

  if (!opts.batch) {
    emit('project:loaded', project.getCurrentProject());
    autosave.markDirty();
    switchView(viewId);
  }

  return viewId;
}

async function runForeshadowAnalysis() {
  const cache = project.getCache();
  const existing = cache.foreshadows.map((f) => f.title);
  const candidates = analyzeForeshadowCandidates(cache.episodes, existing);

  if (!candidates.length) {
    showAlert('복선 분석', '새로운 복선 후보가 발견되지 않았습니다.');
    return;
  }

  const body = `
    <p>${candidates.length}개의 복선 후보를 제안합니다. 승인할 항목을 선택하세요.</p>
    <div class="candidate-list">
      ${candidates.map((c, i) => `
        <label class="candidate-item">
          <input type="checkbox" name="cand" value="${i}" ${c.confidence >= 70 ? 'checked' : ''}>
          <span>
            <strong>[${c.grade}] ${c.title}</strong> (${c.confidence}%)
            <br><small>EP${c.createdEpisode} · ${c.description}</small>
          </span>
        </label>
      `).join('')}
    </div>
  `;

  await showDialog({
    title: '복선 후보 분석',
    bodyHtml: body,
    onConfirm: async () => {
      const checks = document.querySelectorAll('input[name="cand"]:checked');
      const proj = project.getCurrentProject();
      for (const chk of checks) {
        const c = candidates[parseInt(chk.value, 10)];
        const fsId = `FS${String(cache.foreshadows.length + 1).padStart(4, '0')}`;
        const record = {
          id: `${proj.projectId}-${fsId}`,
          projectId: proj.projectId,
          foreshadowId: fsId,
          title: c.title,
          description: c.description,
          grade: c.grade,
          status: 'OPEN',
          createdEpisode: c.createdEpisode,
          expectedEpisode: c.expectedEpisode,
          resolvedEpisode: 0,
          relatedCharacters: [],
          relatedEvents: [],
          tags: c.tags,
        };
        await storage.put('foreshadows', record);
        cache.foreshadows.push(record);
      }
      emit('project:loaded', proj);
      autosave.markDirty();
      switchView('foreshadow');
    },
  });
}

async function addForeshadowFromSelection() {
  const selection = getEditorSelection();
  if (!selection?.trim()) {
    alert('에디터에서 문장을 선택한 뒤 복선 등록을 누르세요.');
    return;
  }

  const grade = prompt('등급 (F~SSS):', 'B');
  if (!grade || !FORESHADOW_GRADES.includes(grade.toUpperCase())) {
    alert('올바른 등급을 입력하세요.');
    return;
  }

  const epNum = getCurrentEpisodeNumber() || 1;
  const expected = parseInt(prompt('예상 회수 화수:', String(epNum + 20)), 10);
  const proj = project.getCurrentProject();
  const cache = project.getCache();
  const fsId = `FS${String(cache.foreshadows.length + 1).padStart(4, '0')}`;

  const record = {
    id: `${proj.projectId}-${fsId}`,
    projectId: proj.projectId,
    foreshadowId: fsId,
    title: selection.slice(0, 40),
    description: selection,
    grade: grade.toUpperCase(),
    status: 'OPEN',
    createdEpisode: epNum,
    expectedEpisode: expected || epNum + 20,
    resolvedEpisode: 0,
    relatedCharacters: [],
    relatedEvents: [],
    tags: [],
  };

  await storage.put('foreshadows', record);
  cache.foreshadows.push(record);
  emit('project:loaded', proj);
  emit('inspector:show', { type: 'foreshadow', data: record });
  autosave.markDirty();
}

function initSearch() {
  const input = document.getElementById('global-search');
  let debounce = null;
  input?.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = input.value;
      if (!q.trim()) return;
      const results = searchAll(q, project.getCache());
      if (!results.length) return;
      const body = `<div class="search-results" id="search-results">${results.map((r) =>
        `<div class="search-hit" data-type="${r.type}" data-id="${r.id}">
          <strong>${r.label}</strong><br><small>${r.snippet}</small>
        </div>`
      ).join('')}</div>`;

      showDialog({ title: `검색: "${q}"`, bodyHtml: body });
      document.getElementById('search-results')?.addEventListener('click', (ev) => {
        const hit = ev.target.closest('.search-hit');
        if (!hit) return;
        document.getElementById('dialog').close();
        emit('explorer:select', {
          id: hit.dataset.id,
          type: hit.dataset.type === 'episode' ? 'episode'
            : hit.dataset.type === 'story' ? 'story'
            : hit.dataset.type === 'setting' ? 'file'
            : hit.dataset.type,
        });
      });
    }, 300);
  });
}

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveCurrentProject(); }
    if (e.ctrlKey && e.key === 'f') { e.preventDefault(); document.querySelector('[data-action="find"]')?.click(); }
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); document.querySelector('[data-action="undo"]')?.click(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); document.querySelector('[data-action="redo"]')?.click(); }
    if (e.key === 'F5') { e.preventDefault(); runForeshadowAnalysis(); }
  });
}

function initStatus() {
  on('save:state', (state) => {
    document.body.dataset.saveState = state;
    const labels = { saving: '저장 중...', saved: '저장됨', dirty: '변경됨', error: '저장 실패' };
    document.getElementById('status-save').textContent = labels[state] || state;
  });
  on('save:dirty', (dirty) => {
    document.body.dataset.saveState = dirty ? 'dirty' : 'saved';
    document.getElementById('status-save').textContent = dirty ? '변경됨' : '저장됨';
  });
}

// 전역 드래그앤드롭 가드 — 모듈 로드 즉시 설치(부팅 예외의 영향을 받지 않음).
// 파일 드래그는 페이지 어디에 떨어지든 브라우저 기본 동작(파일 열기 = 페이지 이탈)을 막는다.
// preventDefault는 브라우저의 파일 열기만 차단할 뿐, 각 드롭 영역 핸들러가
// dataTransfer.files 를 읽어 등록하는 동작에는 영향이 없다(영역 핸들러가 버블링 단계에서 먼저 실행됨).
function installGlobalDropGuard() {
  const isFileDrag = (e) =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  // dragover 기본 동작을 막아야 drop 이벤트가 정상적으로 발생한다.
  window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); }, false);
  document.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); }, false);

  // 파일 드롭은 위치와 무관하게 브라우저가 파일을 열지 못하도록 무조건 차단한다.
  window.addEventListener('drop', (e) => { if (isFileDrag(e)) e.preventDefault(); }, false);
  document.addEventListener('drop', (e) => { if (isFileDrag(e)) e.preventDefault(); }, false);
}

installGlobalDropGuard();

boot().catch(console.error);
