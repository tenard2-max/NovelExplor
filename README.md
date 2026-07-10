# NovelExplor

**인류 생존 프로젝트** 웹소설의 Story Bible·에피소드·복선(떡밥)을 탐색·집필·관리하는 저장소입니다.

## 구성

| 경로 | 역할 | 실행 |
|------|------|------|
| [`index.html`](index.html) + `js/` `css/` | **집필 워크스페이스** (GitHub Pages) | https://tenard2-max.github.io/NovelExplor/ |
| [`data/workspace/`](data/workspace/) | **고정 XML 원본** (앱이 수정하지 않음) | Pages에서 읽기 전용 |
| [`data/seed/`](data/seed/) | 공유 시드 MD · EP001~007 | XML이 참조 |
| [`app.py`](app.py) | 웹소설 네비게이터 (Streamlit) | 포트 **8501** |

**데이터 정책:** 업로드·인물 PNG·DB 편집은 브라우저 IndexedDB만 사용합니다. 일상 작업 시 GitHub에서 다시 받을 필요 없습니다. PC 이동 시 앱의 백업 저장/복원을 사용하세요.

## 제공 기능 (Streamlit)

- 인물 선택 네비게이터
- 소설 1~100화 선택 읽기 (이전/다음 화, 이어보기 저장)
- 인물 관계도 (모바일 SVG + 관계 표)
- 중요 이슈 / 투자 로드맵 / 통장잔고 / 적 리스트
- 마스터 MD / 스토리 MD / Story Bible ZIP 활성 파일 전환
- 모바일 대응 UI

## 제공 기능 (Foreshadow Engine)

- NovelMD 형식 마스터·Story Bible·세계관·복선·인물·타임라인
- EP/ST/TXT/MD Import · JSON Export
- 에디터·리더·복선 분석·Canvas 그래프
- 자세한 내용: [foreshadow-engine/README.md](foreshadow-engine/README.md)

---

## 라이브 서버 배포 (Streamlit, GitHub 연동)

### Render에서 배포

저장소 루트의 `render.yaml`을 연결하면 Streamlit 앱이 배포됩니다.

- 배포 설정: `render.yaml`
- 실행 스크립트: `scripts/start_live_server.sh`

배포 완료 후 발급되는 Render URL로 접속합니다.

> Free 플랜은 비활성 후 슬립이 있을 수 있습니다.

### Foreshadow Engine (로컬 집필 · Live Server)

저장소 루트 **`index.html`** 에서 **Go Live** (포트 **9000**)

```
http://127.0.0.1:9000/index.html
```

루트 `index.html`이 `foreshadow-engine/`의 CSS·JS를 불러옵니다.

> IndexedDB는 `127.0.0.1:9000` origin에 저장됩니다.

---

## 로컬 실행 (개발용)

### Streamlit 네비게이터

```bash
pip install -r requirements.txt
./scripts/start_live_server.sh
```

### Foreshadow Engine (Live Server · 권장)

저장소 루트 **`index.html`** → **Go Live** (포트 **9000**)

```
http://127.0.0.1:9000/index.html
```

설정: `.vscode/settings.json` (`port: 9000`, `root: /`)

### Foreshadow Engine (Python 대안)

Live Server 없을 때 — **같은 포트 9000** 사용 (IndexedDB 유지)

```bash
cd D:\Cursor\NovelExplor
python -m http.server 9000 --bind 127.0.0.1
```

접속: `http://127.0.0.1:9000/index.html`  
`localhost`가 아닌 **`127.0.0.1`** 로 접속해야 기존 저장 데이터와 일치합니다.

---

## 데이터 저장 위치

| 데이터 | 경로 |
|--------|------|
| 기본 시드 문서 | `data/seed/` |
| 화별 본문 (시드) | `data/seed/episodes/EP001.md` ~ |
| 업로드 문서 | `data/uploads/` |
| 활성 파일 설정 | `data/active_files.json` |
| 통장 거래 내역 | `data/ledger.json` |
| 마지막 읽은 화 | `data/reading_progress.json` |
| Foreshadow 프로젝트 | 브라우저 IndexedDB (origin별 분리) |

> 클라우드 런타임(Streamlit)은 파일시스템이 영구 저장소가 아닙니다. 중요한 파일은 JSON Export 또는 Git으로 백업하세요.

## 설계 문서

- `_foreshadow_docs/` — UI·데이터 모델·Import·로드맵 명세
- `foreshadow-engine/TODO.md` — 구현 진행 체크리스트
