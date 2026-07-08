/** ST(소설) ↔ EP(스토리 네비) 동기화 */

import * as storage from './storage.js';
import { nowIso, padEpisode, padStory, extractStoryReaderTitle, basename, parseStoryNumber } from './utils.js';

export function createEpisodeFromStory(story, projectId) {
  const textFile = `${padEpisode(story.number)}.md`;
  const title = story.title || extractDocTitle(story.content, textFile);
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

/** EP가 없으면 ST 소설을 참조해 EP 문서 생성 */
export async function ensureEpisodesFromStories(cache, projectId) {
  if (!projectId || !cache.stories?.length) return false;

  let changed = false;
  const stories = [...cache.stories].sort((a, b) => a.number - b.number);

  for (const story of stories) {
    let ep = cache.episodes.find((e) => e.number === story.number);
    if (ep) continue;

    ep = createEpisodeFromStory(story, projectId);
    cache.episodes.push(ep);
    await storage.put('episodes', ep);

    const epFile = createEpisodeFileRecord(ep, projectId);
    const existingFile = cache.files.find((f) => f.path === epFile.path);
    if (!existingFile) {
      cache.files.push(epFile);
      await storage.put('files', epFile);
    }
    changed = true;
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
