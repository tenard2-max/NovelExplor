/** Undo/Redo 스택 */

const MAX_STEPS = 1000;

export class UndoStack {
  constructor() {
    this.undoList = [];
    this.redoList = [];
  }

  push(state) {
    this.undoList.push(state);
    if (this.undoList.length > MAX_STEPS) this.undoList.shift();
    this.redoList = [];
  }

  undo(current) {
    if (!this.undoList.length) return null;
    this.redoList.push(current);
    return this.undoList.pop();
  }

  redo(current) {
    if (!this.redoList.length) return null;
    this.undoList.push(current);
    return this.redoList.pop();
  }

  canUndo() {
    return this.undoList.length > 0;
  }

  canRedo() {
    return this.redoList.length > 0;
  }
}
