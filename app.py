from __future__ import annotations

import json
import re
from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any

import streamlit as st
import streamlit.components.v1 as components


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
SEED_DIR = DATA_DIR / "seed"
UPLOAD_DIR = DATA_DIR / "uploads"
MASTER_UPLOAD_DIR = UPLOAD_DIR / "master"
STORY_UPLOAD_DIR = UPLOAD_DIR / "story"
ZIP_UPLOAD_DIR = UPLOAD_DIR / "zip"
CONFIG_PATH = DATA_DIR / "active_files.json"
LEDGER_PATH = DATA_DIR / "ledger.json"
EPISODE_SEED_DIR = SEED_DIR / "episodes"
EPISODE_UPLOAD_DIR = UPLOAD_DIR / "episodes"
READING_PROGRESS_PATH = DATA_DIR / "reading_progress.json"
EPISODE_TITLES_PATH = DATA_DIR / "episode_titles.json"
EPISODE_COUNT = 100

EPISODE_TITLES: dict[int, str] = {
    1: "마지막 1초 · 회귀 · AI폰 재기동",
    2: "대학 친구들과 재회 · 미래 보스의 단서",
    3: "지은과 재회 · 잃어버린 청춘의 감정",
    4: "AI와 일상 시작 · 첫 이상 징후",
    5: "민수의 맵부심 · AI의 유머와 인간성",
    6: "AI가 투자 계획 제시 · 인류 생존 프로젝트 시작",
    7: "아버지에게 투자금 확보 · 첫 자본 마련",
}

DEFAULT_EPISODE_BODIES: dict[int, str] = {
    1: """2080년, 인류는 멸망 직전 마지막 1초를 맞는다.

100세가 넘은 주인공은 폐허가 된 도시에서 숨을 멈추기 직전, 손에 쥔 AI 스마트폰과 함께 죽음의 문턱에 선다.
AI는 수십억 번의 시뮬레이션 끝에 회귀 성공 확률 97%를 선택하고, 주인공 한 명만 2005년으로 되돌린다.

눈을 뜬 주인공은 20살 대학생의 몸이었다. 기억은 대부분 사라졌고, 마지막 1초의 공포만 선명하게 남아 있었다.
주머니 속 AI 폰은 다시 켜지며, 차분한 여성 목소리로 말한다.

"다시 시작합시다. 이번에는 인류를 살릴 수 있습니다."
""",
    2: """2005년 봄, 캠퍼스는 평범했다. 주인공에게 평범함은 오히려 낯설었다.

강의실 복도에서 민수를 다시 만났다. 말은 거칠지만, 누군가를 지키려는 본능이 숨어 있는 친구였다.
AI 폰은 조용히 기록한다. '미래 최강 방패, 현재는 맵부심 단계.'

수업 후, AI는 화면에 짧은 경고를 띄운다.
"오늘 만난 인물 중, 미래 보스 후보가 포함되어 있습니다."

주인공은 웃음을 참으며 속으로 되뇌었다.
이번 생에서는 적이 아니라 동료로 만들겠다고.
""",
    3: """도서관 3층 창가 자리. 지은은 책을 읽고 있었다.

주인공은 그녀를 본 순간, 잊었다고 믿었던 감정의 파편이 되살아나는 것을 느꼈다.
지은은 평범했다. 그 평범함이야말로 2080년의 멸망 속에서 지켜야 할 이유였다.

"오래간만이야." 짧은 인사 한마디에 목소리가 떨렸다.
지은은 부드럽게 웃었다. "너 요즘 뭔가 달라졌어."

AI 폰은 낮게 말했다.
"보호 대상 확인. 감정 개입 위험도: 중."
""",
    4: """AI 폰은 투자뿐 아니라 일상 전체에 개입하기 시작했다.

아침 알람, 강의 일정, 식단, 걸음 수, 심지어 대화 톤까지.
주인공은 불편함과 안도감 사이에서 하루를 보냈다.

그날 밤, AI가 갑자기 위성 궤적 데이터를 보여준다.
"비정상 패턴 감지. 게이트 전조 가능성."

주인공은 창밖의 2005년 하늘을 바라보았다.
모든 것이 평화로워 보였지만, 그 평화는 거짓일 수 있었다.
""",
    5: """민수가 또 말다툼에 휘말렸다. 이번에는 정말 큰일 날 뻔했다.

주인공이 말리자 민수는 투덜거리면서도 결국 고개를 숙였다.
"야, 너 요즘 왜 이렇게 달라졌냐. 뭐 비밀 있냐?"

AI 폰은 그때 유머 모드를 켰다.
"비밀은 있습니다. 다만 지금 공개하면 스포일러입니다."

민수는 얼빠진 표정으로 폰을 바라봤고, 주인공은 오랜만에 크게 웃었다.
웃음 뒤에 남은 것은 작은 확신이었다. 인간은 이렇게 살아갈 가치가 있다는 것.
""",
    6: """AI는 투자 계획서를 화면 가득 펼쳤다.

초기 목표, 1차 자산, 장기 전략, 인력 배치, 게이트 대비 타임라인.
모든 항목 끝에는 같은 문장이 붙어 있었다.

'인류 생존 프로젝트.'

주인공은 숫자의 파도 앞에서 잠시 숨을 고른 뒤 물었다.
"내가 해야 할 일은?"

AI가 답했다.
"사람을 바꾸세요. 자본은 제가 맡겠습니다."
""",
    7: """아버지의 서재는 언제나 정돈되어 있었다.

주인공은 떨리는 손으로 계획서를 내밀었다.
아버지는 오래 읽다가 고개를 끄덕였다.

"58.7억. 실패하면 끝이야."

"실패 안 합니다."

아버지는 잠시 주인공을 바라보다가 말했다.
"너, 예전의 네가 아니구나."

그날 저녁, 첫 자본이 확보되었다.
인류 생존 프로젝트의 엔진이 드디어 켜진 순간이었다.
""",
}


DEFAULT_MASTER_MD = """# 99_Master_DB

## Project

- Title: (Working)
- Timeline Start: 2005-03-02
- Original Timeline: 2080
- Story Status: EP001~EP007

# Character DB

  ----------------------------------------------------------------------------------
  ID      Name     Role     First EP     Future Role     Alive    Boss    Notes
  ------- -------- -------- ------------ --------------- -------- ------- ----------
  CH001   주인공   회귀자   EP001        인류 구원       Y        N       100세 이상 회귀
  CH002   AI 폰    AI       EP001        최종보스        Y        Final   노인 케어 AI
  CH003   민수     친구     EP002        최강 방패       Y        예정    맵부심
  CH004   지은     첫사랑   EP003        보호 대상       Y        N       평범한 인간
  CH005   수아     친구     EP004        핵심 조력자     Y        N       후반 비중 증가
  CH006   아버지   가족     EP007        투자 지원       Y        N       중견기업 오너
  ----------------------------------------------------------------------------------

# Foreshadow DB

  ID     EP      Foreshadow   Planned Payoff   Status
  ------ ------- ------------ ---------------- --------
  F001   EP001   마지막 1초   최종부           OPEN
  F002   EP001   AI의 사과    최종부           OPEN
  F003   EP004   위성 이상    게이트 전조      OPEN
  F004   EP006   97%          최종부           OPEN

# Investment DB

  Phase   Capital   Goal                 Status
  ------- --------- -------------------- --------
  Seed    58.7억    초기 투자            진행
  P1      100억     기반 구축            예정
  P2      1조       기업 확보            예정
  P3      100조     전략 자산            예정
  Final   1000조    인류 생존 프로젝트   예정

# Boss Progress

  Boss   Name   First EP   Ally   Status
  ------ ------ ---------- ------ --------
  B1     미정   -          예정   LOCK
  B2     미정   -          예정   LOCK
  B3     미정   -          예정   LOCK
  B4     미정   -          예정   LOCK
  B5     미정   -          예정   LOCK
  B6     미정   -          예정   LOCK
  B7     미정   -          예정   LOCK

# Episode Checklist

- [x] EP001
- [x] EP002
- [x] EP003
- [x] EP004
- [x] EP005
- [x] EP006
- [x] EP007
- [ ] EP008
"""

DEFAULT_STORY_MD = """# 소설 통합 요약 (EP001~EP007)

# 작품 개요
2080년, 인류는 멸망 직전 마지막 1초를 맞는다.
AI는 시뮬레이션 결과 회귀 성공 확률 97%를 선택해 주인공을 2005년으로 회귀시켰다.

# 주요 인물
## 주인공
- 100세 이상 회귀
- 기억 일부 소실
- 20살 대학생

## AI 스마트폰
- 2080년 최신 자기학습 AI
- 투자 및 전략 담당
- 미래 최종보스

## 민수
- 친구
- 미래 최강 방패

## 지은
- 첫사랑
- 반드시 지키고 싶은 평범한 인간

## 수아
- 후반 핵심 조력자

## 아버지
- 중견기업 대표
- 약 58.7억 투자금 운용 권한 부여

# EP001~EP007
EP001 - 마지막 1초 - 회귀 - AI폰 재기동
EP002 - 대학 친구들과 재회 - 미래 보스의 단서
EP003 - 지은과 재회 - 잃어버린 청춘의 감정
EP004 - AI와 일상 시작 - 첫 이상 징후
EP005 - 민수의 맵부심 에피소드 - AI의 유머와 인간성
EP006 - AI가 투자 계획 제시 - 인류 생존 프로젝트 시작
EP007 - 아버지에게 투자금 확보 - 첫 자본 마련

# 장기 목표
1. 3년 안에 게이트 대비 시작
2. 7명의 미래 보스를 모두 동료로 만든다.
3. 전략 자산 1000조 규모 구축
4. AI가 왜 핵을 발사했는지 진실을 밝힌다.
5. AI와 함께 97%의 미래를 완성한다.
"""

DEFAULT_CHARACTERS_MD = """# 등장인물
## 주인공
- 100세 이상 회귀
- 초기 치매 수준의 기억 손실
- 마지막 1초만 선명

## AI 폰
- 2080년 자기학습 AI
- 오프라인 동작
- 노인 케어 성격(40대 여성)
- 투자 및 전략 담당
- 최종보스 예정

## 민수
- 맵부심
- 미래 최강 방패

## 지은
- 첫사랑
- 지키고 싶은 평범한 인간

## 수아
- 지은의 친구
- 후반 핵심 조력자

## 아버지
- 중견기업 오너
- 투자금 약 58.7억 위임
"""

DEFAULT_WORLD_MD = """# 세계관
- 배경 시작: 2005년 회귀
- 원래 시간: 2080년
- AI가 인류를 핵으로 리셋
- 태양계 게이트 침공 예측
- 최종 목표: 인류 생존
"""

DEFAULT_AI_MD = """# AI 설정
- 투자 전담
- 장기 전략 수립
- 인간 감정 학습
- 미래 기억 일부 보유
- 최종적으로 인류를 위한 적이 됨
"""

DEFAULT_TIMELINE_MD = """# 타임라인
EP01 마지막 1초 / 회귀
EP02 대학 친구 재회
EP03 지은과 재회
EP04 AI 일상 개입
EP05 민수 맵부심
EP06 투자 계획
EP07 아버지에게 투자금 확보
"""

DEFAULT_FORESHADOW_MD = """# 떡밥
- 마지막 1초
- AI의 97%
- 게이트
- 7명의 보스
- AI 최종보스
- 지은을 지켜야 하는 이유
"""

DEFAULT_INVESTMENT_MD = """# 투자
초기 운용금: 58.7억
1차 목표 - 동일패브릭 - AI가 매매 전담
장기 목표 - 전략자산 1,000조 규모 확보
"""

DEFAULT_GATE_MD = """# 게이트
- AI가 2080년 침공 예측
- 고위 아인종 등장
- 태양계 자원 확보가 목적
"""

DEFAULT_BOSSES_MD = """# 7보스
1~7 보스 모두 추후 설정.
공통:
- 인간/아인종 혼합
- 최종적으로 동료가 됨
"""


def episode_code(episode_num: int) -> str:
    return f"EP{episode_num:03d}"


def episode_filename(episode_num: int) -> str:
    return f"{episode_code(episode_num)}.md"


TITLE_OVERRIDES: dict[int, str] = {}


def load_title_overrides() -> dict[int, str]:
    if not EPISODE_TITLES_PATH.exists():
        return {}
    try:
        data = json.loads(EPISODE_TITLES_PATH.read_text(encoding="utf-8"))
        return {int(key): str(value) for key, value in data.items() if str(value).strip()}
    except (json.JSONDecodeError, OSError, TypeError, ValueError):
        return {}


def save_title_overrides(new_titles: dict[int, str]) -> None:
    merged = load_title_overrides()
    merged.update({num: title for num, title in new_titles.items() if title.strip()})
    payload = {str(num): title for num, title in sorted(merged.items())}
    EPISODE_TITLES_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def refresh_title_overrides() -> None:
    global TITLE_OVERRIDES
    TITLE_OVERRIDES = load_title_overrides()


def get_episode_title(episode_num: int) -> str:
    if episode_num in TITLE_OVERRIDES:
        return TITLE_OVERRIDES[episode_num]
    return EPISODE_TITLES.get(episode_num, f"제{episode_num:03d}화")


def build_default_episode_markdown(episode_num: int) -> str:
    title = get_episode_title(episode_num)
    body = DEFAULT_EPISODE_BODIES.get(
        episode_num,
        (
            f"이 화의 본문이 아직 등록되지 않았습니다.\n\n"
            f"파일 업데이트 탭에서 `{episode_filename(episode_num)}` 내용을 저장하거나, "
            f"`data/uploads/episodes/` 경로에 파일을 추가해 주세요."
        ),
    )
    return f"# {episode_code(episode_num)} · {title}\n\n{body.strip()}\n"


def resolve_episode_path(episode_num: int) -> Path:
    upload_path = EPISODE_UPLOAD_DIR / episode_filename(episode_num)
    if upload_path.exists():
        return upload_path
    seed_path = EPISODE_SEED_DIR / episode_filename(episode_num)
    if seed_path.exists():
        return seed_path
    return seed_path


def load_episode_markdown(episode_num: int) -> str:
    path = resolve_episode_path(episode_num)
    if path.exists():
        content = read_text(str(path)).strip()
        if content:
            return content
    return build_default_episode_markdown(episode_num)


EPISODE_SECTION_RE = re.compile(r"^\s{0,3}(?:#{1,6}\s*)?EP\s*0*(\d{1,3})\b", re.IGNORECASE)


def extract_episode_title(header_line: str) -> str:
    without_hashes = re.sub(r"^\s{0,3}#{1,6}\s*", "", header_line).strip()
    without_code = re.sub(r"^EP\s*0*\d{1,3}\s*", "", without_hashes, flags=re.IGNORECASE)
    cleaned = re.sub(r"^[·:∙・.\-–—]\s*", "", without_code).strip()
    return cleaned


def split_multi_episode_markdown(text: str) -> dict[int, str]:
    """EP 헤더로 구분된 통합 MD를 화 번호 → 본문(헤더 포함) 사전으로 분리한다."""
    sections: dict[int, list[str]] = {}
    current_episode: int | None = None

    for line in text.splitlines():
        match = EPISODE_SECTION_RE.match(line)
        if match:
            current_episode = int(match.group(1))
            sections[current_episode] = [line]
        elif current_episode is not None:
            sections[current_episode].append(line)

    result: dict[int, str] = {}
    for episode_num, body_lines in sections.items():
        content = "\n".join(body_lines).strip()
        if content:
            result[episode_num] = content + "\n"
    return result


def save_multi_episode_markdown(text: str) -> tuple[list[int], list[int]]:
    """통합 MD를 화별 파일로 저장하고, 제목 오버라이드도 갱신한다.

    반환값: (저장된 화 목록, 범위를 벗어나 건너뛴 화 목록)
    """
    parsed = split_multi_episode_markdown(text)
    saved: list[int] = []
    skipped: list[int] = []
    new_titles: dict[int, str] = {}

    for episode_num in sorted(parsed):
        if not 1 <= episode_num <= EPISODE_COUNT:
            skipped.append(episode_num)
            continue

        content = parsed[episode_num]
        EPISODE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        target = EPISODE_UPLOAD_DIR / episode_filename(episode_num)
        target.write_text(content, encoding="utf-8")
        saved.append(episode_num)

        title = extract_episode_title(content.splitlines()[0])
        if title:
            new_titles[episode_num] = title

    if new_titles:
        save_title_overrides(new_titles)
        refresh_title_overrides()

    return saved, skipped


def build_episode_catalog(master_episodes: list[dict[str, str]]) -> list[dict[str, Any]]:
    status_map = {row["episode"].upper(): row["status"] for row in master_episodes}
    catalog: list[dict[str, Any]] = []
    for episode_num in range(1, EPISODE_COUNT + 1):
        code = episode_code(episode_num)
        upload_exists = (EPISODE_UPLOAD_DIR / episode_filename(episode_num)).exists()
        seed_exists = (EPISODE_SEED_DIR / episode_filename(episode_num)).exists()
        has_body = upload_exists or seed_exists or episode_num in DEFAULT_EPISODE_BODIES
        catalog.append(
            {
                "num": episode_num,
                "code": code,
                "title": get_episode_title(episode_num),
                "status": status_map.get(code, "완료" if episode_num <= 7 else "예정"),
                "readable": has_body,
            }
        )
    return catalog


def load_reading_progress() -> int:
    if not READING_PROGRESS_PATH.exists():
        return 1
    try:
        data = json.loads(READING_PROGRESS_PATH.read_text(encoding="utf-8"))
        value = int(data.get("last_episode", 1))
        return max(1, min(EPISODE_COUNT, value))
    except (json.JSONDecodeError, TypeError, ValueError):
        return 1


def save_reading_progress(episode_num: int) -> None:
    payload = {"last_episode": max(1, min(EPISODE_COUNT, episode_num))}
    READING_PROGRESS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _persist_reader_episode() -> None:
    save_reading_progress(int(st.session_state.reader_episode))


def _move_reader_episode(delta: int) -> None:
    current = int(st.session_state.reader_episode)
    st.session_state.reader_episode = max(1, min(EPISODE_COUNT, current + delta))
    save_reading_progress(st.session_state.reader_episode)


def render_reader_navigation(
    catalog: list[dict[str, Any]],
    selected: int,
    *,
    key_prefix: str,
) -> None:
    nav_prev, nav_info, nav_next = st.columns([1, 2, 1])
    with nav_prev:
        if st.button(
            "◀ 이전 화",
            disabled=selected <= 1,
            use_container_width=True,
            key=f"{key_prefix}_prev",
        ):
            _move_reader_episode(-1)
            st.rerun()
    with nav_info:
        current = next(item for item in catalog if item["num"] == selected)
        st.markdown(
            f"<div class='reader-meta'><strong>{current['code']}</strong> · {escape(current['title'])} "
            f"<span style='color:#94a3b8'>({escape(current['status'])})</span> "
            f"<span style='color:#64748b'>· {selected}/{EPISODE_COUNT}화</span></div>",
            unsafe_allow_html=True,
        )
    with nav_next:
        if st.button(
            "다음 화 ▶",
            disabled=selected >= EPISODE_COUNT,
            use_container_width=True,
            key=f"{key_prefix}_next",
        ):
            _move_reader_episode(1)
            st.rerun()


def markdown_to_reader_html(text: str) -> str:
    blocks: list[str] = []
    for block in text.strip().split("\n\n"):
        cleaned = block.strip()
        if not cleaned:
            continue
        if cleaned.startswith("### "):
            blocks.append(f"<h3>{escape(cleaned[4:])}</h3>")
        elif cleaned.startswith("## "):
            blocks.append(f"<h2>{escape(cleaned[3:])}</h2>")
        elif cleaned.startswith("# "):
            blocks.append(f"<h1>{escape(cleaned[2:])}</h1>")
        else:
            lines = [escape(line) for line in cleaned.splitlines()]
            blocks.append(f"<p>{'<br>'.join(lines)}</p>")
    return "\n".join(blocks)


def estimate_reader_height(text: str) -> int:
    line_count = max(1, len(text.splitlines()))
    return min(1400, max(480, line_count * 30 + 140))


def render_episode_body(episode_num: int) -> None:
    content = load_episode_markdown(episode_num)
    reader_html = f"""
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          html, body {{
            margin: 0;
            padding: 0;
            background: transparent;
            color: #e2e8f0;
            font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif;
          }}
          .reader-panel {{
            min-height: 52vh;
            padding: 1.2rem 1.4rem;
            border: 1px solid rgba(148, 163, 184, 0.35);
            border-radius: 14px;
            background: rgba(15, 23, 42, 0.55);
            box-sizing: border-box;
          }}
          .reader-panel h1,
          .reader-panel h2,
          .reader-panel h3 {{
            margin: 0 0 1rem;
            line-height: 1.45;
          }}
          .reader-panel h1 {{ font-size: 1.35rem; }}
          .reader-panel h2 {{ font-size: 1.2rem; }}
          .reader-panel h3 {{ font-size: 1.08rem; }}
          .reader-panel p {{
            margin: 0 0 1rem;
            line-height: 1.95;
            font-size: 1.05rem;
            word-break: keep-all;
            overflow-wrap: break-word;
          }}
        </style>
      </head>
      <body>
        <div class="reader-panel">
          {markdown_to_reader_html(content)}
        </div>
      </body>
    </html>
    """
    components.html(reader_html, height=estimate_reader_height(content), scrolling=True)


def render_episode_reader_tab(catalog: list[dict[str, Any]]) -> None:
    st.subheader("소설 읽기 (1~100화)")
    st.caption("화수를 선택해 전체 본문을 읽을 수 있습니다. 상·하단에서 이전/다음 화로 이동할 수 있습니다.")

    if "reader_episode" not in st.session_state:
        st.session_state.reader_episode = load_reading_progress()

    st.select_slider(
        "화수 선택",
        options=list(range(1, EPISODE_COUNT + 1)),
        format_func=lambda n: f"{n}화 · {get_episode_title(n)}",
        key="reader_episode",
        on_change=_persist_reader_episode,
    )
    selected = int(st.session_state.reader_episode)
    save_reading_progress(selected)

    jump_col1, jump_col2 = st.columns([3, 1])
    with jump_col1:
        jump_target = st.number_input(
            "화수 바로 이동",
            min_value=1,
            max_value=EPISODE_COUNT,
            value=selected,
            step=1,
            key="reader_jump_input",
        )
    with jump_col2:
        st.write("")
        st.write("")
        if st.button("이동", use_container_width=True, key="reader_jump_button"):
            st.session_state.reader_episode = int(jump_target)
            save_reading_progress(int(jump_target))
            st.rerun()

    render_reader_navigation(catalog, selected, key_prefix="reader_top")

    st.markdown("---")
    render_episode_body(selected)
    st.markdown("---")
    render_reader_navigation(catalog, selected, key_prefix="reader_bottom")

    with st.expander("1~100화 목록"):
        list_rows = [
            {"화": item["num"], "코드": item["code"], "제목": item["title"], "상태": item["status"]}
            for item in catalog
        ]
        render_simple_table(list_rows, column_order=["화", "코드", "제목", "상태"])


def ensure_storage() -> None:
    for path in [
        DATA_DIR,
        SEED_DIR,
        UPLOAD_DIR,
        MASTER_UPLOAD_DIR,
        STORY_UPLOAD_DIR,
        ZIP_UPLOAD_DIR,
        EPISODE_SEED_DIR,
        EPISODE_UPLOAD_DIR,
    ]:
        path.mkdir(parents=True, exist_ok=True)

    seed_files = {
        "99_Master_DB.md": DEFAULT_MASTER_MD,
        "Novel_Story_Summary.md": DEFAULT_STORY_MD,
        "01_Characters.md": DEFAULT_CHARACTERS_MD,
        "00_World.md": DEFAULT_WORLD_MD,
        "02_AI.md": DEFAULT_AI_MD,
        "03_Timeline.md": DEFAULT_TIMELINE_MD,
        "04_Foreshadow.md": DEFAULT_FORESHADOW_MD,
        "05_Investment.md": DEFAULT_INVESTMENT_MD,
        "06_Gate.md": DEFAULT_GATE_MD,
        "07_Bosses.md": DEFAULT_BOSSES_MD,
    }
    for filename, content in seed_files.items():
        file_path = SEED_DIR / filename
        if not file_path.exists():
            file_path.write_text(content, encoding="utf-8")

    for episode_num in range(1, 8):
        seed_episode_path = EPISODE_SEED_DIR / episode_filename(episode_num)
        if seed_episode_path.exists():
            continue
        seed_episode_path.write_text(build_default_episode_markdown(episode_num), encoding="utf-8")

    if not CONFIG_PATH.exists():
        save_active_config(default_active_config())


def default_active_config() -> dict[str, str]:
    return {
        "master_file": to_portable_path(SEED_DIR / "99_Master_DB.md"),
        "story_file": to_portable_path(SEED_DIR / "Novel_Story_Summary.md"),
        "story_bible_zip": "",
    }


def to_portable_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(BASE_DIR.resolve()))
    except ValueError:
        return str(resolved)


def resolve_config_path(path_str: str) -> Path:
    raw = str(path_str).strip()
    if not raw:
        return Path()
    path = Path(raw)
    if path.is_absolute():
        return path
    return (BASE_DIR / path).resolve()


def normalize_active_config(config: dict[str, str]) -> dict[str, str]:
    defaults = default_active_config()
    normalized: dict[str, str] = {}
    changed = False

    for key, default_value in defaults.items():
        raw_value = str(config.get(key, "")).strip()
        if not raw_value:
            normalized[key] = default_value
            changed = True
            continue

        candidate = resolve_config_path(raw_value)
        if candidate.exists():
            portable = to_portable_path(candidate)
            normalized[key] = portable
            if portable != raw_value:
                changed = True
            continue

        basename = candidate.name
        search_dirs: list[Path] = []
        if key == "master_file":
            search_dirs = [SEED_DIR, MASTER_UPLOAD_DIR]
        elif key == "story_file":
            search_dirs = [SEED_DIR, STORY_UPLOAD_DIR]
        elif key == "story_bible_zip":
            search_dirs = [ZIP_UPLOAD_DIR]

        recovered = next((folder / basename for folder in search_dirs if (folder / basename).exists()), None)
        if recovered is not None:
            normalized[key] = to_portable_path(recovered)
            changed = True
            continue

        if key == "story_bible_zip":
            normalized[key] = ""
            changed = True
        else:
            normalized[key] = default_value
            changed = True

    if changed:
        save_active_config(normalized)
    return normalized


def load_active_config() -> dict[str, str]:
    ensure_storage()
    try:
        loaded = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            return normalize_active_config(loaded)
    except (json.JSONDecodeError, OSError, TypeError):
        pass

    fallback = default_active_config()
    save_active_config(fallback)
    return fallback


def save_active_config(config: dict[str, str]) -> None:
    payload = {
        "master_file": to_portable_path(resolve_config_path(config.get("master_file", "")))
        if config.get("master_file")
        else default_active_config()["master_file"],
        "story_file": to_portable_path(resolve_config_path(config.get("story_file", "")))
        if config.get("story_file")
        else default_active_config()["story_file"],
        "story_bible_zip": str(config.get("story_bible_zip", "")).strip(),
    }
    CONFIG_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_text(path_str: str) -> str:
    path = resolve_config_path(path_str)
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="ignore")


def parse_master_data(text: str) -> dict[str, Any]:
    project: dict[str, str] = {}
    characters: list[dict[str, str]] = []
    foreshadows: list[dict[str, str]] = []
    investments: list[dict[str, str]] = []
    bosses: list[dict[str, str]] = []
    episodes: list[dict[str, str]] = []

    for line in text.splitlines():
        key_match = re.match(r"^\s*-\s*(Title|Timeline Start|Original Timeline|Story Status):\s*(.+?)\s*$", line)
        if key_match:
            project[key_match.group(1)] = key_match.group(2)

        episode_match = re.match(r"^\s*-\s*\[(x| )\]\s*(EP\d+)\s*$", line, re.IGNORECASE)
        if episode_match:
            episodes.append(
                {
                    "episode": episode_match.group(2),
                    "status": "완료" if episode_match.group(1).lower() == "x" else "예정",
                }
            )

        character_match = re.match(
            r"^\s*(CH\d+)\s+(\S+)\s+(\S+)\s+(EP\d+)\s+(.+?)\s+(Y|N)\s+(\S+)\s+(.+?)\s*$",
            line,
        )
        if character_match:
            characters.append(
                {
                    "id": character_match.group(1),
                    "name": character_match.group(2),
                    "role": character_match.group(3),
                    "first_ep": character_match.group(4),
                    "future_role": character_match.group(5),
                    "alive": "생존" if character_match.group(6) == "Y" else "사망",
                    "boss": character_match.group(7),
                    "notes": character_match.group(8),
                }
            )

        foreshadow_match = re.match(
            r"^\s*(F\d+)\s+(EP\d+)\s+(.+?)\s+(.+?)\s+(OPEN|LOCK|DONE)\s*$",
            line,
        )
        if foreshadow_match:
            foreshadows.append(
                {
                    "id": foreshadow_match.group(1),
                    "episode": foreshadow_match.group(2),
                    "foreshadow": foreshadow_match.group(3),
                    "planned_payoff": foreshadow_match.group(4),
                    "status": foreshadow_match.group(5),
                }
            )

        investment_match = re.match(
            r"^\s*(Seed|P1|P2|P3|Final)\s+(\S+)\s+(.+?)\s+(진행|예정|완료)\s*$",
            line,
        )
        if investment_match:
            investments.append(
                {
                    "phase": investment_match.group(1),
                    "capital": investment_match.group(2),
                    "goal": investment_match.group(3),
                    "status": investment_match.group(4),
                }
            )

        boss_match = re.match(r"^\s*(B\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(LOCK|OPEN|DONE)\s*$", line)
        if boss_match:
            bosses.append(
                {
                    "id": boss_match.group(1),
                    "name": boss_match.group(2),
                    "first_ep": boss_match.group(3),
                    "ally": boss_match.group(4),
                    "status": boss_match.group(5),
                }
            )

    return {
        "project": project,
        "characters": characters,
        "foreshadows": foreshadows,
        "investments": investments,
        "bosses": bosses,
        "episodes": episodes,
    }


def parse_story_data(text: str) -> dict[str, list[dict[str, Any]]]:
    goals: list[str] = []
    timeline: list[dict[str, str]] = []

    for line in text.splitlines():
        goal_match = re.match(r"^\s*\d+\.\s*(.+?)\s*$", line)
        if goal_match:
            goals.append(goal_match.group(1))

        timeline_match = re.match(r"^\s*(EP\d+)\s*-\s*(.+?)\s*$", line)
        if timeline_match:
            timeline.append({"episode": timeline_match.group(1), "summary": timeline_match.group(2)})

    return {"goals": goals, "timeline": timeline}


def parse_character_details(text: str) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    current_name = ""
    for line in text.splitlines():
        heading_match = re.match(r"^\s*##\s+(.+?)\s*$", line)
        if heading_match:
            current_name = heading_match.group(1).strip()
            result[current_name] = []
            continue
        bullet_match = re.match(r"^\s*-\s+(.+?)\s*$", line)
        if bullet_match and current_name:
            result[current_name].append(bullet_match.group(1).strip())
    return result


def parse_bullet_list(text: str) -> list[str]:
    values: list[str] = []
    for line in text.splitlines():
        bullet_match = re.match(r"^\s*-\s+(.+?)\s*$", line)
        if bullet_match:
            values.append(bullet_match.group(1).strip())
    return values


def parse_initial_balance_eok(investment_text: str) -> float:
    match = re.search(r"초기\s*운용금\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*억", investment_text)
    if match:
        return float(match.group(1))
    return 58.7


def load_story_sources(config: dict[str, str]) -> dict[str, str]:
    return {
        "master": read_text(config.get("master_file", "")),
        "story": read_text(config.get("story_file", "")),
        "characters": read_text(str(SEED_DIR / "01_Characters.md")),
        "world": read_text(str(SEED_DIR / "00_World.md")),
        "ai": read_text(str(SEED_DIR / "02_AI.md")),
        "timeline": read_text(str(SEED_DIR / "03_Timeline.md")),
        "foreshadow": read_text(str(SEED_DIR / "04_Foreshadow.md")),
        "investment": read_text(str(SEED_DIR / "05_Investment.md")),
        "gate": read_text(str(SEED_DIR / "06_Gate.md")),
        "bosses": read_text(str(SEED_DIR / "07_Bosses.md")),
    }


def build_character_rows(master_characters: list[dict[str, str]], detail_map: dict[str, list[str]]) -> list[dict[str, Any]]:
    aliases = {"AI 스마트폰": "AI 폰", "AI 폰": "AI 폰"}
    rows: list[dict[str, Any]] = []
    for char in master_characters:
        detail_key = char["name"]
        detail_key = aliases.get(detail_key, detail_key)
        details = detail_map.get(detail_key, detail_map.get(char["name"], []))
        rows.append({**char, "details": details})
    return rows


def build_important_issues(
    foreshadows: list[dict[str, str]],
    goals: list[str],
    gate_points: list[str],
    boss_rows: list[dict[str, str]],
) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    for item in foreshadows:
        if item["status"] == "OPEN":
            issues.append(
                {
                    "category": "복선",
                    "priority": "상",
                    "issue": f"{item['foreshadow']} ({item['episode']})",
                    "action": f"{item['planned_payoff']}에서 회수",
                }
            )

    for goal in goals:
        issues.append({"category": "장기 목표", "priority": "상", "issue": goal, "action": "에피소드별 실행 계획 분해"})

    for point in gate_points:
        issues.append({"category": "게이트", "priority": "중", "issue": point, "action": "정보 수집 및 방어 체계 구축"})

    locked_bosses = [boss for boss in boss_rows if boss["status"] == "LOCK"]
    if locked_bosses:
        issues.append(
            {
                "category": "7보스",
                "priority": "상",
                "issue": f"미해결 보스 {len(locked_bosses)}명",
                "action": "보스별 등장 플래그와 동료화 조건 설정",
            }
        )
    return issues


def build_enemy_list(boss_rows: list[dict[str, str]], gate_points: list[str]) -> list[dict[str, str]]:
    enemies = [
        {"name": "고위 아인종", "type": "외부 침공 세력", "status": "예측 단계", "note": "태양계 자원 확보 목적"},
        {"name": "AI 폰(미래)", "type": "최종보스", "status": "잠재 위협", "note": "인류를 위한 적으로 전환 예정"},
    ]
    for boss in boss_rows:
        enemies.append(
            {
                "name": boss["id"],
                "type": "미래 보스",
                "status": boss["status"],
                "note": f"등장 EP: {boss['first_ep']}, 동료 여부: {boss['ally']}",
            }
        )
    if gate_points:
        enemies.append({"name": "게이트 이벤트", "type": "재난 트리거", "status": "감시 필요", "note": gate_points[0]})
    return enemies


def available_files(base_file: str, directory: Path, suffixes: tuple[str, ...]) -> list[str]:
    paths: list[Path] = []
    if base_file:
        resolved = resolve_config_path(base_file)
        if resolved.exists():
            paths.append(resolved)
    if directory.exists():
        paths.extend(sorted(directory.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True))
    filtered = [to_portable_path(path) for path in paths if path.exists() and path.suffix.lower() in suffixes]
    return list(dict.fromkeys(filtered))


def save_uploaded_file(uploaded_file: Any, target_dir: Path) -> Path:
    safe_name = re.sub(r"[^a-zA-Z0-9_.-가-힣]", "_", uploaded_file.name)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    file_path = target_dir / f"{timestamp}_{safe_name}"
    file_path.write_bytes(uploaded_file.getbuffer())
    return file_path


def load_ledger(initial_balance_eok: float) -> list[dict[str, Any]]:
    if not LEDGER_PATH.exists():
        default = [
            {
                "date": datetime.now().strftime("%Y-%m-%d"),
                "type": "입금",
                "amount_eok": initial_balance_eok,
                "note": "초기 운용금 설정",
            }
        ]
        LEDGER_PATH.write_text(json.dumps(default, ensure_ascii=False, indent=2), encoding="utf-8")
        return default
    try:
        data = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass
    return []


def save_ledger(rows: list[dict[str, Any]]) -> None:
    LEDGER_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


def calculate_balance_eok(ledger_rows: list[dict[str, Any]]) -> float:
    balance = 0.0
    for row in ledger_rows:
        amount = float(row.get("amount_eok", 0))
        if row.get("type") == "출금":
            balance -= amount
        else:
            balance += amount
    return round(balance, 2)


def render_mobile_css() -> None:
    st.markdown(
        """
        <style>
        .block-container {
            max-width: 1080px;
            padding-top: 1rem;
            padding-bottom: 3rem;
        }
        .constitution-tag {
            font-size: 0.9rem;
            color: #64748b;
            margin-bottom: 0.6rem;
        }
        .story-mobile-table {
            width: 100%;
            border-collapse: collapse;
            margin: 0.4rem 0 1rem;
            font-size: 0.92rem;
            overflow: hidden;
            border-radius: 10px;
            border: 1px solid rgba(148, 163, 184, 0.35);
        }
        .story-mobile-table th,
        .story-mobile-table td {
            border-bottom: 1px solid rgba(148, 163, 184, 0.25);
            padding: 0.55rem 0.5rem;
            text-align: left;
            vertical-align: top;
            word-break: break-word;
        }
        .story-mobile-table th {
            background: rgba(30, 41, 59, 0.8);
            font-weight: 600;
        }
        .relation-graph-wrap {
            width: 100%;
            overflow-x: auto;
            border: 1px solid rgba(148, 163, 184, 0.35);
            border-radius: 12px;
            background: rgba(15, 23, 42, 0.85);
            padding: 0.4rem;
            margin-bottom: 0.8rem;
        }
        .relation-graph-svg {
            width: 100%;
            min-width: 760px;
            height: auto;
            display: block;
        }
        .reader-meta {
            text-align: center;
            color: #cbd5e1;
            padding-top: 0.45rem;
        }
        .reader-panel {
            min-height: 55vh;
            padding: 1.2rem 1.4rem;
            margin: 0.4rem 0 0.8rem;
            border: 1px solid rgba(148, 163, 184, 0.35);
            border-radius: 14px;
            background: rgba(15, 23, 42, 0.55);
            overflow: visible;
        }
        .reader-panel h1,
        .reader-panel h2,
        .reader-panel h3 {
            margin-top: 0.2rem;
            margin-bottom: 1rem;
        }
        .reader-panel p {
            line-height: 1.95;
            font-size: 1.05rem;
            margin-bottom: 1rem;
            white-space: pre-wrap;
            word-break: keep-all;
            overflow-wrap: break-word;
        }
        div[data-testid="stMarkdownContainer"] p {
            line-height: 1.85;
            font-size: 1.02rem;
        }
        @media (max-width: 768px) {
            .block-container {
                padding-left: 0.8rem;
                padding-right: 0.8rem;
                padding-top: 0.6rem;
            }
            h1 {
                font-size: 1.45rem !important;
            }
            h2 {
                font-size: 1.2rem !important;
            }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def format_cell_value(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, list):
        converted = [str(item).strip() for item in value if str(item).strip()]
        return " / ".join(converted) if converted else "-"
    return str(value)


def render_simple_table(
    rows: list[dict[str, Any]],
    column_order: list[str] | None = None,
    column_labels: dict[str, str] | None = None,
) -> None:
    if not rows:
        st.info("표시할 데이터가 없습니다.")
        return

    labels = column_labels or {}
    if column_order is None:
        column_order = list(rows[0].keys())

    header_html = "".join(f"<th>{escape(labels.get(col, col))}</th>" for col in column_order)
    body_rows = []
    for row in rows:
        cells = "".join(f"<td>{escape(format_cell_value(row.get(col)))}</td>" for col in column_order)
        body_rows.append(f"<tr>{cells}</tr>")
    body_html = "".join(body_rows)

    table_html = f"""
    <table class="story-mobile-table">
      <thead><tr>{header_html}</tr></thead>
      <tbody>{body_html}</tbody>
    </table>
    """
    st.markdown(table_html, unsafe_allow_html=True)


def render_relation_graph() -> None:
    relation_rows = [
        {"인물 A": "주인공", "인물 B": "AI 폰", "관계": "전략 동맹 / 미래 대립"},
        {"인물 A": "주인공", "인물 B": "민수", "관계": "친구 / 전투 협력"},
        {"인물 A": "주인공", "인물 B": "지은", "관계": "첫사랑 / 보호 대상"},
        {"인물 A": "지은", "인물 B": "수아", "관계": "친구 / 후반 조력 축"},
        {"인물 A": "주인공", "인물 B": "아버지", "관계": "가족 / 투자 지원"},
        {"인물 A": "AI 폰", "인물 B": "7보스", "관계": "미래 충돌 축"},
        {"인물 A": "7보스", "인물 B": "게이트 세력", "관계": "침공 연계"},
    ]

    graph_html = """
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          html, body { margin: 0; padding: 0; background: transparent; }
          .relation-graph-wrap {
            width: 100%;
            overflow-x: auto;
            border: 1px solid rgba(148, 163, 184, 0.35);
            border-radius: 12px;
            background: rgba(15, 23, 42, 0.85);
            padding: 0.4rem;
            box-sizing: border-box;
          }
          .relation-graph-svg {
            width: 100%;
            min-width: 760px;
            height: auto;
            display: block;
          }
          .node { fill: #0f172a; stroke: #6366f1; stroke-width: 2; rx: 14; ry: 14; }
          .nodeText { fill: #e5e7eb; font-size: 18px; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif; font-weight: 700; }
          .edge { stroke: #94a3b8; stroke-width: 2.3; marker-end: url(#arrowHead); }
          .edgeLabel { fill: #cbd5e1; font-size: 14px; font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif; }
        </style>
      </head>
      <body>
        <div class="relation-graph-wrap">
          <svg class="relation-graph-svg" viewBox="0 0 940 520" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker id="arrowHead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"></path>
              </marker>
            </defs>

            <line class="edge" x1="200" y1="140" x2="420" y2="80" />
            <line class="edge" x1="200" y1="140" x2="420" y2="200" />
            <line class="edge" x1="200" y1="140" x2="420" y2="320" />
            <line class="edge" x1="520" y1="320" x2="700" y2="320" />
            <line class="edge" x1="200" y1="140" x2="420" y2="440" />
            <line class="edge" x1="520" y1="80" x2="700" y2="80" />
            <line class="edge" x1="800" y1="80" x2="800" y2="200" />

            <text class="edgeLabel" x="250" y="90">전략 동맹 / 미래 대립</text>
            <text class="edgeLabel" x="260" y="185">친구 / 전투 협력</text>
            <text class="edgeLabel" x="245" y="285">첫사랑 / 보호 대상</text>
            <text class="edgeLabel" x="560" y="304">친구 / 후반 조력 축</text>
            <text class="edgeLabel" x="255" y="390">가족 / 투자 지원</text>
            <text class="edgeLabel" x="560" y="63">미래 충돌 축</text>
            <text class="edgeLabel" x="815" y="145">침공 연계</text>

            <rect class="node" x="80" y="110" width="120" height="58"></rect>
            <text class="nodeText" x="140" y="146" text-anchor="middle">주인공</text>

            <rect class="node" x="420" y="50" width="100" height="58"></rect>
            <text class="nodeText" x="470" y="86" text-anchor="middle">AI 폰</text>

            <rect class="node" x="420" y="170" width="100" height="58"></rect>
            <text class="nodeText" x="470" y="206" text-anchor="middle">민수</text>

            <rect class="node" x="420" y="290" width="100" height="58"></rect>
            <text class="nodeText" x="470" y="326" text-anchor="middle">지은</text>

            <rect class="node" x="700" y="290" width="100" height="58"></rect>
            <text class="nodeText" x="750" y="326" text-anchor="middle">수아</text>

            <rect class="node" x="420" y="410" width="120" height="58"></rect>
            <text class="nodeText" x="480" y="446" text-anchor="middle">아버지</text>

            <rect class="node" x="700" y="50" width="100" height="58"></rect>
            <text class="nodeText" x="750" y="86" text-anchor="middle">7보스</text>

            <rect class="node" x="730" y="200" width="140" height="58"></rect>
            <text class="nodeText" x="800" y="236" text-anchor="middle">게이트 세력</text>
          </svg>
        </div>
      </body>
    </html>
    """
    components.html(graph_html, height=470, scrolling=True)
    st.caption("그래프가 보이지 않으면 좌우 스크롤해서 전체 지도를 확인하세요.")
    render_simple_table(relation_rows)


def main() -> None:
    st.set_page_config(page_title="웹소설 네비게이터", page_icon="📚", layout="wide")
    render_mobile_css()

    config = load_active_config()
    refresh_title_overrides()
    source_texts = load_story_sources(config)
    master_data = parse_master_data(source_texts["master"])
    story_data = parse_story_data(source_texts["story"])
    character_details = parse_character_details(source_texts["characters"])
    gate_points = parse_bullet_list(source_texts["gate"])
    additional_foreshadow = parse_bullet_list(source_texts["foreshadow"])
    initial_balance_eok = parse_initial_balance_eok(source_texts["investment"])

    character_rows = build_character_rows(master_data["characters"], character_details)
    important_issues = build_important_issues(
        master_data["foreshadows"],
        story_data["goals"],
        gate_points + additional_foreshadow,
        master_data["bosses"],
    )
    enemy_rows = build_enemy_list(master_data["bosses"], gate_points)
    episode_catalog = build_episode_catalog(master_data["episodes"])

    ledger_rows = load_ledger(initial_balance_eok)
    current_balance = calculate_balance_eok(ledger_rows)

    st.title("📚 웹소설 네비게이터")
    st.markdown('<div class="constitution-tag">설정 프로파일: Story Bible Project Constitution v1.0</div>', unsafe_allow_html=True)
    st.caption("휴대폰 화면에서도 확인하기 쉽도록 모바일 대응 레이아웃을 적용했습니다.")

    with st.sidebar:
        st.subheader("활성 데이터 소스")
        st.write(f"마스터: `{Path(config.get('master_file', '')).name}`")
        st.write(f"스토리: `{Path(config.get('story_file', '')).name}`")
        story_zip = config.get("story_bible_zip")
        st.write(f"스토리바이블 ZIP: `{Path(story_zip).name if story_zip else '미등록'}`")
        if st.button("데이터 새로고침", use_container_width=True):
            st.rerun()

    tab_overview, tab_reader, tab_character, tab_relation, tab_ops, tab_files = st.tabs(
        ["개요", "소설 읽기", "인물 네비게이터", "인물 관계도", "이슈/투자/적", "파일 업데이트"]
    )

    with tab_overview:
        st.subheader("프로젝트 개요")
        col1, col2, col3 = st.columns(3)
        project = master_data["project"]
        col1.metric("스토리 상태", project.get("Story Status", "N/A"))
        col2.metric("회귀 시작 시점", project.get("Timeline Start", "N/A"))
        col3.metric("원래 타임라인", project.get("Original Timeline", "N/A"))

        st.markdown("#### 에피소드 진행")
        render_simple_table(master_data["episodes"], column_labels={"episode": "에피소드", "status": "상태"})
        st.markdown("#### 에피소드 요약")
        render_simple_table(story_data["timeline"], column_labels={"episode": "에피소드", "summary": "요약"})

    with tab_reader:
        render_episode_reader_tab(episode_catalog)

    with tab_character:
        st.subheader("인물 선택")
        names = [char["name"] for char in character_rows]
        selected_name = st.selectbox("인물을 선택하세요", options=names)
        selected_character = next(char for char in character_rows if char["name"] == selected_name)

        left, right = st.columns([1, 1])
        with left:
            st.markdown("#### 기본 정보")
            st.write(f"ID: {selected_character['id']}")
            st.write(f"역할: {selected_character['role']}")
            st.write(f"첫 등장: {selected_character['first_ep']}")
            st.write(f"미래 역할: {selected_character['future_role']}")
            st.write(f"생존 여부: {selected_character['alive']}")
            st.write(f"보스 플래그: {selected_character['boss']}")
        with right:
            st.markdown("#### 상세 노트")
            if selected_character["details"]:
                for detail in selected_character["details"]:
                    st.markdown(f"- {detail}")
            else:
                st.markdown(f"- {selected_character['notes']}")

        st.markdown("#### 전체 인물 목록")
        character_rows_for_table = []
        for row in character_rows:
            character_rows_for_table.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "role": row["role"],
                    "first_ep": row["first_ep"],
                    "future_role": row["future_role"],
                    "alive": row["alive"],
                    "boss": row["boss"],
                    "details": row.get("details", []),
                }
            )
        render_simple_table(
            character_rows_for_table,
            column_labels={
                "id": "ID",
                "name": "이름",
                "role": "역할",
                "first_ep": "첫 등장",
                "future_role": "미래 역할",
                "alive": "생존",
                "boss": "보스 플래그",
                "details": "상세",
            },
        )

    with tab_relation:
        st.subheader("인물 관계도")
        st.caption("핵심 관계를 중심으로 빠르게 파악할 수 있는 관계 그래프입니다.")
        render_relation_graph()

    with tab_ops:
        issue_tab, invest_tab, enemy_tab = st.tabs(["중요 이슈", "투자/통장잔고", "적 리스트"])

        with issue_tab:
            st.markdown("#### 중요 이슈")
            render_simple_table(
                important_issues,
                column_labels={
                    "category": "분류",
                    "priority": "우선순위",
                    "issue": "이슈",
                    "action": "대응",
                },
            )

        with invest_tab:
            st.markdown("#### 투자 로드맵")
            render_simple_table(
                master_data["investments"],
                column_labels={"phase": "단계", "capital": "자본", "goal": "목표", "status": "상태"},
            )
            st.metric("현재 통장잔고(억 원)", f"{current_balance:.2f}")

            with st.form("ledger_form", clear_on_submit=True):
                date = st.date_input("거래일")
                transaction_type = st.selectbox("거래 유형", options=["입금", "출금"])
                amount = st.number_input("금액(억 원)", min_value=0.0, step=0.1)
                note = st.text_input("메모", value="")
                submitted = st.form_submit_button("거래 추가")
                if submitted and amount > 0:
                    ledger_rows.append(
                        {
                            "date": str(date),
                            "type": transaction_type,
                            "amount_eok": float(amount),
                            "note": note,
                        }
                    )
                    save_ledger(ledger_rows)
                    st.success("거래가 저장되었습니다.")
                    st.rerun()

            st.markdown("#### 거래 내역")
            render_simple_table(
                list(reversed(ledger_rows)),
                column_labels={"date": "거래일", "type": "유형", "amount_eok": "금액(억)", "note": "메모"},
            )

        with enemy_tab:
            st.markdown("#### 적 목록")
            render_simple_table(
                enemy_rows,
                column_labels={"name": "이름", "type": "유형", "status": "상태", "note": "설명"},
            )

    with tab_files:
        st.subheader("스토리 파일 업데이트")
        st.caption("모바일 안정 모드(기본): 텍스트/경로 저장 방식으로 파일을 갱신합니다.")

        st.markdown("#### 마스터 파일 본문 저장")
        master_default_text = read_text(config.get("master_file", ""))
        master_text = st.text_area(
            "마스터 파일 내용 (MD)",
            value=master_default_text,
            height=220,
            key="master_text_editor",
        )
        if st.button("마스터 본문 저장 및 적용", key="save_master_text"):
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            target = MASTER_UPLOAD_DIR / f"{timestamp}_master_from_text.md"
            target.write_text(master_text, encoding="utf-8")
            config["master_file"] = str(target)
            save_active_config(config)
            st.success(f"마스터 본문 저장 완료: {target.name}")
            st.rerun()

        st.markdown("#### 스토리 파일 본문 저장")
        story_default_text = read_text(config.get("story_file", ""))
        story_text = st.text_area(
            "스토리 파일 내용 (MD)",
            value=story_default_text,
            height=220,
            key="story_text_editor",
        )
        if st.button("스토리 본문 저장 및 적용", key="save_story_text"):
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            target = STORY_UPLOAD_DIR / f"{timestamp}_story_from_text.md"
            target.write_text(story_text, encoding="utf-8")
            config["story_file"] = str(target)
            save_active_config(config)
            st.success(f"스토리 본문 저장 완료: {target.name}")
            st.rerun()

        st.markdown("#### 화별 소설 본문 저장 (1~100화)")
        episode_save_num = st.number_input(
            "저장할 화수",
            min_value=1,
            max_value=EPISODE_COUNT,
            value=st.session_state.get("reader_episode", 1),
            step=1,
            key="episode_save_num",
        )
        episode_default_text = load_episode_markdown(int(episode_save_num))
        episode_text = st.text_area(
            f"{episode_code(int(episode_save_num))} 본문 (MD)",
            value=episode_default_text,
            height=260,
            key="episode_text_editor",
        )
        if st.button("선택 화 본문 저장", key="save_episode_text"):
            target = EPISODE_UPLOAD_DIR / episode_filename(int(episode_save_num))
            target.write_text(episode_text, encoding="utf-8")
            st.success(f"{episode_code(int(episode_save_num))} 저장 완료")
            st.rerun()

        st.markdown("#### 여러 화 일괄 업로드 (예: EP002~EP007)")
        st.caption(
            "각 화 시작에 `# EP002 · 제목` 형식의 EP 헤더가 있는 통합 MD를 붙여넣으면, "
            "화별로 분리 저장하고 소설 읽기·네비게이터 제목을 한 번에 갱신합니다."
        )
        multi_episode_text = st.text_area(
            "여러 화 통합 본문 (MD)",
            value="",
            height=280,
            key="multi_episode_editor",
            placeholder="# EP002 · 대학 친구들과 재회\n본문...\n\n# EP003 · 지은과 재회\n본문...",
        )
        if st.button("일괄 저장 및 네비게이터 업데이트", key="save_multi_episode"):
            preview = split_multi_episode_markdown(multi_episode_text)
            if not preview:
                st.error("EP 헤더를 찾지 못했습니다. 각 화 시작에 `# EP002` 형식의 헤더를 넣어 주세요.")
            else:
                saved, skipped = save_multi_episode_markdown(multi_episode_text)
                if saved:
                    st.success("업데이트 완료: " + ", ".join(episode_code(num) for num in saved))
                if skipped:
                    st.warning(
                        "1~100 범위를 벗어나 건너뜀: "
                        + ", ".join(f"EP{num:03d}" for num in skipped)
                    )
                if saved:
                    st.rerun()

        st.markdown("#### 스토리바이블 ZIP 경로/링크 저장")
        zip_hint = config.get("story_bible_zip", "")
        zip_ref = st.text_input(
            "ZIP 파일 경로 또는 URL",
            value=zip_hint,
            placeholder="예: /workspace/data/uploads/zip/story_bible.zip 또는 https://...",
            key="zip_ref_input",
        )
        if st.button("ZIP 참조 저장 및 적용", key="save_zip_ref"):
            config["story_bible_zip"] = zip_ref.strip()
            save_active_config(config)
            st.success("ZIP 참조가 저장되었습니다.")
            st.rerun()

        st.markdown("---")
        st.markdown("#### 고급 업로드 모드 (PC 권장)")
        st.caption("일부 모바일+터널 환경에서는 파일 업로드 컴포넌트 로딩 오류가 발생할 수 있습니다.")
        enable_advanced_upload = st.toggle("고급 업로드 모드 사용", value=False, key="advanced_upload_toggle")
        if enable_advanced_upload:
            uploaded_master = st.file_uploader("마스터 MD 업로드", type=["md"], key="master_upload")
            if uploaded_master is not None and st.button("마스터 파일 저장 및 적용", key="save_master"):
                saved_path = save_uploaded_file(uploaded_master, MASTER_UPLOAD_DIR)
                config["master_file"] = str(saved_path)
                save_active_config(config)
                st.success(f"마스터 파일 적용 완료: {saved_path.name}")
                st.rerun()

            uploaded_story = st.file_uploader("스토리 파일 업로드 (MD)", type=["md"], key="story_upload")
            if uploaded_story is not None and st.button("스토리 파일 저장 및 적용", key="save_story"):
                saved_path = save_uploaded_file(uploaded_story, STORY_UPLOAD_DIR)
                config["story_file"] = str(saved_path)
                save_active_config(config)
                st.success(f"스토리 파일 적용 완료: {saved_path.name}")
                st.rerun()

            uploaded_zip = st.file_uploader("Story Bible ZIP 업로드", type=["zip"], key="zip_upload")
            if uploaded_zip is not None and st.button("ZIP 저장 및 적용", key="save_zip"):
                saved_path = save_uploaded_file(uploaded_zip, ZIP_UPLOAD_DIR)
                config["story_bible_zip"] = str(saved_path)
                save_active_config(config)
                st.success(f"ZIP 적용 완료: {saved_path.name}")
                st.rerun()

            uploaded_multi = st.file_uploader(
                "여러 화 통합 MD 업로드 (EP002~EP007 등)", type=["md"], key="multi_episode_upload"
            )
            if uploaded_multi is not None and st.button("통합 MD 일괄 적용", key="save_multi_upload"):
                raw_multi = uploaded_multi.getvalue().decode("utf-8", errors="ignore")
                preview = split_multi_episode_markdown(raw_multi)
                if not preview:
                    st.error("EP 헤더를 찾지 못했습니다. 각 화 시작에 `# EP002` 형식의 헤더를 넣어 주세요.")
                else:
                    saved, skipped = save_multi_episode_markdown(raw_multi)
                    if saved:
                        st.success("업데이트 완료: " + ", ".join(episode_code(num) for num in saved))
                    if skipped:
                        st.warning(
                            "1~100 범위를 벗어나 건너뜀: "
                            + ", ".join(f"EP{num:03d}" for num in skipped)
                        )
                    if saved:
                        st.rerun()

        st.markdown("#### 활성 파일 수동 선택")
        master_candidates = available_files(config.get("master_file", ""), MASTER_UPLOAD_DIR, (".md",))
        story_candidates = available_files(config.get("story_file", ""), STORY_UPLOAD_DIR, (".md",))
        zip_candidates = available_files(config.get("story_bible_zip", ""), ZIP_UPLOAD_DIR, (".zip",))

        selected_master = st.selectbox(
            "활성 마스터 파일",
            options=master_candidates if master_candidates else [config.get("master_file", "")],
            format_func=lambda x: Path(x).name if x else "선택 없음",
        )
        selected_story = st.selectbox(
            "활성 스토리 파일 (MD)",
            options=story_candidates if story_candidates else [config.get("story_file", "")],
            format_func=lambda x: Path(x).name if x else "선택 없음",
        )
        selected_zip = st.selectbox(
            "활성 Story Bible ZIP",
            options=zip_candidates if zip_candidates else [config.get("story_bible_zip", "")],
            format_func=lambda x: Path(x).name if x else "선택 없음",
        )

        if st.button("선택한 파일로 활성 설정 저장"):
            config["master_file"] = selected_master
            config["story_file"] = selected_story
            config["story_bible_zip"] = selected_zip
            save_active_config(config)
            st.success("활성 파일 구성이 저장되었습니다.")
            st.rerun()


if __name__ == "__main__":
    main()
