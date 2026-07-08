# Fantasy Foreshadow Tool

판타지 소설의 복선(떡밥)을 관리하는 GitHub Pages 기반 웹 애플리케이션입니다.

## 문서 기준

`009_FORESHADOW_ENGINE` 명세(000~020)에 따라 단계별로 구현합니다.

### STEP 1 (현재) — MVP 기반

- Workspace/Project 생성·열기·저장 (IndexedDB)
- 3-패널 UI (Explorer 1 : Editor/Reader 5 : Inspector 2)
- EP001~EP007 시드 데이터
- Character / World / Foreshadow / Timeline DB 조회·수정
- Story Editor (Undo/Redo, 찾기/바꾸기, 자동저장 5초)
- Reader (이전/다음 화, 목차)
- 규칙 기반 복선 후보 분석 (사용자 승인 후 저장)
- 통합 검색, JSON Export/Import
- 다크/라이트 테마

## 실행 방법

### 로컬

```bash
# Python 내장 서버 (정적 파일 서빙만 — 앱 자체는 Python 미사용)
cd foreshadow-engine
python -m http.server 8080
```

브라우저에서 http://localhost:8080 접속

### GitHub Pages

`main` 브랜치 push 시 `.github/workflows/foreshadow-pages.yml`이 `foreshadow-engine/`을 배포합니다.

## 기술 스택

- HTML5 / CSS3 / JavaScript (ES Modules)
- IndexedDB / LocalStorage
- Canvas API (STEP 3 Graph 예정)

## 다음 STEP (Phase 1 잔여)

- TXT/MD/ZIP Import 파이프라인
- 소프트 삭제 + 휴지통
- Novel_Master.zip Export

자세한 로드맵은 `TODO.md` 참고.
