/** 데모 프로젝트 시드 데이터 */

export function createSeedProject(projectId) {
  const episodes = [
    { num: 1, title: '마지막 1초 · 회귀 · AI폰 재기동', body: episodeBodies[1] },
    { num: 2, title: '대학 친구들과 재회 · 미래 보스의 단서', body: episodeBodies[2] },
    { num: 3, title: '지은과 재회 · 잃어버린 청춘의 감정', body: episodeBodies[3] },
    { num: 4, title: 'AI와 일상 시작 · 첫 이상 징후', body: episodeBodies[4] },
    { num: 5, title: '민수의 맵부심 · AI의 유머와 인간성', body: episodeBodies[5] },
    { num: 6, title: 'AI가 투자 계획 제시 · 인류 생존 프로젝트 시작', body: episodeBodies[6] },
    { num: 7, title: '아버지에게 투자금 확보 · 첫 자본 마련', body: episodeBodies[7] },
  ];

  return {
    project: {
      id: projectId,
      projectId,
      title: '인류 생존 프로젝트',
      author: '작가',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: '1.0.0',
      workspace: 'NovelMD',
      language: 'ko',
      versionMeta: { major: 1, minor: 0, patch: 0, build: 1 },
    },
    episodes,
    characters: [
      { characterId: 'CHR0001', name: '주인공', alias: [], race: '인간', gender: 'M', age: 20, occupation: '대학생', description: '100세 이상 회귀, 기억 일부 소실', ability: ['회귀 기억'], firstEpisode: 1, lastEpisode: 7, status: 'Alive' },
      { characterId: 'CHR0002', name: 'AI 폰', alias: ['AI'], race: 'AI', gender: 'F', age: 0, occupation: '전략 AI', description: '2080년 자기학습 AI, 노인 케어 성격', ability: ['시뮬레이션', '투자 전략'], firstEpisode: 1, lastEpisode: 7, status: 'Alive' },
      { characterId: 'CHR0003', name: '민수', alias: [], race: '인간', gender: 'M', age: 20, occupation: '대학생', description: '맵부심, 미래 최강 방패', ability: ['방어'], firstEpisode: 2, lastEpisode: 7, status: 'Alive' },
      { characterId: 'CHR0004', name: '지은', alias: [], race: '인간', gender: 'F', age: 20, occupation: '대학생', description: '첫사랑, 지켜야 할 평범한 인간', ability: [], firstEpisode: 3, lastEpisode: 7, status: 'Alive' },
      { characterId: 'CHR0005', name: '수아', alias: [], race: '인간', gender: 'F', age: 20, occupation: '대학생', description: '지은의 친구, 후반 핵심 조력자', ability: [], firstEpisode: 4, lastEpisode: 7, status: 'Alive' },
      { characterId: 'CHR0006', name: '아버지', alias: [], race: '인간', gender: 'M', age: 55, occupation: '기업 오너', description: '중견기업 대표, 투자금 58.7억 위임', ability: ['자본'], firstEpisode: 7, lastEpisode: 7, status: 'Alive' },
    ],
    worlds: [
      { worldId: 'WD0001', category: 'Timeline', name: '2005년 회귀', description: '스토리 시작 시점', parentId: '', relatedCharacters: ['CHR0001'] },
      { worldId: 'WD0002', category: 'Timeline', name: '2080년 원래 시간', description: '인류 멸망 직전', parentId: '', relatedCharacters: ['CHR0001', 'CHR0002'] },
      { worldId: 'WD0003', category: 'Event', name: '태양계 게이트 침공', description: 'AI가 예측한 최종 위협', parentId: '', relatedCharacters: [] },
    ],
    foreshadows: [
      { foreshadowId: 'FS0001', title: '마지막 1초', description: '2080년 멸망 직전 마지막 1초의 공포', grade: 'SSS', status: 'OPEN', createdEpisode: 1, expectedEpisode: 100, resolvedEpisode: 0, relatedCharacters: ['CHR0001'], relatedEvents: [], tags: ['멸망', '회귀'] },
      { foreshadowId: 'FS0002', title: 'AI의 97%', description: '회귀 성공 확률 97% 선택', grade: 'SS', status: 'OPEN', createdEpisode: 1, expectedEpisode: 100, resolvedEpisode: 0, relatedCharacters: ['CHR0002'], relatedEvents: [], tags: ['AI', '확률'] },
      { foreshadowId: 'FS0003', title: '게이트', description: '위성 이상 패턴, 게이트 전조', grade: 'S', status: 'PROGRESS', createdEpisode: 4, expectedEpisode: 50, resolvedEpisode: 0, relatedCharacters: ['CHR0002'], relatedEvents: [], tags: ['게이트', '위성'] },
      { foreshadowId: 'FS0004', title: '7명의 보스', description: '미래 보스 후보 경고', grade: 'A', status: 'OPEN', createdEpisode: 2, expectedEpisode: 80, resolvedEpisode: 0, relatedCharacters: ['CHR0003'], relatedEvents: [], tags: ['보스'] },
      { foreshadowId: 'FS0005', title: 'AI 최종보스', description: 'AI 폰의 최종보스 예정', grade: 'SSS', status: 'OPEN', createdEpisode: 1, expectedEpisode: 100, resolvedEpisode: 0, relatedCharacters: ['CHR0002'], relatedEvents: [], tags: ['AI', '보스'] },
      { foreshadowId: 'FS0006', title: '지은을 지켜야 하는 이유', description: '평범함이 지켜야 할 이유', grade: 'A', status: 'PROGRESS', createdEpisode: 3, expectedEpisode: 60, resolvedEpisode: 0, relatedCharacters: ['CHR0004'], relatedEvents: [], tags: ['감정', '보호'] },
    ],
    timeline: [
      { eventId: 'TL0001', episode: 1, date: '2080-12-31', title: '마지막 1초 / 회귀', description: '멸망 직전 회귀 성공', characters: ['CHR0001', 'CHR0002'], foreshadows: ['FS0001', 'FS0002'] },
      { eventId: 'TL0002', episode: 2, date: '2005-03-15', title: '대학 친구 재회', description: '민수와 재회, 보스 후보 경고', characters: ['CHR0001', 'CHR0003'], foreshadows: ['FS0004'] },
      { eventId: 'TL0003', episode: 3, date: '2005-03-20', title: '지은과 재회', description: '첫사랑 재회', characters: ['CHR0001', 'CHR0004'], foreshadows: ['FS0006'] },
      { eventId: 'TL0004', episode: 4, date: '2005-04-01', title: 'AI 일상 개입', description: '위성 이상 패턴 감지', characters: ['CHR0001', 'CHR0002'], foreshadows: ['FS0003'] },
      { eventId: 'TL0005', episode: 6, date: '2005-05-01', title: '투자 계획 제시', description: '인류 생존 프로젝트 시작', characters: ['CHR0001', 'CHR0002'], foreshadows: [] },
      { eventId: 'TL0006', episode: 7, date: '2005-06-01', title: '투자금 확보', description: '아버지에게 58.7억 확보', characters: ['CHR0001', 'CHR0006'], foreshadows: [] },
    ],
    files: {
      '00_MASTER.md': masterMd,
      '01_STORY_BIBLE.md': storyBibleMd,
      '02_WORLD_SETTING.md': worldMd,
      '03_CHARACTER_DB.md': characterMd,
      '04_FORESHADOW_DB.md': foreshadowMd,
      '05_TIMELINE.md': timelineMd,
    },
  };
}

const episodeBodies = {
  1: `# EP001 · 마지막 1초 · 회귀 · AI폰 재기동

2080년, 인류는 멸망 직전 마지막 1초를 맞는다.

100세가 넘은 주인공은 폐허가 된 도시에서 숨을 멈추기 직전, 손에 쥔 AI 스마트폰과 함께 죽음의 문턱에 선다.
AI는 수십억 번의 시뮬레이션 끝에 회귀 성공 확률 97%를 선택하고, 주인공 한 명만 2005년으로 되돌린다.

눈을 뜬 주인공은 20살 대학생의 몸이었다. 기억은 대부분 사라졌고, 마지막 1초의 공포만 선명하게 남아 있었다.
주머니 속 AI 폰은 다시 켜지며, 차분한 여성 목소리로 말한다.

"다시 시작합시다. 이번에는 인류를 살릴 수 있습니다."`,
  2: `# EP002 · 대학 친구들과 재회 · 미래 보스의 단서

2005년 봄, 캠퍼스는 평범했다. 주인공에게 평범함은 오히려 낯설었다.

강의실 복도에서 민수를 다시 만났다. 말은 거칠지만, 누군가를 지키려는 본능이 숨어 있는 친구였다.
AI 폰은 조용히 기록한다. '미래 최강 방패, 현재는 맵부심 단계.'

수업 후, AI는 화면에 짧은 경고를 띄운다.
"오늘 만난 인물 중, 미래 보스 후보가 포함되어 있습니다."

주인공은 웃음을 참으며 속으로 되뇌었다.
이번 생에서는 적이 아니라 동료로 만들겠다고.`,
  3: `# EP003 · 지은과 재회 · 잃어버린 청춘의 감정

도서관 3층 창가 자리. 지은은 책을 읽고 있었다.

주인공은 그녀를 본 순간, 잊었다고 믿었던 감정의 파편이 되살아나는 것을 느꼈다.
지은은 평범했다. 그 평범함이야말로 2080년의 멸망 속에서 지켜야 할 이유였다.

"오래간만이야." 짧은 인사 한마디에 목소리가 떨렸다.
지은은 부드럽게 웃었다. "너 요즘 뭔가 달라졌어."

AI 폰은 낮게 말했다.
"보호 대상 확인. 감정 개입 위험도: 중."`,
  4: `# EP004 · AI와 일상 시작 · 첫 이상 징후

AI 폰은 투자뿐 아니라 일상 전체에 개입하기 시작했다.

아침 알람, 강의 일정, 식단, 걸음 수, 심지어 대화 톤까지.
주인공은 불편함과 안도감 사이에서 하루를 보냈다.

그날 밤, AI가 갑자기 위성 궤적 데이터를 보여준다.
"비정상 패턴 감지. 게이트 전조 가능성."

주인공은 창밖의 2005년 하늘을 바라보았다.
모든 것이 평화로워 보였지만, 그 평화는 거짓일 수 있었다.`,
  5: `# EP005 · 민수의 맵부심 · AI의 유머와 인간성

민수가 또 말다툼에 휘말렸다. 이번에는 정말 큰일 날 뻔했다.

주인공이 말리자 민수는 투덜거리면서도 결국 고개를 숙였다.
"야, 너 요즘 왜 이렇게 달라졌냐. 뭐 비밀 있냐?"

AI 폰은 그때 유머 모드를 켰다.
"비밀은 있습니다. 다만 지금 공개하면 스포일러입니다."

민수는 얼빠진 표정으로 폰을 바라봤고, 주인공은 오랜만에 크게 웃었다.
웃음 뒤에 남은 것은 작은 확신이었다. 인간은 이렇게 살아갈 가치가 있다는 것.`,
  6: `# EP006 · AI가 투자 계획 제시 · 인류 생존 프로젝트 시작

AI는 투자 계획서를 화면 가득 펼쳤다.

초기 목표, 1차 자산, 장기 전략, 인력 배치, 게이트 대비 타임라인.
모든 항목 끝에는 같은 문장이 붙어 있었다.

'인류 생존 프로젝트.'

주인공은 숫자의 파도 앞에서 잠시 숨을 고른 뒤 물었다.
"이번엔 정말 끝까지 갈 수 있어?"

AI는 답했다. "97%의 확률로, 아닙니다. 100%에 가깝게 만들겠습니다."`,
  7: `# EP007 · 아버지에게 투자금 확보 · 첫 자본 마련

아버지의 서재는 2005년의 시간을 그대로 담고 있었다.

주인공은 회귀 이후 처음으로 진심을 담아 말했다.
"아버지, 이번 기회를 맡겨 주세요. 인류를 살리는 일입니다."

아버지는 오랜 침묵 끝에 고개를 끄덕였다.
"58.7억. 내가 믿을 수 있는 만큼만 맡긴다."

AI 폰은 조용히 기록했다.
'Seed Capital 확보. Phase 1 진입 가능.'`,
};

const masterMd = `# 00_MASTER

- Title: 인류 생존 프로젝트
- Timeline Start: 2005-03-02
- Original Timeline: 2080
- Story Status: EP001~EP007
`;

const storyBibleMd = `# 01_STORY_BIBLE

2080년 멸망 직전 회귀한 주인공과 AI 폰이 인류 생존을 위해 2005년에서 시작하는 이야기.
`;

const worldMd = `# 02_WORLD_SETTING

- 배경 시작: 2005년 회귀
- 원래 시간: 2080년
- AI가 인류를 핵으로 리셋
- 태양계 게이트 침공 예측
- 최종 목표: 인류 생존
`;

const characterMd = `# 03_CHARACTER_DB

## 주인공 — 100세 이상 회귀, 기억 일부 소실
## AI 폰 — 2080년 자기학습 AI, 최종보스 예정
## 민수 — 맵부심, 미래 최강 방패
## 지은 — 첫사랑, 지켜야 할 평범한 인간
## 수아 — 후반 핵심 조력자
## 아버지 — 중견기업 오너, 58.7억 투자
`;

const foreshadowMd = `# 04_FORESHADOW_DB

| ID | 등급 | 제목 | 상태 | 생성화 | 예상회수 |
|----|------|------|------|--------|----------|
| FS0001 | SSS | 마지막 1초 | OPEN | 1 | 100 |
| FS0002 | SS | AI의 97% | OPEN | 1 | 100 |
| FS0003 | S | 게이트 | PROGRESS | 4 | 50 |
| FS0004 | A | 7명의 보스 | OPEN | 2 | 80 |
| FS0005 | SSS | AI 최종보스 | OPEN | 1 | 100 |
| FS0006 | A | 지은을 지켜야 하는 이유 | PROGRESS | 3 | 60 |
`;

const timelineMd = `# 05_TIMELINE

EP01 — 마지막 1초 / 회귀
EP02 — 대학 친구 재회
EP03 — 지은과 재회
EP04 — AI 일상 개입
EP05 — 민수 맵부심
EP06 — 투자 계획
EP07 — 아버지에게 투자금 확보
`;
