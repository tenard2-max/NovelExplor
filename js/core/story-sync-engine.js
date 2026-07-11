/** 스토리 → 인물/관계/타임라인 로컬 분석 (외부 API 없음) */

/** 타임라인 사건 키워드 — 구간 추출용 */
export const TIMELINE_KEYWORDS = [
  '붕괴', '회귀', '투자', '만남', '재회', '멸망', '게이트', '진동', '균열',
  '경고', '도망', '생존', '프로젝트', '지진', '무너', '금이', '동기화',
  '전투', '위험', '프로토콜', '자본', '상한가', '시험', '스마트폰', '공학관',
  '벽', '하늘', '돈', '쓰임', '스무 살',
];

/**
 * @param {object} cache
 * @returns {{
 *   episodesSynced: number,
 *   characterCandidates: object[],
 *   characterUpdates: object[],
 *   relationPairs: Array<{fromName,toName,count,episodes}>,
 *   timelineCandidates: object[],
 * }}
 */
export function analyzeStorySync(cache) {
  const episodes = [...(cache.episodes || [])].sort((a, b) => a.number - b.number);
  const characters = cache.characters || [];
  const known = collectKnownNames(characters);

  const nameStats = scanNameStats(episodes, known);
  const characterCandidates = [];
  const characterUpdates = [];

  for (const [name, stat] of nameStats) {
    const epNums = [...stat.episodes].sort((a, b) => a - b);
    const existing = characters.find((c) => c.name === name || (c.alias || []).includes(name));
    if (!existing) {
      if (stat.count >= 3 && (stat.strong >= 1 || stat.count >= 6)) {
        characterCandidates.push({
          name,
          count: stat.count,
          strong: stat.strong,
          episodes: epNums,
          firstEpisode: epNums[0],
          lastEpisode: epNums[epNums.length - 1],
          description: buildCharacterDescription(name, epNums, stat.count),
        });
      }
      continue;
    }

    characterUpdates.push({
      id: existing.id,
      name: existing.name,
      firstEpisode: epNums[0],
      lastEpisode: epNums[epNums.length - 1],
      description: buildCharacterDescription(name, epNums, stat.count),
      count: stat.count,
      prev: {
        firstEpisode: existing.firstEpisode || 0,
        lastEpisode: existing.lastEpisode || 0,
        description: existing.description || '',
      },
    });
  }

  const relationPairs = collectCooccurrencePairs(episodes, characters, nameStats);
  const timelineCandidates = extractTimelineCandidates(episodes);

  return {
    episodesSynced: episodes.length,
    characterCandidates: characterCandidates
      .sort((a, b) => (b.strong - a.strong) || (b.count - a.count))
      .slice(0, 40),
    characterUpdates,
    relationPairs,
    timelineCandidates,
  };
}

function collectKnownNames(characters) {
  const set = new Set();
  for (const c of characters) {
    if (c.name) set.add(c.name.trim());
    for (const a of c.alias || []) if (a) set.add(String(a).trim());
  }
  return set;
}

const PERSON_MARKERS = ['님', '씨', '아', '야'];
const JOSA = ['은', '는', '이', '가', '을', '를', '과', '와', '에게', '한테', '께', '의', '도', '만', '랑', '이랑'];
const SPEECH_VERBS = ['말했', '물었', '외쳤', '대답', '속삭', '중얼', '소리쳤', '대꾸', '되물', '읊조'];
const STOPWORDS = new Set([
  '노인', '도시', '하늘', '목소리', '화면', '순간', '기억', '세상', '인간', '인류', '자신', '생각',
  '사람', '사람들', '우리', '당신', '그녀', '그들', '이것', '그것', '저것', '여기', '저기', '거기',
  '지금', '오늘', '내일', '어제', '정말', '진짜', '물론', '결국', '갑자기', '천천히', '조용', '고요',
  '스마트폰', '자동차', '강의실', '형광등', '프로젝트', '시나리오', '확률', '생존', '경고', '침묵',
  '얼굴', '마지막', '처음', '다시', '모든', '하나', '자리', '소리', '눈물', '심장', '주머니', '목표',
  '시간', '이유', '문제', '정도', '동안', '때문', '이제', '그때', '어디', '누구', '무엇', '무슨',
  '조금', '아주', '매우', '그리고', '하지만', '그러나', '그런데', '왜냐', '어쩌면', '아마', '역시',
  '모두', '전부', '서로', '혼자', '함께', '이번', '다음', '이런', '저런', '그런', '무언가', '누군가',
  '분위기', '표정', '눈빛', '머리', '가슴', '어깨', '손끝', '발끝', '입술', '이마', '온몸', '두개골',
  '공학관', '세미나', '회의실', '출입문', '콘크리트',
]);

function scanNameStats(episodes, known = new Set()) {
  const freq = new Map();
  const strong = new Map();
  const epsMap = new Map();
  const markerAlt = [...PERSON_MARKERS, ...JOSA].sort((a, b) => b.length - a.length).join('|');
  const tokenRe = new RegExp(`([가-힣]{2,4})(${markerAlt})`, 'g');
  const speechRe = new RegExp(
    `([가-힣]{2,4})(?:은|는|이|가)?\\s*[^\\n]{0,6}?(?:${SPEECH_VERBS.join('|')})`,
    'g'
  );
  const bump = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);

  for (const ep of episodes) {
    const text = ep.content || '';
    const num = ep.number;
    let m;
    while ((m = tokenRe.exec(text)) !== null) {
      const name = m[1];
      if (STOPWORDS.has(name)) continue;
      bump(freq, name);
      if (PERSON_MARKERS.includes(m[2])) bump(strong, name);
      if (!epsMap.has(name)) epsMap.set(name, new Set());
      epsMap.get(name).add(num);
    }
    while ((m = speechRe.exec(text)) !== null) {
      const name = m[1];
      if (STOPWORDS.has(name)) continue;
      bump(strong, name, 2);
      if (!epsMap.has(name)) epsMap.set(name, new Set());
      epsMap.get(name).add(num);
    }
  }

  const out = new Map();
  for (const [name, count] of freq) {
    out.set(name, {
      count,
      strong: strong.get(name) || 0,
      episodes: epsMap.get(name) || new Set(),
    });
  }

  // 이미 등록된 인물명: 본문 단순 포함만으로도 EP 범위·언급 수 갱신
  for (const ep of episodes) {
    const text = ep.content || '';
    for (const name of known) {
      if (!name || name.length < 2 || !text.includes(name)) continue;
      if (!out.has(name)) {
        out.set(name, { count: 0, strong: 0, episodes: new Set() });
      }
      const row = out.get(name);
      row.count += 1;
      row.episodes.add(ep.number);
    }
  }

  return out;
}

function buildCharacterDescription(name, epNums, count) {
  const range = epNums.length > 1
    ? `EP${epNums[0]}~EP${epNums[epNums.length - 1]}`
    : `EP${epNums[0] || '?'}`;
  return `스토리 동기화 · ${range} · 언급 ${count}회`;
}

/** 연속 EP를 EP1~EP11, EP14 형식으로 압축 */
export function formatEpisodeRanges(epNums = []) {
  const sorted = [...new Set(epNums.map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
  if (!sorted.length) return '—';
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
      continue;
    }
    parts.push(start === prev ? `EP${start}` : `EP${start}~EP${prev}`);
    start = prev = sorted[i];
  }
  parts.push(start === prev ? `EP${start}` : `EP${start}~EP${prev}`);
  return parts.join(', ');
}

/** 스토리(ST/EP) 본문 기준 인물별 등장 EP · 등장 횟수 순 */
export function collectMultiverseRows(cache) {
  const sources = getStoryScanSources(cache);
  const characters = cache.characters || [];
  const known = collectKnownNames(characters);
  const stats = scanNameStats(sources, known);

  return characters
    .filter((ch) => ch?.name)
    .map((ch) => {
      const names = [ch.name, ...(ch.alias || [])].filter(Boolean);
      let count = 0;
      const eps = new Set();
      for (const name of names) {
        const st = stats.get(name);
        if (!st) continue;
        count += st.count;
        for (const e of st.episodes) eps.add(e);
      }
      if (!eps.size) {
        const a = Number(ch.firstEpisode) || 0;
        const b = Number(ch.lastEpisode) || a;
        if (a > 0) {
          for (let i = a; i <= b; i += 1) eps.add(i);
          count = Math.max(count, eps.size);
        }
      }
      const episodes = [...eps].sort((a, b) => a - b);
      return {
        id: ch.id,
        name: ch.name,
        count,
        episodes,
        rangesLabel: formatEpisodeRanges(episodes),
        data: ch,
      };
    })
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'ko'));
}

/** ST·EP 중 더 긴 본문을 화수별로 선택 */
function getStoryScanSources(cache) {
  const byNum = new Map();
  for (const st of cache.stories || []) {
    const num = Number(st.number) || 0;
    if (!num) continue;
    byNum.set(num, { number: num, content: st.content || '' });
  }
  for (const ep of cache.episodes || []) {
    const num = Number(ep.number) || 0;
    if (!num) continue;
    const prev = byNum.get(num);
    const epContent = ep.content || '';
    if (!prev || epContent.length >= (prev.content || '').length) {
      byNum.set(num, { number: num, content: epContent });
    }
  }
  return [...byNum.values()].sort((a, b) => a.number - b.number);
}

function collectCooccurrencePairs(episodes, characters, nameStats) {
  const names = new Set(characters.map((c) => c.name).filter(Boolean));
  for (const [name, stat] of nameStats) {
    if (stat.count >= 3 && (stat.strong >= 1 || stat.count >= 6)) names.add(name);
  }
  const nameList = [...names];
  const pairMap = new Map();

  for (const ep of episodes) {
    const text = ep.content || '';
    const present = nameList.filter((n) => text.includes(n));
    for (let i = 0; i < present.length; i += 1) {
      for (let j = i + 1; j < present.length; j += 1) {
        const a = present[i];
        const b = present[j];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (!pairMap.has(key)) {
          pairMap.set(key, { fromName: a < b ? a : b, toName: a < b ? b : a, count: 0, episodes: [] });
        }
        const row = pairMap.get(key);
        row.count += 1;
        if (!row.episodes.includes(ep.number)) row.episodes.push(ep.number);
      }
    }
  }

  return [...pairMap.values()]
    .filter((p) => p.count >= 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 80);
}

/**
 * 키워드가 있는 에피소드만 타임라인 후보로 추출 — EP당 1건
 * date = 년월일, title = 에피소드 제목 또는 키워드 요약
 */
export function extractTimelineCandidates(episodes) {
  const results = [];
  const kwAlt = [...TIMELINE_KEYWORDS].sort((a, b) => b.length - a.length).join('|');
  const kwRe = new RegExp(kwAlt, 'g');

  for (const ep of episodes) {
    const text = ep.content || '';
    if (!text.trim()) continue;

    const blocks = text
      .split(/\n{2,}|^---+$/m)
      .map((b) => b.trim())
      .filter(Boolean);

    const allKeywords = new Set();
    let bestDate = '';

    for (const block of blocks) {
      const hits = [...block.matchAll(kwRe)].map((m) => m[0]);
      if (!hits.length) continue;
      hits.forEach((h) => allKeywords.add(h));
      const d = extractDateFromText(block);
      if (d && !bestDate) bestDate = d;
    }

    if (!allKeywords.size) continue;

    const keywords = [...allKeywords];
    const date = bestDate || episodeFallbackDate(ep.number);
    const epTitle = String(ep.title || '').trim();
    const title = epTitle && !/^EP\s*\d+/i.test(epTitle)
      ? epTitle
      : keywords.slice(0, 3).join('·');

    results.push({
      episode: ep.number,
      title,
      date,
      description: '',
      keywords,
      source: 'story-sync',
    });
  }

  return results;
}

/** EP당 1건으로 정리 (날짜·제목 품질 우선) */
export function dedupeTimelineByEpisode(timeline = []) {
  const byEp = new Map();
  for (const t of timeline) {
    const ep = Number(t.episode) || 0;
    const prev = byEp.get(ep);
    if (!prev) {
      byEp.set(ep, t);
      continue;
    }
    if (timelineEntryScore(t) > timelineEntryScore(prev)) byEp.set(ep, t);
  }
  return [...byEp.values()].sort((a, b) => a.episode - b.episode);
}

function timelineEntryScore(t) {
  let s = 0;
  if (t.date && /^\d{4}-\d{2}-\d{2}$/.test(String(t.date))) s += 3;
  const title = String(t.title || '').trim();
  if (title && !/^\d{4}-\d{2}-\d{2}$/.test(title) && title !== t.date) s += 2;
  if ((t.keywords || []).length) s += 1;
  return s;
}

/** 표시용 년월일·제목 (한 줄) */
export function timelineDisplayParts(t) {
  const date = t.date && /^\d{4}-\d{2}-\d{2}$/.test(String(t.date))
    ? t.date
    : (/^\d{4}-\d{2}-\d{2}$/.test(String(t.title || '')) ? t.title : '—');
  let title = String(t.title || '').trim();
  if (!title || /^\d{4}-\d{2}-\d{2}$/.test(title) || title === date) {
    title = (t.keywords || []).slice(0, 3).join('·') || '사건';
  }
  return { date, title };
}

/** 본문에서 YYYY-MM-DD / 2024년 3월 15일 등 추출 */
export function extractDateFromText(text = '') {
  const s = String(text || '');
  const iso = s.match(/(20\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (iso) return formatYmd(iso[1], iso[2], iso[3]);
  const kor = s.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (kor) return formatYmd(kor[1], kor[2], kor[3]);
  const korYm = s.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월/);
  if (korYm) return formatYmd(korYm[1], korYm[2], '1');
  return '';
}

function formatYmd(y, m, d) {
  const yy = String(y).padStart(4, '0');
  const mm = String(Number(m)).padStart(2, '0');
  const dd = String(Number(d)).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** 본문에 날짜가 없을 때 EP 번호 기반 표시용 날짜 */
function episodeFallbackDate(episodeNumber) {
  const n = Math.max(1, Number(episodeNumber) || 1);
  // 2024-01-01 부터 EP마다 7일 간격
  const base = Date.UTC(2024, 0, 1);
  const dt = new Date(base + (n - 1) * 7 * 24 * 60 * 60 * 1000);
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function truncate(s, max) {
  const t = String(s || '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** 인물 카드 MD 본문 생성 */
export function buildCharacterCardMarkdown(ch, relations = []) {
  const cid = ch.characterId || String(ch.id || '').split('-').pop() || 'CHR0000';
  const relRows = relations.map((r) =>
    `| ${r.lineNo || '-'} | ${r.otherName || ''} | ${r.type || 'ally'} | ${r.lineWidth || 3} | ${r.description || ''} |`
  ).join('\n');

  return `# 인물 카드 · ${ch.name || cid}

| 항목 | 값 |
|------|-----|
| characterId | ${cid} |
| 이름 | ${ch.name || ''} |
| 종족 | ${ch.race || '인간'} |
| 성별 | ${ch.gender || ''} |
| 나이 | ${ch.age || ''} |
| 직업 | ${ch.occupation || ''} |
| 상태 | ${ch.status || 'Alive'} |
| 첫 등장 | EP${ch.firstEpisode || '?'} |
| 마지막 | EP${ch.lastEpisode || '?'} |

## 한 줄 소개
${ch.description || '(스토리 동기화로 갱신됨)'}

## 관계도
| lineNo | 상대 | type | lineWidth | description |
|--------|------|------|-----------|-------------|
${relRows || '| - | - | - | - | - |'}

## 대표 이미지
\`overlays/characters/${cid}.png\`
`;
}

/** 타임라인 → 05_TIMELINE.md (EP당 1줄 · 년월일 + 제목) */
export function buildTimelineMarkdown(timeline = []) {
  const rows = dedupeTimelineByEpisode(timeline)
    .map((t) => {
      const ep = `EP${String(t.episode).padStart(3, '0')}`;
      const { date, title } = timelineDisplayParts(t);
      return `${ep}  ${date}  ${title}`;
    });

  return `# 05_TIMELINE

> EP당 1건 · 년월일 + 제목 · 스토리 동기화 · ${new Date().toISOString()}

${rows.join('\n') || '(사건 없음)'}
`;
}

/** 에피소드 본문에서 짧은 요약 생성 (로컬, API 없음) */
export function buildEpisodeSummary(content = '', title = '') {
  const raw = String(content || '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/^#+\s+.+$/gm, '')
    .replace(/\r/g, '')
    .trim();
  if (!raw) return title ? `${title} 요약 없음` : '요약 없음';

  const paras = raw
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 12);

  const pick = paras.slice(0, 3).join(' ');
  const text = pick || raw.replace(/\s+/g, ' ');
  const clipped = text.length > 280 ? `${text.slice(0, 279)}…` : text;
  return formatSummaryLineBreaks(clipped);
}

/** 문장 구분(.)마다 개행 — 스토리 네비 요약 가독성 */
export function formatSummaryLineBreaks(text = '') {
  return String(text || '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\.{2,}/g, '…') // 말줄임은 한 덩어리로
    .replace(/\.\s*/g, '.\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** 스토리 네비 → 11_STORY_NAV.md */
export function buildStoryNavMarkdown(episodes = []) {
  const blocks = [...episodes]
    .sort((a, b) => a.number - b.number)
    .map((ep) => {
      const id = `EP${String(ep.number).padStart(3, '0')}`;
      const summary = ep.summary || buildEpisodeSummary(ep.content, ep.title);
      return `## ${id} · ${ep.title || id}

- 파일: \`${ep.textFile || `${id}.md`}\`
- 요약: ${summary}
`;
    });

  return `# 11_STORY_NAV

> ST→EP 동기화 · 에피소드 요약 · ${new Date().toISOString()}

${blocks.join('\n') || '(에피소드 없음)'}
`;
}
