# \# 009\_FORESHADOW\_ENGINE

# 

# \# 1. 목적

# 

# Foreshadow Engine은 소설 속 복선(Foreshadow)의 생성부터 회수까지

# 전 과정을 관리하는 핵심 엔진이다.

# 

# AI는 복선을 자동으로 분석하지만,

# 절대로 자동 등록하지 않는다.

# 

# 모든 결과는 사용자 승인 후 반영된다.

# 

# \---

# 

# \# 2. Engine Pipeline

# 

# Story Import

# 

# ↓

# 

# Story Parser

# 

# ↓

# 

# Character Analyzer

# 

# ↓

# 

# Keyword Analyzer

# 

# ↓

# 

# Context Analyzer

# 

# ↓

# 

# Foreshadow Candidate Generator

# 

# ↓

# 

# Contradiction Checker

# 

# ↓

# 

# Timeline Linker

# 

# ↓

# 

# Story Bible Sync

# 

# ↓

# 

# User Approval

# 

# ↓

# 

# Database Save

# 

# \---

# 

# \# 3. 복선 Life Cycle

# 

# NEW

# 

# ↓

# 

# CANDIDATE

# 

# ↓

# 

# APPROVED

# 

# ↓

# 

# ACTIVE

# 

# ↓

# 

# EXPECTED

# 

# ↓

# 

# RESOLVED

# 

# ↓

# 

# ARCHIVED

# 

# 또는

# 

# ↓

# 

# CANCELLED

# 

# \---

# 

# \# 4. Engine Modules

# 

# Foreshadow Engine

# 

# ```

# ForeshadowEngine

# 

# ├── Story Parser

# ├── Character Analyzer

# ├── World Analyzer

# ├── Timeline Analyzer

# ├── Keyword Analyzer

# ├── Pattern Analyzer

# ├── Context Analyzer

# ├── Contradiction Checker

# ├── Relationship Analyzer

# ├── Grade Calculator

# ├── Resolution Checker

# ├── Story Bible Sync

# ```

# 

# \---

# 

# \# 5. Story Parser

# 

# 추출

# 

# 문장

# 

# 문단

# 

# Chapter

# 

# Episode

# 

# Line

# 

# Paragraph

# 

# Word Count

# 

# \---

# 

# \# 6. Character Analyzer

# 

# 분석

# 

# 이름

# 

# 별칭

# 

# 호칭

# 

# 등장 빈도

# 

# 공동 등장

# 

# 사망 여부

# 

# 상태 변화

# 

# \---

# 

# \# 7. World Analyzer

# 

# 추출

# 

# 국가

# 

# 도시

# 

# 던전

# 

# 신

# 

# 종족

# 

# 마법

# 

# 아이템

# 

# 조직

# 

# \---

# 

# \# 8. Keyword Analyzer

# 

# 반복 키워드

# 

# 특수 용어

# 

# 상징

# 

# 색

# 

# 숫자

# 

# 이름

# 

# 장소

# 

# 마법

# 

# 유물

# 

# \---

# 

# \# 9. Context Analyzer

# 

# 분석

# 

# 암시

# 

# 복선

# 

# 예언

# 

# 회상

# 

# 꿈

# 

# 독백

# 

# 의심

# 

# 감정 변화

# 

# \---

# 

# \# 10. Pattern Analyzer

# 

# 패턴

# 

# 반복 문장

# 

# 반복 단어

# 

# 반복 사건

# 

# 반복 인물

# 

# 반복 장소

# 

# 반복 아이템

# 

# \---

# 

# \# 11. Candidate Generator

# 

# AI는

# 

# 복선 후보를 생성한다.

# 

# 예시

# 

# "붉은 반지"

# 

# ↓

# 

# 후보 생성

# 

# ↓

# 

# Grade 계산

# 

# ↓

# 

# 예상 회수 Episode 계산

# 

# ↓

# 

# 승인 대기

# 

# \---

# 

# \# 12. Grade System

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

# 기준

# 

# 출현 빈도

# 

# 중요도

# 

# 연결 수

# 

# 스토리 영향도

# 

# \---

# 

# \# 13. Confidence

# 

# 0\~100%

# 

# 90 이상

# 

# 자동 추천

# 

# 70\~89

# 

# 추천

# 

# 50\~69

# 

# 후보

# 

# 50 미만

# 

# 무시

# 

# \---

# 

# \# 14. Relationship Analyzer

# 

# 연결

# 

# Character

# 

# ↓

# 

# Character

# 

# ↓

# 

# World

# 

# ↓

# 

# Timeline

# 

# ↓

# 

# Foreshadow

# 

# Graph 생성

# 

# \---

# 

# \# 15. Contradiction Checker

# 

# 검사

# 

# 설정 충돌

# 

# 이름 변경

# 

# 시간 오류

# 

# 사망 후 등장

# 

# 장소 충돌

# 

# 마법 충돌

# 

# \---

# 

# \# 16. Resolution Checker

# 

# 복선이

# 

# 회수되었는지

# 

# 자동 검사

# 

# 상태

# 

# OPEN

# 

# ↓

# 

# EXPECTED

# 

# ↓

# 

# RESOLVED

# 

# 또는

# 

# MISSED

# 

# \---

# 

# \# 17. Story Bible Sync

# 

# 승인된 복선은

# 

# Story Bible

# 

# Character DB

# 

# Timeline

# 

# World DB

# 

# 자동 연결

# 

# \---

# 

# \# 18. AI Rules

# 

# AI는

# 

# 원본 TXT 수정 금지

# 

# 자동 저장 금지

# 

# 삭제 금지

# 

# 사용자 승인 필수

# 

# \---

# 

# \# 19. 성능 목표

# 

# 1000 Episode

# 

# 10000 복선

# 

# 100000줄

# 

# 1초 이내 검색

# 

# 5초 이내 분석 시작

# 

# \---

# 

# \# 20. 확장 예정

# 

# LLM Plugin

# 

# Graph AI

# 

# Foreshadow Prediction

# 

# Ending Prediction

# 

# Auto Story Bible

# 

# Relationship Heat Map

# 

# Semantic Search

# 

# RAG Memory

# 

# \---

# 

# \# 21. Engine Event Flow

# 

# Story Changed

# 

# ↓

# 

# Dirty Flag

# 

# ↓

# 

# Re Analysis Queue

# 

# ↓

# 

# Incremental Analyze

# 

# ↓

# 

# Changed Candidate

# 

# ↓

# 

# Approval

# 

# ↓

# 

# Database Update

# 

# ↓

# 

# Graph Update

# 

# ↓

# 

# Timeline Update

# 

# ↓

# 

# UI Refresh

