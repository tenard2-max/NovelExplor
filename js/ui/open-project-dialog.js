/** 프로젝트 열기 — 동기화 폴더 목록 + JSON 직접 선택(USB 등) */

import {
  initSyncFolder,
  pickSyncDirectory,
  listTimestampBackups,
  readBackupFile,
  getSyncFolderLabel,
  hasSyncDir,
} from '../core/sync-folder.js';
import * as project from '../core/project.js';

/**
 * @returns {Promise<{ type: 'file', file: File } | { type: 'db', projectId: string } | null>}
 */
export async function showOpenProjectDialog() {
  await initSyncFolder();

  const dialog = document.getElementById('dialog');
  const titleEl = document.getElementById('dialog-title');
  const bodyEl = document.getElementById('dialog-body');
  const form = dialog.querySelector('.dialog-form');
  const cancelBtn = document.getElementById('dialog-cancel');
  const confirmBtn = document.getElementById('dialog-confirm');

  titleEl.textContent = '프로젝트 열기';
  confirmBtn.textContent = '불러오기';
  confirmBtn.disabled = false;

  const dbProjects = await project.listProjects();

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
          연결 폴더의 <code>YYYYMMDDHHMMSS.json</code> 목록입니다.<br>
          USB·다른 경로의 파일은 아래 <strong>JSON 파일 직접 선택</strong> 또는
          목록 미선택 시 <strong>불러오기</strong>를 누르세요.
        </p>
        <div id="open-proj-file-list" class="open-proj-file-list" role="listbox" aria-label="동기화 파일"></div>
        <button type="button" class="upload-btn full open-proj-pick-file" id="open-proj-pick-file">
          📄 JSON 파일 직접 선택 (USB·다운로드 등)
        </button>
      </section>
      <section class="open-proj-section">
        <strong>브라우저 DB</strong>
        <div id="open-proj-db-list" class="open-proj-db-list"></div>
      </section>
    </div>`;

  /** @type {{ type: 'file', file: File, name?: string } | { type: 'db', projectId: string } | null} */
  let selection = null;

  const fileListEl = bodyEl.querySelector('#open-proj-file-list');
  const dbListEl = bodyEl.querySelector('#open-proj-db-list');
  const folderNameEl = bodyEl.querySelector('#open-proj-folder-name');

  let settled = false;
  let resolveOuter = null;

  const finish = (value) => {
    if (settled) return;
    settled = true;
    cleanup();
    dialog.close();
    confirmBtn.textContent = '확인';
    confirmBtn.disabled = false;
    resolveOuter?.(value);
  };

  function setSelection(next) {
    selection = next;
    fileListEl.querySelectorAll('.open-proj-file').forEach((el) => {
      el.classList.toggle('is-selected', selection?.type === 'file' && el.dataset.name === selection.name);
    });
    dbListEl.querySelectorAll('.open-proj-db').forEach((el) => {
      el.classList.toggle('is-selected', selection?.type === 'db' && el.dataset.id === selection.projectId);
    });
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
          setSelection({ type: 'file', file, name });
        });
      });
    } catch (err) {
      fileListEl.innerHTML = `<p class="open-proj-empty">목록 로드 실패: ${esc(err.message)}</p>`;
    }
  }

  function renderDbList() {
    if (!dbProjects.length) {
      dbListEl.innerHTML = '<p class="open-proj-empty">브라우저에 저장된 프로젝트 없음</p>';
      return;
    }
    dbListEl.innerHTML = dbProjects.map((p) => `
      <button type="button" class="open-proj-db" data-id="${esc(p.id)}">
        ${esc(p.title || '제목 없음')}
      </button>`).join('');
    dbListEl.querySelectorAll('.open-proj-db').forEach((btn) => {
      btn.addEventListener('click', () => {
        setSelection({ type: 'db', projectId: btn.dataset.id });
      });
    });
  }

  bodyEl.querySelector('#open-proj-pick-folder')?.addEventListener('click', async () => {
    try {
      await pickSyncDirectory();
      setSelection(null);
      await refreshFileList();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      alert(err.message);
    }
  });

  bodyEl.querySelector('#open-proj-pick-file')?.addEventListener('click', async () => {
    const file = await pickJsonFile();
    if (file) finish({ type: 'file', file, name: file.name });
  });

  renderDbList();
  await refreshFileList();

  return new Promise((resolve) => {
    resolveOuter = resolve;

    const onCancel = () => finish(null);

    const onSubmit = async (e) => {
      e.preventDefault();
      if (selection) {
        finish(selection);
        return;
      }
      const file = await pickJsonFile();
      if (file) finish({ type: 'file', file, name: file.name });
    };

    const cleanup = () => {
      cancelBtn.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
    };

    cancelBtn.addEventListener('click', onCancel);
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

function folderLabel() {
  if (!hasSyncDir()) return '연결되지 않음 — 「폴더 연결」을 누르세요';
  return getSyncFolderLabel() || '연결됨';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
