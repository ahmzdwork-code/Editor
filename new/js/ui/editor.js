// Editor screen: top bar, preview, transport, timeline and the context toolbar.
import { S, bus, commit, select, sel, undo, redo, save, projDur } from './state.js';
import { h, ico, toast, promptBox } from './widgets.js';
import { icon } from './icons.js';
import { Player } from '../playback.js';
import { Timeline } from './timeline.js';
import { Gizmo } from './gizmo.js';
import * as A from './actions.js';
import * as panels from './panels.js';
import { History, toggleKf, kfAt, hasKf, layoutMain, mainItems } from '../model.js';
import { fmtTime, clamp } from '../util.js';
import { decodeAudio, imageFor } from '../media.js';
import * as faces from '../faces.js';
import { getShake } from '../track.js';

let ui = null;

export async function openEditor(p, onExit) {
  S.p = p; S.hist = new History(p); S.sel = null; S.view = 'editor';
  layoutMain(p);
  // warm caches: sound, pictures, analyses
  for (const m of Object.values(p.media)) { if (m.kind !== 'image') decodeAudio(m); else imageFor(m.id); }
  for (const it of p.items) {
    if (it.faces?.on) faces.getData(it.mid).then(() => S.player?.invalidate());
    if (it.cutout?.on) faces.getCutout(it.mid).then(() => S.player?.invalidate());
    if (it.stab?.on) getShake(it.mid).then(() => S.player?.invalidate());
  }
  const app = document.getElementById('app'); app.innerHTML = '';
  const canvas = h('canvas.view');
  const stage = h('div.stage', {}, canvas);
  const name = h('button.name', { on: { click: async () => { const n = await promptBox('Project name', p.name); if (n != null) { p.name = n.trim() || 'Untitled'; name.textContent = p.name; save(); } } } }, p.name);
  const ratioChip = h('button.chip', { on: { click: () => panels.open('canvas') } });
  const top = h('div.top', {},
    h('button.ibtn', { title: 'Back to projects', html: icon('back'), on: { click: () => exit() } }),
    name, h('div.grow'),
    ratioChip,
    h('button.btn.primary.sm', { on: { click: () => panels.open('export') } }, ico('save', 's'), 'Export'));
  const time = h('div.time.mono');
  const playBtn = h('button.play', { title: 'Play (space)', html: icon('play') });
  const kfBtn = h('button.ibtn', { title: 'Keyframe', html: icon('diamond') });
  const undoBtn = h('button.ibtn', { title: 'Undo', html: icon('undo') }), redoBtn = h('button.ibtn', { title: 'Redo', html: icon('redo') });
  const transport = h('div.transport', {}, time, h('div.grow'), undoBtn, redoBtn, playBtn, kfBtn,
    h('button.ibtn', { title: 'Full screen preview', html: icon('expand'), on: { click: () => fullscreen(stage) } }));
  const tlRoot = h('div');
  const tools = h('div.tools');
  const ed = h('div.ed', {}, top, stage, transport, tlRoot, tools);
  app.append(ed);

  S.player = new Player(canvas);
  S.player.setProject(p);
  const tl = new Timeline(tlRoot, { addMain: () => A.pickAndAdd('main'), open: n => panels.open(n) });
  tlRoot.replaceWith(tl.el);
  const gz = new Gizmo(stage, canvas, {
    dblTap: it => { if (it.kind === 'text') panels.open('text', { tab: 'edit' }); },
    toggleFace: (it, id) => panels.toggleFace(it, id),
    drew: (box, g) => panels.drew(box, g),
    faceNames: it => panels.faceNames(it),
  });
  panels.init({ stage, gizmo: gz, tools, timeline: tl });
  ui = { canvas, stage, time, playBtn, kfBtn, undoBtn, redoBtn, tools, ratioChip, tl, gz };

  const fit = () => {
    const r = stage.getBoundingClientRect(), k = Math.min((r.width - 16) / p.w, (r.height - 16) / p.h);
    canvas.style.width = Math.max(10, p.w * k) + 'px'; canvas.style.height = Math.max(10, p.h * k) + 'px';
    S.player.previewLong = Math.min(1280, Math.max(540, Math.max(p.w, p.h) * k * Math.min(2, devicePixelRatio || 1)));
    S.player.invalidate(); gz.render();
  };
  new ResizeObserver(fit).observe(stage);
  bus.on('change', () => { fit(); updTransport(); ratioChip.textContent = p.ratio === 'original' ? 'Original' : p.ratio; });
  bus.on('select', () => { renderTools(); updTransport(); });
  S.player.on('time', updTransport);
  S.player.on('play', () => { playBtn.innerHTML = icon('pause'); });
  S.player.on('pause', () => { playBtn.innerHTML = icon('play'); });
  playBtn.onclick = () => S.player.toggle();
  undoBtn.onclick = () => undo(); redoBtn.onclick = () => redo();
  kfBtn.onclick = () => {
    const it = sel(); if (!it) return toast('Select a clip first');
    const lt = S.player.t - it.start; if (lt < 0 || lt > it.dur) return toast('Move the playhead over the clip');
    const added = toggleKf(it, lt); commit(); toast(added ? 'Keyframe added — move or resize to animate' : 'Keyframe removed');
  };
  ratioChip.textContent = p.ratio === 'original' ? 'Original' : p.ratio;
  renderTools(); updTransport(); fit();
  document.addEventListener('keydown', keys);
  async function exit() {
    S.player.pause(); await save();
    document.removeEventListener('keydown', keys);
    try { const c = S.player.snapshot(false); const k = 240 / Math.max(c.width, c.height), t = document.createElement('canvas'); t.width = c.width * k; t.height = c.height * k; t.getContext('2d').drawImage(c, 0, 0, t.width, t.height); p.thumb = t.toDataURL('image/jpeg', 0.7); await save(); } catch (e) { }
    S.view = 'home'; S.player.stopAudio(); S.player = null; panels.close(true);
    onExit();
  }
}

function updTransport() {
  if (!ui) return;
  const t = S.player.t, d = projDur();
  ui.time.innerHTML = `<b>${fmtTime(t)}</b> / ${fmtTime(d)}`;
  const it = sel(), lt = it ? t - it.start : -1;
  const inside = it && lt >= 0 && lt <= it.dur;
  ui.kfBtn.innerHTML = icon(inside && kfAt(it, lt) ? 'diamondF' : 'diamond');
  ui.kfBtn.classList.toggle('on', !!(it && hasKf(it)));
  ui.kfBtn.style.visibility = it && it.kind !== 'effect' && it.kind !== 'filter' ? 'visible' : 'hidden';
  ui.undoBtn.disabled = !S.hist.stack.length; ui.redoBtn.disabled = !S.hist.redo.length;
}

function fullscreen(stage) {
  const el = stage;
  if (document.fullscreenElement) document.exitFullscreen();
  else if (el.requestFullscreen) el.requestFullscreen().catch(() => toast('Full screen is not available here'));
  else if (S.player.canvas.webkitEnterFullscreen) S.player.canvas.webkitEnterFullscreen();
  else toast('Full screen is not available here');
}

function keys(e) {
  if (S.view !== 'editor' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  const k = e.key, mod = e.metaKey || e.ctrlKey;
  if (k === ' ') { e.preventDefault(); S.player.toggle(); }
  else if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); const f = 1 / (S.p.fps || 30) * (e.shiftKey ? 10 : 1); S.player.seek(S.player.t + (k === 'ArrowRight' ? f : -f)); }
  else if (k === 'Delete' || k === 'Backspace') { if (sel()) { e.preventDefault(); A.del(); } }
  else if (k.toLowerCase() === 's' && !mod) A.split();
  else if (mod && k.toLowerCase() === 'd') { e.preventDefault(); A.dup(); }
  else if (k === 'Escape') { panels.close(); select(null); }
  else if (k.toLowerCase() === 'm') { S.p.markers ||= []; S.p.markers.push(S.player.t); commit(); toast('Marker added'); }
  else if (k === 'Home') S.player.seek(0);
  else if (k === 'End') S.player.seek(projDur());
  else if (k === '=' || k === '+') ui.tl.zoom(1.25);
  else if (k === '-') ui.tl.zoom(0.8);
}

/* ---------- context toolbar ---------- */
const T = (id, label, ic, fn, cls = '') => ({ id, label, ic, fn, cls });
function toolsFor(it) {
  const o = n => () => panels.open(n);
  if (!it) return [
    T('edit', 'Edit', 'scissors', () => { const c = mainItems(S.p).find(i => S.player.t >= i.start && S.player.t < i.start + i.dur) || mainItems(S.p)[0]; c ? select(c.id) : A.pickAndAdd('main'); }),
    T('media', 'Add video', 'import', () => A.pickAndAdd('main')),
    T('overlay', 'Overlay', 'layers', () => A.pickAndAdd('layer')),
    T('text', 'Text', 'text', () => { A.addText(); panels.open('text', { tab: 'edit' }); }),
    T('captions', 'Captions', 'captions', o('captions')),
    T('faces', 'Face blur', 'face', () => { const c = mainItems(S.p).find(i => i.kind === 'video' && S.player.t >= i.start && S.player.t < i.start + i.dur) || S.p.items.find(i => i.kind === 'video'); if (!c) return toast('Add a video first'); select(c.id); panels.open('faces'); }, 'priv'),
    T('blurArea', 'Blur area', 'blurArea', () => { A.addBlurArea(); panels.open('blurArea'); }, 'priv'),
    T('shapes', 'Shapes', 'shapes', o('shapes')),
    T('sfx', 'Sound effects', 'sfx', o('sfx')),
    T('voice', 'Voiceover', 'mic', o('record')),
    T('fx', 'Effects', 'fx', () => panels.open('effects', { layer: true })),
    T('filters', 'Filters', 'filter', () => panels.open('filters', { layer: true })),
    T('adjust', 'Adjust', 'adjust', () => { A.addFilterLayer(null, {}); panels.open('adjust'); }),
    T('canvas', 'Canvas', 'canvas', o('canvas')),
    T('camera', 'Camera', 'camera', () => panels.camera()),
    T('audioFile', 'Voice file', 'sound', () => A.pickAndAdd('audio')),
    T('project', 'More', 'more', o('project')),
  ];
  const common = [T('split', 'Split', 'scissors', A.split)];
  const tail = [T('copy', 'Copy style', 'copy', A.copyStyle), ...(S.styleClip ? [T('paste', 'Paste style', 'paste', A.pasteStyle)] : []), T('dup', 'Duplicate', 'copy', A.dup), T('del', 'Delete', 'trash', A.del, 'danger')];
  if (it.kind === 'video' || it.kind === 'image') return [
    ...common,
    ...(it.kind === 'video' ? [T('speed', 'Speed', 'speed', o('speed')), T('volume', 'Volume', 'volume', o('volume'))] : []),
    T('anim', 'Animation', 'anim', o('anim')),
    ...(it.kind === 'video' ? [T('faces', 'Face blur', 'face', o('faces'), 'priv')] : []),
    T('filters', 'Filters', 'filter', o('filters')), T('adjust', 'Adjust', 'adjust', o('adjust')), T('effects', 'Effects', 'fx', o('effects')),
    T('mask', 'Mask', 'mask', o('mask')), T('crop', 'Crop', 'crop', o('crop')), T('transform', 'Transform', 'transform', o('transform')),
    T('opacity', 'Opacity', 'opacity', o('opacity')), T('chroma', 'Chroma key', 'chroma', o('chroma')),
    ...(it.kind === 'video' ? [T('cutout', 'Cutout', 'cutout', o('cutout')), T('stab', 'Stabilise', 'stab', o('stab'))] : []),
    ...(it.track === 'main' ? [T('trans', 'Transition', 'trans', o('transition'))] : []),
    ...(it.kind === 'video' ? [T('extract', 'Extract sound', 'audioOut', A.extractAudio), T('voice', 'Voice effects', 'voice', o('voicefx')), T('reverse', 'Reverse', 'reverse', A.reverseClip)] : []),
    T('freeze', 'Freeze', 'freeze', A.freezeFrame), T('replace', 'Replace', 'replace', A.replaceClip),
    ...tail,
  ];
  if (it.kind === 'text') return [
    T('edit', 'Edit', 'edit', () => panels.open('text', { tab: 'edit' })), T('font', 'Font', 'font', () => panels.open('text', { tab: 'font' })),
    T('style', 'Style', 'style', () => panels.open('text', { tab: 'style' })), T('anim', 'Animation', 'anim', o('anim')),
    ...(it.caption ? [T('captions', 'Captions', 'captions', o('captions'))] : []),
    ...common, T('effects', 'Effects', 'fx', o('effects')), T('opacity', 'Opacity', 'opacity', o('opacity')), T('mask', 'Mask', 'mask', o('mask')), ...tail,
  ];
  if (it.kind === 'shape') return [
    T('shape', 'Shape', 'shapes', o('shape')), T('anim', 'Animation', 'anim', o('anim')), ...common,
    T('effects', 'Effects', 'fx', o('effects')), T('opacity', 'Opacity', 'opacity', o('opacity')), T('mask', 'Mask', 'mask', o('mask')), ...tail,
  ];
  if (it.kind === 'audio') return [
    ...common, T('volume', 'Volume', 'volume', o('volume')), ...(it.sfx ? [] : [T('speed', 'Speed', 'speed', o('speed'))]),
    T('voice', 'Voice effects', 'voice', o('voicefx')), T('denoise', 'Clean up', 'denoise', () => panels.open('voicefx', { tab: 'clean' })), ...tail,
  ];
  if (it.kind === 'effect') return [T('change', 'Effect', 'fx', () => panels.open('effects', { layer: true, replace: true })), ...common, T('dup', 'Duplicate', 'copy', A.dup), T('del', 'Delete', 'trash', A.del, 'danger')];
  if (it.kind === 'filter') return [T('filters', 'Filter', 'filter', o('filters')), T('adjust', 'Adjust', 'adjust', o('adjust')), ...common, T('dup', 'Duplicate', 'copy', A.dup), T('del', 'Delete', 'trash', A.del, 'danger')];
  if (it.kind === 'blur') return [T('blur', 'Blur', 'blurArea', o('blurArea'), 'priv'), T('track', 'Follow motion', 'target', () => panels.open('blurArea', { track: true })), ...common, T('dup', 'Duplicate', 'copy', A.dup), T('del', 'Delete', 'trash', A.del, 'danger')];
  return [...common, ...tail];
}

export function renderTools() {
  if (!ui) return;
  const it = sel(), list = toolsFor(it), tools = ui.tools;
  tools.innerHTML = '';
  if (it) tools.append(h('button.back', { title: 'Done', html: icon('back'), on: { click: () => { panels.close(); select(null); } } }));
  const sc = h('div.scroll');
  for (const t of list) sc.append(h('button.tool' + (t.cls ? '.' + t.cls : ''), { 'data-tool': t.id, on: { click: t.fn } }, ico(t.ic), h('span', {}, t.label)));
  tools.append(sc);
}
