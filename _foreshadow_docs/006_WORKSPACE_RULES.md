# \# 006\_WORKSPACE\_RULES

# 

# \# 1. 목적

# 

# Workspace는 모든 프로젝트 데이터의 루트이다.

# 

# 사용자는 하나의 Workspace를 선택하며,

# 모든 읽기/쓰기 작업은 Workspace 내부에서만 수행한다.

# 

# Workspace 외부에는 어떠한 파일도 생성하거나 수정하지 않는다.

# 

# GitHub Pages 환경을 기준으로 설계한다.

# 

# \---

# 

# \# 2. Workspace 구조

# 

# ```

# FantasyProject/

# 

# Project.json

# 

# NovelMD/

# 

# Story/

# 

# Character/

# 

# World/

# 

# Timeline/

# 

# Foreshadow/

# 

# Relationship/

# 

# Dictionary/

# 

# Graph/

# 

# Import/

# 

# Export/

# 

# Backup/

# 

# AutoSave/

# 

# Cache/

# 

# Temp/

# 

# Log/

# ```

# 

# \---

# 

# \# 3. NovelMD 구조

# 

# ```

# NovelMD/

# 

# 00\_MASTER.md

# 

# 01\_STORY\_BIBLE.md

# 

# 02\_WORLD\_SETTING.md

# 

# 03\_CHARACTER\_DB.md

# 

# 04\_FORESHADOW\_DB.md

# 

# 05\_TIMELINE.md

# 

# EP001.md

# 

# EP002.md

# 

# ...

# 

# EP999.md

# ```

# 

# \---

# 

# \# 4. Export 구조

# 

# ```

# Export/

# 

# Novel\_Master.zip

# 

# Story.txt

# 

# Story.md

# 

# Story.json

# 

# Project\_Backup.zip

# ```

# 

# \---

# 

# \# 5. Backup 구조

# 

# ```

# Backup/

# 

# 2026-07-07/

# 

# Auto\_001.zip

# 

# Auto\_002.zip

# 

# Manual\_001.zip

# ```

# 

# \---

# 

# \# 6. Import 규칙

# 

# 지원 파일

# 

# TXT

# 

# MD

# 

# JSON

# 

# ZIP

# 

# 압축 해제는 Workspace 내부 Temp에서 수행한다.

# 

# \---

# 

# \# 7. 저장 규칙

# 

# 저장은 항상

# 

# Dirty Flag 확인

# 

# ↓

# 

# JSON 저장

# 

# ↓

# 

# Markdown 저장

# 

# ↓

# 

# Backup 생성

# 

# ↓

# 

# Version 증가

# 

# 순서로 수행한다.

# 

# \---

# 

# \# 8. 자동 저장

# 

# 기본

# 

# 5초

# 

# 사용자 변경 가능

# 

# 1\~300초

# 

# 자동 저장 시 UI는 차단하지 않는다.

# 

# \---

# 

# \# 9. 파일 생성 규칙

# 

# 새 파일 생성 위치

# 

# Story

# 

# Character

# 

# World

# 

# Timeline

# 

# Foreshadow

# 

# Relationship

# 

# Dictionary

# 

# 모든 파일명은 UTF-8을 사용한다.

# 

# \---

# 

# \# 10. 파일명 규칙

# 

# Episode

# 

# EP001.md

# 

# EP002.md

# 

# EP003.md

# 

# Character

# 

# CHR\_0001.json

# 

# Foreshadow

# 

# FS\_0001.json

# 

# Timeline

# 

# TL\_0001.json

# 

# World

# 

# WD\_0001.json

# 

# \---

# 

# \# 11. 삭제 규칙

# 

# 삭제는 즉시 제거하지 않는다.

# 

# Recycle Bin으로 이동한다.

# 

# 30일 후 자동 삭제한다.

# 

# Undo 가능해야 한다.

# 

# \---

# 

# \# 12. Lock 규칙

# 

# 동시에 하나의 파일만 수정 가능

# 

# 읽기는 여러 개 가능

# 

# 저장 중에는 Lock을 건다.

# 

# \---

# 

# \# 13. 캐시 규칙

# 

# Cache/

# 

# AI 분석 결과

# 

# 검색 인덱스

# 

# Graph Cache

# 

# Thumbnail

# 

# 프로그램 종료 시 재생성 가능해야 한다.

# 

# \---

# 

# \# 14. Temp 규칙

# 

# Temp/

# 

# 압축 해제

# 

# Import 작업

# 

# AI 임시 파일

# 

# 종료 시 자동 삭제

# 

# \---

# 

# \# 15. Version 규칙

# 

# Version.json

# 

# ```json

# {

# &#x20;"major":1,

# &#x20;"minor":0,

# &#x20;"patch":0,

# &#x20;"build":15

# }

# ```

# 

# 저장 시 Patch 증가

# 

# Export 시 Build 증가

# 

# \---

# 

# \# 16. Log 규칙

# 

# Log/

# 

# Save.log

# 

# Error.log

# 

# Import.log

# 

# AI.log

# 

# 최근 100개만 유지

# 

# \---

# 

# \# 17. Workspace Validation

# 

# 프로젝트 열기 시 검사

# 

# Project.json 존재

# 

# NovelMD 존재

# 

# Story 폴더 존재

# 

# Export 폴더 존재

# 

# Backup 폴더 존재

# 

# 없으면 자동 생성

# 

# \---

# 

# \# 18. Security Rules

# 

# Workspace 외부 접근 금지

# 

# 절대 경로 저장 금지

# 

# 상대 경로만 저장

# 

# 실행 파일(.exe, .bat 등) Import 금지

# 

# \---

# 

# \# 19. GitHub Pages 제약

# 

# 허용

# 

# HTML5

# 

# CSS3

# 

# JavaScript

# 

# IndexedDB

# 

# File System Access API

# 

# JSON

# 

# 금지

# 

# Python

# 

# Node.js

# 

# Express

# 

# Flask

# 

# Django

# 

# 외부 데이터베이스

# 

# \---

# 

# \# 20. 운영 원칙

# 

# 모든 데이터는 Workspace 내부에서만 관리한다.

# 

# 원본 Story(TXT/MD)는 항상 보존한다.

# 

# AI는 원본 파일을 직접 수정하지 않는다.

# 

# 모든 변경은 사용자 승인 후 반영한다.

# 

# Workspace는 언제든 다른 PC로 복사하여 동일한 프로젝트를 복원할 수 있어야 한다.

