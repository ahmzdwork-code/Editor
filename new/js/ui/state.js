// Shared editor state and the one place edits are committed (undo, save, redraw).
import { Emitter, debounce } from '../util.js';
import { History, layoutMain, duration } from '../model.js';
import * as store from '../store.js';

export const S = { p: null, hist: null, player: null, sel: null, sheet: null, view: 'home', clipboard: null, styleClip: null };
export const bus = new Emitter();

export const sel = () => S.p?.items.find(i => i.id === S.sel) || null;
export const lt = it => (S.player?.t ?? 0) - it.start;
export const now = () => S.player?.t ?? 0;

const saveSoon = debounce(() => save(), 600);
export async function save() {
  if (!S.p) return;
  S.p.updated = Date.now();
  try { await store.saveProject(S.p); } catch (e) { console.warn('save failed', e); }
}

// call after every edit. `live` = in the middle of a drag (no undo step yet)
export function commit(opts = {}) {
  const p = S.p; if (!p) return;
  layoutMain(p);
  if (!opts.live) { S.hist.commit(p); saveSoon(); }
  S.player?.invalidate();
  if (opts.audio) S.player?.refreshAudio();
  bus.emit('change', opts);
}
export function select(id) {
  if (S.sel === id) return;
  S.sel = id;
  bus.emit('select', id);
}
export function undo() { const r = S.hist.undo(S.p); if (r) applyState(r); }
export function redo() { const r = S.hist.again(S.p); if (r) applyState(r); }
function applyState(r) {
  Object.assign(S.p, r);
  if (S.sel && !S.p.items.some(i => i.id === S.sel)) S.sel = null;
  layoutMain(S.p); saveSoon();
  S.player?.invalidate(); S.player?.refreshAudio();
  bus.emit('change', { undo: true }); bus.emit('select', S.sel);
}
export const projDur = () => (S.p ? duration(S.p) : 0);
