/** Canvas 그래프 렌더러 */

import { on } from '../core/events.js';
import * as project from '../core/project.js';
import * as autosave from '../core/autosave.js';
import { openCharacterPanel, openImageLightbox } from '../ui/character-panel.js';
import { showDialog, showAlert } from '../ui/dialog.js';
import { dedupeTimelineByEpisode, timelineDisplayParts } from '../core/story-sync-engine.js';

const GRADE_COLORS = {
  F: '#6b7280', D: '#60a5fa', C: '#4ade80', B: '#facc15',
  A: '#fb923c', S: '#c084fc', SS: '#f472b6', SSS: '#f87171',
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
    ?.addEventListener('click', () => saveCharacterLayout().catch(console.error));
  document.querySelector('[data-action="graph-add-link"]')
    ?.addEventListener('click', () => toggleLinkAddMode());

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
  if (!show) cancelLinkAddMode();
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
    renderLegend('좌: 인물 · 우: 복선 · 연관 직교 연결');
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
    buildTimelineGraph(cache);
    if (gen !== buildGeneration) return;
    renderLegend('화수 순 타임라인 · 사건 노드');
    draw();
    updateStatus();
  }
}

/**
 * 복선 그래프 — 좌(인물) / 우(복선) 사다리(이분) 배치.
 * 연관 인물↔복선은 여러 직교 선으로 연결하며, 노드끼리 겹치지 않게 세로로 나열한다.
 */
function buildForeshadowGraph(cache, filter) {
  const foreshadows = cache.foreshadows.filter((f) =>
    filter === 'all' || f.status === filter
  );
  const characters = cache.characters || [];

  const w = canvas.clientWidth || 800;
  const h = canvas.clientHeight || 600;
  const padX = Math.max(90, w * 0.14);
  const padY = Math.max(56, h * 0.08);
  const leftX = padX;
  const rightX = w - padX;
  const minGap = 72;

  // relatedCharacters 링크 (캐릭터 id / characterId / 이름 모두 허용)
  const links = [];
  const tempIndex = buildCharacterIndex(characters);
  for (const fs of foreshadows) {
    for (const ref of fs.relatedCharacters || []) {
      const ch = resolveCharacter(ref, tempIndex);
      if (ch) links.push({ charId: ch.id, fsId: fs.id });
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
    nodes.push({
      id: ch.id,
      label: ch.name,
      sub: ch.race || '',
      color: '#38bdf8',
      x: leftX,
      y: orderedChars.length === 1 ? h / 2 : padY + charStep * i,
      r: 18,
      data: ch,
      type: 'character',
    });
  });

  orderedFs.forEach((fs, i) => {
    nodes.push({
      id: fs.id,
      label: fs.title,
      sub: fs.grade,
      color: GRADE_COLORS[fs.grade] || '#888',
      x: rightX,
      y: orderedFs.length === 1 ? h / 2 : padY + fsStep * i,
      r: fs.grade === 'SSS' || fs.grade === 'SS' ? 28 : 22,
      data: fs,
      type: 'foreshadow',
    });
  });

  // from=인물(좌) → to=복선(우) — 한 인물이 여러 복선에, 한 복선이 여러 인물에 연결 가능
  let edgeIdx = 0;
  for (const link of links) {
    const charNode = nodes.find((n) => n.id === link.charId && n.type === 'character');
    const fsNode = nodes.find((n) => n.id === link.fsId && n.type === 'foreshadow');
    if (charNode && fsNode) {
      edges.push({
        from: charNode,
        to: fsNode,
        color: 'rgba(108,140,255,0.45)',
        lane: edgeIdx++,
      });
    }
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
  const hasAvatars = characters.some((c) => c.avatarDataUrl);
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
    r: protagonist.avatarDataUrl ? AVATAR_NODE_R : CHARACTER_GRAPH.centerR,
    shape: protagonist.avatarDataUrl ? 'square' : 'circle',
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
      r: ch.avatarDataUrl ? AVATAR_NODE_R : CHARACTER_GRAPH.outerR,
      shape: ch.avatarDataUrl ? 'square' : 'circle',
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
    : '줄 추가 버튼 또는 Shift+드래그로 연결 · 선 클릭: 편집';
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
  const url = node.data?.avatarDataUrl;
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

function buildTimelineGraph(cache) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const padding = 60;
  const items = dedupeTimelineByEpisode(cache.timeline || []);
  const step = items.length > 1 ? (w - padding * 2) / (items.length - 1) : 0;

  items.forEach((ev, i) => {
    const { date, title } = timelineDisplayParts(ev);
    nodes.push({
      id: ev.id,
      label: `${date} ${truncate(title, 10)}`,
      sub: `EP${ev.episode}`,
      color: '#34d399',
      x: padding + step * i,
      y: h / 2 + (i % 2 === 0 ? -50 : 50),
      r: 20,
      data: ev,
      type: 'timeline',
    });
  });

  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i], to: nodes[i + 1], color: 'rgba(52,211,153,0.5)' });
  }
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
    ctx.lineWidth = e.lineWidth || 1.5;
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
 * 복선 사다리 연결선 — 인물(좌) 오른쪽 가장자리 → 복선(우) 왼쪽 가장자리.
 * 중간 세로 레인으로 직교 경로를 잡아 노드 원과 겹치지 않게 한다.
 */
function getForeshadowEdgePath(e) {
  const left = e.from.x <= e.to.x ? e.from : e.to;
  const right = e.from.x <= e.to.x ? e.to : e.from;
  const lr = left.r || 18;
  const rr = right.r || 22;
  const x0 = left.x + lr + 2;
  const x1 = right.x - rr - 2;
  const y0 = left.y;
  const y1 = right.y;
  const span = Math.max(40, x1 - x0);
  // 여러 선이 같은 세로축에 겹치지 않도록 레인 오프셋
  const lane = Number(e.lane) || 0;
  const midX = x0 + span * (0.28 + ((lane % 7) / 7) * 0.44);

  if (Math.abs(y0 - y1) <= 6) {
    return [
      { x: x0, y: y0 },
      { x: x1, y: y1 },
    ];
  }

  return [
    { x: x0, y: y0 },
    { x: midX, y: y0 },
    { x: midX, y: y1 },
    { x: x1, y: y1 },
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
  const hasAvatar = isCharacter && n.data?.avatarDataUrl;
  const img = hasAvatar ? avatarImages.get(n.id) : null;
  const avatarReady = img && img.complete && img.naturalWidth > 0;
  const cx = Math.round(n.x);
  const cy = Math.round(n.y);
  const r = n.r;

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
    el.innerHTML = `<div>${text}</div>` + Object.entries(GRADE_COLORS).map(([g, c]) =>
      `<span style="color:${c}">● ${g}</span>`
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

  if (linkAddMode && mode === 'character') {
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

  if (hit && mode === 'character' && hit.type === 'character' && e.shiftKey) {
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
      pointerState = { sx: e.clientX, sy: e.clientY, edge: edgeHit };
      dragNode = null;
      dragging = null;
      return;
    }
  }

  if (hit) {
    dragNode = hit;
    pointerState = { sx: e.clientX, sy: e.clientY };
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
    connectPointer = { x: wx, y: wy };
    draw();
    return;
  }

  if (dragNode) {
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
    const dx = e.clientX - pointerState.sx;
    const dy = e.clientY - pointerState.sy;
    if (dx * dx + dy * dy <= CLICK_THRESHOLD * CLICK_THRESHOLD) {
      await editRelationDialog(pointerState.edge);
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
    const url = node.data?.avatarDataUrl;
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
    if (n.shape === 'square') {
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
  linkAddMode = !linkAddMode;
  linkPickFirst = null;
  connectingFrom = null;
  connectPointer = null;
  const btn = document.querySelector('[data-action="graph-add-link"]');
  if (btn) btn.classList.toggle('is-active', linkAddMode);
  if (isGraphVisible() && mode === 'character') buildAndDraw();
  else draw();
}

function cancelLinkAddMode() {
  linkAddMode = false;
  linkPickFirst = null;
  connectingFrom = null;
  connectPointer = null;
  document.querySelector('[data-action="graph-add-link"]')?.classList.remove('is-active');
}

async function finishLinkAdd(fromNode, toNode) {
  connectingFrom = null;
  connectPointer = null;
  linkPickFirst = null;
  await openRelationDialog(fromNode, toNode);
  cancelLinkAddMode();
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
