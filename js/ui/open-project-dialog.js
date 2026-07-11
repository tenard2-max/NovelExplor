/** 프로젝트 열기 — 관리자: 로컬 폴더 / 사용자: 기본·GitHub만 */

import {
  initSyncFolder,
  pickSyncDirectory,
  listTimestampBackups,
  readBackupFile,
  getSyncFolderLabel,
  hasSyncDir,
} from '../core/sync-folder.js';
import { countCharactersWithPhotos } from '../core/project.js';
import { getCurrentUser, ROLES } from '../core/auth.js';
import {
  fetchGithubDefaultMeta,
  getLocalDefaultMeta,
  listGithubProjectSnapshots,
} from '../core/default-project.js';

/**
 * @returns {Promise<
 *   | { type: 'file', file: File, name?: string }
 *   | { type: 'github', snapshotId: string, name?: string }
 *   | { type: 'default' }
 *   | null
 * >}
 */
export async function showOpenProjectDialog() {
  const user = getCurrentUser();
  if (user?.role === ROLES.USER) {
    return showUserOpenProjectDialog();
  }
  return showAdminOpenProjectDialog();
}

/** 일반 사용자: 기본 프로젝트 + GitHub 스냅샷만 */
async function showUserOpenProjectDialog() {
  const dialog = document.getElementById('dialog');
  const titleEl = document.getElementById('dialog-title');
  const bodyEl = document.getElementById('dialog-body');
  const form = dialog.querySelector('.dialog-form');
  const cancelBtn = document.getElementById('dialog-cancel');
  const confirmBtn = document.getElementById('dialog-confirm');
  const actionsEl = dialog.querySelector('.dialog-actions');

  titleEl.textContent = '프로젝트 열기';

  const loadBtn = document.getElementById('open-proj-load-btn');
  if (loadBtn) loadBtn.hidden = true;

  confirmBtn.textContent = '열기';
  confirmBtn.disabled = true;

  bodyEl.innerHTML = `
    <div class="open-proj">
      <section class="open-proj-section">
        <strong>기본 프로젝트</strong>
        <p class="open-proj-hint">마스터가 지정한 기본 프로젝트입니다.</p>
        <div id="open-proj-default" class="open-proj-file-list"></div>
      </section>
      <section class="open-proj-section">
        <strong>GitHub 프로젝트</strong>
        <p class="open-proj-hint">저장소에 저장된 스냅샷 목록입니다. (열람 전용)</p>
        <div id="open-proj-github-list" class="open-proj-file-list" role="listbox" aria-label="GitHub 스냅샷"></div>
      </section>
      <section id="open-proj-preview" class="open-proj-preview" hidden>
        <strong>선택</strong>
        <div id="open-proj-preview-body" class="open-proj-preview-card"></div>
      </section>
    </div>`;

  /** @type {{ type: 'default' } | { type: 'github', snapshotId: string, name: string, title?: string } | null} */
  let selection = null;

  const defaultEl = bodyEl.querySelector('#open-proj-default');
  const githubListEl = bodyEl.querySelector('#open-proj-github-list');
  const previewEl = bodyEl.querySelector('#open-proj-preview');
  const previewBodyEl = bodyEl.querySelector('#open-proj-preview-body');

  let settled = false;
  let resolveOuter = null;
  let cleanup = () => {};

  const finish = (value) => {
    if (settled) return;
    settled = true;
    cleanup();
    confirmBtn.textContent = '확인';
    confirmBtn.disabled = false;
    dialog.close();
    resolveOuter?.(value);
  };

  function selectDefault(meta) {
    selection = { type: 'default' };
    previewEl.hidden = false;
    previewBodyEl.innerHTML = `
      <p class="open-proj-preview-title"><strong>${esc(meta?.title || '기본 프로젝트')}</strong></p>
      <p class="open-proj-preview-file"><code>${esc(meta?.filename || meta?.snapshotId || 'default')}</code></p>
      <p class="open-proj-preview-hint">마스터가 지정한 기본 프로젝트를 불러옵니다. (열람 전용)</p>`;
    confirmBtn.disabled = false;
    defaultEl.querySelectorAll('.open-proj-file').forEach((el) => el.classList.add('is-selected'));
    githubListEl.querySelectorAll('.open-proj-file').forEach((el) => el.classList.remove('is-selected'));
  }

  function selectGithub(item) {
    selection = { type: 'github', snapshotId: item.snapshotId, name: item.name, title: item.title };
    previewEl.hidden = false;
    previewBodyEl.innerHTML = `
      <p class="open-proj-preview-title"><strong>${esc(item.title || item.name)}</strong></p>
      <p class="open-proj-preview-file"><code>${esc(item.name)}</code></p>
      <p class="open-proj-preview-hint">GitHub 스냅샷을 불러옵니다. (열람 전용 · 저장 불가)</p>`;
    confirmBtn.disabled = false;
    defaultEl.querySelectorAll('.open-proj-file').forEach((el) => el.classList.remove('is-selected'));
    githubListEl.querySelectorAll('.open-proj-file').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.id === item.snapshotId);
    });
  }

  // 기본 프로젝트
  let defaultMeta = await fetchGithubDefaultMeta();
  if (!defaultMeta) defaultMeta = await getLocalDefaultMeta();
  if (defaultMeta) {
    defaultEl.innerHTML = `
      <button type="button" class="open-proj-file" data-kind="default" role="option">
        <span class="open-proj-file-stamp">기본</span>
        <span class="open-proj-file-name">${esc(defaultMeta.title)}</span>
        <code class="open-proj-file-name">${esc(defaultMeta.filename || defaultMeta.snapshotId)}</code>
      </button>`;
    defaultEl.querySelector('button')?.addEventListener('click', () => selectDefault(defaultMeta));
  } else {
    defaultEl.innerHTML = '<p class="open-proj-empty">아직 지정된 기본 프로젝트가 없습니다.</p>';
  }

  // GitHub 목록
  try {
    const snaps = await listGithubProjectSnapshots();
    if (!snaps.length) {
      githubListEl.innerHTML = '<p class="open-proj-empty">GitHub 스냅샷이 없습니다.</p>';
    } else {
      const shown = snaps.slice(0, 40);
      githubListEl.innerHTML = shown.map((s) => `
        <button type="button" class="open-proj-file" data-id="${esc(s.snapshotId)}" role="option">
          <span class="open-proj-file-stamp">${esc(s.label)}</span>
          <code class="open-proj-file-name">${esc(s.name)}</code>
        </button>`).join('');
      githubListEl.querySelectorAll('.open-proj-file').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = shown.find((x) => x.snapshotId === btn.dataset.id);
          if (item) selectGithub(item);
        });
      });
    }
  } catch (err) {
    githubListEl.innerHTML = `<p class="open-proj-empty">GitHub 목록 로드 실패: ${esc(err.message)}</p>`;
  }

  return new Promise((resolve) => {
    resolveOuter = resolve;

    const onCancel = () => finish(null);
    const onSubmit = (e) => {
      e.preventDefault();
      if (!selection) return;
      if (selection.type === 'default') finish({ type: 'default' });
      else finish({ type: 'github', snapshotId: selection.snapshotId, name: selection.name });
    };

    cleanup = () => {
      cancelBtn.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
    };

    cancelBtn.addEventListener('click', onCancel);
    form.addEventListener('submit', onSubmit);
    dialog.showModal();
  });
}

/** 관리자: 기존 로컬 폴더·JSON 열기 */
async function showAdminOpenProjectDialog() {
  await initSyncFolder();

  const dialog = document.getElementById('dialog');
  const titleEl = document.getElementById('dialog-title');
  const bodyEl = document.getElementById('dialog-body');
  const form = dialog.querySelector('.dialog-form');
  const cancelBtn = document.getElementById('dialog-cancel');
  const confirmBtn = document.getElementById('dialog-confirm');
  const actionsEl = dialog.querySelector('.dialog-actions');

  titleEl.textContent = '프로젝트 열기';

  let loadBtn = document.getElementById('open-proj-load-btn');
  if (!loadBtn) {
    loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.id = 'open-proj-load-btn';
    loadBtn.className = 'btn-secondary';
    actionsEl.insertBefore(loadBtn, confirmBtn);
  }
  loadBtn.textContent = '불러오기';
  loadBtn.hidden = false;
  confirmBtn.textContent = '적용';
  confirmBtn.disabled = true;

  bodyEl.innerHTML = `
    <div class="open-proj">
      <section class="open-proj-section">
        <div class="open-proj-folder-row">
          <div>
            <strong>저장 폴더</strong>
            <p id="open-proj-folder-name" class="open-proj-folder-name">${esc(folderLabel())}</p>
          </div>
          <button type="button" class="btn-sm" id="open-proj-pick-folder">📂 폴더 연결</button>
        </div>
        <p class="open-proj-hint">
          연결 폴더의 <code>YYYYMMDDHHMMSS.json</code> · <code>YYYYMMDDHHMMSS_테마.json</code> 목록입니다.<br>
          USB·다른 경로는 <strong>JSON 파일 직접 선택</strong> 또는 <strong>불러오기</strong>를 사용하세요.
        </p>
        <div id="open-proj-file-list" class="open-proj-file-list" role="listbox" aria-label="동기화 파일"></div>
        <button type="button" class="upload-btn full open-proj-pick-file" id="open-proj-pick-file">
          📄 JSON 파일 직접 선택 (USB·다운로드 등)
        </button>
      </section>
      <section id="open-proj-preview" class="open-proj-preview" hidden>
        <strong>선택한 JSON</strong>
        <div id="open-proj-preview-body" class="open-proj-preview-card"></div>
      </section>
    </div>`;

  /** @type {{ type: 'file', file: File, name: string, meta: object } | null} */
  let selection = null;

  const fileListEl = bodyEl.querySelector('#open-proj-file-list');
  const folderNameEl = bodyEl.querySelector('#open-proj-folder-name');
  const previewEl = bodyEl.querySelector('#open-proj-preview');
  const previewBodyEl = bodyEl.querySelector('#open-proj-preview-body');

  let settled = false;
  let resolveOuter = null;
  let cleanup = () => {};

  const finish = (value) => {
    if (settled) return;
    settled = true;
    cleanup();
    loadBtn.hidden = true;
    confirmBtn.textContent = '확인';
    confirmBtn.disabled = false;
    dialog.close();
    resolveOuter?.(value);
  };

  async function chooseFile(file, displayName = file?.name || '') {
    if (!file) return;
    const meta = await peekBackupFile(file);
    if (!meta.valid) {
      alert(meta.error || '백업 파일을 읽을 수 없습니다.');
      return;
    }
    selection = { type: 'file', file, name: displayName || file.name, meta };
    renderPreview(selection);
    confirmBtn.disabled = false;
    fileListEl.querySelectorAll('.open-proj-file').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.name === selection.name);
    });
  }

  function renderPreview(sel) {
    const m = sel.meta;
    previewEl.hidden = false;
    previewBodyEl.innerHTML = `
      <p class="open-proj-preview-file"><code>${esc(sel.name)}</code></p>
      <p class="open-proj-preview-title"><strong>${esc(m.title)}</strong>${m.author ? ` <span class="open-proj-preview-author">— ${esc(m.author)}</span>` : ''}</p>
      <ul class="open-proj-preview-stats">
        <li>백업 시각: ${esc(m.exportedLabel)}</li>
        <li>에피소드 ${m.episodes} · 인물 ${m.characters} · 소설 ${m.stories}</li>
        <li>인물 사진: <strong>${m.charactersWithPhotos}</strong>명</li>
        <li>파일 크기: ${esc(m.sizeLabel)}</li>
      </ul>
      <p class="open-proj-preview-hint">적용 시 브라우저 DB의 기존 프로젝트는 <strong>모두 이 파일로 교체</strong>됩니다.</p>
      <p class="open-proj-preview-hint">내용을 확인한 뒤 <strong>적용</strong>을 누르세요.</p>`;
  }

  async function refreshFileList() {
    folderNameEl.textContent = folderLabel();
    if (!hasSyncDir()) {
      fileListEl.innerHTML = '<p class="open-proj-empty">폴더를 연결하면 저장 파일이 여기에 표시됩니다.</p>';
      return;
    }
    try {
      const files = await listTimestampBackups();
      if (!files.length) {
        fileListEl.innerHTML = '<p class="open-proj-empty">폴더에 YYYYMMDDHHMMSS.json 파일이 없습니다.</p>';
        return;
      }
      fileListEl.innerHTML = files.map((f) => `
        <button type="button" class="open-proj-file" data-name="${esc(f.name)}" role="option">
          <span class="open-proj-file-stamp">${esc(f.label)}</span>
          <code class="open-proj-file-name">${esc(f.name)}</code>
        </button>`).join('');

      fileListEl.querySelectorAll('.open-proj-file').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const name = btn.dataset.name;
          const item = files.find((x) => x.name === name);
          if (!item) return;
          const file = await readBackupFile(item.handle);
          await chooseFile(file, name);
        });
      });
    } catch (err) {
      fileListEl.innerHTML = `<p class="open-proj-empty">목록 로드 실패: ${esc(err.message)}</p>`;
    }
  }

  bodyEl.querySelector('#open-proj-pick-folder')?.addEventListener('click', async () => {
    try {
      await pickSyncDirectory();
      selection = null;
      previewEl.hidden = true;
      confirmBtn.disabled = true;
      await refreshFileList();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      alert(err.message);
    }
  });

  const onPickFile = async () => {
    const file = await pickJsonFile();
    if (file) await chooseFile(file, file.name);
  };

  bodyEl.querySelector('#open-proj-pick-file')?.addEventListener('click', onPickFile);

  await refreshFileList();

  return new Promise((resolve) => {
    resolveOuter = resolve;

    const onCancel = () => finish(null);
    const onLoad = () => onPickFile();

    const onSubmit = (e) => {
      e.preventDefault();
      if (!selection) return;
      finish({ type: 'file', file: selection.file, name: selection.name });
    };

    cleanup = () => {
      cancelBtn.removeEventListener('click', onCancel);
      loadBtn.removeEventListener('click', onLoad);
      form.removeEventListener('submit', onSubmit);
    };

    cancelBtn.addEventListener('click', onCancel);
    loadBtn.addEventListener('click', onLoad);
    form.addEventListener('submit', onSubmit);
    dialog.showModal();
  });
}

/** USB·로컬 등 임의 경로의 JSON 파일 선택 */
async function pickJsonFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{
          description: 'NovelExplor 동기화 JSON',
          accept: { 'application/json': ['.json'] },
        }],
      });
      return handle.getFile();
    } catch (err) {
      if (err?.name === 'AbortError') return null;
      throw err;
    }
  }

  return new Promise((resolve) => {
    const input = document.getElementById('backup-file');
    if (!input) {
      resolve(null);
      return;
    }
    const onChange = () => {
      input.removeEventListener('change', onChange);
      const file = input.files?.[0] || null;
      input.value = '';
      resolve(file);
    };
    input.addEventListener('change', onChange);
    input.click();
  });
}

async function peekBackupFile(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.project && !data.stories && !data.episodes) {
      return { valid: false, error: '유효하지 않은 백업 파일입니다.' };
    }
    const sizeKb = file.size / 1024;
    const sizeLabel = sizeKb >= 1024
      ? `${(sizeKb / 1024).toFixed(1)} MB`
      : `${sizeKb.toFixed(1)} KB`;
    return {
      valid: true,
      title: data.project?.title || '(제목 없음)',
      author: data.project?.author || '',
      exportedLabel: formatIsoLabel(data.exportedAt) || '—',
      episodes: (data.episodes || []).length,
      characters: (data.characters || []).length,
      charactersWithPhotos: countCharactersWithPhotos(data.characters || []),
      stories: (data.stories || []).length,
      sizeLabel,
    };
  } catch {
    return { valid: false, error: 'JSON 백업 파일이 아닙니다.' };
  }
}

function folderLabel() {
  if (!hasSyncDir()) return '연결되지 않음 — 「폴더 연결」을 누르세요';
  return getSyncFolderLabel() || '연결됨';
}

function formatIsoLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
