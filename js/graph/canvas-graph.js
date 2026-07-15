/** Canvas 그래프 렌더러 */

import { on } from '../core/events.js';
import * as project from '../core/project.js';
import * as autosave from '../core/autosave.js';
import { getCharacterRepresentativeUrl } from '../core/character-media.js';
import { openCharacterPanel, openImageLightbox } from '../ui/character-panel.js';
import { showDialog, showAlert } from '../ui/dialog.js';
import { collectMultiverseRows } from '../core/story-sync-engine.js';

const GRADE_COLORS = {
  F: '#6b7280', D: '#60a5fa', C: '#4ade80', B: '#facc15',
  A: '#fb923c', S: '#c084fc', SS: '#f472b6', SSS: '#f87171',
};

/** 복선 사다리 — 고대비 직사각형 (배경 어둡게 · 글자 밝게) */
const GRADE_RECT_STYLE = {
  SSS: { bg: '#450a0a', fg: '#fecaca', border: '#f87171' },
  SS: { bg: '#500724', fg: '#fbcfe8', border: '#f472b6' },
  S: { bg: '#3b0764', fg: '#f3e8ff', border: '#c084fc' },
  A: { bg: '#7c2d12', fg: '#ffedd5', border: '#fb923c' },
  B: { bg: '#713f12', fg: '#fef9c3', border: '#facc15' },
  C: { bg: '#14532d', fg: '#dcfce7', border: '#4ade80' },
  D: { bg: '#1e3a5f', fg: '#dbeafe', border: '#60a5fa' },
  F: { bg: '#111827', fg: '#f3f4f6', border: '#9ca3af' },
};
const CHAR_RECT_STYLE = { bg: '#082f49', fg: '#e0f2fe', border: '#7dd3fc' };
const FORESHADOW_LADDER = {
  charW: 156,
  fsW: 172,
  boxH: 52,
  corner: 6,
  /** 기존 1.5px의 3배 */
  lineWidth: 4.5,
  lineColor: 'rgba(186, 230, 253, 0.95)',
  /** 좌·우 열 간격 = (화면 기준 최대 간격)의 30% */
  columnSpanRatio: 0.3,
  minColumnGap: 48,
};

const RELATION_COLORS = {
  neutral: '#ffffff',
  ally: '#93c5fd',
  enemy: '#f87171',
};

let canvas, ctx;
let mode = 'foreshadow';
let zoom = 1;
let panX = 0, panY = 0;
let nodes = [];
let edges = [];
let dragging = null;
let dragNode = null;
let connectingFrom = null;
let connectPointer = null;
let pointerState = null;
let linkAddMode = false;
let linkEditMode = false;
let linkPickFirst = null;
const avatarImages = new Map();
/** 드래그로 옮긴 좌표 — rebuild 시에도 유지, 「위치 저장」으로 DB 반영 */
const sessionPositions = new Map();
/** 이름/직업 라벨 방향 — right|left|below|above */
const sessionLabelSides = new Map();
/** 비동기 build 경쟁 방지 — 최신 요청만 노드/엣지를 반영 */
let buildGeneration = 0;
const CLICK_THRESHOLD = 6;
const DBLCLICK_MS = 280;
const AVATAR_NODE_R = 105; // 300×300 → 30% 축소 = 210×210
let pendingClickTimer = null;
let lastClick = { id: null, time: 0 };
const CHARACTER_GRAPH = {
  centerR: 39,
  outerR: 34,
  layoutScale: 0.58,
  labelGap: 24,
  subGap: 28,
};
/** 같은 높이로 볼 Y 오차 (이하면 직선) */
const EDGE_Y_ALIGN_TOL = 50;
/** 관계선 라벨을 선 위로 띄우는 거리 */
const EDGE_LABEL_ABOVE = 14;

/** 인물 관계도 편집(드래그·줄 추가·관계 수정) — 소유 관리자·마스터만 */
function canEditCharacterGraph() {
  return project.canManageCurrentProject();
}

export function initGraph() {
  canvas = document.getElementById('main-canvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d', { alpha: true });
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }

  on('project:loaded', () => {
    avatarImages.clear();
    sessionPositions.clear();
    sessionLabelSides.clear();
    if (isGraphVisible()) buildAndDraw();
  });

  on('character:updated', () => {
    // 드래그 중 rebuild 하면 고아 노드·복제 카드가 생김
    if (dragNode) return;
    if (isGraphVisible() && mode === 'character') buildAndDraw();
  });

  on('character:deleted', () => {
    if (dragNode) return;
    if (isGraphVisible() && mode === 'character') buildAndDraw();
  });

  on('view:changed', (view) => {
    if (view.startsWith('graph-')) {
      mode = view.replace('graph-', '');
      if (mode === 'character' && !canEditCharacterGraph()) cancelLinkModes();
      showGraphLayer(true);
      buildAndDraw();
    } else {
      showGraphLayer(false);
    }
  });

  window.addEventListener('resize', () => {
    if (isGraphVisible()) { resizeCanvas(); buildAndDraw(); }
  });

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  document.querySelector('[data-action="graph-zoom-in"]')?.addEventListener('click', () => { zoom *= 1.15; draw(); });
  document.querySelector('[data-action="graph-zoom-out"]')?.addEventListener('click', () => { zoom /= 1.15; draw(); });
  document.querySelector('[data-action="graph-reset"]')?.addEventListener('click', () => { zoom = 1; panX = 0; panY = 0; buildAndDraw(); });

  document.querySelector('[data-action="graph-save-layout"]')
    ?.addEventListener('click', () => {
      if (!canEditCharacterGraph()) {
        alert('일반 사용자는 인물 관계도를 편집할 수 없습니다. (열람만 가능)');
        return;
      }
      saveCharacterLayout().catch(console.error);
    });
  document.querySelector('[data-action="graph-add-link"]')
    ?.addEventListener('click', () => {
      if (!canEditCharacterGraph()) {
        alert('일반 사용자는 인물 관계도를 편집할 수 없습니다. (열람만 가능)');
        return;
      }
      toggleLinkAddMode();
    });
  document.querySelector('[data-action="graph-edit-link"]')
    ?.addEventListener('click', () => {
      if (!canEditCharacterGraph()) {
        alert('일반 사용자는 인물 관계도를 편집할 수 없습니다. (열람만 가능)');
        return;
      }
      toggleLinkEditMode();
    });

  document.getElementById('graph-filter')?.addEventListener('change', buildAndDraw);
}

function isGraphVisible() {
  const layer = document.getElementById('graph-layer');
  return layer && !layer.hidden;
}

function showGraphLayer(show) {
  const graphLayer = document.getElementById('graph-layer');
  const workspaceLayer = document.getElementById('workspace-layer');
  const filter = document.getElementById('graph-filter');
  if (graphLayer) graphLayer.hidden = !show;
  if (workspaceLayer) workspaceLayer.hidden = show;
  if (filter) filter.hidden = !(show && mode === 'foreshadow');
  if (!show) cancelLinkModes();
  if (show) { resizeCanvas(); buildAndDraw(); }
}

export function hideGraph() {
  showGraphLayer(false);
}

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function buildAndDraw() {
  const cache = project.getCache();
  const filter = document.getElementById('graph-filter')?.value || 'all';
  const gen = ++buildGeneration;

  if (mode === 'foreshadow') {
    nodes = [];
    edges = [];
    buildForeshadowGraph(cache, filter);
    if (gen !== buildGeneration) return;
    renderLegend('좌: 인물 · 우: 복선 · 직사각형 · 두꺼운 직선');
    draw();
    updateStatus();
  } else if (mode === 'character') {
    buildCharacterGraph(cache, gen).then((result) => {
      if (!result || result.gen !== buildGeneration) return;
      nodes = result.nodes;
      edges = result.edges;
      // 드래그 중이면 포인터가 가리키는 노드 참조를 새 배열에 맞춤
      if (dragNode) {
        const live = nodes.find((n) => n.id === dragNode.id);
        if (live) dragNode = live;
      }
      renderLegend(result.legend);
      draw();
      updateStatus();
    }).catch(console.error);
  } else if (mode === 'timeline') {
    nodes = [];
    edges = [];
    buildMultiverseGraph(cache);
    if (gen !== buildGeneration) return;
    renderLegend('멀티버스 · 스토리 등장 EP · 등장 횟수 순');
    draw();
    updateStatus();
  }
}

/**
 * 복선 그래프 — 좌(인물) / 우(복선) 사다리 배치.
 * 직사각형 노드 + 고대비 텍스트 + 두꺼운 직선 연결.
 * relatedCharacters 매칭 실패 시 선은 만들지 않고 노드만 둔다.
 */
function buildForeshadowGraph(cache, filter) {
  const foreshadows = cache.foreshadows.filter((f) =>
    filter === 'all' || f.status === filter
  );
  const characters = cache.characters || [];

  const w = canvas.clientWidth || 800;
  const h = canvas.clientHeight || 600;
  const { charW, fsW, boxH, columnSpanRatio, minColumnGap } = FORESHADOW_LADDER;
  const padX = Math.max(24, w * 0.03);
  const padY = Math.max(40, h * 0.06);

  // 예전: 좌·우 끝단에 붙여 간격이 거의 화면 전체 → 그 최대 간격의 30%만 사용
  const maxCenterSpan = Math.max(
    (charW + fsW) / 2 + minColumnGap,
    w - 2 * padX - (charW + fsW) / 2
  );
  const centerSpan = Math.max(
    (charW + fsW) / 2 + minColumnGap,
    maxCenterSpan * columnSpanRatio
  );
  const midX = w / 2;
  const leftX = midX - centerSpan / 2;
  const rightX = midX + centerSpan / 2;
  const minGap = boxH + 14;

  // 명시된 relatedCharacters만 연결 — 해석 실패 시 선 없음(강제 연결 안 함)
  const links = [];
  const tempIndex = buildCharacterIndex(characters);
  for (const fs of foreshadows) {
    for (const ref of fs.relatedCharacters || []) {
      const ch = resolveCharacter(ref, tempIndex);
      if (!ch) continue;
      links.push({ charId: ch.id, fsId: fs.id });
    }
  }

  const { chars: orderedChars, fores: orderedFs } = orderForeshadowLadder(
    characters,
    foreshadows,
    links
  );

  const charStep = orderedChars.length > 1
    ? Math.max(minGap, (h - padY * 2) / (orderedChars.length - 1))
    : 0;
  const fsStep = orderedFs.length > 1
    ? Math.max(minGap, (h - padY * 2) / (orderedFs.length - 1))
    : 0;

  orderedChars.forEach((ch, i) => {
    const style = CHAR_RECT_STYLE;
    nodes.push({
      id: ch.id,
      label: ch.name,
      sub: ch.race || '',
      color: style.border,
      bg: style.bg,
      fg: style.fg,
      border: style.border,
      x: leftX,
      y: orderedChars.length === 1 ? h / 2 : padY + charStep * i,
      w: charW,
      h: boxH,
      r: Math.max(charW, boxH) / 2,
      shape: 'rect',
      data: ch,
      type: 'character',
    });
  });

  orderedFs.forEach((fs, i) => {
    const style = GRADE_RECT_STYLE[fs.grade] || GRADE_RECT_STYLE.F;
    nodes.push({
      id: fs.id,
      label: fs.title,
      sub: fs.grade || '',
      color: style.border,
      bg: style.bg,
      fg: style.fg,
      border: style.border,
      x: rightX,
      y: orderedFs.length === 1 ? h / 2 : padY + fsStep * i,
      w: fsW,
      h: boxH,
      r: Math.max(fsW, boxH) / 2,
      shape: 'rect',
      data: fs,
      type: 'foreshadow',
    });
  });

  for (const link of links) {
    const charNode = nodes.find((n) => n.id === link.charId && n.type === 'character');
    const fsNode = nodes.find((n) => n.id === link.fsId && n.type === 'foreshadow');
    if (!charNode || !fsNode) continue;
    edges.push({
      from: charNode,
      to: fsNode,
      color: FORESHADOW_LADDER.lineColor,
      lineWidth: FORESHADOW_LADDER.lineWidth,
    });
  }
}

/** 교차 감소용 이분 그래프 정렬 (barycenter) */
function orderForeshadowLadder(characters, foreshadows, links) {
  let chars = characters.slice();
  let fores = foreshadows.slice();
  if (!chars.length || !fores.length || !links.length) {
    return { chars, fores };
  }

  const charPos = new Map(chars.map((c, i) => [c.id, i]));
  const fsPos = new Map(fores.map((f, i) => [f.id, i]));

  for (let pass = 0; pass < 4; pass += 1) {
    // 인물: 연결된 복선들의 평균 순서로 정렬
    chars = chars.slice().sort((a, b) => {
      const ba = barycenterOf(a.id, links, 'charId', 'fsId', fsPos);
      const bb = barycenterOf(b.id, links, 'charId', 'fsId', fsPos);
      return ba - bb;
    });
    chars.forEach((c, i) => charPos.set(c.id, i));

    // 복선: 연결된 인물들의 평균 순서로 정렬
    fores = fores.slice().sort((a, b) => {
      const ba = barycenterOf(a.id, links, 'fsId', 'charId', charPos);
      const bb = barycenterOf(b.id, links, 'fsId', 'charId', charPos);
      return ba - bb;
    });
    fores.forEach((f, i) => fsPos.set(f.id, i));
  }

  return { chars, fores };
}

function barycenterOf(id, links, selfKey, otherKey, otherPos) {
  const ys = [];
  for (const L of links) {
    if (L[selfKey] !== id) continue;
    const p = otherPos.get(L[otherKey]);
    if (p != null) ys.push(p);
  }
  if (!ys.length) return 1e9;
  return ys.reduce((s, v) => s + v, 0) / ys.length;
}

function buildCharacterIndex(characters) {
  const byId = new Map();
  const byCharacterId = new Map();
  const byName = new Map();

  for (const ch of characters) {
    byId.set(ch.id, ch);
    if (ch.characterId) byCharacterId.set(ch.characterId, ch);
    if (ch.name) byName.set(ch.name, ch);
    for (const alias of ch.alias || []) {
      if (alias) byName.set(alias, ch);
    }
  }

  return { byId, byCharacterId, byName };
}

function resolveCharacter(ref, index) {
  if (!ref) return null;
  return index.byId.get(ref)
    || index.byCharacterId.get(ref)
    || index.byName.get(String(ref).trim())
    || null;
}

function pairKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

function addPairCount(map, idA, idB, weight = 1) {
  if (!idA || !idB || idA === idB) return;
  const key = pairKey(idA, idB);
  map.set(key, (map.get(key) || 0) + weight);
}

function collectTimelinePairs(timeline, index) {
  const pairs = new Map();

  for (const ev of timeline || []) {
    const present = (ev.characters || [])
      .map((ref) => resolveCharacter(ref, index))
      .filter(Boolean);

    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        addPairCount(pairs, present[i].id, present[j].id);
      }
    }
  }

  return pairs;
}

function collectEpisodePairs(characters, texts, index) {
  const pairs = new Map();

  for (const item of texts || []) {
    const text = item?.content || '';
    if (!text) continue;

    const present = characters.filter((ch) => {
      if (ch.name && text.includes(ch.name)) return true;
      return (ch.alias || []).some((alias) => alias && text.includes(alias));
    });

    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        addPairCount(pairs, present[i].id, present[j].id);
      }
    }
  }

  return pairs;
}

function findCharacterNode(nodes, ref) {
  const index = buildCharacterIndex(nodes.filter((n) => n.type === 'character').map((n) => n.data));
  const ch = resolveCharacter(ref, index);
  if (!ch) return null;
  return nodes.find((n) => n.id === ch.id) || null;
}

function collectEpisodeRangePairs(characters) {
  const pairs = new Map();

  for (let i = 0; i < characters.length; i++) {
    for (let j = i + 1; j < characters.length; j++) {
      const a = characters[i];
      const b = characters[j];
      const aFirst = Number(a.firstEpisode) || 0;
      const aLast = Number(a.lastEpisode) || 0;
      const bFirst = Number(b.firstEpisode) || 0;
      const bLast = Number(b.lastEpisode) || 0;
      if (!aFirst || !aLast || !bFirst || !bLast) continue;
      if (aFirst <= bLast && bFirst <= aLast) {
        addPairCount(pairs, a.id, b.id);
      }
    }
  }

  return pairs;
}

async function buildCharacterGraph(cache, gen) {
  const nextNodes = [];
  const nextEdges = [];

  // id 기준 중복 제거 (동일 인물이 두 번 들어오면 카드가 복제됨)
  const seenIds = new Set();
  const characters = (cache.characters || []).filter((ch) => {
    if (!ch?.id || seenIds.has(ch.id)) return false;
    seenIds.add(ch.id);
    return true;
  });

  const cx = canvas.clientWidth / 2;
  const cy = canvas.clientHeight / 2;
  const hasAvatars = characters.some((c) => getCharacterRepresentativeUrl(c));
  const radius = Math.min(cx, cy) * (hasAvatars ? 0.82 : CHARACTER_GRAPH.layoutScale);
  const index = buildCharacterIndex(characters);

  if (!characters.length) {
    return { gen, nodes: nextNodes, edges: nextEdges, legend: '인물 데이터가 없습니다 — Character DB를 확인하세요.' };
  }

  const timelinePairs = collectTimelinePairs(cache.timeline, index);
  const episodeTexts = [...(cache.episodes || []), ...(cache.stories || [])];
  const episodePairs = collectEpisodePairs(characters, episodeTexts, index);

  let pairs = timelinePairs;
  let source = 'timeline';

  if (!pairs.size) {
    pairs = episodePairs;
    source = 'episode';
  }

  if (!pairs.size) {
    pairs = collectEpisodeRangePairs(characters);
    source = 'episode-range';
  }

  // 등장 순서대로 자동 관계선 반영 (기본: 아군·두께3·설명빈칸)
  const orderedPairs = [...pairs.keys()].map((key) => key.split('|'));
  await project.upsertAutoCharacterRelations(orderedPairs);
  if (gen !== buildGeneration) return null;
  await project.ensureCharacterRelationsNormalized();
  if (gen !== buildGeneration) return null;

  const layout = await project.getCharacterLayout();
  if (gen !== buildGeneration) return null;
  const saved = layout.positions || {};

  const protagonist = characters.find((ch) => ch.name === '주인공')
    || characters.find((ch) => (ch.name || '').includes('주인공'))
    || characters[0];

  const others = characters.filter((ch) => ch.id !== protagonist.id);

  function resolvePos(id, fallbackX, fallbackY) {
    const session = sessionPositions.get(id);
    if (session) return session;
    const stored = saved[id];
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      if (stored.labelSide) sessionLabelSides.set(id, stored.labelSide);
      return { x: stored.x, y: stored.y };
    }
    return { x: fallbackX, y: fallbackY };
  }

  const pPos = resolvePos(protagonist.id, cx, cy);
  nextNodes.push({
    id: protagonist.id,
    label: protagonist.name,
    sub: protagonist.occupation || '',
    color: protagonist.status === 'Dead' ? '#f87171' : '#6c8cff',
    x: pPos.x,
    y: pPos.y,
    r: getCharacterRepresentativeUrl(protagonist) ? AVATAR_NODE_R : CHARACTER_GRAPH.centerR,
    shape: getCharacterRepresentativeUrl(protagonist) ? 'square' : 'circle',
    data: protagonist,
    type: 'character',
  });

  others.forEach((ch, i) => {
    const angle = (i / Math.max(others.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const pos = resolvePos(
      ch.id,
      cx + Math.cos(angle) * radius,
      cy + Math.sin(angle) * radius
    );
    nextNodes.push({
      id: ch.id,
      label: ch.name,
      sub: ch.occupation || '',
      color: ch.status === 'Dead' ? '#f87171' : '#6c8cff',
      x: pos.x,
      y: pos.y,
      r: getCharacterRepresentativeUrl(ch) ? AVATAR_NODE_R : CHARACTER_GRAPH.outerR,
      shape: getCharacterRepresentativeUrl(ch) ? 'square' : 'circle',
      data: ch,
      type: 'character',
    });
  });

  const relations = [...(project.getCache().characterRelations || [])]
    .sort((a, b) => (a.lineNo || 0) - (b.lineNo || 0));

  for (const rel of relations) {
    const na = nextNodes.find((n) => n.id === rel.fromId);
    const nb = nextNodes.find((n) => n.id === rel.toId);
    if (!na || !nb) continue;
    const key = pairKey(na.id, nb.id);
    if (nextEdges.some((e) => pairKey(e.from.id, e.to.id) === key)) continue;
    const type = rel.type || 'ally';
    nextEdges.push({
      from: na,
      to: nb,
      color: RELATION_COLORS[type] || RELATION_COLORS.ally,
      lineWidth: Math.min(10, Math.max(1, Number(rel.lineWidth) || 3)),
      lineNo: rel.lineNo || 0,
      description: rel.description || '',
      relationType: type,
      manual: !!rel.manual,
      rel,
    });
  }

  for (const n of nextNodes) preloadAvatar(n);

  const linkHint = linkAddMode
    ? '줄 추가 모드: 카드 두 개를 순서대로 클릭'
    : linkEditMode
      ? '줄 변경 모드: 관계선을 클릭해 편집'
      : '줄 추가·줄 변경 버튼으로 연결/편집';
  const baseLegend = `드래그: 이동 · ${linkHint} · 중립=흰 / 아군=화이트블루 / 적군=레드`;

  let legend = `${baseLegend} · 연결 없음`;
  if (nextEdges.length) {
    if (source === 'timeline') legend = `${baseLegend} · 타임라인 공동 등장`;
    else if (source === 'episode') legend = `${baseLegend} · EP/ST 본문 공동 등장`;
    else legend = `${baseLegend} · 등장 화수 겹침`;
  }

  return { gen, nodes: nextNodes, edges: nextEdges, legend };
}

function preloadAvatar(node) {
  if (node.type !== 'character') return;
  const url = getCharacterRepresentativeUrl(node.data);
  if (!url) {
    avatarImages.delete(node.id);
    return;
  }
  const cached = avatarImages.get(node.id);
  if (cached && cached.src === url) return;
  const img = new Image();
  img.onload = () => { if (isGraphVisible() && mode === 'character') draw(); };
  img.src = url;
  avatarImages.set(node.id, img);
}

function roundRectPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * 멀티버스 — 인물별 스토리 등장 EP (등장 횟수 순)
 * 예: 투자 - EP1~EP11, EP14~EP16
 */
function buildMultiverseGraph(cache) {
  const rows = collectMultiverseRows(cache);
  const w = canvas.clientWidth || 800;
  const padX = 28;
  const padY = 28;
  const rowH = 46;
  const gap = 8;
  const boxW = Math.max(320, Math.min(w - padX * 2, 780));

  if (!rows.length) {
    nodes.push({
      id: 'multiverse-empty',
      label: '등록된 인물이 없습니다',
      sub: '스토리 동기화 후 다시 열어주세요',
      shape: 'rect',
      type: 'multiverse',
      w: boxW,
      h: rowH,
      x: padX + boxW / 2,
      y: padY + rowH / 2,
      bg: '#111827',
      fg: '#e5e7eb',
      border: '#6b7280',
      r: rowH / 2,
      data: { count: 0 },
    });
    return;
  }

  rows.forEach((row, i) => {
    nodes.push({
      id: row.id,
      label: row.name,
      sub: row.rangesLabel,
      shape: 'rect',
      type: 'multiverse',
      w: boxW,
      h: rowH,
      x: padX + boxW / 2,
      y: padY + i * (rowH + gap) + rowH / 2,
      bg: i % 2 === 0 ? '#0c1929' : '#0f172a',
      fg: '#f8fafc',
      border: '#38bdf8',
      r: rowH / 2,
      data: row,
    });
  });
}

function draw() {
  if (!ctx || !canvas) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  const grid = 40 * zoom;
  for (let x = (panX % grid); x < w; x += grid) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = (panY % grid); y < h; y += grid) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  for (const e of edges) {
    ctx.strokeStyle = e.color;
    ctx.lineWidth = e.lineWidth || (mode === 'foreshadow' ? FORESHADOW_LADDER.lineWidth : 1.5);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const path = mode === 'character'
      ? getCharacterEdgePath(e)
      : mode === 'foreshadow'
        ? getForeshadowEdgePath(e)
        : [
          { x: e.from.x, y: e.from.y },
          { x: e.to.x, y: e.to.y },
        ];
    drawPolyline(path);
    if (mode === 'character' && (e.lineNo || e.description)) {
      drawEdgeLabel(e, path);
    }
  }

  if (connectingFrom && connectPointer) {
    ctx.strokeStyle = linkAddMode ? 'rgba(147,197,253,0.9)' : 'rgba(251,191,36,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    const preview = mode === 'character'
      ? getCharacterEdgePath({ from: connectingFrom, to: connectPointer })
      : [{ x: connectingFrom.x, y: connectingFrom.y }, { x: connectPointer.x, y: connectPointer.y }];
    drawPolyline(preview);
    ctx.setLineDash([]);
  }

  const labelLayouts = mode === 'character' ? resolveAllCharacterLabels() : new Map();
  for (const n of nodes) {
    drawNode(n, labelLayouts.get(n.id) || null);
  }

  ctx.restore();
}

function nodeCardHeight(n) {
  if (!n) return CHARACTER_GRAPH.outerR * 2;
  return (Number(n.r) || CHARACTER_GRAPH.outerR) * 2;
}

function measureTextSize(text, font) {
  ctx.font = font;
  const m = String(font).match(/(\d+(?:\.\d+)?)px/);
  return {
    w: ctx.measureText(text).width,
    h: m ? Number(m[1]) : 14,
  };
}

function rectsOverlap(a, b, pad = 4) {
  return !(
    a.x + a.w + pad <= b.x
    || b.x + b.w + pad <= a.x
    || a.y + a.h + pad <= b.y
    || b.y + b.h + pad <= a.y
  );
}

function nodeBodyRect(n) {
  if (n.shape === 'rect' && n.w && n.h) {
    return { x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h };
  }
  const r = n.r || 20;
  if (n.shape === 'square') {
    return { x: n.x - r, y: n.y - r, w: r * 2, h: r * 2 };
  }
  return { x: n.x - r, y: n.y - r, w: r * 2, h: r * 2 };
}

/** 이름+직업 블록의 후보 배치 (카드 아래 / 라인·카드 오른쪽) */
function buildLabelCandidate(n, side, overrideX = null) {
  const isSquare = n.shape === 'square';
  const nameText = truncate(n.label, isSquare ? 12 : 8);
  const subText = n.sub ? truncate(n.sub, isSquare ? 18 : 16) : '';
  const nameFont = isSquare
    ? '700 22px sans-serif'
    : `600 ${Math.max(18, n.r * 0.45)}px sans-serif`;
  const subFont = isSquare
    ? '16px sans-serif'
    : `${Math.max(14, n.r * 0.32)}px sans-serif`;
  const nameSize = measureTextSize(nameText, nameFont);
  const subSize = subText ? measureTextSize(subText, subFont) : { w: 0, h: 0 };
  const gap = 10;
  const lineGap = isSquare ? 8 : 4;
  const blockW = Math.max(nameSize.w, subSize.w) + 4;
  const blockH = nameSize.h + (subText ? lineGap + subSize.h : 0);
  const r = n.r || 20;
  let boxX;
  let boxY;
  let align = 'center';

  if (side === 'right' || side === 'right-of-line') {
    const startX = overrideX != null ? overrideX : (n.x + r + gap);
    boxX = startX;
    // 카드 아래 높이와 맞춰 이름·직업이 카드 밑 라인 근처에서 읽히게
    boxY = n.y + r + gap;
    align = 'left';
  } else {
    // below (기본)
    boxX = n.x - blockW / 2;
    boxY = n.y + r + gap;
    align = 'center';
  }

  const nameX = align === 'left' ? boxX : boxX + blockW / 2;
  const nameY = boxY;
  const subX = nameX;
  const subY = boxY + nameSize.h + lineGap;

  return {
    side,
    align,
    box: { x: boxX, y: boxY, w: blockW, h: blockH },
    nameText,
    subText,
    nameFont,
    subFont,
    nameX,
    nameY,
    subX,
    subY,
  };
}

/** 라벨 박스가 관계선과 겹치는지 (샘플 거리) */
function labelBoxHitsEdges(box, edgePaths, threshold = 12) {
  const samples = [];
  const steps = 4;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    samples.push([box.x + box.w * t, box.y + 2]);
    samples.push([box.x + box.w * t, box.y + box.h / 2]);
    samples.push([box.x + box.w * t, box.y + box.h - 2]);
    samples.push([box.x + 2, box.y + box.h * t]);
    samples.push([box.x + box.w - 2, box.y + box.h * t]);
  }
  for (const path of edgePaths) {
    for (const [px, py] of samples) {
      if (distToPolyline(px, py, path) <= threshold) return true;
    }
  }
  return false;
}

function labelBoxHitsNodes(box, selfId) {
  for (const other of nodes) {
    if (other.type !== 'character' || other.id === selfId) continue;
    if (rectsOverlap(box, nodeBodyRect(other), 8)) return true;
  }
  return false;
}

function labelBoxHitsPlaced(box, placed) {
  return placed.some((p) => rectsOverlap(box, p.box, 8));
}

/**
 * 라벨 영역 근처 관계선의 오른쪽 경계 X
 * (수직선이면 그 선의 x, 아니면 최근접점 x)
 */
function rightEdgeXNearLabel(n, belowBox, edgePaths) {
  let rightX = n.x + (n.r || 20);
  const pad = 14;
  const probes = [
    [n.x, belowBox.y + belowBox.h / 2],
    [n.x, belowBox.y],
    [n.x, belowBox.y + belowBox.h],
    [belowBox.x + belowBox.w / 2, belowBox.y + belowBox.h / 2],
  ];

  for (const path of edgePaths) {
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      for (const [px, py] of probes) {
        const d = distToSegment(px, py, a.x, a.y, b.x, b.y);
        if (d > 28) continue;
        // 수직에 가까운 구간: x 고정
        if (Math.abs(a.x - b.x) <= 1) {
          rightX = Math.max(rightX, a.x + pad);
          continue;
        }
        // 최근접점의 x
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy || 1;
        let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const qx = a.x + t * dx;
        rightX = Math.max(rightX, qx + pad);
      }
    }
  }
  return rightX;
}

/**
 * 기본: 카드 아래. 라인(또는 다른 카드)과 겹치면 라인 오른쪽에 표시.
 * @returns {Map<string, object>}
 */
function resolveAllCharacterLabels() {
  const layouts = new Map();
  if (mode !== 'character' || !ctx) return layouts;

  const chars = nodes.filter((n) => n.type === 'character');
  const edgePaths = edges.map((e) => getCharacterEdgePath(e));
  const order = [...chars].sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const placed = [];

  for (const n of order) {
    let cand = buildLabelCandidate(n, 'below');
    const hitsLine = labelBoxHitsEdges(cand.box, edgePaths);
    const hitsNode = labelBoxHitsNodes(cand.box, n.id);
    const hitsLabel = labelBoxHitsPlaced(cand.box, placed);

    if (hitsLine || hitsNode || hitsLabel) {
      let x = rightEdgeXNearLabel(n, cand.box, edgePaths);
      // 다른 카드/라벨을 피할 때까지 오른쪽으로 밀기
      for (let attempt = 0; attempt < 8; attempt += 1) {
        cand = buildLabelCandidate(n, 'right-of-line', x);
        if (
          !labelBoxHitsEdges(cand.box, edgePaths, 10)
          && !labelBoxHitsNodes(cand.box, n.id)
          && !labelBoxHitsPlaced(cand.box, placed)
        ) {
          break;
        }
        x += 22;
      }
    }

    layouts.set(n.id, cand);
    placed.push(cand);
    sessionLabelSides.set(n.id, cand.side);
  }
  return layouts;
}

/**
 * 라벨·카드 겹침이 남으면 카드를 살짝 밀어 분리 (위치 저장 시)
 * @returns {number} 이동한 카드 수
 */
function separateOverlappingCharacterCards(maxIter = 12) {
  const chars = nodes.filter((n) => n.type === 'character');
  let moved = 0;
  for (let iter = 0; iter < maxIter; iter += 1) {
    const layouts = resolveAllCharacterLabels();
    let hit = false;
    for (let i = 0; i < chars.length; i += 1) {
      for (let j = i + 1; j < chars.length; j += 1) {
        const a = chars[i];
        const b = chars[j];
        const la = layouts.get(a.id);
        const lb = layouts.get(b.id);
        const bodyA = nodeBodyRect(a);
        const bodyB = nodeBodyRect(b);
        const conflict =
          (la && lb && rectsOverlap(la.box, lb.box, 8))
          || (la && rectsOverlap(la.box, bodyB, 8))
          || (lb && rectsOverlap(lb.box, bodyA, 8))
          || rectsOverlap(bodyA, bodyB, 4);
        if (!conflict) continue;
        hit = true;
        const dx = b.x - a.x || 0.01;
        const dy = b.y - a.y || 0.01;
        const len = Math.hypot(dx, dy) || 1;
        const push = 18;
        a.x -= (dx / len) * push;
        a.y -= (dy / len) * push;
        b.x += (dx / len) * push;
        b.y += (dy / len) * push;
        sessionPositions.set(a.id, { x: a.x, y: a.y });
        sessionPositions.set(b.id, { x: b.x, y: b.y });
        moved += 1;
      }
    }
    if (!hit) break;
  }
  resolveAllCharacterLabels();
  return moved;
}

/**
 * 복선 사다리 연결선 — 직사각형 가장자리끼리 잇는 직선만 사용.
 */
function getForeshadowEdgePath(e) {
  const left = e.from.x <= e.to.x ? e.from : e.to;
  const right = e.from.x <= e.to.x ? e.to : e.from;
  const lw = (left.w || (left.r || 18) * 2) / 2;
  const rw = (right.w || (right.r || 22) * 2) / 2;
  return [
    { x: left.x + lw, y: left.y },
    { x: right.x - rw, y: right.y },
  ];
}

/**
 * 인물 관계선 경로
 * - |dy| ≤ 50: 직선
 * - |dy| > 카드 높이: 왼쪽 카드에서 수직으로 맞춘 뒤 오른쪽으로 꺾는 직각
 */
function getCharacterEdgePath(e) {
  const a = e.from;
  const b = e.to;
  const dy = Math.abs(a.y - b.y);
  if (dy <= EDGE_Y_ALIGN_TOL) {
    // 거의 같은 높이 → 직선 (평균 Y로 살짝 수평 보정)
    const y = (a.y + b.y) / 2;
    return [
      { x: a.x, y },
      { x: b.x, y },
    ];
  }

  const cardH = Math.max(nodeCardHeight(a), nodeCardHeight(b));
  if (dy > cardH) {
    // 왼쪽 노드에서 수직으로 내린(또는 올린) 뒤 오른쪽으로 수평
    const left = a.x <= b.x ? a : b;
    const right = a.x <= b.x ? b : a;
    const elbow = { x: left.x, y: right.y };
    return [
      { x: left.x, y: left.y },
      elbow,
      { x: right.x, y: right.y },
    ];
  }

  // 50 < dy ≤ 카드높이: 직선 유지
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: b.y },
  ];
}

function drawPolyline(points) {
  if (!points?.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

function distToPolyline(px, py, points) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const d = distToSegment(
      px, py,
      points[i].x, points[i].y,
      points[i + 1].x, points[i + 1].y
    );
    if (d < best) best = d;
  }
  return best;
}

/** 관계선 라벨 — 선과 겹치지 않게 선보다 위쪽에 표시 */
function drawEdgeLabel(e, path) {
  const pts = path || getCharacterEdgePath(e);
  const label = e.lineNo
    ? (e.description ? `L${e.lineNo} ${truncate(e.description, 12)}` : `L${e.lineNo}`)
    : truncate(e.description, 14);

  let lx;
  let ly;
  if (pts.length >= 3) {
    // 직각: 수평 구간의 중점 위
    const h0 = pts[pts.length - 2];
    const h1 = pts[pts.length - 1];
    lx = (h0.x + h1.x) / 2;
    ly = h0.y - EDGE_LABEL_ABOVE;
  } else {
    lx = (pts[0].x + pts[1].x) / 2;
    ly = (pts[0].y + pts[1].y) / 2 - EDGE_LABEL_ABOVE;
  }

  ctx.font = '600 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const tw = ctx.measureText(label).width;
  const padX = 5;
  const padY = 3;
  const boxH = 16;
  ctx.fillStyle = 'rgba(10,12,18,0.78)';
  ctx.fillRect(lx - tw / 2 - padX, ly - boxH + padY, tw + padX * 2, boxH);
  ctx.fillStyle = e.color || '#fff';
  ctx.fillText(label, lx, ly);
}

/** 텍스트 박스 중심이 관계선과 가까우면 true — 미사용 제거됨 */

function drawNode(n, labelLayout = null) {
  const isCharacter = n.type === 'character';
  const isSquare = n.shape === 'square';
  const isRect = n.shape === 'rect';
  const hasAvatar = isCharacter && getCharacterRepresentativeUrl(n.data);
  const img = hasAvatar ? avatarImages.get(n.id) : null;
  const avatarReady = img && img.complete && img.naturalWidth > 0;
  const cx = Math.round(n.x);
  const cy = Math.round(n.y);
  const r = n.r;

  if (isRect) {
    if (n.type === 'multiverse') drawMultiverseRectNode(n, cx, cy);
    else drawForeshadowRectNode(n, cx, cy);
    return;
  }

  if (isSquare) {
    const size = r * 2;
    const x = cx - r;
    const y = cy - r;
    const corner = 24;

    ctx.save();
    roundRectPath(x, y, size, size, corner);
    ctx.fillStyle = 'rgba(18,20,28,0.92)';
    ctx.fill();

    if (avatarReady) {
      ctx.save();
      roundRectPath(x, y, size, size, corner);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const s = Math.min(size / iw, size / ih);
      const dw = iw * s;
      const dh = ih * s;
      ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '600 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('이미지 로딩…', cx, cy);
    }

    roundRectPath(x, y, size, size, corner);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    drawCharacterNameSub(n, labelLayout, true);
    return;
  }

  const strokeW = isCharacter ? 3 : 2;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = n.color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = strokeW;
  ctx.stroke();

  if (isCharacter && mode === 'character') {
    drawCharacterNameSub(n, labelLayout, false);
    return;
  }

  const nameText = truncate(n.label, 8);
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${Math.max(10, r * 0.45)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(nameText, cx, cy);
  if (n.sub) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `${Math.max(8, r * 0.32)}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(n.sub, cx, Math.round(cy + r + 10));
  }
}

/** 멀티버스 행: `이름 - EP1~EP11, EP14` + 등장 횟수 */
function drawMultiverseRectNode(n, cx, cy) {
  const w = n.w || 480;
  const h = n.h || 46;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const corner = 6;
  const pad = 12;
  const count = Number(n.data?.count) || 0;
  const countText = count > 0 ? `${count}회` : '';
  const main = n.sub && n.sub !== '—'
    ? `${n.label} - ${n.sub}`
    : `${n.label} - —`;

  ctx.save();
  roundRectPath(x, y, w, h, corner);
  ctx.fillStyle = n.bg || '#0f172a';
  ctx.fill();
  ctx.strokeStyle = n.border || '#38bdf8';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  roundRectPath(x + 1, y + 1, w - 2, h - 2, Math.max(2, corner - 1));
  ctx.clip();

  ctx.fillStyle = n.fg || '#f8fafc';
  ctx.textBaseline = 'middle';

  let countW = 0;
  if (countText) {
    ctx.font = '600 12px sans-serif';
    countW = measureTextSize(countText, ctx.font).w + 10;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7dd3fc';
    ctx.fillText(countText, x + w - pad, cy);
  }

  const maxMainW = w - pad * 2 - countW;
  let fontSize = 14;
  let text = main;
  let font = `700 ${fontSize}px sans-serif`;
  while (fontSize >= 10) {
    font = `700 ${fontSize}px sans-serif`;
    text = main;
    while (text.length > 4 && measureTextSize(text, font).w > maxMainW) {
      text = `${text.slice(0, Math.max(3, text.length - 2))}…`;
    }
    if (measureTextSize(text, font).w <= maxMainW) break;
    fontSize -= 1;
  }

  ctx.font = font;
  ctx.fillStyle = n.fg || '#f8fafc';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + pad, cy);
  ctx.restore();
}

/** 복선 그래프용 직사각형 노드 — 텍스트가 박스 밖으로 나가지 않음 */
function drawForeshadowRectNode(n, cx, cy) {
  const w = n.w || 150;
  const h = n.h || 52;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const corner = FORESHADOW_LADDER.corner;
  const pad = 8;
  const fitted = fitRectLabel(n.label, n.sub, w - pad * 2, h - pad * 2);

  ctx.save();
  roundRectPath(x, y, w, h, corner);
  ctx.fillStyle = n.bg || '#111827';
  ctx.fill();
  ctx.strokeStyle = n.border || '#e5e7eb';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 텍스트 클리핑 — 사각형 밖으로 절대 나가지 않음
  roundRectPath(x + 1, y + 1, w - 2, h - 2, Math.max(2, corner - 1));
  ctx.clip();

  ctx.fillStyle = n.fg || '#f9fafb';
  ctx.textAlign = 'center';
  ctx.font = fitted.nameFont;
  if (fitted.sub) {
    ctx.textBaseline = 'bottom';
    ctx.fillText(fitted.name, cx, cy - 1);
    ctx.font = fitted.subFont;
    ctx.fillStyle = n.fg || '#f9fafb';
    ctx.globalAlpha = 0.9;
    ctx.textBaseline = 'top';
    ctx.fillText(fitted.sub, cx, cy + 2);
    ctx.globalAlpha = 1;
  } else {
    ctx.textBaseline = 'middle';
    ctx.fillText(fitted.name, cx, cy);
  }
  ctx.restore();
}

/** 박스 안에 들어가도록 글자 크기·말줄임 조정 */
function fitRectLabel(label, sub, maxW, maxH) {
  const rawName = String(label || '').trim() || '—';
  const rawSub = String(sub || '').trim();
  let nameSize = 13;
  let subSize = 11;

  while (nameSize >= 9) {
    const nameFont = `700 ${nameSize}px sans-serif`;
    const subFont = `600 ${subSize}px sans-serif`;
    let name = rawName;
    while (name.length > 1 && measureTextSize(name, nameFont).w > maxW) {
      name = `${name.slice(0, Math.max(1, name.length - 2))}…`;
    }
    let subText = rawSub;
    if (subText) {
      while (subText.length > 1 && measureTextSize(subText, subFont).w > maxW) {
        subText = `${subText.slice(0, Math.max(1, subText.length - 2))}…`;
      }
    }
    const needH = nameSize + (subText ? subSize + 4 : 0);
    if (needH <= maxH && measureTextSize(name, nameFont).w <= maxW) {
      return { name, sub: subText, nameFont, subFont };
    }
    nameSize -= 1;
    subSize = Math.max(8, subSize - 1);
  }

  const nameFont = '700 9px sans-serif';
  let name = rawName;
  while (name.length > 1 && measureTextSize(name, nameFont).w > maxW) {
    name = `${name.slice(0, Math.max(1, name.length - 2))}…`;
  }
  return { name, sub: '', nameFont, subFont: '600 8px sans-serif' };
}

function drawCharacterNameSub(n, layout, isSquare) {
  const fallback = buildLabelCandidate(n, isSquare ? 'below' : 'below');
  const L = layout || fallback;
  ctx.fillStyle = '#fff';
  ctx.font = L.nameFont;
  ctx.textAlign = L.align;
  ctx.textBaseline = 'top';
  ctx.fillText(L.nameText, L.nameX, L.nameY);
  if (L.subText) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = L.subFont;
    ctx.textAlign = L.align;
    ctx.textBaseline = 'top';
    ctx.fillText(L.subText, L.subX, L.subY);
  }
}

function renderLegend(text) {
  const el = document.getElementById('graph-legend');
  if (!el) return;
  if (mode === 'foreshadow') {
    el.innerHTML = `<div>${text}</div>` + Object.entries(GRADE_RECT_STYLE).map(([g, s]) =>
      `<span style="color:${s.fg};background:${s.bg};padding:1px 6px;border-radius:3px;border:1px solid ${s.border}">${g}</span>`
    ).join(' ');
  } else {
    el.innerHTML = `<div>${text}</div>`;
  }
}

function updateStatus() {
  const el = document.getElementById('status-graph');
  if (el) el.textContent = `노드 ${nodes.length} · 연결 ${edges.length} · ${Math.round(zoom * 100)}%`;
}

function onMouseDown(e) {
  const rect = canvas.getBoundingClientRect();
  const wx = (e.clientX - rect.left - panX) / zoom;
  const wy = (e.clientY - rect.top - panY) / zoom;
  const hit = hitTest(wx, wy);
  const canEdit = mode !== 'character' || canEditCharacterGraph();

  if (linkAddMode && mode === 'character') {
    if (!canEdit) {
      cancelLinkModes();
      return;
    }
    if (hit && hit.type === 'character') {
      if (!linkPickFirst) {
        linkPickFirst = hit;
        connectingFrom = hit;
        connectPointer = { x: wx, y: wy };
        draw();
      } else if (hit.id !== linkPickFirst.id) {
        finishLinkAdd(linkPickFirst, hit).catch(console.error);
      }
    }
    dragNode = null;
    dragging = null;
    pointerState = null;
    return;
  }

  if (linkEditMode && mode === 'character') {
    if (!canEdit) {
      cancelLinkModes();
      return;
    }
    const edgeHit = hitTestEdge(wx, wy);
    if (edgeHit) {
      pointerState = { sx: e.clientX, sy: e.clientY, edge: edgeHit, editMode: true };
      dragNode = null;
      dragging = null;
      return;
    }
    // 줄 변경 모드에서는 빈 곳 팬만 허용
    dragNode = null;
    pointerState = null;
    dragging = { x: e.clientX - panX, y: e.clientY - panY };
    return;
  }

  if (canEdit && hit && mode === 'character' && hit.type === 'character' && e.shiftKey) {
    connectingFrom = hit;
    connectPointer = { x: wx, y: wy };
    dragNode = null;
    dragging = null;
    pointerState = null;
    return;
  }

  if (!hit && mode === 'character') {
    const edgeHit = hitTestEdge(wx, wy);
    if (edgeHit) {
      if (!canEdit) {
        // 열람만 — 관계선 클릭으로 편집 불가
        dragNode = null;
        dragging = { x: e.clientX - panX, y: e.clientY - panY };
        pointerState = null;
        return;
      }
      // 줄 변경 모드가 아니어도 선 클릭으로 편집 가능(기존 동작)
      pointerState = { sx: e.clientX, sy: e.clientY, edge: edgeHit };
      dragNode = null;
      dragging = null;
      return;
    }
  }

  if (hit) {
    dragNode = hit;
    pointerState = { sx: e.clientX, sy: e.clientY, readonly: !canEdit };
    dragging = null;
    return;
  }

  dragNode = null;
  pointerState = null;
  dragging = { x: e.clientX - panX, y: e.clientY - panY };
}

function onMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const wx = (e.clientX - rect.left - panX) / zoom;
  const wy = (e.clientY - rect.top - panY) / zoom;

  if (connectingFrom) {
    if (mode === 'character' && !canEditCharacterGraph()) {
      connectingFrom = null;
      connectPointer = null;
      return;
    }
    connectPointer = { x: wx, y: wy };
    draw();
    return;
  }

  if (dragNode) {
    // 일반 사용자: 인물 카드 위치 이동 금지 (클릭 열람·팬만)
    if (mode === 'character' && !canEditCharacterGraph()) {
      return;
    }
    dragNode.x = wx;
    dragNode.y = wy;
    if (mode === 'character' && dragNode.type === 'character') {
      sessionPositions.set(dragNode.id, { x: wx, y: wy });
      // 배열 안 동일 id 노드도 동기화 (rebuild 직후 참조 어긋남 방지)
      const live = nodes.find((n) => n.id === dragNode.id);
      if (live && live !== dragNode) {
        live.x = wx;
        live.y = wy;
        dragNode = live;
      }
    }
    draw();
  } else if (dragging) {
    panX = e.clientX - dragging.x;
    panY = e.clientY - dragging.y;
    draw();
  }
}

async function onMouseUp(e) {
  if (linkAddMode) {
    // 클릭 처리는 mousedown에서 완료
    return;
  }

  if (connectingFrom) {
    if (mode === 'character' && !canEditCharacterGraph()) {
      connectingFrom = null;
      connectPointer = null;
      dragNode = null;
      pointerState = null;
      dragging = null;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left - panX) / zoom;
    const wy = (e.clientY - rect.top - panY) / zoom;
    const target = hitTest(wx, wy);

    if (target && target.type === 'character' && target.id !== connectingFrom.id) {
      await openRelationDialog(connectingFrom, target);
    } else {
      draw();
    }

    connectingFrom = null;
    connectPointer = null;
    dragNode = null;
    pointerState = null;
    dragging = null;
    return;
  }

  if (pointerState?.edge && mode === 'character') {
    if (canEditCharacterGraph()) {
      const dx = e.clientX - pointerState.sx;
      const dy = e.clientY - pointerState.sy;
      if (dx * dx + dy * dy <= CLICK_THRESHOLD * CLICK_THRESHOLD) {
        await editRelationDialog(pointerState.edge);
      }
    }
    pointerState = null;
    return;
  }

  if (dragNode && pointerState && mode === 'character' && dragNode.type === 'character') {
    const dx = e.clientX - pointerState.sx;
    const dy = e.clientY - pointerState.sy;
    if (dx * dx + dy * dy <= CLICK_THRESHOLD * CLICK_THRESHOLD) {
      handleCharacterClick(dragNode);
    }
  }

  dragging = null;
  dragNode = null;
  pointerState = null;
}

// 단일 클릭 → 상세 패널 / 더블 클릭 → 원본(풀사이즈) 뷰어
function handleCharacterClick(node) {
  const now = Date.now();
  const isDouble = lastClick.id === node.id && now - lastClick.time < DBLCLICK_MS;

  if (isDouble) {
    if (pendingClickTimer) { clearTimeout(pendingClickTimer); pendingClickTimer = null; }
    lastClick = { id: null, time: 0 };
    const url = getCharacterRepresentativeUrl(node.data);
    if (url) openImageLightbox(url);
    else openCharacterPanel(node.data);
    return;
  }

  lastClick = { id: node.id, time: now };
  if (pendingClickTimer) clearTimeout(pendingClickTimer);
  const data = node.data;
  pendingClickTimer = setTimeout(() => {
    openCharacterPanel(data);
    pendingClickTimer = null;
    lastClick = { id: null, time: 0 };
  }, DBLCLICK_MS);
}

function onWheel(e) {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.92 : 1.08;
  zoom = Math.max(0.3, Math.min(3, zoom * factor));
  draw();
  updateStatus();
}

function hitTest(wx, wy) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const dx = wx - n.x, dy = wy - n.y;
    if (n.shape === 'rect' && n.w && n.h) {
      if (Math.abs(dx) <= n.w / 2 && Math.abs(dy) <= n.h / 2) return n;
    } else if (n.shape === 'square') {
      if (Math.abs(dx) <= n.r && Math.abs(dy) <= n.r) return n;
    } else if (dx * dx + dy * dy <= n.r * n.r) {
      return n;
    }
  }
  return null;
}

function hitTestEdge(wx, wy) {
  const threshold = 8 / zoom;
  let best = null;
  let bestDist = threshold;
  for (const e of edges) {
    const path = mode === 'character'
      ? getCharacterEdgePath(e)
      : mode === 'foreshadow'
        ? getForeshadowEdgePath(e)
        : [{ x: e.from.x, y: e.from.y }, { x: e.to.x, y: e.to.y }];
    const dist = distToPolyline(wx, wy, path);
    if (dist < bestDist) {
      bestDist = dist;
      best = e;
    }
  }
  return best;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function toggleLinkAddMode() {
  if (!canEditCharacterGraph()) {
    cancelLinkModes();
    return;
  }
  const next = !linkAddMode;
  cancelLinkModes();
  linkAddMode = next;
  linkPickFirst = null;
  connectingFrom = null;
  connectPointer = null;
  syncLinkModeButtons();
  if (isGraphVisible() && mode === 'character') buildAndDraw();
  else draw();
}

function toggleLinkEditMode() {
  if (!canEditCharacterGraph()) {
    cancelLinkModes();
    return;
  }
  const next = !linkEditMode;
  cancelLinkModes();
  linkEditMode = next;
  syncLinkModeButtons();
  if (isGraphVisible() && mode === 'character') buildAndDraw();
  else draw();
}

function cancelLinkAddMode() {
  cancelLinkModes();
}

function cancelLinkModes() {
  linkAddMode = false;
  linkEditMode = false;
  linkPickFirst = null;
  connectingFrom = null;
  connectPointer = null;
  syncLinkModeButtons();
}

function syncLinkModeButtons() {
  document.querySelector('[data-action="graph-add-link"]')
    ?.classList.toggle('is-active', linkAddMode);
  document.querySelector('[data-action="graph-edit-link"]')
    ?.classList.toggle('is-active', linkEditMode);
}

async function finishLinkAdd(fromNode, toNode) {
  connectingFrom = null;
  connectPointer = null;
  linkPickFirst = null;
  await openRelationDialog(fromNode, toNode);
  cancelLinkModes();
}

function relationFormHtml(defaults = {}) {
  const type = defaults.type || 'ally';
  const width = Math.min(10, Math.max(1, Number(defaults.lineWidth) || 3));
  const lineNo = defaults.lineNo || '';
  const desc = defaults.description || '';
  const widthOpts = Array.from({ length: 10 }, (_, i) => {
    const v = i + 1;
    return `<option value="${v}"${v === width ? ' selected' : ''}>${v}</option>`;
  }).join('');

  return `
    <label class="char-form-field">
      <span class="char-form-label">라인 번호 (1~100)</span>
      <input type="number" id="rel-line-no" class="char-form-input" min="1" max="100" value="${lineNo}" placeholder="자동">
    </label>
    <label class="char-form-field">
      <span class="char-form-label">관계 유형</span>
      <select id="rel-type" class="char-form-input">
        <option value="neutral"${type === 'neutral' ? ' selected' : ''}>중립 (흰색)</option>
        <option value="ally"${type === 'ally' ? ' selected' : ''}>아군 (화이트블루)</option>
        <option value="enemy"${type === 'enemy' ? ' selected' : ''}>적군 (레드)</option>
      </select>
    </label>
    <label class="char-form-field">
      <span class="char-form-label">라인 두께 (1~10)</span>
      <select id="rel-width" class="char-form-input">${widthOpts}</select>
    </label>
    <label class="char-form-field">
      <span class="char-form-label">관계 설명</span>
      <input type="text" id="rel-desc" class="char-form-input" maxlength="80" value="${escAttr(desc)}" placeholder="예: 대학 동기">
    </label>`;
}

function readRelationForm() {
  const lineNoRaw = document.getElementById('rel-line-no')?.value;
  return {
    lineNo: lineNoRaw ? Number(lineNoRaw) : undefined,
    type: document.getElementById('rel-type')?.value || 'ally',
    lineWidth: Number(document.getElementById('rel-width')?.value) || 3,
    description: document.getElementById('rel-desc')?.value?.trim() || '',
  };
}

function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

async function openRelationDialog(fromNode, toNode) {
  if (!canEditCharacterGraph()) {
    await showAlert('인물 관계도', '일반 사용자는 관계선을 추가할 수 없습니다. (열람만 가능)');
    draw();
    return;
  }
  let form = {};
  const confirmed = await showDialog({
    title: '관계선 추가',
    bodyHtml: `<p class="autoadd-desc"><strong>${escHtml(fromNode.label)}</strong> ↔ <strong>${escHtml(toNode.label)}</strong></p>${relationFormHtml({ type: 'ally', lineWidth: 3 })}`,
    onConfirm: () => { form = readRelationForm(); },
  });
  if (!confirmed) {
    draw();
    return;
  }

  if (form.lineNo != null && (form.lineNo < 1 || form.lineNo > 100 || Number.isNaN(form.lineNo))) {
    await showAlert('관계선', '라인 번호는 1~100 사이여야 합니다.');
    return;
  }

  const added = await project.addCharacterRelation(fromNode.id, toNode.id, {
    ...form,
    manual: true,
  });
  if (!added) {
    await showAlert('관계선', '이미 연결된 인물이거나 라인 번호가 가득 찼습니다.');
    draw();
    return;
  }
  autosave.markDirty();
  buildAndDraw();
}

async function editRelationDialog(edge) {
  if (!canEditCharacterGraph()) {
    await showAlert('인물 관계도', '일반 사용자는 관계선을 편집할 수 없습니다. (열람만 가능)');
    return;
  }
  const rel = edge.rel || {};
  let form = {};
  let remove = false;
  const confirmed = await showDialog({
    title: `관계선 편집 · L${rel.lineNo || '?'}`,
    bodyHtml: `
      <p class="autoadd-desc"><strong>${escHtml(edge.from.label)}</strong> ↔ <strong>${escHtml(edge.to.label)}</strong></p>
      ${relationFormHtml(rel)}
      <label class="autoadd-row" style="margin-top:12px">
        <input type="checkbox" id="rel-remove">
        <span class="autoadd-name">이 관계선 삭제</span>
      </label>`,
    onConfirm: () => {
      remove = !!document.getElementById('rel-remove')?.checked;
      form = readRelationForm();
    },
  });
  if (!confirmed) return;

  if (remove) {
    await project.removeCharacterRelation(edge.from.id, edge.to.id);
    autosave.markDirty();
    buildAndDraw();
    return;
  }

  if (form.lineNo != null && (form.lineNo < 1 || form.lineNo > 100 || Number.isNaN(form.lineNo))) {
    await showAlert('관계선', '라인 번호는 1~100 사이여야 합니다.');
    return;
  }

  await project.updateCharacterRelation(edge.from.id, edge.to.id, form);
  autosave.markDirty();
  buildAndDraw();
}

async function saveCharacterLayout() {
  if (!canEditCharacterGraph()) {
    await showAlert('인물 관계도', '일반 사용자는 위치를 저장할 수 없습니다. (열람만 가능)');
    return;
  }
  if (mode !== 'character') {
    await showAlert('위치 저장', '인물 관계도 화면에서만 저장할 수 있습니다.');
    return;
  }

  // 이름·직업이 다른 카드/관계선과 겹치지 않도록 카드 분리 + 라벨 방향 재계산
  const nudged = separateOverlappingCharacterCards();
  const layouts = resolveAllCharacterLabels();

  const positions = {};
  for (const n of nodes) {
    if (n.type !== 'character') continue;
    const side = layouts.get(n.id)?.side || sessionLabelSides.get(n.id) || 'below';
    positions[n.id] = { x: n.x, y: n.y, labelSide: side };
    sessionPositions.set(n.id, { x: n.x, y: n.y });
    sessionLabelSides.set(n.id, side);
  }

  const ok = await project.saveCharacterLayout(positions);
  if (!ok) {
    await showAlert('위치 저장', '저장에 실패했습니다.');
    return;
  }
  autosave.markDirty();
  draw();
  const extra = nudged ? ` · 겹침 해소 ${nudged}회` : '';
  await showAlert(
    '위치 저장',
    `인물 ${Object.keys(positions).length}명의 좌표·라벨 방향을 저장했습니다.${extra}`
  );
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
