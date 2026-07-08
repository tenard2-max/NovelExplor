# \# 011\_CHARACTER\_DB

# 

# \# 1. 목적

# 

# Character DB는 프로젝트의 모든 등장인물을 관리하는 중앙 데이터베이스이다.

# 

# 모든 인물은 고유 ID를 가지며

# 

# Story

# Timeline

# Foreshadow

# World

# Relationship

# 

# 과 연결된다.

# 

# AI는 후보를 제안할 뿐 자동 등록하지 않는다.

# 

# \---

# 

# \# 2. Database Structure

# 

# Character.json

# 

# Character

# 

# &#x20;├── Metadata

# &#x20;├── Profile

# &#x20;├── Appearance

# &#x20;├── Personality

# &#x20;├── Ability

# &#x20;├── Status

# &#x20;├── Relationship

# &#x20;├── Story

# &#x20;├── Timeline

# &#x20;├── Statistics

# &#x20;└── History

# 

# \---

# 

# \# 3. JSON 구조

# 

# ```json

# {

# &#x20; "characterId":"CHR0001",

# &#x20; "name":"",

# &#x20; "alias":\[],

# &#x20; "race":"",

# &#x20; "gender":"",

# &#x20; "age":0,

# &#x20; "occupation":"",

# &#x20; "status":"Alive",

# &#x20; "firstEpisode":1,

# &#x20; "lastEpisode":999,

# &#x20; "createdAt":"",

# &#x20; "updatedAt":""

# }

# ```

# 

# \---

# 

# \# 4. Metadata

# 

# Character ID

# 

# 이름

# 

# 별칭

# 

# 생성일

# 

# 수정일

# 

# 작성자

# 

# 버전

# 

# 태그

# 

# \---

# 

# \# 5. Profile

# 

# 본명

# 

# 별명

# 

# 칭호

# 

# 종족

# 

# 성별

# 

# 나이

# 

# 직업

# 

# 소속

# 

# 국적

# 

# 출신지

# 

# 생일

# 

# \---

# 

# \# 6. Appearance

# 

# 키

# 

# 체형

# 

# 머리색

# 

# 눈색

# 

# 피부색

# 

# 복장

# 

# 장신구

# 

# 무기

# 

# 대표 이미지

# 

# \---

# 

# \# 7. Personality

# 

# 성격

# 

# 말투

# 

# 가치관

# 

# 목표

# 

# 취미

# 

# 습관

# 

# 약점

# 

# 트라우마

# 

# \---

# 

# \# 8. Ability

# 

# 능력

# 

# 마법

# 

# 무기 숙련도

# 

# 스킬

# 

# 특성

# 

# 레벨

# 

# 등급

# 

# 패시브

# 

# \---

# 

# \# 9. Status

# 

# Alive

# 

# Dead

# 

# Missing

# 

# Sealed

# 

# Corrupted

# 

# Unknown

# 

# \---

# 

# \# 10. Story 정보

# 

# 첫 등장 화

# 

# 마지막 등장 화

# 

# 등장 횟수

# 

# 주연 여부

# 

# 중요도

# 

# 스토리 역할

# 

# \---

# 

# \# 11. Relationship

# 

# 부모

# 

# 형제

# 

# 배우자

# 

# 스승

# 

# 제자

# 

# 동료

# 

# 적

# 

# 라이벌

# 

# 길드

# 

# 국가

# 

# 조직

# 

# \---

# 

# \# 12. Timeline 연결

# 

# 탄생

# 

# 주요 사건

# 

# 성장

# 

# 전직

# 

# 사망

# 

# 부활

# 

# 은퇴

# 

# \---

# 

# \# 13. Foreshadow 연결

# 

# 생성한 복선

# 

# 관련 복선

# 

# 회수한 복선

# 

# 미회수 복선

# 

# 예상 회수 복선

# 

# \---

# 

# \# 14. World 연결

# 

# 국가

# 

# 도시

# 

# 지역

# 

# 종족

# 

# 종교

# 

# 마법

# 

# 유물

# 

# 조직

# 

# \---

# 

# \# 15. Statistics

# 

# 등장 횟수

# 

# 대사 수

# 

# 언급 횟수

# 

# AI 분석 횟수

# 

# 복선 연결 수

# 

# 관계 수

# 

# \---

# 

# \# 16. History

# 

# 모든 변경 이력 저장

# 

# 작성자

# 

# 수정 시간

# 

# 변경 내용

# 

# Rollback 지원

# 

# \---

# 

# \# 17. Validation

# 

# 중복 이름 검사

# 

# ID 중복 금지

# 

# 첫 등장 화 검증

# 

# 마지막 등장 화 검증

# 

# 상태 검증

# 

# 종족 검증

# 

# \---

# 

# \# 18. Search Index

# 

# 이름

# 

# 별칭

# 

# 종족

# 

# 직업

# 

# 국가

# 

# 조직

# 

# 태그

# 

# 상태

# 

# \---

# 

# \# 19. Graph 연결

# 

# Character

# 

# ↓

# 

# Relationship

# 

# ↓

# 

# Foreshadow

# 

# ↓

# 

# Timeline

# 

# ↓

# 

# World

# 

# \---

# 

# \# 20. AI Rules

# 

# AI는

# 

# 자동 생성 금지

# 

# 자동 삭제 금지

# 

# 자동 수정 금지

# 

# 사용자 승인 후 저장

# 

# \---

# 

# \# 21. Event Flow

# 

# Story 변경

# 

# ↓

# 

# Character 분석

# 

# ↓

# 

# 새 인물 후보

# 

# ↓

# 

# 사용자 승인

# 

# ↓

# 

# Character DB 저장

# 

# ↓

# 

# Story Bible 갱신

# 

# ↓

# 

# Graph 갱신

# 

# ↓

# 

# Timeline 갱신

# 

# \---

# 

# \# 22. Import / Export

# 

# 지원

# 

# JSON

# 

# Markdown

# 

# NovelMD

# 

# Novel\_Master.zip

# 

# CSV

# 

# TXT Report

# 

# \---

# 

# \# 23. 성능 목표

# 

# 10000명 등장인물

# 

# 1000 Episode

# 

# 100000줄 소설

# 

# 검색 1초 이내

# 

# 자동 저장 0.5초 이내

# 

# \---

# 

# \# 24. 향후 확장

# 

# Character 성장 곡선

# 

# 감정 변화 그래프

# 

# 인물 관계도

# 

# AI 성격 분석

# 

# AI 대사 분석

# 

# 출현 빈도 Heat Map

# 

# Voice Profile

# 

# Multiverse Character

