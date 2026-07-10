# Workspace XML — 개발 결정 사항

## 확정 (2026-07-10)

| 항목 | 선택 |
|------|------|
| **Q1** GitHub 쓰기 | **보류** — 일상 편집은 XML을 변경하지 않음 |
| **Q2** PNG 원본 | Pages assets는 읽기 전용 시드, 사용자 PNG는 IndexedDB |
| **Q3** IndexedDB | **로컬 오버레이** (XML과 독립) |
| **Q4** 소설 읽기 UI | **B** XML 목록 + IndexedDB 병합 표시 |

---

## 표시 모델 (2026-07-10 갱신)

`
화면 = XML(Pages 원본, 읽기 전용) + IndexedDB(이 브라우저 로컬)
`

- 업로드(ST/MD/TXT)·인물 PNG·DB 편집 → **IndexedDB만** 변경
- data/workspace/**/*.xml · assets 파일 → **앱이 자동으로 쓰지 않음**
- 같은 화/인물이 양쪽에 있으면 **로컬 DB가 화면에서 우선**
- 다른 PC / 캐시 삭제 시 → XML 원본만 다시 보임 (로컬 오버레이는 따라오지 않음)

### 소설 읽기 source

| source | 의미 |
|--------|------|
| xml | Pages XML·MD만 |
| idb | 이 PC에만 업로드된 소설 |
| overlay | XML에 있는 화 + 로컬 본문으로 덮어씀 |

### 인물

- XML 카드 + IndexedDB 아바타/추가 인물 병합
- PNG 등록은 캐릭터 패널 → IndexedDB (XML Avatar 미갱신)
