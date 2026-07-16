/** 프로젝트 열기 — 로컬 폴더 / 이 브라우저 / GitHub */

import {
  initSyncFolder,
  pickSyncDirectory,
  listTimestampBackups,
  readBackupFile,
  getSyncFolderLabel,
  hasSyncDir,
} from '../core/sync-folder.js';
import { countCharactersWithPhotos, listProjects } from '../core/project.js';
import {
  deleteGithubProjectSnapshots,
  fetchGithubDefaultMeta,
  getGithubSnapshotDeleteBlockReason,
  getLocalDefaultMeta,
  listGithubProjectsDetailed,
} from '../core/default-project.js';
import { hasGithubToken } from '../core/github-config.js';
import { isMaster } from '../core/auth.js';

/**
 * @returns {Promise<
 *   | { type: 'file', file: File, name?: string }
 *   | { type: 'github', snapshotId: string, name?: string }
 *   | { type: 'default' }
 *   | { type: 'local-db', projectId: string, name?: string }
 *   | null
 * >}
 */
export async function showOpenProjectDialog() {
  const source = await showOpenSourcePicker();
  if (!source) return null;
  if (source === 'local') return showLocalOpenProjectDialog();
  if (source === 'browser') return showBrowserOpenProjectDialog();
  return showGithubOpenProjectDialog();
}

/** 1단계: 로컬 폴더 / 이 브라우저 / GitHub */
function showOpenSourcePicker() {
  const dialog = document.getElementById('dialog');
  const titleEl = document.getElementById('dialog-title');
  const bodyEl = document.getElementById('dialog-body');
  const form = dialog.querySelector('.dialog-form');
  const cancelBtn = document.getElementById('dialog-cancel');
  const confirmBtn = document.getElementById('dialog-confirm');
  const loadBtn = document.getElementById('open-proj-load-btn');
  if (loadBtn) loadBtn.hidden = true;

  titleEl.textContent = '프로젝트 열기';
  confirmBtn.textContent = '다음';
  confirmBtn.disabled = true;

  bodyEl.innerHTML = `
    <div class="open-proj">
      <p class="open-proj-hint">불러올 위치를 선택하세요.</p>
      <div class="open-proj-source-grid open-proj-source-grid--3" role="listbox" aria-label="열기 위치">
        <button type="button" class="open-proj-source-btn" data-source="browser" role="option">
          <span class="open-proj-source-icon">🗄</span>
          <strong>이 브라우저</strong>
          <span class="open-proj-source-desc">IndexedDB에 있는 프로젝트</span>
        </button>
        <button type="button" class="open-proj-source-btn" data-source="local" role="option">
          <span class="open-proj-source-icon">📂</span>
          <strong>로컬 폴더</strong>
          <span class="open-proj-source-desc">동기화 폴더 · JSON 파일</span>
        </button>
        <button type="button" class="open-proj-source-btn" data-source="github" role="option">
          <span class="open-proj-source-icon">☁</span>
          <strong>GitHub</strong>
          <span class="open-proj-source-desc">원격에 업로드된 스냅샷만</span>
        </button>
      </div>
    </div>`;

  /** @type {'local' | 'github' | 'browser' | null} */
  let selection = null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      confirmBtn.textContent = '확인';
      confirmBtn.disabled = false;
      dialog.close();
      resolve(value);
    };

    const select = (src) => {
      selection = src;
      bodyEl.querySelectorAll('.open-proj-source-btn').forEach((btn) => {
        btn.classList.toggle('is-selected', btn.dataset.source === src);
      });
      confirmBtn.disabled = false;
    };

    const onSourceClick = (e) => {
      const btn = e.target.closest('.open-proj-source-btn');
      if (btn?.dataset.source) select(btn.dataset.source);
    };

    const onCancel = () => finish(null);
    const onSubmit = (e) => {
      e.preventDefault();
      if (selection) finish(selection);
    };

    const cleanup = () => {
      bodyEl.removeEventListener('click', onSourceClick);
      cancelBtn.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
    };

    bodyEl.addEventListener('click', onSourceClick);
    cancelBtn.addEventListener('click', onCancel);
    form.addEventListener('submit', onSubmit);
    dialog.showModal();
  });
}

/** 이 브라우저 IndexedDB 프로젝트 */
async function showBrowserOpenProjectDialog() {
  const dialog = document.getElementById('dialog');
  const titleEl = document.getElementById('dialog-title');
  const bodyEl = document.getElementById('dialog-body');
  const form = dialog.querySelector('.dialog-form');
  const cancelBtn = document.getElementById('dialog-cancel');
  const confirmBtn = document.getElementById('dialog-confirm');
  const loadBtn = document.getElementById('open-proj-load-btn');
  if (loadBtn) loadBtn.hidden = true;

  titleEl.textContent = '이 브라우저에서 열기';
  confirmBtn.textContent = '열기';
  confirmBtn.disabled = true;

  const projects = await listProjects();

  bodyEl.innerHTML = `
    <div class="open-proj">
      <p class="open-proj-hint">이 PC 브라우저 DB에 저장된 프로젝트입니다. (GitHub와 별개)</p>
      <div id="open-proj-db-list" class="open-proj-file-list" role="listbox" aria-label="로컬 DB 프로젝트"></div>
      <section id="open-proj-preview" class="open-proj-preview" hidden>
        <strong>선택</strong>
        <div id="open-proj-preview-body" class="open-proj-preview-card"></div>
      </section>
    </div>`;

  const listEl = bodyEl.querySelector('#open-proj-db-list');
  const previewEl = bodyEl.querySelector('#open-proj-preview');
  const previewBodyEl = bodyEl.querySelector('#open-proj-preview-body');

  /** @type {{ type: 'local-db', projectId: string, name: string } | null} */
  let selection = null;

  if (!projects.length) {
    listEl.innerHTML = '<p class="open-proj-empty">저장된 프로젝트가 없습니다.</p>';
  } else {
    listEl.innerHTML = projects.map((p) => {
      const id = p.id || p.projectId;
      const when = p.updatedAt
        ? String(p.updatedAt).slice(0, 19).replace('T', ' ')
        : '';
      return `
        <button type="button" class="open-proj-file" data-id="${esc(id)}" role="option">
          <span class="open-proj-file-stamp">DB</span>
          <span class="open-proj-file-name">${esc(p.title || '(제목 없음)')}</span>
          <code class="open-proj-file-name">${esc([p.author, when].filter(Boolean).join(' · '))}</code>
        </button>`;
    }).join('');

    listEl.querySelectorAll('.open-proj-file').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = projects.find((x) => (x.id || x.projectId) === btn.dataset.id);
        if (!p) return;
        const id = p.id || p.projectId;
        selection = { type: 'local-db', projectId: id, name: p.title || id };
        previewEl.hidden = false;
        previewBodyEl.innerHTML = `
          <p class="open-proj-preview-title"><strong>${esc(p.title || '(제목 없음)')}</strong></p>
          <p class="open-proj-preview-hint">브라우저 DB 프로젝트를 엽니다. 다른 프로젝트 데이터는 그대로 둡니다.</p>`;
        confirmBtn.disabled = false;
        listEl.querySelectorAll('.open-proj-file').forEach((el) => {
          el.classList.toggle('is-selected', el.dataset.id === id);
        });
      });
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cancelBtn.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
      confirmBtn.textContent = '확인';
      confirmBtn.disabled = false;
      dialog.close();
      resolve(value);
    };
    const onCancel = () => finish(null);
    const onSubmit = (e) => {
      e.preventDefault();
      if (selection) finish(selection);
    };
    cancelBtn.addEventListener('click', onCancel);
    form.addEventListener('submit', onSubmit);
    dialog.showModal();
  });
}

/** GitHub · 기본 프로젝트 */
async function showGithubOpenProjectDialog() {
  const dialog = document.getElementById('dialog');
  const titleEl = document.getElementById('dialog-title');
  const bodyEl = document.getElementById('dialog-body');
  const form = dialog.querySelector('.dialog-form');
  const cancelBtn = document.getElementById('dialog-cancel');
  const confirmBtn = document.getElementById('dialog-confirm');
  const loadBtn = document.getElementById('open-proj-load-btn');
  if (loadBtn) loadBtn.hidden = true;

  titleEl.textContent = 'GitHub에서 열기';
  confirmBtn.textContent = '열기';
  confirmBtn.disabled = true;

  bodyEl.innerHTML = `
    <div class="open-proj">
      <section class="open-proj-section">
        <strong>기본 프로젝트</strong>
        <p class="open-proj-hint">마스터가 지정한 기본본입니다. 출처(GitHub / 이 브라우저)가 표시됩니다.</p>
        <div id="open-proj-default" class="open-proj-file-list"></div>
      </section>
      <section class="open-proj-section">
        <strong>GitHub 원격 스냅샷</strong>
        <p class="open-proj-hint">
          GitHub <code>data/workspace/snapshots/</code>에 <strong>실제로 올라간</strong> 타임스탬프 JSON만 나옵니다.
          다운로드·이 브라우저·연결 폴더만 저장한 건 여기 없습니다 → 열기 1단계에서 「이 브라우저」또는 「로컬 폴더」를 고르세요.
        </p>
        <p id="open-proj-gh-count" class="open-proj-gh-count"></p>
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
  const countEl = bodyEl.querySelector('#open-proj-gh-count');
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

  function selectDefault(meta, sourceLabel) {
    selection = { type: 'default' };
    previewEl.hidden = false;
    previewBodyEl.innerHTML = `
      <p class="open-proj-preview-title"><strong>${esc(meta?.title || '기본 프로젝트')}</strong></p>
      <p class="open-proj-preview-file"><code>${esc(meta?.filename || meta?.snapshotId || 'default')}</code></p>
      <p class="open-proj-preview-hint">${esc(sourceLabel)} 기본 프로젝트를 불러옵니다.</p>`;
    confirmBtn.disabled = false;
    defaultEl.querySelectorAll('.open-proj-file').forEach((el) => el.classList.add('is-selected'));
    githubListEl.querySelectorAll('.open-proj-file').forEach((el) => el.classList.remove('is-selected'));
  }

  function selectGithub(item) {
    selection = { type: 'github', snapshotId: item.snapshotId, name: item.name, title: item.title };
    previewEl.hidden = false;
    previewBodyEl.innerHTML = `
      <p class="open-proj-preview-title"><strong>${esc(item.title || item.name)}</strong>
        ${item.author ? `<span class="open-proj-preview-author">— ${esc(item.author)}</span>` : ''}</p>
      <p class="open-proj-preview-file"><code>${esc(item.name)}</code></p>
      <p class="open-proj-preview-hint">GitHub 스냅샷을 불러옵니다. writers에 없으면 열람만 가능합니다.</p>`;
    confirmBtn.disabled = false;
    defaultEl.querySelectorAll('.open-proj-file').forEach((el) => el.classList.remove('is-selected'));
    githubListEl.querySelectorAll('.open-proj-file').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.id === item.snapshotId);
    });
  }

  const ghDefault = await fetchGithubDefaultMeta();
  const localDefault = await getLocalDefaultMeta();

  /** @type {{ meta: object, stamp: string, source: string }[]} */
  const defaultRows = [];
  if (ghDefault) {
    defaultRows.push({ meta: ghDefault, stamp: 'GitHub 기본', source: 'GitHub' });
  }
  if (localDefault) {
    const sameAsGh = ghDefault
      && (ghDefault.snapshotId === localDefault.snapshotId
        || ghDefault.filename === localDefault.filename);
    if (!sameAsGh) {
      defaultRows.push({
        meta: localDefault,
        stamp: '이 브라우저 기본',
        source: '이 브라우저(GitHub 아님)',
      });
    }
  }

  if (defaultRows.length) {
    defaultEl.innerHTML = defaultRows.map((row, i) => `
      <button type="button" class="open-proj-file" data-default-idx="${i}" role="option">
        <span class="open-proj-file-stamp">${esc(row.stamp)}</span>
        <span class="open-proj-file-name">${esc(row.meta.title || '기본 프로젝트')}</span>
        <code class="open-proj-file-name">${esc(row.meta.filename || row.meta.snapshotId)}</code>
      </button>`).join('');
    defaultEl.querySelectorAll('.open-proj-file').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = defaultRows[Number(btn.dataset.defaultIdx)];
        if (row) selectDefault(row.meta, row.source);
      });
    });
  } else {
    defaultEl.innerHTML = '<p class="open-proj-empty">아직 지정된 기본 프로젝트가 없습니다.</p>';
  }

  try {
    countEl.textContent = 'GitHub 스냅샷 불러오는 중…';
    let snaps = await listGithubProjectsDetailed();
    let githubDefaultId = String(
      ghDefault?.snapshotId
      || ghDefault?.filename
      || ''
    ).replace(/\.json$/i, '');
    const remoteNote = localDefault && !snaps.some((s) => s.snapshotId === localDefault.snapshotId)
      ? ` · 이 브라우저 기본(${localDefault.filename || localDefault.snapshotId})은 원격에 없음`
      : '';

    const renderGithubSnapshots = (statusMessage = '') => {
      countEl.textContent = statusMessage || (snaps.length
        ? `원격 스냅샷 ${snaps.length}개 (저장소 기준)${remoteNote}`
        : `원격 스냅샷 0개 — PAT로 「프로젝트 저장」해야 여기에 쌓입니다.${remoteNote}`);

      if (!snaps.length) {
        githubListEl.innerHTML = '<p class="open-proj-empty">GitHub에 타임스탬프 JSON이 없습니다.</p>';
        return;
      }

      githubListEl.innerHTML = snaps.map((s) => {
        const isDefault = Boolean(githubDefaultId && s.snapshotId === githubDefaultId);
        const blockReason = getGithubSnapshotDeleteBlockReason(s, undefined, githubDefaultId);
        const canDelete = !blockReason;
        const deleteTitle = blockReason || (isDefault
          ? '기본 프로젝트 삭제 (마스터 전용)'
          : '이 GitHub 스냅샷 삭제');
        return `
          <div class="open-proj-file-row">
            <button type="button" class="open-proj-file" data-id="${esc(s.snapshotId)}" role="option">
              <span class="open-proj-file-stamp">${esc(s.label)}${isDefault ? ' · 기본' : ''}</span>
              <span class="open-proj-file-name">${esc(s.title || s.name)}</span>
              <code class="open-proj-file-name">${esc(s.name)}${s.author ? ` · ${esc(s.author)}` : ''}</code>
            </button>
            ${canDelete ? `
              <button type="button"
                      class="btn-sm btn-danger open-proj-gh-delete"
                      data-delete-id="${esc(s.snapshotId)}"
                      data-is-default="${isDefault ? '1' : '0'}"
                      title="${esc(deleteTitle)}">
                삭제
              </button>` : ''}
          </div>`;
      }).join('');

      githubListEl.querySelectorAll('.open-proj-file').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = snaps.find((x) => x.snapshotId === btn.dataset.id);
          if (item) selectGithub(item);
        });
      });

      githubListEl.querySelectorAll('.open-proj-gh-delete').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const snapshotId = btn.dataset.deleteId;
          const item = snaps.find((snapshot) => snapshot.snapshotId === snapshotId);
          if (!item) return;
          if (!hasGithubToken()) {
            alert('GitHub 프로젝트를 삭제하려면 PAT를 먼저 연결하세요.');
            return;
          }
          const isDefaultDelete = btn.dataset.isDefault === '1';
          const confirmLines = [
            'GitHub에서 이 프로젝트 버전을 삭제할까요?',
            '',
            item.title || item.name,
            item.name,
          ];
          if (isDefaultDelete && isMaster()) {
            confirmLines.push(
              '',
              '⚠ 이 버전은 현재 기본 프로젝트입니다.',
              '삭제하면 default.json 포인터가 다른 최신 버전으로 바뀝니다.'
            );
          }
          confirmLines.push('', '이 작업은 되돌릴 수 없습니다.');
          if (!confirm(confirmLines.join('\n'))) return;

          btn.disabled = true;
          btn.textContent = '삭제 중…';
          countEl.textContent = `${item.name} 삭제 중…`;
          try {
            const result = await deleteGithubProjectSnapshots([snapshotId]);
            if (selection?.type === 'github' && selection.snapshotId === snapshotId) {
              selection = null;
              previewEl.hidden = true;
              previewBodyEl.innerHTML = '';
              confirmBtn.disabled = true;
            }

            // 저장소 기준으로 목록과 기본 포인터를 다시 읽어 성공 상태를 확정한다.
            const [refreshedSnapshots, refreshedDefault] = await Promise.all([
              listGithubProjectsDetailed(),
              fetchGithubDefaultMeta({ fresh: true }),
            ]);
            snaps = refreshedSnapshots;
            githubDefaultId = String(
              refreshedDefault?.snapshotId
              || refreshedDefault?.filename
              || ''
            ).replace(/\.json$/i, '');

            const details = [
              result.alreadyAbsent
                ? `${result.deletedCount || result.deleted.length}개 이미 삭제됨`
                : `${result.deletedCount || result.deleted.length}개 삭제 완료`,
            ];
            if (result.latestUpdated) {
              details.push(result.latestTarget
                ? `latest → ${result.latestTarget}`
                : 'latest 포인터 제거');
            }
            if (result.defaultUpdated) {
              details.push(result.defaultTarget
                ? `기본 → ${result.defaultTarget}`
                : '기본 포인터 제거');
            }
            renderGithubSnapshots(`${details.join(' · ')} · 원격 ${snaps.length}개`);
          } catch (err) {
            const message = String(err?.message || err);
            const guidance = /동기화 충돌|fast.?forward|먼저 갱신/i.test(message)
              ? '\n\n같은 GitHub main에 앱 코드 푸시·다른 저장/삭제가 겹쳤습니다.\n'
                + '목록을 새로 불러온 뒤 다시 시도해 주세요.'
              : /권한|마스터|일반 사용자/i.test(message)
                ? '\n\nGitHub 최신 메타 기준으로 삭제 권한이 거부되었습니다.'
                : /한도 초과|rate limit/i.test(message)
                  ? '\n\nPAT의 GitHub API 잔량을 확인해 주세요.'
                  : '';
            alert(`GitHub 프로젝트 삭제 실패\n\n${message}${guidance}`);
            try {
              snaps = await listGithubProjectsDetailed();
              const refreshedDefault = await fetchGithubDefaultMeta({ fresh: true });
              githubDefaultId = String(
                refreshedDefault?.snapshotId
                || refreshedDefault?.filename
                || ''
              ).replace(/\.json$/i, '');
            } catch {
              /* 기존 목록 유지 */
            }
            renderGithubSnapshots();
          }
        });
      });
    };

    renderGithubSnapshots();
  } catch (err) {
    countEl.textContent = '';
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

/** 로컬 폴더 · JSON 파일 */
async function showLocalOpenProjectDialog() {
  await initSyncFolder();

  const dialog = document.getElementById('dialog');
  const titleEl = document.getElementById('dialog-title');
  const bodyEl = document.getElementById('dialog-body');
  const form = dialog.querySelector('.dialog-form');
  const cancelBtn = document.getElementById('dialog-cancel');
  const confirmBtn = document.getElementById('dialog-confirm');
  const actionsEl = dialog.querySelector('.dialog-actions');

  titleEl.textContent = '로컬에서 열기';

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
      <p class="open-proj-preview-hint">내용을 확인한 뒤 <strong>적용</strong>을 누르세요. writers에 없으면 열람만 가능합니다.</p>`;
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
