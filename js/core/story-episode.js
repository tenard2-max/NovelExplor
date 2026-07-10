/** ST(소설) ↔ EP(스토리 네비) 동기화 */

import * as storage from './storage.js';
import { nowIso, padEpisode, padStory, extractStoryReaderTitle, basename, parseStoryNumber } from './utils.js';

export function createEpisodeFromStory(story, projectId) {
  const textFile = `${padEpisode(story.number)}.md`;
  const title = story.title || extractStoryReaderTitle(story.content, textFile);
  return {
    id: `${projectId}-ep-${story.number}`,
    projectId,
    episodeId: `${projectId}-ep-${story.number}`,
    title,
    number: story.number,
    summary: '',
    textFile,
    content: story.content,
    originalContent: story.originalContent || story.content,
    sourceStoryId: story.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function createStoryFileRecord(story, projectId) {
  const path = `Story/Original/${story.textFile}`;
  return {
    id: `${projectId}-file-${path}`,
    projectId,
    path,
    folder: 'Story/Original',
    content: story.content,
    storyId: story.id,
    readonly: true,
    updatedAt: nowIso(),
  };
}

export function createEpisodeFileRecord(episode, projectId) {
  const path = `Story/${episode.textFile}`;
  return {
    id: `${projectId}-file-${path}`,
    projectId,
    path,
    folder: 'Story',
    content: episode.content,
    episodeId: episode.id,
    updatedAt: nowIso(),
  };
}

/**
 * ST를 원본으로 EP를 맞춘다.
 * - EP 없으면 생성
 * - EP 있으면 제목·본문을 ST 기준으로 항상 덮어씀
 */
export async function ensureEpisodesFromStories(cache, projectId) {
  if (!projectId || !cache.stories?.length) return false;

  let changed = false;
  const stories = [...cache.stories].sort((a, b) => a.number - b.number);

  for (const story of stories) {
    const title = story.title || extractStoryReaderTitle(story.content, story.textFile);
    let ep = cache.episodes.find((e) => e.number === story.number);

    if (!ep) {
      ep = createEpisodeFromStory(story, projectId);
      cache.episodes.push(ep);
      await storage.put('episodes', ep);
      changed = true;
    } else {
      const nextContent = story.content || '';
      const nextTitle = title;
      if (ep.content !== nextContent || ep.title !== nextTitle || ep.sourceStoryId !== story.id) {
        ep = {
          ...ep,
          title: nextTitle,
          content: nextContent,
          originalContent: story.originalContent || nextContent,
          sourceStoryId: story.id,
          textFile: ep.textFile || `${padEpisode(story.number)}.md`,
          updatedAt: nowIso(),
        };
        const idx = cache.episodes.findIndex((e) => e.id === ep.id);
        if (idx >= 0) cache.episodes[idx] = ep;
        await storage.put('episodes', ep);
        changed = true;
      }
    }

    const epFile = createEpisodeFileRecord(ep, projectId);
    const fileIdx = cache.files.findIndex((f) => f.path === epFile.path);
    if (fileIdx < 0) {
      cache.files.push(epFile);
      await storage.put('files', epFile);
      changed = true;
    } else if (cache.files[fileIdx].content !== epFile.content) {
      cache.files[fileIdx] = { ...cache.files[fileIdx], ...epFile, id: cache.files[fileIdx].id };
      await storage.put('files', cache.files[fileIdx]);
      changed = true;
    }
  }

  if (changed) {
    cache.episodes.sort((a, b) => a.number - b.number);
  }
  return changed;
}

/** ST*.md 파일 → stories 저장소 동기화 (업로드된 소설만) */
export function syncStoriesFromFiles(cache, projectId) {
  if (!projectId) return false;
  let changed = false;

  for (const file of cache.files || []) {
    const name = basename(file.path);
    if (!/^ST\d+\.md$/i.test(name)) continue;

    const num = parseStoryNumber(name);
    if (num == null) continue;

    if (cache.stories.some((s) => s.number === num)) continue;

    const textFile = `${padStory(num)}.md`;
    const story = {
      id: `${projectId}-st-${num}`,
      projectId,
      storyId: `${projectId}-st-${num}`,
      title: extractStoryReaderTitle(file.content || '', textFile),
      number: num,
      textFile,
      content: file.content || '',
      originalContent: file.content || '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    cache.stories.push(story);
    changed = true;
  }

  if (changed) {
    cache.stories.sort((a, b) => a.number - b.number);
  }
  return changed;
}
