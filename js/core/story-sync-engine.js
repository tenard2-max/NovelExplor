/** 스토리 → 인물/관계/타임라인 로컬 분석 (외부 API 없음) */

/** 타임라인 사건 키워드 — 구간 추출용 */
export const TIMELINE_KEYWORDS = [
  '붕괴', '회귀', '투자', '만남', '재회', '멸망', '게이트', '진동', '균열',
  '경고', '도망', '생존', '프로젝트', '지진', '무너', '금이', '동기화',
  '전투', '위험', '프로토콜', '자본', '상한가',
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
 * 키워드가 있는 문단/구간만 타임라인 후보로 추출
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

    const matched = [];
    for (const block of blocks) {
      const hits = [...block.matchAll(kwRe)].map((m) => m[0]);
      if (!hits.length) continue;
      const uniq = [...new Set(hits)];
      const firstLine = block.split(/\n/).find((l) => l.trim()) || '';
      const title = truncate(
        firstLine.replace(/^#+\s*/, '').replace(/^제?\d+화[.\s]*/, '').trim() || uniq.join('·'),
        40
      );
      matched.push({
        episode: ep.number,
        title,
        description: truncate(block.replace(/\s+/g, ' '), 120),
        keywords: uniq,
        source: 'story-sync',
      });
    }

    if (!matched.length) continue;

    // 화당 과도한 후보 제한: 키워드 다양성 높은 상위 3개
    matched.sort((a, b) => b.keywords.length - a.keywords.length);
    results.push(...matched.slice(0, 3));
  }

  return results;
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
