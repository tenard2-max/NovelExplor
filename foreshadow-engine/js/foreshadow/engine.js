/** Foreshadow Engine — 규칙 기반 후보 생성 (AI 승인 전 저장 안 함) */

import { FORESHADOW_GRADES } from '../core/utils.js';

const KEYWORD_PATTERNS = [
  { pattern: /마지막\s*1초/g, title: '마지막 1초', grade: 'SSS', tags: ['멸망'] },
  { pattern: /97\s*%|97퍼/g, title: 'AI의 97%', grade: 'SS', tags: ['AI', '확률'] },
  { pattern: /게이트/g, title: '게이트', grade: 'S', tags: ['게이트'] },
  { pattern: /보스\s*후보|미래\s*보스/g, title: '미래 보스 후보', grade: 'A', tags: ['보스'] },
  { pattern: /최종보스/g, title: 'AI 최종보스', grade: 'SSS', tags: ['AI'] },
  { pattern: /붉은\s*반지|반지/g, title: '붉은 반지', grade: 'B', tags: ['상징'] },
  { pattern: /회귀/g, title: '회귀', grade: 'A', tags: ['회귀'] },
  { pattern: /인류\s*생존/g, title: '인류 생존 프로젝트', grade: 'S', tags: ['목표'] },
  { pattern: /위성|궤적/g, title: '위성 이상', grade: 'B', tags: ['전조'] },
  { pattern: /평범/g, title: '평범함의 의미', grade: 'C', tags: ['테마'] },
];

/**
 * 에피소드 텍스트에서 복선 후보를 추출한다.
 * 자동 저장하지 않으며 사용자 승인 대기 상태로 반환한다.
 */
export function analyzeForeshadowCandidates(episodes, existingTitles = []) {
  const candidates = [];
  const seen = new Set(existingTitles.map((t) => t.toLowerCase()));

  for (const ep of episodes) {
    const text = ep.content || '';
    const lines = text.split('\n');

    for (const rule of KEYWORD_PATTERNS) {
      let match;
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      while ((match = regex.exec(text)) !== null) {
        const key = `${rule.title}-${ep.number}`;
        if (seen.has(rule.title.toLowerCase())) continue;
        if (candidates.some((c) => c.key === key)) continue;

        const lineNum = text.slice(0, match.index).split('\n').length;
        const context = lines[lineNum - 1]?.trim() || match[0];
        const confidence = calcConfidence(rule, text, match[0]);

        if (confidence < 50) continue;

        candidates.push({
          key,
          title: rule.title,
          description: context,
          grade: rule.grade,
          status: 'CANDIDATE',
          createdEpisode: ep.number,
          expectedEpisode: ep.number + estimatePayoffDistance(rule.grade),
          confidence,
          tags: rule.tags,
          sourceLine: lineNum,
          sourceEpisode: ep.number,
        });
        seen.add(rule.title.toLowerCase());
      }
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

function calcConfidence(rule, text, match) {
  let score = 60;
  const occurrences = (text.match(rule.pattern) || []).length;
  if (occurrences > 1) score += 15;
  if (rule.grade === 'SSS' || rule.grade === 'SS') score += 10;
  if (match.length > 4) score += 5;
  return Math.min(100, score);
}

function estimatePayoffDistance(grade) {
  const idx = FORESHADOW_GRADES.indexOf(grade);
  return 20 + idx * 10;
}

/** 모순 탐지 — 사망 후 등장 등 */
export function detectContradictions(characters, episodes) {
  const warnings = [];

  for (const ch of characters) {
    if (ch.status !== 'Dead') continue;
    const deathEp = ch.lastEpisode || 0;
    for (const ep of episodes) {
      if (ep.number <= deathEp) continue;
      if ((ep.content || '').includes(ch.name)) {
        warnings.push({
          type: 'dead_character_appearance',
          message: `${ch.name}은(는) ${deathEp}화 이후 사망 처리되었으나 ${ep.number}화에 등장합니다.`,
          character: ch.name,
          episode: ep.number,
        });
      }
    }
  }

  return warnings;
}

/** 미회수 복선 탐지 */
export function findUnresolvedForeshadows(foreshadows, currentEpisode) {
  return foreshadows.filter((f) => {
    if (f.status === 'RESOLVED' || f.status === 'CANCELLED') return false;
    return f.expectedEpisode > 0 && currentEpisode > f.expectedEpisode;
  });
}
