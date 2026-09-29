import type { MarkdownEdit, MarkdownSelection } from "./markdownEditing";

type Change = { start: number; removed: string; inserted: string; before: MarkdownSelection; after: MarkdownSelection; time: number; typing: boolean };

/** Store bounded text patches, not one full document per keystroke. */
export class MarkdownEditHistory {
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];
  constructor(private readonly maxCharacters = 2_000_000, private readonly maxEntries = 100) {}
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  clear() { this.undoStack = []; this.redoStack = []; }
  record(value: string, next: string, before: MarkdownSelection, after: MarkdownSelection, typing = false, time = Date.now()) {
    if (value === next) return;
    let start = 0;
    while (start < value.length && start < next.length && value[start] === next[start]) start++;
    let end = value.length;
    let nextEnd = next.length;
    while (end > start && nextEnd > start && value[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
    const change: Change = { start, removed: value.slice(start, end), inserted: next.slice(start, nextEnd), before, after, typing, time };
    const previous = this.undoStack[this.undoStack.length - 1];
    const merge = typing && previous?.typing && time - previous.time < 800 && this.redoStack.length === 0;
    if (merge && previous.inserted && !change.removed && start === previous.start + previous.inserted.length) {
      previous.inserted += change.inserted; previous.after = after; previous.time = time;
    } else if (merge && !previous.inserted && !change.inserted && start + change.removed.length === previous.start) {
      previous.start = start; previous.removed = change.removed + previous.removed; previous.after = after; previous.time = time;
    } else {
      this.undoStack.push(change);
    }
    this.redoStack = [];
    let size = this.undoStack.reduce((sum, entry) => sum + entry.removed.length + entry.inserted.length, 0);
    while (this.undoStack.length > this.maxEntries || size > this.maxCharacters) {
      const removed = this.undoStack.shift()!;
      size -= removed.removed.length + removed.inserted.length;
    }
  }
  undo(value: string): MarkdownEdit | undefined { return this.apply(value, this.undoStack, this.redoStack, true); }
  redo(value: string): MarkdownEdit | undefined { return this.apply(value, this.redoStack, this.undoStack, false); }
  private apply(value: string, from: Change[], to: Change[], undo: boolean): MarkdownEdit | undefined {
    const change = from.pop();
    if (!change) return;
    const expected = undo ? change.inserted : change.removed;
    if (value.slice(change.start, change.start + expected.length) !== expected) { this.clear(); return; }
    to.push(change);
    change.typing = false;
    return { value: value.slice(0, change.start) + (undo ? change.removed : change.inserted) + value.slice(change.start + expected.length),
      selection: undo ? change.before : change.after };
  }
}
