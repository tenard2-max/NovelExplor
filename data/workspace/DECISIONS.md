# Workspace XML — 개발 결정 사항

## 확정 (2026-07-10)

| 항목 | 선택 |
|------|------|
| **Q1** GitHub 쓰기 | **C** 하이브리드 (토큰 있으면 API, 없으면 파일) |
| **Q2** PNG 원본 | **A** `data/workspace/assets/` + lazy download |
| **Q3** IndexedDB | **A** XML 원본, IndexedDB는 캐시 |
| **Q4** 소설 읽기 UI | **B** XML 데이터 + 기존 reader UI 재사용 |

---

## Q4=B 구현 요지

- 화면: `view-reader` (이전화 / 선택 / 다음화 / 글꼴)
- 목록·본문 소스: `sections/10_reader.xml` → MD `src` lazy fetch
- IndexedDB ST 목록은 XML이 없을 때만 폴백
- Pages 미반영 시 IndexedDB 본문 폴백

---

## STEP: ST MD 하이브리드 업로드 (2026-07-10)

| 항목 | 선택 |
|------|------|
| 토큰 저장 | **B** 세션 입력만 (메모리, localStorage 금지) |
| 저장소 | 고정 `tenard2-max/NovelExplor` · `main` |
| 커밋 범위 | `assets/stories/*.md` + `sections/10_reader.xml` + `workspace.xml` Assets |
| 로컬 저장 | File System Access(`data/workspace` 폴더) 또는 다운로드 폴백 |
| DB | IndexedDB 캐시 병행 (`importStoryFile`) |

### 업로드 파이프라인

1. IndexedDB에 ST 등록
2. 인메모리 `10_reader.xml` / `workspace.xml` 갱신 → 리더 즉시 반영
3. 폴더 연결 시 디스크 기록
4. 세션 PAT 있으면 GitHub Contents API 커밋 (3파일 순차)
5. FS·GitHub 모두 없으면 파일 다운로드
