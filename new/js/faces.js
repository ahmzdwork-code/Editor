/* Face blur — finding faces and following them through a video.
   Everything runs on the device; nothing is uploaded.
   Three finders look at every analysed frame:
     1. SSD MobileNet face detector (good with small, distant faces)
     2. BlazeFace full-range face detector (good with close and tilted faces)
     3. MoveNet body pose → a head box from the eyes, ears and nose (catches heads turned away,
        side views and faces hidden by motion blur, which face detectors miss)
   Their boxes are merged, linked into tracks over time, smoothed, gap-filled, and padded for motion,
   so the cover never "blinks" off a face between analysed frames. */
import { withTimeout, sleep, clamp, once } from './util.js';
import { urlFor } from './media.js';
import * as store from './store.js';

const base = new URL('../vendor/', import.meta.url).href;
let engines = null;

async function loadSSD() {
  const fa = await withTimeout(import(base + 'fa/face-api.esm.js'), 60000, 'face finder');
  let ok = false; try { ok = await withTimeout(fa.tf.setBackend('webgl'), 15000, 'graphics'); } catch (e) { }
  if (!ok) await fa.tf.setBackend('cpu');
  await fa.tf.ready();
  await withTimeout(fa.nets.ssdMobilenetv1.loadFromUri(base + 'fa/model'), 90000, 'face model');
  return {
    detect: async (c, minConf) => (await fa.detectAllFaces(c, new fa.SsdMobilenetv1Options({ minConfidence: minConf, maxResults: 60 })))
      .map(d => ({ x: d.box.x, y: d.box.y, w: d.box.width, h: d.box.height, score: d.score, src: 'ssd' })),
  };
}
async function loadHuman(withBody, withSeg) {
  const H = await withTimeout(import(base + 'hu/human.esm.js'), 60000, 'people finder');
  let last = null;
  for (const backend of ['webgl', 'wasm', 'cpu']) {
    if (backend === 'wasm') continue;
    try {
      const human = new H.Human({
        backend, modelBasePath: base + 'hu/models/', filter: { enabled: false }, cacheSensitivity: 0, skipAllowed: false, warmup: 'none', debug: false, async: true,
        face: { enabled: true, detector: { modelPath: 'blazeface-back.json', maxDetected: 50, minConfidence: 0.2, rotation: false, return: false }, mesh: { enabled: false }, iris: { enabled: false }, emotion: { enabled: false }, description: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false }, attention: { enabled: false } },
        body: { enabled: withBody, modelPath: 'movenet-multipose.json', maxDetected: 6, minConfidence: 0.15 },
        hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false },
        segmentation: { enabled: withSeg, modelPath: 'selfie.json', mode: 'alpha' },
      });
      await withTimeout(human.load(), 120000, 'people models');
      return {
        human,
        detect: async (c, minConf) => {
          const r = await human.detect(c);
          // the finder reports faces 1.4x larger than the face; shrink back
          const faces = r.face.filter(f => f.score >= minConf).map(f => { const k = 1 / 1.4, w = f.box[2] * k, h = f.box[3] * k; return { x: f.box[0] + (f.box[2] - w) / 2, y: f.box[1] + (f.box[3] - h) / 2, w, h, score: f.score, src: 'blaze' }; });
          const heads = withBody ? r.body.map(b => headFromBody(b)).filter(Boolean) : [];
          return [...faces, ...heads];
        },
        segment: async c => { const m = await human.segmentation(c); if (!m) return null; const d = await m.data(), h = m.shape[0], w = m.shape[1]; m.dispose?.(); return { d, w, h }; },
      };
    } catch (e) { last = e; console.warn('human', backend, e); }
  }
  throw last;
}

export async function loadEngines(onStatus) {
  if (engines) return engines;
  if (window.__mockFaces) return (engines = { list: [{ name: 'test', detect: window.__mockFaces }] });
  onStatus?.('Loading face finders (first time only)…');
  const [ssd, hum] = await Promise.allSettled([loadSSD(), loadHuman(true, false)]);
  const list = [];
  if (ssd.status === 'fulfilled') list.push({ name: 'ssd', ...ssd.value });
  if (hum.status === 'fulfilled') list.push({ name: 'human', ...hum.value });
  if (!list.length) throw new Error('Could not load the face finders: ' + [ssd.reason, hum.reason].map(e => e?.message || e).join(' / '));
  engines = { list };
  return engines;
}

const KP = (kp, n, min = 0.3) => kp.find(q => q.part === n && q.score >= min);
function headFromBody(b) {
  const kp = b.keypoints.map(q => ({ part: q.part, x: q.position[0], y: q.position[1], score: q.score }));
  const pts = ['nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar'].map(n => KP(kp, n)).filter(Boolean);
  const ls = KP(kp, 'leftShoulder'), rs = KP(kp, 'rightShoulder'), sw = ls && rs ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : 0;
  let box = null, score = 0;
  if (pts.length >= 2 || (pts.length && sw)) {
    const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length, cy = pts.reduce((a, q) => a + q.y, 0) / pts.length;
    const spread = Math.max(...pts.map(q => q.x)) - Math.min(...pts.map(q => q.x));
    const w = clamp(Math.max(spread * 1.1, sw * 0.36), sw * 0.25 || 6, sw ? sw * 0.75 : 1e4), h = w * 1.15;
    box = { x: cx - w / 2, y: cy - h * 0.45, w, h }; score = pts.reduce((a, q) => a + q.score, 0) / pts.length * 0.8;
  } else if (ls && rs && b.score > 0.3) {
    const w = sw * 0.38, h = w * 1.15, cx = (ls.x + rs.x) / 2, cy = Math.min(ls.y, rs.y) - h * 0.95;
    box = { x: cx - w / 2, y: cy - h / 2, w, h }; score = 0.4;
  }
  return box && box.w > 4 ? { ...box, score, src: 'body' } : null;
}

const iou = (a, b) => { const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h); const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1); return i / (a.w * a.h + b.w * b.h - i || 1); };
const inside = (a, b) => { const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h); return Math.max(0, x2 - x1) * Math.max(0, y2 - y1) / (Math.min(a.w * a.h, b.w * b.h) || 1); };

// merges boxes from several finders: overlapping boxes become one (score-weighted), body-only heads kept
function merge(list) {
  list.sort((a, b) => b.score - a.score);
  const out = [];
  for (const d of list) {
    const m = out.find(o => iou(o, d) > 0.3 || inside(o, d) > 0.6);
    if (m) {
      if (d.src === 'body' && m.srcs.has('ssd')) { m.srcs.add('body'); continue; }   // face finders are more exact than pose
      const wa = m.wsum, wb = d.score;
      for (const k of ['x', 'y', 'w', 'h']) m[k] = (m[k] * wa + d[k] * wb) / (wa + wb);
      m.wsum += wb; m.score = Math.max(m.score, d.score); m.srcs.add(d.src);
    } else out.push({ ...d, wsum: d.score, srcs: new Set([d.src]) });
  }
  return out.map(o => ({ x: o.x, y: o.y, w: o.w, h: o.h, score: Math.min(1, o.score + (o.srcs.size > 1 ? 0.15 : 0)), body: o.srcs.size === 1 && o.srcs.has('body') }));
}

/* ---------- analysing a video ---------- */
// opts: { from, to (source seconds), rate (frames per second analysed), sens (0..1), small (tile search for far faces), body (pose heads) }
export async function analyse(mid, media, opts, onProgress, signal) {
  const eng = await loadEngines(s => onProgress?.(0, s));
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = await urlFor(mid);
  await withTimeout(once(v, 'loadeddata'), 20000, 'video');
  const W = v.videoWidth, H = v.videoHeight, long = Math.max(W, H), k = Math.min(1, 1280 / long);
  const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const tile = document.createElement('canvas'), tctx = tile.getContext('2d');
  const minConf = 0.62 - (opts.sens ?? 0.5) * 0.42;  // more sensitive = lower threshold
  const from = Math.max(0, opts.from ?? 0), to = Math.min(media.dur || v.duration, opts.to ?? v.duration);
  const step = 1 / (opts.rate || 10), frames = [];
  const prev = (await getData(mid)) || { w: W, h: H, frames: [], manual: [] };
  const N = Math.max(1, Math.ceil((to - from) / step));
  for (let i = 0; i <= N; i++) {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    const t = Math.min(to - 0.001, from + i * step);
    v.currentTime = t;
    try { await withTimeout(once(v, 'seeked'), 6000, 'seek'); } catch (e) { continue; }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    let dets = [];
    for (const e of eng.list) {
      try { dets.push(...(await e.detect(c, minConf))); } catch (err) { console.warn(e.name, err); }
    }
    // far faces: look again at overlapping quarters of the picture, enlarged
    if (opts.small) {
      const tw = Math.round(c.width * 0.6), th = Math.round(c.height * 0.6); tile.width = tw; tile.height = th;
      for (const [ox, oy] of [[0, 0], [c.width - tw, 0], [0, c.height - th], [c.width - tw, c.height - th]]) {
        tctx.drawImage(c, ox, oy, tw, th, 0, 0, tw, th);
        for (const e of eng.list) {
          if (e.name === 'human') continue;
          try { for (const d of await e.detect(tile, minConf + 0.05)) dets.push({ ...d, x: d.x + ox, y: d.y + oy }); } catch (err) { }
        }
      }
    }
    if (opts.body === false) dets = dets.filter(d => d.src !== 'body');
    const m = merge(dets).map(d => ({ x: d.x / c.width, y: d.y / c.height, w: d.w / c.width, h: d.h / c.height, s: +d.score.toFixed(3), b: d.body ? 1 : 0 }));
    frames.push({ t, d: m });
    onProgress?.((i + 1) / (N + 1), `Looking for faces… ${Math.round((i + 1) / (N + 1) * 100)}%`);
    if (i % 4 === 3) await sleep(0);
  }
  v.removeAttribute('src'); v.load();
  // merge with earlier analysis outside this range
  const keep = prev.frames.filter(f => f.t < from - 0.001 || f.t > to + 0.001);
  const data = { w: W, h: H, rate: opts.rate || 10, frames: [...keep, ...frames].sort((a, b) => a.t - b.t), manual: prev.manual || [], off: prev.off || [], version: 2 };
  data.tracks = buildTracks(data.frames, opts);
  await setData(mid, data);
  return data;
}

/* ---------- linking boxes into tracks ---------- */
export function buildTracks(frames, opts = {}) {
  const tracks = [], live = [];
  let nextId = 1;
  const maxGap = opts.maxGap ?? 1.2;
  for (const f of frames) {
    // predicted position of each live track
    const preds = live.map(tr => {
      const s = tr.s, a = s[s.length - 1], b = s[s.length - 2];
      if (!b) return { ...a };
      const dt = f.t - a.t, k = dt / ((a.t - b.t) || 1) * 0.6;
      return { x: a.x + (a.x - b.x) * k, y: a.y + (a.y - b.y) * k, w: a.w, h: a.h };
    });
    const pairs = [];
    f.d.forEach((d, j) => preds.forEach((p, i) => {
      const ov = iou(p, d), dist = Math.hypot((p.x + p.w / 2) - (d.x + d.w / 2), (p.y + p.h / 2) - (d.y + d.h / 2)) / Math.max(p.w, d.w, 0.01);
      const sizeOk = Math.max(p.w / d.w, d.w / p.w) < 2.2;
      if ((ov > 0.05 || dist < 1.1) && sizeOk) pairs.push({ i, j, c: (1 - ov) + dist * 0.5 });
    }));
    pairs.sort((a, b) => a.c - b.c);
    const ui = new Set(), uj = new Set();
    for (const pr of pairs) {
      if (ui.has(pr.i) || uj.has(pr.j)) continue;
      ui.add(pr.i); uj.add(pr.j);
      const d = f.d[pr.j]; live[pr.i].s.push({ t: f.t, x: d.x, y: d.y, w: d.w, h: d.h, sc: d.s });
      live[pr.i].best = Math.max(live[pr.i].best, d.s); if (!d.b) live[pr.i].faceHits++;
    }
    f.d.forEach((d, j) => { if (!uj.has(j)) { const tr = { id: nextId++, s: [{ t: f.t, x: d.x, y: d.y, w: d.w, h: d.h, sc: d.s }], best: d.s, faceHits: d.b ? 0 : 1 }; live.push(tr); tracks.push(tr); } });
    for (let i = live.length - 1; i >= 0; i--) if (f.t - live[i].s[live[i].s.length - 1].t > maxGap) live.splice(i, 1);
  }
  // join pieces of the same person split by a longer gap
  tracks.sort((a, b) => a.s[0].t - b.s[0].t);
  for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
    const A = tracks[i], B = tracks[j]; if (!A.s.length || !B.s.length) continue;
    const ae = A.s[A.s.length - 1], bs = B.s[0], gap = bs.t - ae.t;
    if (gap <= 0 || gap > 3) continue;
    const dist = Math.hypot((ae.x + ae.w / 2) - (bs.x + bs.w / 2), (ae.y + ae.h / 2) - (bs.y + bs.h / 2)) / Math.max(ae.w, bs.w);
    if (dist < 1.2 && Math.max(ae.w / bs.w, bs.w / ae.w) < 1.8) { A.s.push(...B.s); A.best = Math.max(A.best, B.best); A.faceHits += B.faceHits; B.s = []; }
  }
  const sens = opts.sens ?? 0.5;
  return tracks.filter(tr => tr.s.length && (tr.s.length >= 2 || tr.best > 0.75 - sens * 0.3) && (tr.faceHits > 0 || tr.s.length >= 3))
    .map((tr, i) => ({ id: tr.id, s: smooth(tr.s), best: tr.best, t0: tr.s[0].t, t1: tr.s[tr.s.length - 1].t }));
}
// gentle smoothing of box position and size (removes jitter, keeps motion)
function smooth(s) {
  if (s.length < 3) return s;
  return s.map((p, i) => {
    let n = 0, x = 0, y = 0, w = 0, h = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(s.length - 1, i + 2); j++) {
      const q = s[j], wt = j === i ? 2 : Math.abs(j - i) === 1 ? 1.5 : 1;
      if (Math.abs(q.t - p.t) > 0.6) continue;
      x += (q.x + q.w / 2) * wt; y += (q.y + q.h / 2) * wt; w += q.w * wt; h += q.h * wt; n += wt;
    }
    w /= n; h /= n;
    return { t: p.t, x: x / n - w / 2, y: y / n - h / 2, w, h, sc: p.sc };
  });
}

/* ---------- box of a track at time t (interpolated), with motion margin ---------- */
export function boxAt(tr, t, hold = 0.35) {
  const s = tr.s; if (!s?.length) return null;
  if (t < s[0].t - hold || t > s[s.length - 1].t + hold) return null;
  if (t <= s[0].t) return { ...s[0], v: 0 };
  if (t >= s[s.length - 1].t) return { ...s[s.length - 1], v: 0 };
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m].t <= t) lo = m; else hi = m; }
  const a = s[lo], b = s[hi], k = (t - a.t) / (b.t - a.t || 1);
  // long gap with no detection in between: keep covering, but only where the face could be
  const r = { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k };
  // how far the face moved between the two samples: covers any wobble in between
  r.v = Math.hypot((b.x + b.w / 2) - (a.x + a.w / 2), (b.y + b.h / 2) - (a.y + a.h / 2)) * 0.5 + Math.abs(b.w - a.w) * 0.5;
  return r;
}

/* ---------- regions for the renderer ---------- */
// fb: item.faces settings. Returns { list, opts } in pixels of a w×h frame.
export function regions(data, fb, t, w, h) {
  if (!data || !fb?.on) return null;
  const list = [], pad = fb.pad ?? 1.35, off = new Set(fb.off || []), only = fb.only ? new Set(fb.only) : null;
  const shapeN = fb.shape === 'rect' ? 1 : fb.shape === 'box' ? 2 : 0;
  const add = (b, extra = 1) => {
    const cx = (b.x + b.w / 2) * w, cy = (b.y + b.h / 2 - b.h * 0.04) * h;
    const mv = (b.v || 0) * Math.max(w, h);
    const hw = (b.w * w / 2) * pad * extra + mv, hh = (b.h * h / 2) * pad * 1.12 * extra + mv;
    list.push({ x: cx, y: cy, hw, hh, shape: shapeN, feather: fb.feather ?? 0.35, style: STYLE_N[fb.style] ?? 0 });
  };
  for (const tr of data.tracks || []) {
    if (fb.mode === 'selected' ? !(only?.has(tr.id)) : off.has(tr.id)) continue;
    const b = boxAt(tr, t, fb.hold ?? 0.35); if (b) add(b);
  }
  for (const m of data.manual || []) {
    if (off.has(m.id)) continue;
    const b = boxAt(m, t, 0.05); if (b) add(b, 1 / pad);
  }
  return { list, opts: { style: STYLE_N[fb.style] ?? 0, strength: fb.strength ?? 0.85, blocks: Math.round(4 + (1 - (fb.strength ?? 0.85)) * 14), color: hex(fb.color || '#000000') } };
}
const STYLE_N = { blur: 0, mosaic: 1, solid: 2, frosted: 3 };
const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

/* ---------- storage ---------- */
const mem = new Map();
export async function getData(mid) {
  if (mem.has(mid)) return mem.get(mid);
  const d = await store.cacheGet('faces:' + mid).catch(() => null);
  mem.set(mid, d || null);
  return d || null;
}
export const dataNow = mid => mem.get(mid);
export async function setData(mid, d) { mem.set(mid, d); await store.cacheSet('faces:' + mid, d); }

// still image of a face for the list
export async function faceThumb(mid, tr, size = 72) {
  const s = tr.s.reduce((a, b) => (b.sc > a.sc ? b : a), tr.s[0]);
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = await urlFor(mid);
  await withTimeout(once(v, 'loadeddata'), 15000, 'thumb');
  v.currentTime = s.t; await withTimeout(once(v, 'seeked'), 8000, 'thumb seek');
  const W = v.videoWidth, H = v.videoHeight, c = document.createElement('canvas'); c.width = c.height = size;
  const m = Math.max(s.w * W, s.h * H) * 1.5, cx = (s.x + s.w / 2) * W, cy = (s.y + s.h / 2) * H;
  c.getContext('2d').drawImage(v, cx - m / 2, cy - m / 2, m, m, 0, 0, size, size);
  v.removeAttribute('src'); v.load();
  return c.toDataURL('image/jpeg', 0.8);
}

/* ---------- people cut-out (background removal) ---------- */
let segEngine = null;
async function seg() { if (!segEngine) segEngine = await loadHuman(false, true); return segEngine; }
const segMem = new Map();
export async function analyseCutout(mid, media, opts, onProgress, signal) {
  const e = await seg();
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = await urlFor(mid);
  await withTimeout(once(v, 'loadeddata'), 20000, 'video');
  const c = document.createElement('canvas'), W = v.videoWidth, H = v.videoHeight, k = Math.min(1, 512 / Math.max(W, H));
  c.width = Math.round(W * k); c.height = Math.round(H * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const from = Math.max(0, opts.from || 0), to = Math.min(media.dur || v.duration, opts.to ?? v.duration), step = 1 / (opts.rate || 12);
  const frames = []; const N = Math.max(1, Math.ceil((to - from) / step));
  let mw = 0, mh = 0;
  for (let i = 0; i <= N; i++) {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    const t = Math.min(to - 0.001, from + i * step);
    v.currentTime = t; try { await withTimeout(once(v, 'seeked'), 6000, 'seek'); } catch (err) { continue; }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const m = await e.segment(c); if (!m) continue;
    mw = m.w; mh = m.h;
    const a = new Uint8Array(m.w * m.h); for (let j = 0; j < a.length; j++) a[j] = clamp(Math.round(m.d[j] * 255), 0, 255);
    frames.push({ t, a });
    onProgress?.((i + 1) / (N + 1), `Finding people… ${Math.round((i + 1) / (N + 1) * 100)}%`);
    if (i % 3 === 2) await sleep(0);
  }
  v.removeAttribute('src'); v.load();
  const data = { w: mw, h: mh, frames };
  segMem.set(mid, data); await store.cacheSet('seg:' + mid, data);
  return data;
}
export async function getCutout(mid) {
  if (segMem.has(mid)) return segMem.get(mid);
  const d = await store.cacheGet('seg:' + mid).catch(() => null);
  segMem.set(mid, d || null); return d || null;
}
const maskCanvas = new Map();
// mask image for time t (nearest analysed frame), as a canvas
export function cutoutAt(mid, t) {
  const d = segMem.get(mid); if (!d?.frames?.length) return null;
  let lo = 0, hi = d.frames.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d.frames[m].t <= t) lo = m; else hi = m; }
  const f = Math.abs(d.frames[lo].t - t) <= Math.abs(d.frames[hi].t - t) ? d.frames[lo] : d.frames[hi];
  let c = maskCanvas.get(mid);
  if (!c) { c = { el: document.createElement('canvas'), ver: null }; c.el.width = d.w; c.el.height = d.h; maskCanvas.set(mid, c); }
  if (c.ver !== f.t) {
    const ctx = c.el.getContext('2d'), img = ctx.createImageData(d.w, d.h);
    for (let i = 0; i < f.a.length; i++) { const v = f.a[i]; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0); c.ver = f.t;
  }
  return { el: c.el, w: d.w, h: d.h, ver: mid + ':' + f.t };
}
