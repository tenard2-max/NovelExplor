# \# 008\_EDITOR\_SPEC

# 

# \# 1. 목적

# 

# Story Editor는 판타지 소설을 작성하고 수정하는 핵심 기능이다.

# 

# 단순 텍스트 편집기가 아니라

# 

# \- Story Bible

# \- Character DB

# \- World DB

# \- Foreshadow DB

# \- Timeline

# 

# 과 실시간 연동된다.

# 

# AI는 편집을 보조하지만 사용자의 승인 없이 내용을 변경하지 않는다.

# 

# \---

# 

# \# 2. 지원 형식

# 

# TXT

# 

# Markdown

# 

# NovelMD

# 

# JSON

# 

# 읽기

# 

# 쓰기

# 

# 자동 저장

# 

# \---

# 

# \# 3. Layout

# 

# ```

# ┌───────────────────────────────────────────────┐

# │ Toolbar                                       │

# ├──────────────┬────────────────────────────────┤

# │ Explorer     │ Story Editor                   │

# │              │                                │

# │              │                                │

# ├──────────────┴────────────────────────────────┤

# │ Status Bar                                    │

# └───────────────────────────────────────────────┘

# ```

# 

# \---

# 

# \# 4. Editor 기능

# 

# 작성

# 

# 수정

# 

# 삭제

# 

# 복사

# 

# 붙여넣기

# 

# 잘라내기

# 

# Undo

# 

# Redo

# 

# 자동 저장

# 

# \---

# 

# \# 5. Markdown 지원

# 

# Heading

# 

# Bold

# 

# Italic

# 

# Quote

# 

# Code Block

# 

# List

# 

# Table

# 

# Image Link

# 

# Link

# 

# \---

# 

# \# 6. Story 기능

# 

# Episode 생성

# 

# Episode 삭제

# 

# Episode 이동

# 

# Episode 번호 변경

# 

# 자동 목차 생성

# 

# \---

# 

# \# 7. Character 연동

# 

# 이름 입력 시

# 

# Character DB 검색

# 

# 자동 완성

# 

# 새 인물 제안

# 

# 별칭 표시

# 

# 등장 횟수 갱신

# 

# \---

# 

# \# 8. World 연동

# 

# 장소 입력

# 

# ↓

# 

# World DB 검색

# 

# ↓

# 

# 자동 링크

# 

# ↓

# 

# 새 장소 생성 제안

# 

# \---

# 

# \# 9. Foreshadow 연동

# 

# 문장 선택

# 

# ↓

# 

# 복선 등록

# 

# ↓

# 

# 등급 선택

# 

# ↓

# 

# 예상 회수 화수 입력

# 

# ↓

# 

# Foreshadow DB 저장

# 

# \---

# 

# \# 10. Timeline 연동

# 

# 사건 입력

# 

# ↓

# 

# Timeline 자동 생성

# 

# ↓

# 

# Episode 연결

# 

# ↓

# 

# 날짜 연결

# 

# \---

# 

# \# 11. AI 기능

# 

# 지원

# 

# 복선 후보 분석

# 

# 모순 탐지

# 

# 인물 관계 분석

# 

# 세계관 충돌 검사

# 

# 미회수 복선 탐지

# 

# AI는 제안만 한다.

# 

# \---

# 

# \# 12. 검색

# 

# 전문검색

# 

# 정규식 검색

# 

# Replace

# 

# 다음 찾기

# 

# 이전 찾기

# 

# 대소문자 구분

# 

# \---

# 

# \# 13. Bookmark

# 

# 라인 북마크

# 

# Episode 북마크

# 

# 복선 북마크

# 

# 최근 편집 위치 저장

# 

# \---

# 

# \# 14. 자동 저장

# 

# Dirty Flag 발생

# 

# ↓

# 

# 5초 대기

# 

# ↓

# 

# IndexedDB 저장

# 

# ↓

# 

# Workspace 저장

# 

# ↓

# 

# Version 생성

# 

# \---

# 

# \# 15. Undo / Redo

# 

# 최소

# 

# 1000단계

# 

# 지원

# 

# 문장 단위

# 

# 복원

# 

# \---

# 

# \# 16. Drag \& Drop

# 

# TXT

# 

# MD

# 

# ZIP

# 

# Explorer

# 

# Story 이동

# 

# 지원

# 

# \---

# 

# \# 17. 단축키

# 

# Ctrl+N

# 

# 새 Episode

# 

# Ctrl+S

# 

# 저장

# 

# Ctrl+F

# 

# 검색

# 

# Ctrl+H

# 

# 바꾸기

# 

# Ctrl+Z

# 

# Undo

# 

# Ctrl+Y

# 

# Redo

# 

# Ctrl+B

# 

# 복선 등록

# 

# Ctrl+T

# 

# Timeline 등록

# 

# F5

# 

# AI 분석

# 

# \---

# 

# \# 18. Status Bar

# 

# 현재 Episode

# 

# Line

# 

# Column

# 

# Character Count

# 

# Word Count

# 

# 자동 저장 상태

# 

# Workspace

# 

# AI 상태

# 

# \---

# 

# \# 19. Validation

# 

# 빈 Episode 저장 금지

# 

# 잘못된 Markdown 검사

# 

# 깨진 링크 검사

# 

# 중복 Episode 번호 검사

# 

# 손상된 JSON 검사

# 

# \---

# 

# \# 20. 성능 목표

# 

# 100000줄

# 

# 실시간 편집

# 

# 1000 Episode

# 

# 동시 관리

# 

# Undo 1000단계

# 

# 검색 1초 이내

# 

# 자동 저장 0.5초 이내

# 

# \---

# 

# \# 21. 향후 확장

# 

# Split Editor

# 

# Multi Tab

# 

# Diff Viewer

# 

# Track Changes

# 

# Comment

# 

# AI Rewrite

# 

# AI Summary

# 

# AI Translation

# 

# Live Preview

# 

# Plugin System

