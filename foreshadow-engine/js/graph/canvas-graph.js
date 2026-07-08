/** Canvas 그래프 렌더러 */

import { on } from '../core/events.js';
import * as project from '../core/project.js';
import { openCharacterPanel, openImageLightbox } from '../ui/character-panel.js';

const GRADE_COLORS = {
  F: '#6b7280', D: '#60a5fa', C: '#4ade80', B: '#facc15',
  A: '#fb923c', S: '#c084fc', SS: '#f472b6', SSS: '#f87171',
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
const avatarImages = new Map();
const CLICK_THRESHOLD = 6;
const DBLCLICK_MS = 280;
const AVATAR_NODE_R = 150; // 이미지 등록된 노드: 300x300
let pendingClickTimer = null;
let lastClick = { id: null, time: 0 };
const CHARACTER_GRAPH = {
  centerR: 56,
  outerR: 48,
  layoutScale: 0.58,
  labelGap: 24,
  subGap: 28,
};

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
    if (isGraphVisible()) buildAndDraw();
  });

  on('character:updated', () => {
    if (isGraphVisible() && mode === 'character') buildAndDraw();
  });

  on('character:deleted', () => {
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
  if (filter) filter.hidden = !show;
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
  nodes = [];
  edges = [];
  const filter = document.getElementById('graph-filter')?.value || 'all';

  if (mode === 'foreshadow') {
    buildForeshadowGraph(cache, filter);
    renderLegend('복선 등급별 노드 · 인물 연결선');
  } else if (mode === 'character') {
    const legend = buildCharacterGraph(cache);
    renderLegend(legend);
  } else if (mode === 'timeline') {
    buildTimelineGraph(cache);
    renderLegend('화수 순 타임라인 · 사건 노드');
  }

  draw();
  updateStatus();
}

function buildForeshadowGraph(cache, filter) {
  const foreshadows = cache.foreshadows.filter((f) =>
    filter === 'all' || f.status === filter
  );

  const cx = canvas.clientWidth / 2;
  const cy = canvas.clientHeight / 2;
  const radius = Math.min(cx, cy) * 0.55;

  foreshadows.forEach((fs, i) => {
    const angle = (i / Math.max(foreshadows.length, 1)) * Math.PI * 2 - Math.PI / 2;
    nodes.push({
      id: fs.id,
      label: fs.title,
      sub: fs.grade,
      color: GRADE_COLORS[fs.grade] || '#888',
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      r: fs.grade === 'SSS' || fs.grade === 'SS' ? 28 : 22,
      data: fs,
      type: 'foreshadow',
    });
  });

  cache.characters.forEach((ch, i) => {
    const angle = (i / Math.max(cache.characters.length, 1)) * Math.PI * 2;
    const cr = radius * 0.35;
    nodes.push({
      id: ch.id,
      label: ch.name,
      sub: ch.race || '',
      color: '#38bdf8',
      x: cx + Math.cos(angle) * cr,
      y: cy + Math.sin(angle) * cr,
      r: 18,
      data: ch,
      type: 'character',
    });
  });

  for (const fs of foreshadows) {
    for (const cid of fs.relatedCharacters || []) {
      const charNode = findCharacterNode(nodes, cid);
      const fsNode = nodes.find((n) => n.id === fs.id);
      if (charNode && fsNode) edges.push({ from: fsNode, to: charNode, color: 'rgba(108,140,255,0.4)' });
    }
  }
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

function buildCharacterGraph(cache) {
  const characters = cache.characters || [];
  const cx = canvas.clientWidth / 2;
  const cy = canvas.clientHeight / 2;
  const hasAvatars = characters.some((c) => c.avatarDataUrl);
  const radius = Math.min(cx, cy) * (hasAvatars ? 0.82 : CHARACTER_GRAPH.layoutScale);
  const index = buildCharacterIndex(characters);

  if (!characters.length) {
    return '인물 데이터가 없습니다 — Character DB를 확인하세요.';
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

  const protagonist = characters.find((ch) => ch.name === '주인공')
    || characters.find((ch) => (ch.name || '').includes('주인공'))
    || characters[0];

  const others = characters.filter((ch) => ch.id !== protagonist.id);
  nodes.push({
    id: protagonist.id,
    label: protagonist.name,
    sub: protagonist.occupation || '',
    color: protagonist.status === 'Dead' ? '#f87171' : '#6c8cff',
    x: cx,
    y: cy,
    r: protagonist.avatarDataUrl ? AVATAR_NODE_R : CHARACTER_GRAPH.centerR,
    shape: protagonist.avatarDataUrl ? 'square' : 'circle',
    data: protagonist,
    type: 'character',
  });

  others.forEach((ch, i) => {
    const angle = (i / Math.max(others.length, 1)) * Math.PI * 2 - Math.PI / 2;
    nodes.push({
      id: ch.id,
      label: ch.name,
      sub: ch.occupation || '',
      color: ch.status === 'Dead' ? '#f87171' : '#6c8cff',
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      r: ch.avatarDataUrl ? AVATAR_NODE_R : CHARACTER_GRAPH.outerR,
      shape: ch.avatarDataUrl ? 'square' : 'circle',
      data: ch,
      type: 'character',
    });
  });

  for (const [key, weight] of pairs) {
    const [idA, idB] = key.split('|');
    const na = nodes.find((n) => n.id === idA);
    const nb = nodes.find((n) => n.id === idB);
    if (!na || !nb) continue;
    if (hasEdgeBetween(na.id, nb.id)) continue;
    edges.push({
      from: na,
      to: nb,
      color: `rgba(139,92,246,${Math.min(0.3 + weight * 0.12, 0.85)})`,
      lineWidth: Math.min(1 + weight * 0.6, 4),
      weight,
      manual: false,
    });
  }

  for (const rel of cache.characterRelations || []) {
    const na = nodes.find((n) => n.id === rel.fromId);
    const nb = nodes.find((n) => n.id === rel.toId);
    if (!na || !nb) continue;
    if (hasEdgeBetween(na.id, nb.id)) continue;
    edges.push({
      from: na,
      to: nb,
      color: 'rgba(251,191,36,0.75)',
      lineWidth: 2.5,
      manual: true,
    });
  }

  for (const n of nodes) preloadAvatar(n);

  const manualCount = (cache.characterRelations || []).length;
  const baseLegend = manualCount
    ? `클릭: 상세·이미지 · 더블클릭: 원본 · Shift+드래그: 연결 (수동 ${manualCount})`
    : '클릭: 상세·이미지 · 더블클릭: 원본 · Shift+드래그: 연결';

  if (!edges.length) {
    return `${baseLegend} · 자동 연결 데이터 없음`;
  }

  if (source === 'timeline') return `${baseLegend} · 타임라인 공동 등장`;
  if (source === 'episode') return `${baseLegend} · EP/ST 본문 공동 등장`;
  return `${baseLegend} · 등장 화수 겹침`;
}

function hasEdgeBetween(idA, idB) {
  const key = pairKey(idA, idB);
  return edges.some((e) => pairKey(e.from.id, e.to.id) === key);
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
  const items = [...cache.timeline].sort((a, b) => a.episode - b.episode);
  const step = items.length > 1 ? (w - padding * 2) / (items.length - 1) : 0;

  items.forEach((ev, i) => {
    nodes.push({
      id: ev.id,
      label: ev.title,
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
    ctx.beginPath();
    ctx.moveTo(e.from.x, e.from.y);
    ctx.lineTo(e.to.x, e.to.y);
    ctx.stroke();
  }

  if (connectingFrom && connectPointer) {
    ctx.strokeStyle = 'rgba(251,191,36,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(connectingFrom.x, connectingFrom.y);
    ctx.lineTo(connectPointer.x, connectPointer.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const n of nodes) {
    drawNode(n);
  }

  ctx.restore();
}

function drawNode(n) {
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
      // contain: 원본 일러스트가 잘리지 않도록 전체 표시
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

    const nameY = cy + r + 16;
    ctx.fillStyle = '#fff';
    ctx.font = '700 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(truncate(n.label, 12), cx, nameY);
    if (n.sub) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '16px sans-serif';
      ctx.fillText(truncate(n.sub, 18), cx, nameY + 28);
    }
    return;
  }

  const strokeW = isCharacter ? 3 : 2;
  const subOffset = isCharacter ? 20 : 10;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = n.color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = strokeW;
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = `600 ${Math.max(isCharacter ? 18 : 10, r * 0.45)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(truncate(n.label, 8), cx, cy);

  if (n.sub) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `${Math.max(isCharacter ? 14 : 8, r * 0.32)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(n.sub, cx, Math.round(cy + r + subOffset));
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

  if (hit && mode === 'character' && hit.type === 'character' && e.shiftKey) {
    connectingFrom = hit;
    connectPointer = { x: wx, y: wy };
    dragNode = null;
    dragging = null;
    pointerState = null;
    return;
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
    draw();
  } else if (dragging) {
    panX = e.clientX - dragging.x;
    panY = e.clientY - dragging.y;
    draw();
  }
}

async function onMouseUp(e) {
  if (connectingFrom) {
    const rect = canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left - panX) / zoom;
    const wy = (e.clientY - rect.top - panY) / zoom;
    const target = hitTest(wx, wy);

    if (target && target.type === 'character' && target.id !== connectingFrom.id) {
      const added = await project.addCharacterRelation(connectingFrom.id, target.id);
      if (added) buildAndDraw();
      else draw();
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
