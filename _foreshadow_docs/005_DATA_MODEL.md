# \# 005\_DATA\_MODEL

# 

# \# 1. 목적

# 

# Fantasy Foreshadow Tool에서 사용하는 모든 데이터 구조를 정의한다.

# 

# 모든 데이터는 Workspace 내부 JSON으로 저장한다.

# 

# 외부 DB는 사용하지 않는다.

# 

# GitHub Pages에서 동작하는 것을 전제로 한다.

# 

# \---

# 

# \# 2. Database Structure

# 

# Workspace

# 

# ```

# Project.json

# 

# Story.json

# 

# Character.json

# 

# World.json

# 

# Timeline.json

# 

# Foreshadow.json

# 

# Setting.json

# 

# Version.json

# ```

# 

# \---

# 

# \# 3. Entity Relationship

# 

# ```

# Project

# &#x20;│

# &#x20;├── Story

# &#x20;│      │

# &#x20;│      ├── Episode

# &#x20;│      ├── Paragraph

# &#x20;│      └── Sentence

# &#x20;│

# &#x20;├── Character

# &#x20;│

# &#x20;├── World

# &#x20;│

# &#x20;├── Timeline

# &#x20;│

# &#x20;└── Foreshadow

# ```

# 

# \---

# 

# \# 4. Project

# 

# ```json

# {

# &#x20; "projectId":"",

# &#x20; "title":"",

# &#x20; "author":"",

# &#x20; "createdAt":"",

# &#x20; "updatedAt":"",

# &#x20; "version":"1.0.0",

# &#x20; "workspace":"",

# &#x20; "language":"ko"

# }

# ```

# 

# \---

# 

# \# 5. Episode

# 

# ```json

# {

# &#x20; "episodeId":"",

# &#x20; "title":"",

# &#x20; "number":1,

# &#x20; "summary":"",

# &#x20; "textFile":"",

# &#x20; "createdAt":"",

# &#x20; "updatedAt":""

# }

# ```

# 

# \---

# 

# \# 6. Character

# 

# ```json

# {

# &#x20; "characterId":"",

# &#x20; "name":"",

# &#x20; "alias":"",

# &#x20; "race":"",

# &#x20; "gender":"",

# &#x20; "age":0,

# &#x20; "occupation":"",

# &#x20; "description":"",

# &#x20; "ability":\[],

# &#x20; "firstEpisode":1,

# &#x20; "lastEpisode":999,

# &#x20; "status":"Alive"

# }

# ```

# 

# \---

# 

# \# 7. World

# 

# ```json

# {

# &#x20; "worldId":"",

# &#x20; "category":"Kingdom",

# &#x20; "name":"",

# &#x20; "description":"",

# &#x20; "parentId":"",

# &#x20; "relatedCharacters":\[]

# }

# ```

# 

# \---

# 

# \# 8. Timeline

# 

# ```json

# {

# &#x20; "eventId":"",

# &#x20; "episode":15,

# &#x20; "date":"1001-04-12",

# &#x20; "title":"",

# &#x20; "description":"",

# &#x20; "characters":\[],

# &#x20; "foreshadows":\[]

# }

# ```

# 

# \---

# 

# \# 9. Foreshadow

# 

# ```json

# {

# &#x20; "foreshadowId":"",

# &#x20; "title":"",

# &#x20; "description":"",

# &#x20; "grade":"A",

# &#x20; "status":"OPEN",

# &#x20; "createdEpisode":10,

# &#x20; "expectedEpisode":35,

# &#x20; "resolvedEpisode":0,

# &#x20; "relatedCharacters":\[],

# &#x20; "relatedEvents":\[],

# &#x20; "tags":\[]

# }

# ```

# 

# \---

# 

# \# 10. Foreshadow Grade

# 

# F

# 

# D

# 

# C

# 

# B

# 

# A

# 

# S

# 

# SS

# 

# SSS

# 

# \---

# 

# \# 11. Foreshadow Status

# 

# OPEN

# 

# PROGRESS

# 

# RESOLVED

# 

# CANCELLED

# 

# \---

# 

# \# 12. Story Bible

# 

# ```json

# {

# &#x20;"worlds":\[],

# &#x20;"characters":\[],

# &#x20;"foreshadows":\[],

# &#x20;"timeline":\[]

# }

# ```

# 

# \---

# 

# \# 13. Version

# 

# ```json

# {

# &#x20;"version":"1.0.0",

# &#x20;"createdAt":"",

# &#x20;"comment":""

# }

# ```

# 

# \---

# 

# \# 14. Settings

# 

# ```json

# {

# &#x20;"theme":"dark",

# &#x20;"fontSize":16,

# &#x20;"language":"ko",

# &#x20;"autoSave":true,

# &#x20;"autoSaveInterval":5

# }

# ```

# 

# \---

# 

# \# 15. Index

# 

# 검색 인덱스

# 

# Character Name

# 

# Episode

# 

# Foreshadow Title

# 

# Tag

# 

# Timeline Date

# 

# Location

# 

# \---

# 

# \# 16. File Rules

# 

# ID는 UUID 사용

# 

# 삭제 시 Soft Delete

# 

# CreatedAt / UpdatedAt 유지

# 

# 모든 객체는 projectId 포함

# 

# \---

# 

# \# 17. Relationship Rules

# 

# Character ↔ Episode

# 

# Character ↔ Foreshadow

# 

# Foreshadow ↔ Timeline

# 

# Timeline ↔ World

# 

# World ↔ Character

# 

# 모든 관계는 ID 참조 방식으로 관리한다.

# 

# \---

# 

# \# 18. Validation Rules

# 

# ID 중복 금지

# 

# 빈 제목 저장 금지

# 

# Episode 번호 중복 금지

# 

# Foreshadow Grade는 F\~SSS만 허용

# 

# Status는 OPEN, PROGRESS, RESOLVED, CANCELLED만 허용

# 

# \---

# 

# \# 19. Save Rules

# 

# Dirty Flag 발생 시 저장 대기열 등록

# 

# 자동 저장 후 Version.json 갱신

# 

# JSON 저장 실패 시 이전 버전 복원

# 

# \---

# 

# \# 20. 향후 확장

# 

# Graph Database

# 

# Plugin Data

# 

# AI Memory Cache

# 

# Cloud Sync Metadata

# 

# Revision History

# 

# Multi Author

