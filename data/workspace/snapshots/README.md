# GitHub 스냅샷 (NovelExplor 동기화)

브라우저에서 **프로젝트 저장** 또는 **JSON 적용** 시 GitHub REST API로 커밋됩니다.

## 경로

| 경로 | 내용 |
|------|------|
| `snapshots/YYYYMMDDHHMMSS.json` | 분리 manifest (PNG 본문 제외, 경로 참조) |
| `snapshots/latest.json` | 최신 스냅샷 ID → **JSON 버전** 표시용 |
| `overlays/characters/*.png` | 인물 사진 |
| `overlays/stories/*.md` | 업로드 소설·설정 MD/TXT |
| `overlays/files/*` | 기타 텍스트 파일 |

## 인증

앱 우측 패널에서 GitHub **Personal Access Token** (`repo` scope) 설정.

토큰은 브라우저 localStorage에만 저장되며 저장소에 커밋되지 않습니다.
