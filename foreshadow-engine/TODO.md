# NovelExplor — Foreshadow Engine TODO

기준: `_foreshadow_docs/020_TODO.md` · 통합 명세 19장 로드맵  
프로젝트: **인류 생존 프로젝트** (회귀 판타지 · EP001~007 시드)

## STEP 1 ✅ (완료)

- [x] `foreshadow-engine/` 프로젝트 구조 + Nav/Canvas/Files UI
- [x] `index.html` ↔ `js/` ↔ `css/` DOM·레이아웃 정합
- [x] IndexedDB 저장소
- [x] 데모 프로젝트 시드 (EP001~007, 인물 6명, 복선 6건)
- [x] 마스터 대시보드 / Story Bible / 세계관 / 떡밥·인물·타임라인 뷰
- [x] 스토리 네비게이터 + 에디터 + 리더
- [x] Foreshadow CRUD + 등급(F~SSS) / 상태
- [x] 자동저장 / Undo / 전역 검색
- [x] 규칙 기반 복선 후보 (승인 게이트)
- [x] 복선·인물·타임라인 Canvas 그래프 (기본)
- [x] 인물 이미지·월페이퍼·속성 서랍(Inspector)

## STEP 1.5 — 저장소 정합 (진행 중)

- [ ] `data/seed/` MD 파일명 → NovelMD 뷰 자동 매핑 (`99_Master_DB` ↔ `00_MASTER` 등)
- [ ] Streamlit `app.py` 시드와 Foreshadow Engine 시드 동기화 가이드
- [ ] 루트 `README.md` 실행 경로·역할 분리 문서화

## STEP 2 — Import / Export

- [ ] TXT/MD Import (원본 Story/Original 보존)
- [ ] ZIP Import (`Novel_Master.zip`)
- [ ] `Novel_Master.zip` Export
- [ ] 인코딩 자동 감지 (UTF-8, EUC-KR, CP949)
- [ ] `data/seed/episodes/` 일괄 Import 단축키

## STEP 3 — 무결성 & 버전

- [ ] 소프트 삭제 + 휴지통 (30일)
- [ ] Version 스냅샷 + 복원 UI
- [ ] File System Access API (Workspace 폴더 연동)
- [ ] 그래프 레이아웃·필터 고도화

## STEP 4 — AI 보조 (오프라인)

- [ ] Contradiction Checker UI 강화
- [ ] Resolution Checker 자동 알림
- [ ] Story Bible Sync (MD 자동 갱신)

## Backlog (Phase 4)

- Semantic Search / RAG
- Plugin API (외부 LLM)
- DOCX / EPUB Import
