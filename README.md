# 웹소설 네비게이터

첨부받은 Story Bible 문서를 기반으로 만든 Streamlit 앱입니다.

## 제공 기능

- 인물 선택 네비게이터
- **소설 1~100화 선택 읽기** (이전/다음 화, 이어보기 저장)
- 인물 관계도(모바일 안전 SVG + 관계 표)
- 중요 이슈 / 투자 로드맵 / 통장잔고 / 적 리스트
- 마스터 MD / 스토리 MD / Story Bible ZIP 활성 파일 전환
- 모바일 대응 UI

---

## 라이브 서버 배포 (GitHub 연동, 권장)

요청하신 방식대로 휴대폰 로컬 실행이 아닌 **GitHub 기반 라이브 서버 배포**를 기본으로 사용하세요.

### 1) GitHub에 브랜치 푸시

현재 배포용 브랜치:

- `cursor/story-bible-navigator-0854`

### 2) Render에서 배포

저장소 루트에 `render.yaml`이 준비되어 있으므로, Render에서 이 저장소를 연결하면 바로 배포할 수 있습니다.

- 배포 설정 파일: `render.yaml`
- 실행 스크립트: `scripts/start_live_server.sh`

### 3) 접속

배포 완료 후 발급되는 Render URL을 사용하면 상시 접속 가능합니다.

> 참고: free 플랜은 비활성 후 슬립이 있을 수 있습니다.  
> 완전한 24/7 상시는 유료 플랜 또는 항상 켜진 서버를 사용하세요.

---

## 로컬 실행(개발용)

```bash
pip install -r requirements.txt
./scripts/start_live_server.sh
```

---

## 데이터 저장 위치

- 기본 시드 문서: `data/seed/`
- 업로드 문서: `data/uploads/`
- 활성 파일 설정: `data/active_files.json`
- 통장 거래 내역: `data/ledger.json`
- 화별 본문(시드): `data/seed/episodes/EP001.md` ~ `EP100.md`
- 화별 본문(업로드): `data/uploads/episodes/`
- 마지막 읽은 화: `data/reading_progress.json`

> 주의: 대부분의 클라우드 런타임은 파일시스템이 영구 저장소가 아닙니다.  
> 런타임 재시작 시 업로드 파일이 유실될 수 있으므로, 중요한 파일은 GitHub 또는 외부 스토리지에 별도 백업하세요.
