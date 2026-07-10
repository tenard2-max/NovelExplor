# Workspace XML — 개발 결정 사항

## 확정 (2026-07-10)

| 항목 | 선택 |
|------|------|
| **Q1** GitHub 쓰기 | **REST API** — Trees API로 **한 커밋**에 snapshots + overlays + section XML |
| **Q2** GitHub 읽기 | **Pull** — `latest.json` + 분리 자산 → IndexedDB 전체 복원 |
| **Q3** PNG 원본 | overlays/characters, Pages XML Avatar는 `../overlays/characters/CHR####.png` |
| **Q4** IndexedDB | **로컬 오버레이** (Pull/Push로 GitHub와 동기화) |
| **Q5** 소설 읽기 UI | **B** XML 목록 + IndexedDB 병합 표시 |

---

## 운영 정책 (적용)

```
GitHub = SoT (snapshots + overlays + workspace XML)
브라우저 IndexedDB = 실행·캐시
화면 = XML(Pages) + IndexedDB 병합
```

1. **Push** — 저장·적용·업로드 시 DB 기준으로:
   - `data/workspace/snapshots/YYYYMMDDHHMMSS.json` (분리 manifest)
   - `data/workspace/overlays/**` (PNG·MD·TXT)
   - `data/workspace/sections/*.xml`, `workspace.xml` (인물·떡밥·타임라인·리더)
   - 위 파일을 **Git Trees API로 1커밋**에 묶음
2. **Pull** — `latest.json` 스냅샷 + overlays 자산 fetch → IndexedDB 교체 복원
3. **Pages 접속 시** — XML/시드 MD는 읽기용 fetch (Pull 직후에는 GitHub raw로 캐시 갱신)
4. **다른 PC** — GitHub Pull 또는 JSON 파일 복원
5. 같은 화/인물이 양쪽에 있으면 **로컬 DB가 화면에서 우선** (Pull 전까지)

### 소설 읽기 source

| source | 의미 |
|--------|------|
| xml | Pages XML·MD만 |
| idb | 이 PC에만 업로드된 소설 |
| overlay | XML에 있는 화 + 로컬 본문으로 덮어씀 |

### 인물 Avatar (XML)

- Push 시 `../overlays/characters/CHR####.png` 로 section XML 자동 갱신
- Pull 시 PNG base64 → IndexedDB `avatarDataUrl` 복원

## UI: 프로젝트 통합 (2026-07-10)

- 백업 메뉴 제거. **새 프로젝트 / 프로젝트 열기 / 프로젝트 저장** 만 유지
- 저장·새 프로젝트·열기(목록) 시: IndexedDB 반영 + `YYYYMMDDHHMMSS.json` 다운로드
- 프로젝트 열기에서 JSON 파일 복원 (GitHub Pull과 동일 목적)
- 우측 패널: **GitHub Push** / **GitHub에서 Pull**
