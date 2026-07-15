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
import { initReaderTts } from './ui/reader-tts.js';
import { initInspector } from './ui/inspector.js';
import { initCanvasLayout } from './ui/canvas-layout.js';
import { initCanvasWallpaper } from './ui/canvas-wallpaper.js';
import { initCharacterPanel } from './ui/character-panel.js';
import { initCharacterActions } from './ui/character-actions.js';
import { initSceneCuts } from './ui/scene-cuts.js';
import { initBackup, offerLocalRecovery, exportTimestampedBackup, openBackupJsonFile, sanitizeThemeTag } from './core/backup.js';
import { confirmGithubSyncIfLowQuota } from './core/github-sync.js';
import { hasGithubToken } from './core/github-config.js';
import { initSyncFolder } from './core/sync-folder.js';
import { showOpenProjectDialog } from './ui/open-project-dialog.js';
import { showProjectManageDialog } from './ui/project-manage.js';
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
import { refreshNavVersions, refreshNavVersionsFromGithub } from './app-version.js';
import { initGithubPanel } from './ui/github-panel.js';
import { initGithubSync } from './core/github-sync.js';
import { initStorySync } from './ui/story-sync.js';
import { initTimeline } from './ui/timeline-panel.js';
import { initAuth, isLoggedIn, getCurrentUser, ROLES, canSaveProject, canSetDefaultProject, canManageProjectContent } from './core/auth.js';
import { loadDefaultProject, saveAsDefaultProject } from './core/default-project.js';
import { pullProjectFromGithub } from './core/github-pull.js';
import { initAuthGate, showAuthGate, hideAuthGate, whenAuthenticated } from './ui/auth-gate.js';
import { initSettings, updateUserBadge } from './ui/settings-panel.js';
import { initPermissions, applyUploadPermissions } from './ui/permissions.js';
import { initPwaInstall } from './ui/pwa-install.js';
import { initBackgroundAssets } from './core/background-assets.js';

async function boot() {
  initPwaInstall();
  initAuthGate();
  // 인증 확인 전엔 앱만 잠금 — 로그인 창은 세션이 없을 때만 표시
  document.body.classList.add('auth-locked');

  initNav();
  initWorkspace();
  initUploadPanel();
  initGraph();
  initEditor();
  initReader();
  initReaderTts();
  initInspector();
  initCanvasLayout();
  initCanvasWallpaper();
  initCharacterPanel();
  initCharacterActions();
  initSceneCuts();
  initStorySync();
  initTimeline();
  initSettings();
  initPermissions();
  initActions();
  initBackup();
  initBackgroundAssets();
  initGithubSync();
  initGithubPanel();
  initSearch();
  initKeyboard();
  initStatus();
  initUploadHandler();
  initSyncFolder().catch(() => {});

  try {
    await loadWorkspaceManifest();
    console.info('[NovelExplor] workspace.xml 매니페스트 로드 완료');
  } catch (err) {
    console.warn('[NovelExplor] workspace.xml 없음/실패 — IndexedDB 모드만 사용:', err.message);
  }

  try {
    await initAuth();
  } catch (err) {
    console.error('[NovelExplor] 인증 초기화 실패:', err);
  }
  document.body.dataset.authBootDone = '1';
  if (!isLoggedIn()) {
    showAuthGate();
    await whenAuthenticated();
  } else {
    hideAuthGate();
  }

  const user = getCurrentUser();
  if (user?.role === ROLES.MASTER) {
    await project.claimOrphanProjects(user.id);
  }
  updateUserBadge();
  applyUploadPermissions();

  const projects = await project.listProjects();
  const bootProjectId = project.resolveBootProjectId(projects);
  if (bootProjectId) {
    await project.loadProject(bootProjectId);
  } else if (!canSaveProject(user)) {
    // 일반 사용자: 기본 프로젝트 자동 로드 시도
    try {
      await loadDefaultProject({ skipConfirm: true });
    } catch (err) {
      console.info('[NovelExplor] 기본 프로젝트 없음:', err.message);
    }
  } else {
    const recovered = await offerLocalRecovery();
    if (!recovered) {
      await project.createProject('인류 생존 프로젝트', true);
    }
  }
  warnIfWrongOrigin();
  refreshNavVersions();
  await refreshNavVersionsFromGithub();
  initAppVersion();
  switchView(canSaveProject(user) ? 'master' : 'character');

  if (user?.mustChangePassword) {
    switchView('settings');
    await showAlert('비밀번호 변경', '초기 비밀번호를 설정 화면에서 변경해 주세요.');
  }
}

function initAppVersion() {
  refreshNavVersions();
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
    if (!canSaveProject()) {
      alert('일반 사용자는 프로젝트를 만들 수 없습니다. 프로젝트 열기만 가능합니다.');
      return;
    }
    const title = prompt('프로젝트 제목:', '새 프로젝트');
    if (title === null) return;
    try {
      // 이전 프로젝트 편집 내용을 먼저 저장한 뒤, 빈 새 프로젝트로 전환
      await flushPendingSave();
      await autosave.flushSave(true);
      await project.createProject(title, false);
      await autosave.flushSave(true);
      const filename = await exportTimestampedBackup({ notify: false });
      switchView('character');
      await showAlert(
        '새 프로젝트',
        `빈 프로젝트를 만들었습니다. 스토리·인물·떡밥·네비게이터는 초기 상태입니다.<br>`
        + `이전 프로젝트 데이터는 브라우저 DB에 그대로 남아 있습니다.<br>`
        + `<code>${filename}</code>`
      );
    } catch (err) {
      alert(`새 프로젝트 실패: ${err.message}`);
    }
  });

  bindAction('open-project', async () => {
    try {
      const picked = await showOpenProjectDialog();
      if (!picked) return;

      if (picked.type === 'file') {
        const ok = await openBackupJsonFile(picked.file, { skipConfirm: true });
        if (!ok) return;
        await flushPendingSave();
        await autosave.flushSave(true);
        let filename = picked.name || '';
        const canWrite = canManageProjectContent(project.getCurrentProject());
        if (canWrite) {
          filename = await exportTimestampedBackup({ notify: false, skipGithub: true });
        }
        switchView('character');
        await showAlert(
          '프로젝트 열기',
          canWrite
            ? `동기화 파일을 적용했습니다.<br><code>${picked.name || filename}</code>`
            : `프로젝트를 불러왔습니다. <span style="color:#ef4444">(열람만가능)</span><br><code>${picked.name || filename}</code>`
        );
        return;
      }

      if (picked.type === 'local-db') {
        await project.loadProject(picked.projectId);
        switchView('character');
        const ro = !canManageProjectContent(project.getCurrentProject());
        await showAlert(
          '프로젝트 열기',
          `브라우저 프로젝트를 열었습니다.${ro ? ' <span style="color:#ef4444">(열람만가능)</span>' : ''}<br>`
          + `<strong>${picked.name || picked.projectId}</strong>`
        );
        return;
      }

      if (picked.type === 'default') {
        const id = await loadDefaultProject({ skipConfirm: true });
        if (!id) return;
        switchView('character');
        const ro = !canManageProjectContent(project.getCurrentProject());
        await showAlert(
          '기본 프로젝트',
          `기본 프로젝트를 불러왔습니다.${ro ? ' <span style="color:#ef4444">(열람만가능)</span>' : ''}<br><code>${id}.json</code>`
        );
        return;
      }

      if (picked.type === 'github') {
        const id = await pullProjectFromGithub({
          snapshotId: picked.snapshotId,
          skipConfirm: true,
        });
        if (!id) return;
        switchView('character');
        const ro = !canManageProjectContent(project.getCurrentProject());
        await showAlert(
          'GitHub 프로젝트',
          `GitHub 스냅샷을 불러왔습니다.${ro ? ' <span style="color:#ef4444">(열람만가능)</span>' : ''}<br><code>${picked.name || `${id}.json`}</code>`
        );
      }
    } catch (err) {
      alert(`프로젝트 열기 실패: ${err.message}`);
    }
  });

  bindAction('manage-project', async () => {
    try {
      const saved = await showProjectManageDialog();
      if (saved) {
        applyUploadPermissions();
        await showAlert('프로젝트 관리', '선택한 관리자의 쓰기 권한을 프로젝트에 반영했습니다.');
      }
    } catch (err) {
      alert(`프로젝트 관리 실패: ${err.message}`);
    }
  });

  bindAction('save', () => saveCurrentProject());
  bindAction('save-project', () => saveCurrentProject());
  bindAction('save-default-project', async () => {
    if (!canSetDefaultProject()) {
      alert('기본 프로젝트는 마스터만 설정할 수 있습니다.');
      return;
    }
    try {
      const { snapshotId, filename, githubOk, githubError } = await saveAsDefaultProject();
      const ghLine = githubOk
        ? `GitHub <code>snapshots/default.json</code>에도 반영했습니다.`
        : `로컬 기본 프로젝트로 지정했습니다.`
          + (githubError
            ? `<br><small>GitHub 반영: ${githubError}<br>(다른 PC 사용자는 GitHub 반영 후 자동 로드됩니다)</small>`
            : '');
      await showAlert(
        '기본 프로젝트 저장',
        `현재 프로젝트를 기본 프로젝트로 지정했습니다.<br>`
        + `일반 사용자는 브라우저에 프로젝트가 없을 때 이 내용을 자동으로 불러옵니다.<br>`
        + `${ghLine}<br>`
        + `<code>${filename || `${snapshotId}.json`}</code>`
      );
    } catch (err) {
      console.error('[NovelExplor] 기본 프로젝트 저장 실패:', err);
      alert(`기본 프로젝트 저장 실패:\n${err.message || err}`);
    }
  });
  bindAction('export-json', exportJson);

  bindAction('toggle-theme', () => {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = next;
    localStorage.setItem('fft-theme', next);
  });

  bindAction('analyze-foreshadow', runForeshadowAnalysis);
  bindAction('add-foreshadow', addForeshadowFromSelection);
  bindAction('about', () => showAlert(
    'NovelExplor',
    '인류 생존 프로젝트 — 복선·스토리·세계관 워크스페이스<br><br>' +
    '<strong>XML</strong>: Pages 고정 원본<br>' +
    '<strong>프로젝트 저장</strong>: 관리자 — DB + 동기화 파일(<code>시각_테마.json</code>) / 마스터 — 기본 프로젝트 지정<br>' +
    '<strong>프로젝트 열기</strong>: 사용자 — 기본·GitHub만 / 관리자 — 로컬 폴더'
  ));

  const savedTheme = localStorage.getItem('fft-theme');
  if (savedTheme) document.body.dataset.theme = savedTheme;
}

async function saveCurrentProject() {
  if (!project.canManageCurrentProject()) {
    alert('이 프로젝트는 소유 관리자 또는 마스터만 저장할 수 있습니다.');
    return;
  }
  try {
    const themeChoice = await promptSaveTheme();
    if (themeChoice === null) return; // 취소

    if (hasGithubToken()) {
      const proceed = await confirmGithubSyncIfLowQuota();
      if (!proceed) return;
    }

    await flushPendingSave();
    await autosave.flushSave(true);
    const filename = await exportTimestampedBackup({
      notify: true,
      theme: themeChoice,
      skipRateLimitCheck: true,
    });
    console.info('[NovelExplor] 동기화 파일:', filename);
  } catch (err) {
    alert(`프로젝트 저장 실패: ${err.message}`);
  }
}

const SAVE_THEME_KEY = 'ne-save-theme';

/**
 * 저장 파일명 테일 테마 입력
 * @returns {Promise<string|null>} 테마 문자열(빈 문자열 허용) / 취소 시 null
 */
async function promptSaveTheme() {
  let theme = '';
  let last = '';
  try {
    last = localStorage.getItem(SAVE_THEME_KEY) || '';
  } catch {
    last = '';
  }

  const confirmed = await showDialog({
    title: '프로젝트 저장',
    bodyHtml: `
      <p class="open-proj-hint">
        파일명 형식: <code>YYYYMMDDHHMMSS</code> 또는 <code>YYYYMMDDHHMMSS_테마.json</code>
      </p>
      <label class="char-form-field">
        <span class="char-form-label">테마 (선택 · 파일명 끝에 붙음)</span>
        <input type="text" id="save-theme-input" class="char-form-input"
          maxlength="40" placeholder="예: 판타지, 1부, 개정판" value="${escAttr(last)}" autocomplete="off">
      </label>
      <p class="open-proj-hint">비우면 시각만 사용합니다. 공백·특수문자는 자동으로 정리됩니다.</p>`,
    onConfirm: () => {
      theme = document.getElementById('save-theme-input')?.value?.trim() || '';
    },
  });
  if (!confirmed) return null;

  const safe = sanitizeThemeTag(theme);
  try {
    if (safe) localStorage.setItem(SAVE_THEME_KEY, safe);
    else localStorage.removeItem(SAVE_THEME_KEY);
  } catch {
    /* ignore */
  }

  return safe;
}

function escAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
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
    if (!project.canManageCurrentProject()) {
      alert('이 프로젝트에는 소유 관리자 또는 마스터만 파일을 등록할 수 있습니다.');
      return;
    }
    let lastView = null;
    let successCount = 0;
    let storyOrEpisodeCount = 0;
    const errors = [];

    for (const file of files) {
      try {
        const view = await importSingleFile(file);
        if (view) lastView = view;
        const kind = classifyImportFilename(file.name).type;
        if (kind === 'story' || kind === 'episode') storyOrEpisodeCount += 1;
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
      emit('upload:committed', {
        count: successCount,
        storyOrEpisodeCount,
      });
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
