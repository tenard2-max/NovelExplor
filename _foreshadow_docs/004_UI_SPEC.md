# \# 004\_UI\_SPEC

# 

# \# 1. UI 설계 목표

# 

# Fantasy Foreshadow Tool은

# 

# \- 소설 작성

# \- 소설 읽기

# \- 떡밥 관리

# \- 등장인물 관리

# \- 세계관 관리

# 

# 를 하나의 Workspace에서 수행한다.

# 

# UI는 Photoshop + VSCode Explorer + Notion의 장점을 결합한 형태를 목표로 한다.

# 

# \---

# 

# \# 2. Layout

# 

# ```

# ┌──────────────────────────────────────────────────────────────┐

# │ Menu Bar                                                     │

# ├──────────────────────────────────────────────────────────────┤

# │ Toolbar                                                      │

# ├─────────────┬──────────────────────────────┬─────────────────┤

# │ Explorer    │         Editor/Reader        │ Inspector       │

# │             │                              │                 │

# │             │                              │                 │

# ├─────────────┴──────────────────────────────┴─────────────────┤

# │ Timeline / Status Bar                                        │

# └──────────────────────────────────────────────────────────────┘

# ```

# 

# \---

# 

# \# 3. Menu Bar

# 

# 메뉴

# 

# File

# 

# \- New Project

# \- Open Project

# \- Save

# \- Save As

# \- Export

# \- Exit

# 

# Edit

# 

# \- Undo

# \- Redo

# \- Cut

# \- Copy

# \- Paste

# \- Replace

# 

# View

# 

# \- Reader

# \- Editor

# \- Timeline

# \- Graph

# \- Dark Mode

# 

# AI

# 

# \- Analyze Story

# \- Detect Foreshadow

# \- Detect Contradiction

# \- Update Story Bible

# 

# Help

# 

# \- Manual

# \- About

# 

# \---

# 

# \# 4. Toolbar

# 

# 아이콘

# 

# \- Open

# \- Save

# \- Undo

# \- Redo

# \- Search

# \- Bookmark

# \- AI Analyze

# \- Graph

# \- Export

# 

# \---

# 

# \# 5. Explorer

# 

# 폴더

# 

# ```

# Project

# 

# Story

# 

# Character

# 

# World

# 

# Foreshadow

# 

# Timeline

# 

# Setting

# 

# Backup

# 

# Export

# ```

# 

# 우클릭 메뉴

# 

# \- New

# \- Rename

# \- Delete

# \- Duplicate

# \- Copy

# \- Paste

# 

# Drag \& Drop 지원

# 

# \---

# 

# \# 6. Story Editor

# 

# 기능

# 

# \- Markdown

# \- TXT

# \- Syntax Highlight

# \- Line Number

# \- Word Wrap

# 

# 지원

# 

# Undo

# 

# Redo

# 

# Replace

# 

# Search

# 

# Bookmark

# 

# Auto Save

# 

# \---

# 

# \# 7. Reader

# 

# 기능

# 

# \- 목차

# \- 이전화

# \- 다음화

# \- 북마크

# \- 진행률 표시

# \- 글꼴 변경

# \- 줄간격 변경

# \- 다크모드

# 

# \---

# 

# \# 8. Inspector

# 

# 선택한 항목 정보 표시

# 

# Story

# 

# Character

# 

# Foreshadow

# 

# Timeline

# 

# World

# 

# Property 수정 가능

# 

# \---

# 

# \# 9. Timeline Panel

# 

# 표시

# 

# Episode

# 

# Date

# 

# Event

# 

# Character

# 

# Foreshadow

# 

# 정렬

# 

# \- 날짜

# \- 중요도

# \- 화수

# 

# \---

# 

# \# 10. Graph Panel

# 

# 지원

# 

# Character Graph

# 

# Foreshadow Graph

# 

# Timeline Graph

# 

# Relationship Graph

# 

# Dependency Graph

# 

# 줌

# 

# 드래그

# 

# 노드 선택

# 

# 필터

# 

# \---

# 

# \# 11. Status Bar

# 

# 표시

# 

# 현재 프로젝트

# 

# 자동저장 상태

# 

# Dirty Flag

# 

# AI 상태

# 

# Workspace

# 

# Cursor 위치

# 

# \---

# 

# \# 12. Dialog

# 

# 지원

# 

# Open

# 

# Save

# 

# Delete

# 

# Rename

# 

# Export

# 

# Import

# 

# Confirm

# 

# Warning

# 

# \---

# 

# \# 13. Theme

# 

# 지원

# 

# Light

# 

# Dark

# 

# High Contrast

# 

# \---

# 

# \# 14. Color Rules

# 

# Primary

# 

# Secondary

# 

# Success

# 

# Warning

# 

# Danger

# 

# Info

# 

# 색상은 CSS Variables로 관리한다.

# 

# \---

# 

# \# 15. Responsive

# 

# Desktop

# 

# Notebook

# 

# Tablet

# 

# 모바일은 읽기 전용 모드만 지원한다.

# 

# \---

# 

# \# 16. Keyboard Shortcut

# 

# Ctrl+N

# 

# 새 프로젝트

# 

# Ctrl+O

# 

# 열기

# 

# Ctrl+S

# 

# 저장

# 

# Ctrl+Shift+S

# 

# 다른 이름 저장

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

# 북마크

# 

# F5

# 

# AI 분석

# 

# \---

# 

# \# 17. UX Rules

# 

# 모든 변경사항은 Dirty Flag를 활성화한다.

# 

# 자동 저장은 5초 후 실행한다.

# 

# 삭제는 휴지통으로 이동한다.

# 

# 모든 작업은 Undo 가능해야 한다.

# 

# AI는 사용자 승인 전까지 어떤 파일도 수정하지 않는다.

# 

# \---

# 

# \# 18. Error UI

# 

# 경고

# 

# \- 저장 실패

# \- Workspace 없음

# \- 파일 손상

# \- JSON 오류

# 

# 사용자에게 원인과 복구 방법을 표시한다.

# 

# \---

# 

# \# 19. Accessibility

# 

# 키보드만으로 모든 기능 접근 가능

# 

# 색맹 대응 색상

# 

# 폰트 크기 확대

# 

# 스크린 리더 지원

# 

# \---

# 

# \# 20. 향후 UI

# 

# Split View

# 

# Multi Tab

# 

# Floating Window

# 

# Plugin Panel

# 

# AI Chat

# 

# Graph Inspector

# 

# Mini Map

# 

# Workspace Dashboard

