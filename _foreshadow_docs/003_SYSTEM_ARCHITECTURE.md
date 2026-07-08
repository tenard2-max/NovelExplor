# \# 003\_SYSTEM\_ARCHITECTURE

# 

# \# 1. Architecture Overview

# 

# ```

# &#x20;                   Fantasy Foreshadow Tool

# 

# &#x20;                      Browser (GitHub Pages)

# 

# &#x20;┌─────────────────────────────────────────────────────────────┐

# &#x20;│                        UI Layer                             │

# &#x20;│                                                             │

# &#x20;│ Explorer │ Reader │ Editor │ Timeline │ Inspector │ Graph   │

# &#x20;└─────────────────────────────────────────────────────────────┘

# &#x20;                           │

# &#x20;                           ▼

# &#x20;┌─────────────────────────────────────────────────────────────┐

# &#x20;│                    Application Layer                        │

# &#x20;│                                                             │

# &#x20;│ Project Manager                                              │

# &#x20;│ Story Manager                                                │

# &#x20;│ Foreshadow Manager                                            │

# &#x20;│ Character Manager                                             │

# &#x20;│ World Manager                                                 │

# &#x20;│ Timeline Manager                                              │

# &#x20;│ Search Manager                                                │

# &#x20;│ Graph Manager                                                 │

# &#x20;│ Version Manager                                               │

# &#x20;│ Auto Save Manager                                             │

# &#x20;└─────────────────────────────────────────────────────────────┘

# &#x20;                           │

# &#x20;                           ▼

# &#x20;┌─────────────────────────────────────────────────────────────┐

# &#x20;│                        Data Layer                           │

# &#x20;│                                                             │

# &#x20;│ IndexedDB                                                   │

# &#x20;│ LocalStorage                                                │

# &#x20;│ Workspace Files                                             │

# &#x20;│ JSON Database                                               │

# &#x20;└─────────────────────────────────────────────────────────────┘

# ```

# 

# \---

# 

# \# 2. Module Architecture

# 

# Application

# 

# ```

# App

# &#x20;├── Workspace

# &#x20;├── Explorer

# &#x20;├── Story

# &#x20;├── Foreshadow

# &#x20;├── Character

# &#x20;├── World

# &#x20;├── Timeline

# &#x20;├── Search

# &#x20;├── Graph

# &#x20;├── Settings

# ```

# 

# \---

# 

# \# 3. Folder Structure

# 

# ```

# FantasyTool

# 

# /assets

# /icons

# /css

# /js

# 

# /core

# /project

# /story

# /editor

# /reader

# /foreshadow

# /character

# /world

# /timeline

# /search

# /graph

# /storage

# /ui

# 

# /workspace

# 

# NovelMD/

# 

# Novel\_Master.zip

# 

# README.md

# ```

# 

# \---

# 

# \# 4. Core Modules

# 

# \## Project Manager

# 

# 기능

# 

# \- 프로젝트 생성

# \- 프로젝트 열기

# \- 최근 프로젝트

# \- 자동 저장

# \- 백업

# \- 복구

# 

# \---

# 

# \## Story Manager

# 

# 기능

# 

# \- TXT Import

# \- MD Import

# \- Episode 생성

# \- Episode 수정

# \- 저장

# 

# \---

# 

# \## Editor

# 

# 기능

# 

# \- Markdown Editor

# \- Text Editor

# \- Undo

# \- Redo

# \- Replace

# \- Bookmark

# 

# \---

# 

# \## Reader

# 

# 기능

# 

# \- 목차

# \- 이전화

# \- 다음화

# \- 북마크

# \- 검색

# \- 다크모드

# 

# \---

# 

# \## Foreshadow Manager

# 

# 관리

# 

# \- 생성

# \- 수정

# \- 삭제

# \- 회수

# \- 미회수

# \- 폐기

# 

# 등급

# 

# F

# D

# C

# B

# A

# S

# SS

# SSS

# 

# \---

# 

# \## Character Manager

# 

# 관리

# 

# \- 생성

# \- 수정

# \- 삭제

# 

# 속성

# 

# 이름

# 별명

# 종족

# 나이

# 성별

# 외형

# 능력

# 첫 등장

# 마지막 등장

# 

# \---

# 

# \## World Manager

# 

# 관리

# 

# \- 국가

# \- 도시

# \- 지역

# \- 종족

# \- 마법

# \- 역사

# \- 용어

# 

# \---

# 

# \## Timeline Manager

# 

# 기능

# 

# \- 사건 생성

# \- 사건 수정

# \- 시대 보기

# \- 날짜 보기

# \- 사건 링크

# 

# \---

# 

# \## Search Manager

# 

# 지원

# 

# \- 전문검색

# \- 등장인물

# \- 복선

# \- 세계관

# \- 장소

# \- 에피소드

# 

# \---

# 

# \## Graph Manager

# 

# 그래프

# 

# Character Graph

# 

# Foreshadow Graph

# 

# Timeline Graph

# 

# Dependency Graph

# 

# Relationship Graph

# 

# \---

# 

# \# 5. Storage Architecture

# 

# Workspace

# 

# ```

# NovelProject

# 

# Project.json

# 

# Story/

# 

# Episode001.md

# 

# Episode002.md

# 

# Character/

# 

# World/

# 

# Timeline/

# 

# Foreshadow/

# 

# AutoSave/

# 

# Backup/

# 

# Export/

# ```

# 

# \---

# 

# \# 6. Database

# 

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

# Settings.json

# 

# Version.json

# 

# \---

# 

# \# 7. Event Flow

# 

# 프로젝트 열기

# 

# ↓

# 

# Workspace Load

# 

# ↓

# 

# Story Load

# 

# ↓

# 

# Character Load

# 

# ↓

# 

# World Load

# 

# ↓

# 

# Timeline Load

# 

# ↓

# 

# Foreshadow Load

# 

# ↓

# 

# Graph 생성

# 

# ↓

# 

# UI 갱신

# 

# \---

# 

# \# 8. Save Flow

# 

# 사용자 수정

# 

# ↓

# 

# Dirty Flag

# 

# ↓

# 

# Auto Save Queue

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

# \# 9. AI Flow

# 

# TXT Import

# 

# ↓

# 

# AI 분석

# 

# ↓

# 

# 복선 후보 생성

# 

# ↓

# 

# 사용자 승인

# 

# ↓

# 

# Foreshadow DB 저장

# 

# ↓

# 

# Story Bible 갱신

# 

# ↓

# 

# Timeline 갱신

# 

# ↓

# 

# Graph 갱신

# 

# \---

# 

# \# 10. GitHub Pages Constraints

# 

# 허용

# 

# HTML5

# 

# CSS3

# 

# JavaScript

# 

# Canvas API

# 

# IndexedDB

# 

# File System Access API

# 

# Web Components

# 

# JSON

# 

# 금지

# 

# Python

# 

# Node

# 

# Express

# 

# Flask

# 

# Django

# 

# Electron

# 

# 외부 DB

# 

# \---

# 

# \# 11. 확장성

# 

# 향후 추가 가능한 모듈

# 

# AI Summary

# 

# AI Consistency Checker

# 

# AI Character Analyzer

# 

# AI World Analyzer

# 

# AI Timeline Analyzer

# 

# Graph Visualization

# 

# Plugin System

# 

# Cloud Sync

# 

# Collaborative Editing

# 

# API Extension

