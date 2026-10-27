// Editing operations shared by the toolbar, panels and keyboard.
import { S, commit, select, sel, now } from './state.js';
import { baseItem, freeLayer, splitItem, removeItem, duplicateItem, mainItems, srcLen, layoutMain, duration, srcTime } from '../model.js';
import { importFiles, addBlob, decodeAudio } from '../media.js';
import { DEF_TEXT, DEF_SHAPE } from '../draw2d.js';
import { sfxById } from '../sfx.js';
import { effectById } from '../defs.js';
import { toast, busy } from './widgets.js';
import { deep, uid, pickFiles, clamp } from '../util.js';

export async function pickAndAdd(mode = 'main') {
  const files = await pickFiles(mode === 'audio' ? 'audio/*,video/*' : 'video/*,image/*');
  if (!files.length) return;
  await addFiles(files, mode);
}

export async function addFiles(files, mode = 'main', at = null) {
  const p = S.p, b = files.length > 1 || files[0]?.size > 30e6 ? busy('Adding…') : null;
  try {
    const ms = await importFiles(p, files, (f, n) => b?.set(f, n ? 'Reading ' + n : ''));
    if (!ms.length) { toast('Could not read that file'); return; }
    let last = null;
    if (mode === 'main') {
      const main = mainItems(p), t = at ?? now();
      // insert after the clip under the playhead (or at the end)
      let idx = main.length ? p.items.indexOf(main[main.length - 1]) + 1 : p.items.length;
      const under = main.find(i => t >= i.start && t < i.start + i.dur);
      if (under && main.length) idx = t - under.start < under.dur / 2 ? p.items.indexOf(under) : p.items.indexOf(under) + 1;
      for (const m of ms) {
        const it = mediaItem(m, 'main'); p.items.splice(idx++, 0, it); last = it;
      }
      layoutMain(p);
      if (!main.length && ms[0].w && ms[0].h) autoRatio(ms[0]);
    } else {
      for (const m of ms) {
        const it = mediaItem(m, mode === 'audio' ? 'audio' : 'layer');
        it.start = at ?? now();
        if (it.kind !== 'audio') it.tf.s = 0.6;
        it.layer = freeLayer(p, it.start, it.dur, it.track);
        p.items.push(it); last = it;
      }
    }
    commit({ audio: true });
    if (last) { select(last.id); S.player.seek(last.start + 0.001); }
  } finally { b?.close(); }
}

function mediaItem(m, track) {
  if (m.kind === 'audio') return Object.assign(baseItem('audio'), { mid: m.id, dur: Math.max(0.1, m.dur), track: 'audio', sub: 'file', name: m.name });
  const it = baseItem(m.kind === 'image' ? 'image' : 'video', { mid: m.id, track, dur: m.kind === 'image' ? 3 : Math.max(0.1, m.dur) });
  if (track === 'layer') it.layer = 1;
  return it;
}

// first clip decides the shape of a fresh project (portrait / landscape / square)
function autoRatio(m) {
  const p = S.p, r = m.w / m.h;
  const pick = r > 1.6 ? '16:9' : r > 1.2 ? '4:3' : r > 0.9 ? '1:1' : r > 0.7 ? '4:5' : '9:16';
  if (p.items.length === 1) setRatio(pick);
}
export function setRatio(id) {
  const p = S.p;
  const R = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350], '3:4': [1080, 1440], '4:3': [1440, 1080], '2:3': [1080, 1620], '21:9': [2520, 1080], '2.35:1': [2538, 1080] };
  if (id === 'original') {
    const first = mainItems(p)[0], m = first && p.media[first.mid];
    if (!m) return;
    const k = 1080 / Math.min(m.w, m.h); p.w = Math.round(m.w * k / 2) * 2; p.h = Math.round(m.h * k / 2) * 2; p.ratio = 'original';
  } else { [p.w, p.h] = R[id]; p.ratio = id; }
  commit();
}

export function addText(over = {}) {
  const p = S.p, t = now();
  const it = Object.assign(baseItem('text'), deep(DEF_TEXT), { start: t, dur: 3 }, over);
  it.layer = freeLayer(p, it.start, it.dur);
  p.items.push(it); commit(); select(it.id);
  return it;
}
export function addShape(shape) {
  const p = S.p, it = Object.assign(baseItem('shape'), deep(DEF_SHAPE), { shape, start: now(), dur: 3 });
  if (shape === 'line' || shape === 'wave') { it.w = 600; it.h = 60; it.sw = 14; }
  if (['rect', 'ellipse', 'pill', 'parallelogram', 'trapezoid', 'arrow', 'darrow', 'dots'].includes(shape)) { it.w = 560; it.h = shape === 'pill' || shape === 'dots' || shape.includes('arrow') ? 160 : 320; }
  if (shape === 'bubble') { it.w = 520; it.h = 380; it.fill = '#ffffff'; }
  if (shape === 'frame' || shape === 'bracket') { it.w = 900; it.h = 900; it.fill = '#ffffff'; it.sw = 18; }
  it.layer = freeLayer(p, it.start, it.dur);
  p.items.push(it); commit(); select(it.id);
  return it;
}
export function addSfx(id) {
  const def = sfxById(id), p = S.p;
  const it = Object.assign(baseItem('audio'), { sfx: { id, seed: Math.floor(Math.random() * 1e6) }, sub: 'sfx', name: def.name, start: now(), dur: def.dur, volume: 1 });
  it.layer = freeLayer(p, it.start, it.dur, 'audio');
  p.items.push(it); commit({ audio: true }); select(it.id);
  return it;
}
export function addEffectLayer(fxId) {
  const p = S.p, def = effectById(fxId);
  const it = Object.assign(baseItem('effect'), { fxId, a: def.a, b: def.sp ?? 1, name: def.name, start: now(), dur: 3 });
  it.layer = freeLayer(p, it.start, it.dur, 'layer', 1);
  p.items.push(it); commit(); select(it.id);
  return it;
}
export function addFilterLayer(filter, adj) {
  const p = S.p, d = Math.max(3, duration(p) - now());
  const it = Object.assign(baseItem('filter'), { filter: filter ? { id: filter, amt: 1 } : null, adj: adj || null, name: filter ? 'Filter' : 'Adjust', start: now(), dur: Math.min(d, 5) });
  it.layer = freeLayer(p, it.start, it.dur, 'layer', 1);
  p.items.push(it); commit(); select(it.id);
  return it;
}
export function addBlurArea() {
  const p = S.p, it = Object.assign(baseItem('blur'), { name: 'Blur area', start: now(), dur: Math.min(5, Math.max(1, duration(p) - now())), bw: 0.35, bh: 0.2, style: 0, strength: 0.85, feather: 0.4, shapeN: 1, color: '#000000' });
  it.layer = freeLayer(p, it.start, it.dur, 'layer', 1);
  p.items.push(it); commit(); select(it.id);
  return it;
}

export function split() {
  const it = sel() || mainItems(S.p).find(i => now() > i.start && now() < i.start + i.dur);
  if (!it) return toast('Move the playhead over a clip');
  const b = splitItem(S.p, it, now());
  if (!b) return toast('Too close to the edge');
  commit({ audio: true }); select(b.id);
}
export function del() {
  const it = sel(); if (!it) return;
  removeItem(S.p, it); select(null); commit({ audio: true });
}
export function dup() { const it = sel(); if (!it) return; const b = duplicateItem(S.p, it); commit({ audio: true }); select(b.id); }

export async function extractAudio() {
  const it = sel(); if (!it || it.kind !== 'video') return;
  const m = S.p.media[it.mid]; const buf = await decodeAudio(m);
  if (!buf) return toast('This video has no readable sound');
  const a = Object.assign(baseItem('audio'), { mid: it.mid, in: it.in, speed: it.speed, curve: deep(it.curve), keepPitch: it.keepPitch, start: it.start, dur: it.dur, volume: it.volume, name: 'Sound of ' + (m.name || 'clip'), sub: 'extract', voice: it.voice, denoise: it.denoise });
  a.layer = freeLayer(S.p, a.start, a.dur, 'audio');
  it.mute = true;
  S.p.items.push(a); commit({ audio: true }); select(a.id); toast('Sound moved to its own track');
}

export async function freezeFrame() {
  const p = S.p, t = now();
  const it = sel()?.kind === 'video' ? sel() : mainItems(p).find(i => t >= i.start && t < i.start + i.dur && i.kind === 'video');
  if (!it) return toast('Put the playhead over a video clip');
  const { grabFrame } = await import('../media.js');
  const c = await grabFrame(it.mid, srcTime(it, t - it.start), 4096);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
  const m = await addBlob(p, blob, 'frame.jpg');
  const img = Object.assign(deep(it), { id: uid(), kind: 'image', mid: m.id, in: 0, dur: 3, speed: 1, curve: null, trans: null, anim: { in: null, out: null, loop: null }, kf: {} });
  if (it.track === 'main') {
    const b = splitItem(p, it, t);
    const idx = p.items.indexOf(it) + 1;
    p.items.splice(idx, 0, img);
    if (!b && t - it.start < 0.05) { p.items.splice(idx, 1); p.items.splice(p.items.indexOf(it), 0, img); }
  } else { img.start = t; img.layer = freeLayer(p, t, 3, 'layer', it.layer); p.items.push(img); }
  commit({ audio: true }); select(img.id); toast('Frame held for 3 seconds');
}

export async function reverseClip() {
  const it = sel(); if (!it || it.kind !== 'video') return;
  const m = S.p.media[it.mid];
  if (m.reversedId && S.p.media[m.reversedId]) { swapReverse(it, m.reversedId); return; }
  const { reverseMedia, canWebCodecs } = await import('../export.js');
  if (!canWebCodecs()) return toast('This browser cannot reverse video. Try Chrome or a newer Safari.');
  const b = busy('Reversing clip');
  try {
    const blob = await reverseMedia(m, (f, t) => b.set(f, t), b.signal);
    const r = await addBlob(S.p, blob, (m.name || 'clip') + ' (reversed).mp4');
    r.reversedId = m.id; m.reversedId = r.id; r.hasAudio = m.hasAudio;
    swapReverse(it, r.id);
  } catch (e) { if (e.name !== 'AbortError') toast('Could not reverse: ' + e.message); }
  finally { b.close(); }
}
function swapReverse(it, rid) {
  const m = S.p.media[it.mid], r = S.p.media[rid];
  const len = srcLen(it);
  it.in = clamp(m.dur - (it.in + len), 0, r.dur);
  it.mid = rid; it.reversed = !it.reversed;
  commit({ audio: true }); toast(it.reversed ? 'Clip plays backwards' : 'Clip plays forwards');
}

export async function replaceClip() {
  const it = sel(); if (!it || (it.kind !== 'video' && it.kind !== 'image')) return;
  const files = await pickFiles('video/*,image/*', false); if (!files.length) return;
  const [m] = await importFiles(S.p, files); if (!m) return toast('Could not read that file');
  it.mid = m.id; it.kind = m.kind === 'image' ? 'image' : 'video'; it.in = 0;
  if (m.kind === 'video' && m.dur < srcLen(it)) it.dur = m.dur / (it.speed || 1);
  if (it.faces) it.faces = { ...it.faces, off: [] };
  commit({ audio: true });
}

const STYLE_KEYS = ['filter', 'adj', 'fx', 'mask', 'chroma', 'anim', 'opacity', 'blend', 'faces', 'font', 'weight', 'color', 'stroke', 'strokeColor', 'shadow', 'shadowColor', 'bg', 'bgAlpha', 'bgPad', 'bgRadius', 'glow', 'glowColor', 'size', 'voice', 'denoise'];
export function copyStyle() { const it = sel(); if (!it) return; S.styleClip = { kind: it.kind, v: deep(Object.fromEntries(STYLE_KEYS.filter(k => k in it).map(k => [k, it[k]]))) }; toast('Style copied'); }
export function pasteStyle() {
  const it = sel(); if (!it || !S.styleClip) return;
  for (const [k, v] of Object.entries(deep(S.styleClip.v))) if (k in it) { if (k === 'faces' && v) v.off = []; it[k] = v; }
  commit({ audio: true }); toast('Style pasted');
}

export function addCaptionItems(lines, look, opts = {}) {
  const p = S.p, created = [];
  // remove earlier automatic captions when asked
  if (opts.replace) p.items = p.items.filter(i => !i.caption);
  for (const l of lines) {
    const text = l.text ?? l.words.map(w => w.w).join(' ');
    const it = Object.assign(baseItem('text'), deep(DEF_TEXT), look?.s || {}, {
      text, start: l.s, dur: Math.max(0.3, l.e - l.s), caption: true, size: opts.size || 62, maxW: 0.84,
      words: l.words ? l.words.map(w => ({ w: w.w, s: w.s - l.s, e: w.e - l.s })) : null, hl: look?.hl || null,
    });
    it.tf.y = opts.y ?? 0.3;
    it.layer = 40; // captions sit on their own row near the top
    p.items.push(it); created.push(it);
  }
  commit();
  return created;
}
