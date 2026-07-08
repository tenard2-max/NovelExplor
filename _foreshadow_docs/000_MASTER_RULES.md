# 000_MASTER_RULES.md

# TN FanTa Engine — Cursor Master Rules (헌법)

이 프로젝트는 MVP(Minimum Viable Product)를 우선한다. **동작하는 것이 완벽한 것보다 우선한다.**

이 문서는 모든 개발의 **최우선 규칙**이다.

모든 STEP을 진행하기 전에 반드시 이 문서를 먼저 읽는다.

다른 문서와 충돌하면 **이 문서를 우선**한다.

사용자의 오더와 충돌시 사용자에게 질문한다.

---

# 개발 철학

이 프로젝트는 **"웹에서 동작하는 판타지의 떡밥을 회수하는 Tool"** 이다.

- 게임을 만드는 것이 **아니다**. 떡밥을 던지고는 늘 까먹는 GPT와 개발자, 작가를 위한 애플리케이션을 개발한다.
- 라이브 서버방식이고, GitHub Pages에서 실행된다.
- 점진적으로 **요구사항의 연관관계를 그래프로 표시해야 한다.

---

# 개발 방식

한 번에 모든 기능을 구현하지 않는다.

STEP 하나 ~ 7개 정도만 구현한다.

STEP 완료 전 다음 STEP 구현 **금지**.
사용자가 처리 케파를 50% 이상 요구하는 오더를 주면 질문한다. 처리할 것인가? 위험 경고.(토큰이 녹는다고 경고)
---

# 반드시 지킬 규칙

```
STEP 시작 → 개발 → 실행 → 오류 수정 → 테스트 → Commit → 다음 STEP
```
사용자가 오류수정만 요청할때는 간단한 오류기때문에 수정만 한다.
Commit은 깃허브 기반 개발일때만 수행한다.
---

# 에셋 파이프라인 (Asset Pipeline)

Workspace 내 PNG는 아래 **단방향 흐름**을 따른다.


# 절대 금지

Python, Node Server, Express, Flask, Django, Electron, OpenCV, Pillow

Bounding Box 계산, 자동 Crop, 자동 Trim

AI 이미지 분석, AI Sprite 생성, 자동 이미지 수정

외부 서버, 외부 DB, 추측 구현, 요구사항에 없는 기능 추가

---

# 허용

HTML5, CSS3, JavaScript, Canvas API, Web Components

MediaRecorder API, File System Access API, IndexedDB, LocalStorage, JSON

---

# Workspace 규칙

모든 데이터는 사용자가 선택한 **Workspace** 내에서 관리한다.

Workspace 외부는 사용자의 허락을 구하고 접근가능,.

---

# PNG 규칙

PNG는 절대 **수정·Crop·Trim·Resize** 하지 않는다. **원본 유지**.

---
# 코드 규칙

읽기 쉬운 코드, 짧은 함수, 중복 제거, ES Module, 주석 작성

---

# 파일 규칙

하나의 파일은 500줄 기준으로 작성한다. 예외적으로 800줄까지 허용하되 기능별 분리한다.

---

# UI 규칙

정보/탐색, Canvas, explorer 세 부분으로 구동하며 각 모듈은 **독립적으로** 구현한다. (1:5:2)
모든 파일은 클릭시 내용을 수정/저장/보여줘야 한다.(MD, TXT)
---

# Cursor 행동 규칙

- 추측하지 않는다.
- 추가 기능을 만들지 않는다. (간단한 기능, 기본기능은 제외)
- **요구사항만** 구현한다.
- 개발 중 새로운 아이디어가 떠올라도 **현재 STEP에서는 구현하지 않는다.** `TODO.md`에 기록만 한다.
---

# 최종 목표

Motion Engine은 GitHub Pages에서 **설치 없이** 실행 가능한 HTML5 Motion Authoring Tool이어야 한다.

---
