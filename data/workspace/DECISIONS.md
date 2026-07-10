# Workspace XML — 개발 결정 사항

## 확정 (2026-07-10)

| 항목 | 선택 |
|------|------|
| **Q1** GitHub 쓰기 | **사용 안 함** — 일상 편집은 XML/GitHub을 건드리지 않음 |
| **Q2** PNG 원본 | Pages assets는 읽기 전용 시드, 사용자 PNG는 IndexedDB |
| **Q3** IndexedDB | **로컬 오버레이** (XML과 독립) |
| **Q4** 소설 읽기 UI | **B** XML 목록 + IndexedDB 병합 표시 |

---

## 운영 정책 (적용)

`
화면 = XML(Pages 원본, 읽기 전용) + IndexedDB(이 브라우저 로컬)
`

1. **XML은 고정** — 앱이 data/workspace/**/*.xml · assets를 자동으로 쓰지 않음
2. **업로드·DB 편집** — IndexedDB만 변경. **GitHub에서 다시 받을 필요 없음**
3. **Pages 접속 시** — XML/시드 MD는 읽기용으로만 fetch (원본 표시)
4. **다른 PC로 옮길 때** — 백업 저장(JSON) → 그 PC에서 백업 복원
5. 같은 화/인물이 양쪽에 있으면 **로컬 DB가 화면에서 우선**

### 소설 읽기 source

| source | 의미 |
|--------|------|
| xml | Pages XML·MD만 |
| idb | 이 PC에만 업로드된 소설 |
| overlay | XML에 있는 화 + 로컬 본문으로 덮어씀 |

### 인물

- XML 카드 + IndexedDB 아바타/추가 인물 병합
- PNG 등록은 캐릭터 패널 → IndexedDB (XML Avatar 미갱신)

## UI: 프로젝트 통합 (2026-07-10)

- 백업 메뉴 제거. **새 프로젝트 / 프로젝트 열기 / 프로젝트 저장** 만 유지
- 저장·새 프로젝트·열기(목록) 시: IndexedDB 반영 + \YYYYMMDDHHMMSS.json\ 다운로드
- 프로젝트 열기에서 \J\ → JSON 파일 복원 (깃허브/다른 PC 동기화)
- XML은 계속 읽기 전용. JSON이 휴대용 DB 스냅샷
