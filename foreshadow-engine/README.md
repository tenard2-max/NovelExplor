# NovelExplor — Foreshadow Engine

**인류 생존 프로젝트** 웹소설의 복선(떡밥)·스토리·세계관을 관리하는 브라우저 워크스페이스입니다.  
저장소 루트의 Streamlit 앱(`app.py`)과 같은 Story Bible·EP 시드를 공유하며, 집필·복선 추적은 이 정적 앱에서 수행합니다.

## 문서 기준

`_foreshadow_docs/` 명세(000~020)에 따라 단계별로 구현합니다.

## UI 구조

현재 메인 화면(`index.html`)은 아래 3분할 레이아웃을 사용합니다.

```
┌──────────┬────────────────────────────┬──────────┐
│  Nav (1) │      Canvas / Editor (8)     │ Files(1) │
│  메뉴    │  리스트 · 리더 · 에디터 · 그래프 │  업로드  │
└──────────┴────────────────────────────┴──────────┘
```

- **좌측 Nav**: 마스터 DB, Story Bible, 세계관, 소설 읽기, 떡밥·인물·타임라인, 그래프, 에디터
- **중앙 Canvas**: 선택한 뷰의 본문·대시보드·에디터·리더·Canvas 그래프
- **우측 Files**: 드래그 앤 드롭 Import, JSON Export, 프로젝트 저장(IndexedDB)

속성 편집(Inspector)은 중앙 하단 **속성 서랍**으로 열립니다.

## STEP 1 (현재) — MVP

- Workspace/Project 생성·열기·저장 (IndexedDB)
- Nav / Canvas / Files 3분할 UI
- EP001~EP007 시드 (데모: *인류 생존 프로젝트*)
- Character / World / Foreshadow / Timeline DB 조회·수정
- Story Editor (Undo/Redo, 찾기, 자동저장 5초)
- Reader (이전/다음 화, 목차)
- 규칙 기반 복선 후보 분석 (사용자 승인 후 저장)
- 통합 검색, JSON Export/Import
- 다크/라이트 테마

## 실행 방법

저장소 **루트** `index.html` → **Go Live** (포트 **9000**)

```
http://127.0.0.1:9000/index.html
```

루트 `index.html`이 `<base href="foreshadow-engine/">`로 이 폴더의 CSS·JS를 불러옵니다.  
직접 `foreshadow-engine/index.html`을 열어도 동작합니다.

### Python http.server (대안)

포트 **9000** — Live Server와 **IndexedDB가 분리**되므로 일상 사용에는 권장하지 않습니다.

```bash
cd foreshadow-engine
python -m http.server 9000 --bind 127.0.0.1
```

## Import 파일 규칙

| 종류 | 파일명 예시 | 비고 |
|------|-------------|------|
| NovelMD 설정 | `00_MASTER.md` ~ `05_TIMELINE.md` | 앱 기본 형식 |
| 시드 호환 | `99_Master_DB.md`, `01_Characters.md` … | `data/seed/` 와 동일 규칙 (`NN_*.md`) |
| 소설 원고 | `ST001.md`, `*.txt` | 소설 읽기 탭 |
| 에피소드 | `EP001.md` | 스토리 네비게이터·에디터 |

루트 `data/seed/` 폴더의 MD를 그대로 드래그해 넣을 수 있습니다.

## 저장소 내 위치

```
NovelExplor/
├── app.py                 # Streamlit 웹소설 네비게이터 (모바일·배포용)
├── data/seed/             # 공유 시드 MD · EP001~007
├── foreshadow-engine/     # ← 이 앱 (index.html)
└── _foreshadow_docs/      # 설계 명세
```

## 기술 스택

- HTML5 / CSS3 / JavaScript (ES Modules)
- IndexedDB / LocalStorage
- Canvas API (복선·인물·타임라인 그래프)

## 다음 STEP

자세한 로드맵은 [TODO.md](./TODO.md)를 참고하세요.
