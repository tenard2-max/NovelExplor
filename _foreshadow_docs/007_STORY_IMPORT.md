# \# 007\_STORY\_IMPORT

# 

# \# 1. 목적

# 

# Story Import는 외부에서 작성된 소설을 Workspace로 가져오는 기능이다.

# 

# Import 과정에서는 원본을 절대 수정하지 않는다.

# 

# 모든 분석은 복사본 또는 메모리 상에서 수행한다.

# 

# \---

# 

# \# 2. 지원 형식

# 

# 텍스트

# 

# TXT

# 

# Markdown

# 

# MD

# 

# JSON

# 

# Novel\_Master.zip

# 

# NovelMD.zip

# 

# ZIP

# 

# \---

# 

# \# 3. Import Flow

# 

# 사용자

# 

# ↓

# 

# 파일 선택

# 

# ↓

# 

# 파일 형식 검사

# 

# ↓

# 

# Encoding 검사

# 

# ↓

# 

# 압축 해제(필요 시)

# 

# ↓

# 

# Story Parser

# 

# ↓

# 

# Story Analyzer

# 

# ↓

# 

# Workspace 생성

# 

# ↓

# 

# Story 저장

# 

# ↓

# 

# Story Bible 생성

# 

# ↓

# 

# Character 생성

# 

# ↓

# 

# Timeline 생성

# 

# ↓

# 

# Foreshadow 후보 생성

# 

# ↓

# 

# 사용자 승인

# 

# ↓

# 

# 최종 저장

# 

# \---

# 

# \# 4. Encoding

# 

# 지원

# 

# UTF-8

# 

# UTF-8 BOM

# 

# UTF-16

# 

# EUC-KR

# 

# CP949

# 

# 자동 감지 실패 시 사용자 선택

# 

# \---

# 

# \# 5. TXT Import

# 

# TXT는

# 

# Story/

# 

# Original/

# 

# EP001.txt

# 

# 형태로 저장한다.

# 

# 원본은 수정하지 않는다.

# 

# \---

# 

# \# 6. Markdown Import

# 

# 지원

# 

# .md

# 

# Markdown Heading

# 

# Code Block

# 

# Table

# 

# Quote

# 

# List

# 

# 이미지는 링크만 유지한다.

# 

# \---

# 

# \# 7. NovelMD Import

# 

# 자동 인식

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

# ...

# 

# EP999.md

# 

# \---

# 

# \# 8. ZIP Import

# 

# 압축 해제 위치

# 

# Temp/

# 

# 구조 검사

# 

# ↓

# 

# Workspace 이동

# 

# ↓

# 

# Temp 삭제

# 

# \---

# 

# \# 9. Story Parser

# 

# 자동 분석

# 

# Chapter

# 

# Episode

# 

# Paragraph

# 

# Sentence

# 

# Line Number

# 

# Word Count

# 

# \---

# 

# \# 10. Character Detection

# 

# 자동 추출

# 

# 이름

# 

# 별명

# 

# 호칭

# 

# 등장 횟수

# 

# 첫 등장

# 

# 마지막 등장

# 

# 신뢰도가 낮으면 후보만 제안한다.

# 

# \---

# 

# \# 11. World Detection

# 

# 자동 추출

# 

# 국가

# 

# 도시

# 

# 지역

# 

# 마법

# 

# 종족

# 

# 용어

# 

# \---

# 

# \# 12. Foreshadow Detection

# 

# AI는

# 

# 복선 후보

# 

# 떡밥

# 

# 회수 문장

# 

# 암시

# 

# 반복 키워드

# 

# 를 분석한다.

# 

# 자동 저장하지 않는다.

# 

# \---

# 

# \# 13. Timeline Detection

# 

# 추출

# 

# 사건

# 

# 날짜

# 

# 순서

# 

# 회상

# 

# 플래시백

# 

# 시간 이동

# 

# \---

# 

# \# 14. Validation

# 

# 필수 검사

# 

# 중복 Episode

# 

# 깨진 링크

# 

# 잘못된 JSON

# 

# 손상된 ZIP

# 

# 누락 파일

# 

# \---

# 

# \# 15. Duplicate Rules

# 

# 같은 Episode 존재

# 

# ↓

# 

# 덮어쓰기

# 

# 또는

# 

# 새 번호 생성

# 

# 사용자가 선택한다.

# 

# \---

# 

# \# 16. Error Handling

# 

# 오류 발생 시

# 

# Import 중단

# 

# 로그 저장

# 

# 원본 유지

# 

# 복구 가능

# 

# \---

# 

# \# 17. Import Log

# 

# Import.log

# 

# 기록

# 

# 시간

# 

# 파일명

# 

# 성공 여부

# 

# 경고

# 

# 오류

# 

# \---

# 

# \# 18. AI Approval

# 

# AI가 생성한

# 

# Character

# 

# World

# 

# Foreshadow

# 

# Timeline

# 

# 모두 사용자 승인 후 저장한다.

# 

# \---

# 

# \# 19. 성능 목표

# 

# 100MB TXT

# 

# 5초 이내 분석 시작

# 

# 500MB 프로젝트

# 

# Import 가능

# 

# 1000 Episode

# 

# 지원

# 

# 100000줄

# 

# 지원

# 

# \---

# 

# \# 20. 향후 확장

# 

# DOCX Import

# 

# PDF Import

# 

# EPUB Import

# 

# 웹소설 플랫폼 Import

# 

# Google Docs Import

# 

# Git Repository Import

# 

# Cloud Import

