/** js/app-version.js 의 APP_BUILD + FALLBACK JSON/UPLOAD 스탬프 갱신 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'js', 'app-version.js');
const indexHtml = path.join(root, 'index.html');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

function readStamp(filePath, keys) {
  if (!existsSync(filePath)) return '';
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    for (const k of keys) {
      if (data[k]) return String(data[k]);
    }
  } catch {
    /* ignore */
  }
  return '';
}

const jsonStamp = readStamp(
  path.join(root, 'data/workspace/snapshots/latest.json'),
  ['snapshotId']
) || stamp;

const uploadStamp = readStamp(
  path.join(root, 'data/workspace/overlays/upload-latest.json'),
  ['uploadId', 'snapshotId']
) || stamp;

let src = readFileSync(target, 'utf8');
src = src.replace(/export const APP_BUILD = '\d{14}';/, `export const APP_BUILD = '${stamp}';`);
src = src.replace(
  /export const FALLBACK_JSON_STAMP = '\d{14}';/,
  `export const FALLBACK_JSON_STAMP = '${jsonStamp}';`
);
src = src.replace(
  /export const FALLBACK_UPLOAD_STAMP = '\d{14}';/,
  `export const FALLBACK_UPLOAD_STAMP = '${uploadStamp}';`
);
writeFileSync(target, src, 'utf8');

function formatStamp14(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
}

if (existsSync(indexHtml)) {
  let html = readFileSync(indexHtml, 'utf8');
  html = html.replace(
    /id="nav-app-version"[^>]*>[^<]*/,
    `id="nav-app-version" class="nav-app-version">APP: ${formatStamp14(stamp)}`
  );
  html = html.replace(
    /id="nav-json-version"[^>]*>[^<]*/,
    `id="nav-json-version" class="nav-json-version">JSON: ${jsonStamp}`
  );
  html = html.replace(
    /id="nav-upload-version"[^>]*>[^<]*/,
    `id="nav-upload-version" class="nav-upload-version">UPLOAD: ${uploadStamp}`
  );
  writeFileSync(indexHtml, html, 'utf8');
}

console.log(`[bump-version] APP_BUILD = ${stamp}`);
console.log(`[bump-version] FALLBACK_JSON = ${jsonStamp}`);
console.log(`[bump-version] FALLBACK_UPLOAD = ${uploadStamp}`);
