/** IndexedDB 백업 payload → workspace section XML (UTF-8) */

import { padEpisode, padStory, basename, nowIso } from './utils.js';

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xmlAttr(name, value) {
  if (value === undefined || value === null) return ` ${name}=""`;
  return ` ${name}="${escapeXml(value)}"`;
}

function characterIdOf(ch) {
  return ch.characterId
    || String(ch.id || '').split('-').filter(Boolean).pop()
    || 'CHR0000';
}

function hasAvatar(ch) {
  return Boolean(String(ch.avatarDataUrl || ch.image || ch.avatar || '').trim());
}

function buildGalleryXml(ch, cid) {
  const avatar = String(ch.avatarDataUrl || '').trim();
  const images = (Array.isArray(ch.images) ? ch.images : [])
    .map((u) => String(u || '').trim())
    .filter((u) => u && u !== avatar);

  if (!images.length) return '      <Gallery/>';

  const items = images.map((_, i) =>
    `      <Image src="../overlays/characters/${escapeXml(cid)}_${i + 1}.png" mime="image/png"/>`
  );
  return `      <Gallery>\n${items.join('\n')}\n      </Gallery>`;
}

function buildCharactersXml(characters = []) {
  const rows = characters.map((ch) => {
    const cid = characterIdOf(ch);
    const avatarSrc = hasAvatar(ch)
      ? `../overlays/characters/${cid}.png`
      : '';
    const desc = ch.description || '';
    return `    <Character id="${escapeXml(cid)}"`
      + xmlAttr('name', ch.name)
      + xmlAttr('race', ch.race)
      + xmlAttr('gender', ch.gender)
      + xmlAttr('age', ch.age)
      + xmlAttr('occupation', ch.occupation)
      + xmlAttr('firstEpisode', ch.firstEpisode)
      + xmlAttr('lastEpisode', ch.lastEpisode)
      + xmlAttr('status', ch.status || 'Alive')
      + `>\n`
      + `      <Description>${escapeXml(desc)}</Description>\n`
      + `      <Avatar src="${escapeXml(avatarSrc)}" mime="image/png"/>\n`
      + `${buildGalleryXml(ch, cid)}\n`
      + `    </Character>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<Section id="character" viewId="character" title="인물" version="1">\n`
    + `  <Characters>\n${rows.join('\n')}\n  </Characters>\n`
    + `</Section>\n`;
}

function buildForeshadowsXml(foreshadows = []) {
  const rows = foreshadows.map((fs) => {
    const fid = fs.foreshadowId
      || String(fs.id || '').split('-').filter(Boolean).pop()
      || 'FS0000';
    return `    <Foreshadow id="${escapeXml(fid)}"`
      + xmlAttr('title', fs.title)
      + xmlAttr('grade', fs.grade)
      + xmlAttr('status', fs.status)
      + xmlAttr('createdEpisode', fs.createdEpisode)
      + xmlAttr('expectedEpisode', fs.expectedEpisode)
      + xmlAttr('resolvedEpisode', fs.resolvedEpisode ?? 0)
      + `/>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<Section id="foreshadow" viewId="foreshadow" title="떡밥 회수" version="1">\n`
    + `  <Foreshadows>\n${rows.join('\n')}\n  </Foreshadows>\n`
    + `</Section>\n`;
}

function buildTimelineXml(timeline = []) {
  const rows = timeline.map((ev) => {
    const eid = ev.eventId
      || String(ev.id || '').split('-').filter(Boolean).pop()
      || 'TL0000';
    return `    <Event id="${escapeXml(eid)}"`
      + xmlAttr('episode', ev.episode)
      + xmlAttr('date', ev.date)
      + xmlAttr('title', ev.title)
      + xmlAttr('source', ev.source || '')
      + `/>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<Section id="timeline" viewId="timeline" title="타임라인" version="1">\n`
    + `  <Events>\n${rows.join('\n')}\n  </Events>\n`
    + `</Section>\n`;
}

function buildStoryNavXml(episodes = [], files = []) {
  const overlayFiles = overlayStoryPaths(files);
  const sorted = [...episodes].sort((a, b) => (a.number || 0) - (b.number || 0));
  const rows = sorted.map((ep) => {
    const num = ep.number || 0;
    const id = `EP${String(num).padStart(3, '0')}`;
    const textFile = ep.textFile || `${padEpisode(num)}.md`;
    let src = `../overlays/stories/${textFile}`;
    const stName = `${padStory(num)}.md`;
    if (overlayFiles.has(stName) || overlayFiles.has(`Story/Original/${stName}`)) {
      src = `../overlays/stories/${stName}`;
    } else if (overlayFiles.has(textFile) || overlayFiles.has(`Story/${textFile}`)) {
      src = `../overlays/stories/${textFile}`;
    }
    return `    <Episode id="${escapeXml(id)}"`
      + xmlAttr('number', num)
      + xmlAttr('title', ep.title)
      + xmlAttr('src', src)
      + `/>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<Section id="story-nav" viewId="story-nav" title="스토리 네비" version="1">\n`
    + `  <Episodes>\n${rows.join('\n')}\n  </Episodes>\n`
    + `</Section>\n`;
}

function overlayStoryPaths(files = []) {
  const set = new Set();
  for (const f of files) {
    const name = basename(f.path || f.id || '');
    if (name) set.add(name);
    if (f.path) set.add(f.path);
  }
  return set;
}

function storySrc(story, overlayFiles) {
  const textFile = story.textFile || `${padStory(story.number)}.md`;
  const storyPath = `Story/Original/${textFile}`;
  if (overlayFiles.has(textFile) || overlayFiles.has(storyPath)) {
    return `../overlays/stories/${textFile}`;
  }
  return `../../seed/episodes/${padEpisode(story.number)}.md`;
}

function storyXmlId(st) {
  if (st.number != null && !Number.isNaN(Number(st.number))) {
    return `ST${String(st.number).padStart(3, '0')}`;
  }
  const tf = st.textFile || '';
  const m = tf.match(/ST(\d+)/i);
  if (m) return `ST${String(m[1]).padStart(3, '0')}`;
  return 'ST000';
}

function buildReaderXml(stories = [], files = []) {
  const overlayFiles = overlayStoryPaths(files);
  const sorted = [...stories].sort((a, b) => (a.number || 0) - (b.number || 0));

  const rows = sorted.map((st) => {
    const storyId = storyXmlId(st);
    const src = storySrc(st, overlayFiles);
    return `    <Story id="${escapeXml(storyId)}"`
      + xmlAttr('number', st.number)
      + xmlAttr('title', st.title)
      + xmlAttr('src', src)
      + ` mime="text/markdown"/>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<Section id="reader" viewId="reader" title="소설 읽기" version="1">\n`
    + `  <Stories>\n${rows.join('\n')}\n  </Stories>\n`
    + `</Section>\n`;
}

function buildWorkspaceXml(project = {}, payload = {}) {
  const title = project.title || '프로젝트';
  const updatedAt = payload.exportedAt || nowIso();
  const characters = payload.characters || [];
  const files = payload.files || [];

  const assetLines = [];
  for (const ch of characters) {
    if (!hasAvatar(ch)) continue;
    const cid = characterIdOf(ch);
    assetLines.push(
      `    <File id="${escapeXml(`${cid.toLowerCase()}-avatar`)}" `
      + `path="overlays/characters/${escapeXml(cid)}.png" mime="image/png"/>`
    );
  }
  for (const f of files) {
    const name = basename(f.path || '');
    if (!/\.(md|txt)$/i.test(name)) continue;
    assetLines.push(
      `    <File id="${escapeXml(`story-${name.replace(/\W/g, '-')}`)}" `
      + `path="overlays/stories/${escapeXml(name)}" mime="text/markdown"/>`
    );
  }

  const assetsBlock = assetLines.length
    ? `  <Assets root="overlays/">\n${assetLines.join('\n')}\n  </Assets>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<Workspace\n`
    + `  version="1"\n`
    + `  projectTitle="${escapeXml(title)}"\n`
    + `  updatedAt="${escapeXml(updatedAt)}"\n`
    + `  schema="novelexplor-workspace/v1">\n\n`
    + `  <Sections>\n`
    + `    <Section id="master"      viewId="master"      title="마스터 DB"     src="sections/00_master.xml"/>\n`
    + `    <Section id="story-bible" viewId="story-bible" title="Story Bible"   src="sections/01_story_bible.xml"/>\n`
    + `    <Section id="world"       viewId="world"       title="세계관"        src="sections/02_world.xml"/>\n`
    + `    <Section id="reader"      viewId="reader"      title="소설 읽기"     src="sections/10_reader.xml"/>\n`
    + `    <Section id="story-nav"   viewId="story-nav"   title="스토리 네비"   src="sections/11_story_nav.xml"/>\n`
    + `    <Section id="foreshadow"  viewId="foreshadow"  title="떡밥 회수"     src="sections/04_foreshadows.xml"/>\n`
    + `    <Section id="character"   viewId="character"   title="인물"          src="sections/03_characters.xml"/>\n`
    + `    <Section id="timeline"    viewId="timeline"    title="타임라인"      src="sections/05_timeline.xml"/>\n`
    + `    <Section id="editor"      viewId="editor"      title="에디터"        src="sections/12_editor.xml"/>\n`
    + `  </Sections>\n\n`
    + assetsBlock
    + `</Workspace>\n`;
}

/**
 * GitHub 커밋용 section XML 파일 목록
 * @returns {{ repoPath: string, content: string }[]}
 */
export function buildSectionXmlFiles(payload, cfg) {
  const root = cfg.workspaceRoot || 'data/workspace';
  return [
    {
      repoPath: `${root}/sections/03_characters.xml`,
      content: buildCharactersXml(payload.characters),
    },
    {
      repoPath: `${root}/sections/04_foreshadows.xml`,
      content: buildForeshadowsXml(payload.foreshadows),
    },
    {
      repoPath: `${root}/sections/05_timeline.xml`,
      content: buildTimelineXml(payload.timeline),
    },
    {
      repoPath: `${root}/sections/10_reader.xml`,
      content: buildReaderXml(payload.stories, payload.files),
    },
    {
      repoPath: `${root}/sections/11_story_nav.xml`,
      content: buildStoryNavXml(payload.episodes, payload.files),
    },
    {
      repoPath: `${root}/workspace.xml`,
      content: buildWorkspaceXml(payload.project, payload),
    },
  ];
}
