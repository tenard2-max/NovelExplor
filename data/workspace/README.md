# NovelExplor Workspace (XML DB)

GitHub Pages: https://tenard2-max.github.io/NovelExplor/

## 정책

- **XML / assets** = Pages에 올라간 **고정 원본** (앱이 수정하지 않음)
- **업로드·인물 PNG·DB** = 브라우저 **IndexedDB**만 (GitHub 재다운로드 불필요)
- **화면** = XML 원본 + 로컬 DB 오버레이
- **PC 이동** = 우측 패널의 백업 저장 / 복원

## 구조

`
data/workspace/
  workspace.xml
  sections/          ← 뷰별 캔버스 XML (reader ≠ character)
  assets/
    characters/CHR0001/avatar.png   ← 시드 PNG
    stories/ST999.md                ← 시드 MD
`

## Pages 확인

1. 인물 → CHR0001 등 XML 카드 + 클릭 시 로컬 PNG 등록
2. 소설 읽기 → XML 목록 + 업로드한 ST는 로컬로 합쳐 표시
3. 업로드 후에도 GitHub/XML 파일은 그대로
