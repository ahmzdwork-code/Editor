// Project data: items on a timeline, how time maps to the source media, keyframes, undo.
import { uid, clamp, deep, ease, lerp } from './util.js';

export const RATIOS = [
  { id: '9:16', w: 1080, h: 1920, label: '9:16' },
  { id: '16:9', w: 1920, h: 1080, label: '16:9' },
  { id: '1:1', w: 1080, h: 1080, label: '1:1' },
  { id: '4:5', w: 1080, h: 1350, label: '4:5' },
  { id: '3:4', w: 1080, h: 1440, label: '3:4' },
  { id: '4:3', w: 1440, h: 1080, label: '4:3' },
  { id: '2:3', w: 1080, h: 1620, label: '2:3' },
  { id: '21:9', w: 2520, h: 1080, label: '21:9' },
  { id: '2.35:1', w: 2538, h: 1080, label: 'Cinema' },
];

export function newProject(name) {
  return {
    id: uid(), name: name || 'Untitled', created: Date.now(), updated: Date.now(), version: 1,
    ratio: '9:16', w: 1080, h: 1920, fps: 30,
    bg: { type: 'blur', color: '#000000', blur: 0.6 },
    media: {}, items: [], markers: [], muteMain: false, thumb: null,
  };
}

export const VISUAL = new Set(['video', 'image', 'text', 'shape', 'effect', 'filter', 'adjust', 'blur']);
export const isMedia = it => it.kind === 'video' || it.kind === 'image' || it.kind === 'audio';
export const hasSound = (it, p) => it.kind === 'audio' || (it.kind === 'video' && p.media[it.mid]?.hasAudio !== false);

export const DEF_ADJ = { exposure: 0, brightness: 0, contrast: 0, saturation: 0, vibrance: 0, temp: 0, tint: 0, hue: 0, highlights: 0, shadows: 0, fade: 0, sharpen: 0, vignette: 0, grain: 0 };

export function baseItem(kind, extra = {}) {
  const it = {
    id: uid(), kind, track: 'layer', layer: 1, start: 0, dur: 3,
    tf: { x: 0, y: 0, s: 1, r: 0 }, opacity: 1, blend: 'normal',
    anim: { in: null, out: null, loop: null }, kf: {},
  };
  if (kind === 'video' || kind === 'image') Object.assign(it, {
    mid: null, in: 0, speed: 1, curve: null, volume: 1, mute: false, fadeIn: 0, fadeOut: 0, keepPitch: true, voice: null, denoise: 0,
    flipH: false, flipV: false, crop: null, filter: null, adj: null, fx: [], mask: null, chroma: null, trans: null,
    faces: null, stab: null, cutout: null, fit: 'fit', bgOff: false,
  });
  if (kind === 'audio') Object.assign(it, { track: 'audio', mid: null, sfx: null, in: 0, speed: 1, curve: null, volume: 1, mute: false, fadeIn: 0, fadeOut: 0, keepPitch: true, voice: null, denoise: 0, sub: 'sound' });
  return Object.assign(it, extra);
}

/* ---------- main track ---------- */
export const mainItems = p => p.items.filter(i => i.track === 'main');
export function layoutMain(p) {
  let t = 0;
  const m = mainItems(p);
  m.forEach((it, i) => {
    it.start = t;
    const nx = m[i + 1];
    if (it.trans && nx) it.trans.dur = clamp(it.trans.dur, 0.1, Math.min(it.dur, nx.dur) * 0.5);
    else if (it.trans && !nx) it.trans = null;
    t += it.dur - (it.trans && nx ? it.trans.dur : 0);
  });
}
export function duration(p) {
  let d = 0;
  for (const it of p.items) d = Math.max(d, it.start + it.dur);
  return d;
}

/* ---------- time: timeline → source ---------- */
// speed curve: points {p: 0..1 along the clip, v: multiplier}. Integral table built lazily.
const curveCache = new WeakMap();
function curveTable(curve) {
  let t = curveCache.get(curve);
  if (t) return t;
  const N = 400, acc = new Float32Array(N + 1);
  for (let i = 1; i <= N; i++) acc[i] = acc[i - 1] + (curveAt(curve, (i - 0.5) / N)) / N;
  t = { acc, mean: acc[N] };
  curveCache.set(curve, t);
  return t;
}
export function curveAt(curve, p) {
  if (!curve?.length) return 1;
  if (p <= curve[0].p) return curve[0].v;
  for (let i = 1; i < curve.length; i++) if (p <= curve[i].p) {
    const a = curve[i - 1], b = curve[i], k = (p - a.p) / (b.p - a.p || 1);
    return lerp(a.v, b.v, ease.inout(k));
  }
  return curve[curve.length - 1].v;
}
export const curveMean = c => (c?.length ? curveTable(c).mean : 1);
// length of source media the item covers
export const srcLen = it => it.dur * (it.speed || 1) * curveMean(it.curve);
export function srcTime(it, lt) {
  lt = clamp(lt, 0, it.dur);
  if (it.kind === 'image') return 0;
  const sp = it.speed || 1;
  if (!it.curve?.length) return it.in + lt * sp;
  const { acc } = curveTable(it.curve), N = acc.length - 1, f = (lt / it.dur) * N, i = Math.floor(f);
  const v = i >= N ? acc[N] : lerp(acc[i], acc[i + 1], f - i);
  return it.in + v * it.dur * sp;
}
// instantaneous speed at local time
export const speedAt = (it, lt) => (it.speed || 1) * curveAt(it.curve, lt / it.dur);
export function setSpeed(it, sp, curve = it.curve) {
  const len = srcLen(it);
  it.speed = sp; it.curve = curve;
  it.dur = Math.max(0.05, len / (sp * curveMean(curve)));
}

/* ---------- keyframes ---------- */
export const KF_PROPS = ['x', 'y', 's', 'r', 'o', 'vol'];
export function baseVal(it, prop) {
  switch (prop) {
    case 'x': return it.tf.x; case 'y': return it.tf.y; case 's': return it.tf.s; case 'r': return it.tf.r;
    case 'o': return it.opacity; case 'vol': return it.volume ?? 1;
  }
  return 0;
}
export function setBase(it, prop, v) {
  switch (prop) {
    case 'x': it.tf.x = v; break; case 'y': it.tf.y = v; break; case 's': it.tf.s = v; break; case 'r': it.tf.r = v; break;
    case 'o': it.opacity = v; break; case 'vol': it.volume = v; break;
  }
}
export function kfVal(it, prop, lt) {
  const k = it.kf?.[prop];
  if (!k?.length) return baseVal(it, prop);
  if (lt <= k[0].t) return k[0].v;
  for (let i = 1; i < k.length; i++) if (lt <= k[i].t) {
    const a = k[i - 1], b = k[i], f = (lt - a.t) / (b.t - a.t || 1);
    return lerp(a.v, b.v, (ease[a.e] || ease.linear)(f));
  }
  return k[k.length - 1].v;
}
export const hasKf = it => KF_PROPS.some(p => it.kf?.[p]?.length);
export function kfTimes(it) {
  const s = new Set();
  for (const p of KF_PROPS) for (const k of it.kf?.[p] || []) s.add(Math.round(k.t * 1000) / 1000);
  return [...s].sort((a, b) => a - b);
}
const NEAR = 1 / 30 / 2 + 0.001;
export function kfAt(it, lt) { return KF_PROPS.some(p => it.kf?.[p]?.some(k => Math.abs(k.t - lt) < NEAR)); }
// set a property at local time: updates the keyframe there (or creates one) when the property is keyframed
export function setProp(it, prop, v, lt) {
  const k = it.kf?.[prop];
  if (k?.length && lt != null) {
    const e = k.find(q => Math.abs(q.t - lt) < NEAR);
    if (e) e.v = v; else { k.push({ t: lt, v, e: 'inout' }); k.sort((a, b) => a.t - b.t); }
  } else setBase(it, prop, v);
}
// adds a keyframe for all transform props at local time (CapCut-style diamond button)
export function toggleKf(it, lt, props) {
  props ||= it.kind === 'audio' ? ['vol'] : ['x', 'y', 's', 'r', 'o'];
  it.kf ||= {};
  if (kfAt(it, lt)) {
    for (const p of KF_PROPS) if (it.kf[p]) { it.kf[p] = it.kf[p].filter(k => Math.abs(k.t - lt) >= NEAR); if (!it.kf[p].length) delete it.kf[p]; }
    return false;
  }
  for (const p of props) {
    const v = kfVal(it, p, lt);
    (it.kf[p] ||= []).push({ t: lt, v, e: 'inout' });
    it.kf[p].sort((a, b) => a.t - b.t);
  }
  return true;
}
export function shiftKf(it, dt) {
  for (const p of Object.keys(it.kf || {})) {
    it.kf[p] = it.kf[p].map(k => ({ ...k, t: k.t + dt })).filter(k => k.t >= -0.001 && k.t <= it.dur + 0.001);
    if (!it.kf[p].length) delete it.kf[p];
  }
}

/* ---------- editing operations ---------- */
export function splitItem(p, it, t) {
  const lt = t - it.start;
  if (lt < 0.05 || lt > it.dur - 0.05) return null;
  const b = deep(it); b.id = uid();
  if (it.kind === 'video' || it.kind === 'audio') {
    if (it.curve?.length) {
      // keep the curve shape by splitting it at the cut
      const p0 = lt / it.dur, mk = (lo, hi) => {
        const pts = [{ p: 0, v: curveAt(it.curve, lo) }, ...it.curve.filter(c => c.p > lo && c.p < hi).map(c => ({ p: (c.p - lo) / (hi - lo), v: c.v })), { p: 1, v: curveAt(it.curve, hi) }];
        return pts;
      };
      b.in = srcTime(it, lt);
      const ca = mk(0, p0), cb = mk(p0, 1);
      b.curve = cb; b.dur = it.dur - lt; it.curve = ca; it.dur = lt;
    } else { b.in = srcTime(it, lt); b.dur = it.dur - lt; it.dur = lt; }
  } else { b.dur = it.dur - lt; it.dur = lt; }
  if (b.sfx) b.sfx = { ...b.sfx, off: (b.sfx.off || 0) + lt };
  b.start = it.start + lt;
  b.fadeIn = 0; it.fadeOut = 0;
  if (it.anim) { b.anim = { ...it.anim, in: null }; it.anim = { ...it.anim, out: null }; }
  shiftKf(b, -lt); shiftKf(it, 0);
  if (it.trans) { b.trans = it.trans; it.trans = null; }
  const idx = p.items.indexOf(it);
  p.items.splice(idx + 1, 0, b);
  if (it.track === 'main') layoutMain(p);
  return b;
}

export function removeItem(p, it) {
  p.items = p.items.filter(i => i !== it);
  if (it.track === 'main') layoutMain(p);
}

export function duplicateItem(p, it) {
  const b = deep(it); b.id = uid();
  const idx = p.items.indexOf(it);
  if (it.track === 'main') { p.items.splice(idx + 1, 0, b); layoutMain(p); }
  else { b.start = it.start + it.dur; b.layer = freeLayer(p, b.start, b.dur, it.track, it.layer); p.items.push(b); }
  return b;
}

// lowest row (starting at `pref`) with no overlap in [start, start+dur)
export function freeLayer(p, start, dur, track = 'layer', pref = 1, ignore = null) {
  for (let l = Math.max(1, pref); l < 60; l++) {
    const busy = p.items.some(i => i !== ignore && i.track === track && i.layer === l && i.start < start + dur - 1e-3 && i.start + i.dur > start + 1e-3);
    if (!busy) return l;
  }
  return 60;
}

// time ranges of the main track clips: used for snapping
export function snapPoints(p, exclude) {
  const s = new Set([0]);
  for (const i of p.items) if (i !== exclude) { s.add(i.start); s.add(i.start + i.dur); }
  for (const m of p.markers || []) s.add(m);
  return [...s];
}

/* ---------- undo ---------- */
export class History {
  constructor(p) { this.stack = []; this.redo = []; this.last = this.snap(p); }
  snap(p) { const { thumb, ...rest } = p; return JSON.stringify(rest); }
  commit(p) {
    const s = this.snap(p);
    if (s === this.last) return false;
    this.stack.push(this.last); if (this.stack.length > 120) this.stack.shift();
    this.last = s; this.redo = [];
    return true;
  }
  undo(p) {
    if (!this.stack.length) return null;
    this.redo.push(this.last); this.last = this.stack.pop();
    return Object.assign(JSON.parse(this.last), { thumb: p.thumb });
  }
  again(p) {
    if (!this.redo.length) return null;
    this.stack.push(this.last); this.last = this.redo.pop();
    return Object.assign(JSON.parse(this.last), { thumb: p.thumb });
  }
}
