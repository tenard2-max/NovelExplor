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
