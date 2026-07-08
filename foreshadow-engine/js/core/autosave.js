/** 자동 저장 (5초) */

import { emit } from './events.js';
import * as project from './project.js';

let timer = null;
let dirty = false;
let intervalMs = 5000;

export function markDirty() {
  dirty = true;
  emit('save:dirty', true);
  schedule();
}

export function markClean() {
  dirty = false;
  emit('save:dirty', false);
}

export function isDirty() {
  return dirty;
}

async function runSave() {
  emit('save:state', 'saving');
  try {
    await project.saveProjectFull();
    markClean();
    emit('save:state', 'saved');
  } catch (err) {
    emit('save:state', 'error');
    console.error(err);
    throw err;
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!dirty) return;
    try {
      await runSave();
    } catch {
      /* error state already emitted */
    }
  }, intervalMs);
}

/** @param {boolean} [force=false] — true면 dirty 여부와 관계없이 전체 저장 */
export function flushSave(force = false) {
  clearTimeout(timer);
  if (!force && !dirty) return Promise.resolve();
  return runSave();
}

window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
