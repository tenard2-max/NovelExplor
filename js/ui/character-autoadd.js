/** 인물 자동추가 — EP 본문을 스캔해 등장인물 후보를 추출하고, 검토 후 등록 */

import * as project from '../core/project.js';
import * as autosave from '../core/autosave.js';
import { showDialog, showAlert } from './dialog.js';

// 이름 뒤에 붙는 '사람'을 강하게 시사하는 호칭/호격
const PERSON_MARKERS = ['님', '씨', '아', '야'];
// 이름 뒤에 흔히 붙는 조사 (약한 신호)
const JOSA = ['은', '는', '이', '가', '을', '를', '과', '와', '에게', '한테', '께', '의', '도', '만', '랑', '이랑'];
// 대화 귀속 동사 (이름이 화자일 가능성)
const SPEECH_VERBS = ['말했', '물었', '외쳤', '대답', '속삭', '중얼', '소리쳤', '대꾸', '되물', '읊조'];

// 조사/호칭 앞에 자주 오지만 인명이 아닌 일반어 (오검출 차단용)
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
]);

export function initCharacterAutoAdd() {
  document.querySelector('[data-action="character-autoadd"]')
    ?.addEventListener('click', runAutoAdd);
}

async function runAutoAdd() {
  const cache = project.getCache();
  const episodes = cache.episodes || [];
  if (!episodes.length) {
    await showAlert('인물 자동추가', 'EP 문서가 없습니다. 먼저 EP 문서를 등록하세요.');
    return;
  }

  const known = collectKnownNames(cache.characters || []);
  const candidates = detectCandidates(episodes, known);

  if (!candidates.length) {
    await showAlert('인물 자동추가', 'EP 문서에서 새로 추가할 인물 후보를 찾지 못했습니다.');
    return;
  }

  const rows = candidates.map((c, i) => `
    <label class="autoadd-row">
      <input type="checkbox" class="autoadd-check" value="${i}" checked>
      <span class="autoadd-name">${esc(c.name)}</span>
      <span class="autoadd-meta">${c.count}회 · EP${c.episodes[0]}~${c.episodes[c.episodes.length - 1]}</span>
    </label>`).join('');

  const bodyHtml = `
    <p class="autoadd-desc">EP 본문에서 감지한 인물 후보입니다. 추가할 항목을 선택하세요.</p>
    <div class="autoadd-list">${rows}</div>`;

  let selected = [];
  const confirmed = await showDialog({
    title: `인물 자동추가 — 후보 ${candidates.length}명`,
    bodyHtml,
    onConfirm: () => {
      selected = Array.from(document.querySelectorAll('.autoadd-check:checked'))
        .map((el) => candidates[Number(el.value)])
        .filter(Boolean);
    },
  });

  if (!confirmed || !selected.length) return;

  let added = 0;
  for (const c of selected) {
    const rec = await project.addCharacter({
      name: c.name,
      description: `EP 자동 감지 (${c.count}회 언급)`,
      firstEpisode: c.episodes[0],
      lastEpisode: c.episodes[c.episodes.length - 1],
    });
    if (rec) added += 1;
  }

  if (added) autosave.markDirty();
  await showAlert('인물 자동추가', `${added}명을 인물로 추가했습니다.`);
}

function collectKnownNames(characters) {
  const set = new Set();
  for (const c of characters) {
    if (c.name) set.add(c.name.trim());
    for (const a of c.alias || []) if (a) set.add(String(a).trim());
  }
  return set;
}

/**
 * EP 본문에서 인명 후보를 추출한다.
 * - 이름(한글 2~4자) 뒤에 조사/호칭이 붙는 패턴을 수집해 빈도를 센다.
 * - 호격/호칭(님/씨/아/야) 또는 대화 귀속 동사와 함께 나오면 '강한 신호'로 가산한다.
 * - 이미 등록된 이름·불용어는 제외하고, 빈도·신호 기준을 넘는 후보만 반환한다.
 */
function detectCandidates(episodes, known) {
  const freq = new Map();     // 이름 -> 총 등장(조사/호칭 동반) 횟수
  const strong = new Map();   // 이름 -> 강한 인명 신호 횟수
  const epsMap = new Map();   // 이름 -> 등장 EP 번호 Set

  const markerAlt = [...PERSON_MARKERS, ...JOSA]
    .sort((a, b) => b.length - a.length)
    .join('|');
  const tokenRe = new RegExp(`([가-힣]{2,4})(${markerAlt})`, 'g');
  const speechRe = new RegExp(
    `([가-힣]{2,4})(?:은|는|이|가)?\\s*[^\\n]{0,6}?(?:${SPEECH_VERBS.join('|')})`, 'g'
  );

  const bump = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);

  for (const ep of episodes) {
    const text = ep.content || '';
    const num = ep.number;

    let m;
    while ((m = tokenRe.exec(text)) !== null) {
      const name = m[1];
      if (STOPWORDS.has(name) || known.has(name)) continue;
      bump(freq, name);
      if (PERSON_MARKERS.includes(m[2])) bump(strong, name);
      if (!epsMap.has(name)) epsMap.set(name, new Set());
      epsMap.get(name).add(num);
    }

    while ((m = speechRe.exec(text)) !== null) {
      const name = m[1];
      if (STOPWORDS.has(name) || known.has(name)) continue;
      bump(strong, name, 2);
      if (!epsMap.has(name)) epsMap.set(name, new Set());
      epsMap.get(name).add(num);
    }
  }

  const result = [];
  for (const [name, count] of freq) {
    const s = strong.get(name) || 0;
    // 최소 3회 이상 + (인명 신호가 있거나 충분히 자주 등장)
    if (count >= 3 && (s >= 1 || count >= 6)) {
      const epNums = [...(epsMap.get(name) || [])].sort((a, b) => a - b);
      result.push({ name, count, strong: s, episodes: epNums });
    }
  }

  return result
    .sort((a, b) => (b.strong - a.strong) || (b.count - a.count))
    .slice(0, 30);
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
