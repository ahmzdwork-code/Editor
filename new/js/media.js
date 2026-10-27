// Imported media: files on the device, their details, thumbnails, decoded sound and waveforms.
import { uid, once, sleep, withTimeout, clamp } from './util.js';
import * as store from './store.js';

const urls = new Map();       // mid -> object URL
const blobs = new Map();      // mid -> Blob
const audioBufs = new Map();  // mid -> AudioBuffer | null (null = could not read)
const peaks = new Map();      // mid -> Float32Array
const images = new Map();     // mid -> ImageBitmap/HTMLImageElement
const thumbs = new Map();     // mid -> Map(sec -> canvas)

let actx = null;
export function audioCtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  return actx;
}

export async function blobFor(mid) {
  if (blobs.has(mid)) return blobs.get(mid);
  const b = await store.loadBlob(mid);
  if (b) blobs.set(mid, b);
  return b;
}
export async function urlFor(mid) {
  if (urls.has(mid)) return urls.get(mid);
  const b = await blobFor(mid);
  if (!b) return null;
  const u = URL.createObjectURL(b); urls.set(mid, u);
  return u;
}
export const urlNow = mid => urls.get(mid);

function kindOf(file) {
  const t = file.type || '', n = (file.name || '').toLowerCase();
  if (t.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|3gp|avi)$/.test(n)) return 'video';
  if (t.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)$/.test(n)) return 'image';
  if (t.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|opus|flac|caf)$/.test(n)) return 'audio';
  return null;
}

export async function probeVideo(url) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  await withTimeout(once(v, 'loadedmetadata'), 20000, 'reading video');
  let dur = v.duration;
  if (!isFinite(dur)) { // some recordings (webm) report Infinity until seeked to the end
    v.currentTime = 1e7; await withTimeout(once(v, 'seeked'), 8000, 'duration').catch(() => {}); dur = v.duration; v.currentTime = 0;
  }
  const info = { w: v.videoWidth, h: v.videoHeight, dur: isFinite(dur) ? dur : 0 };
  v.removeAttribute('src'); v.load();
  return info;
}

async function probeImage(url) {
  const img = new Image(); img.src = url;
  await img.decode();
  return { w: img.naturalWidth, h: img.naturalHeight, img };
}

async function probeAudio(blob) {
  const buf = await decodeBlob(blob);
  return { dur: buf?.duration || 0, buf };
}

// imports files and returns media records (blobs saved to the device store)
export async function importFiles(project, files, onProgress) {
  const out = [];
  let i = 0;
  for (const f of files) {
    onProgress?.(i++ / files.length, f.name);
    const kind = kindOf(f);
    if (!kind) continue;
    const id = uid();
    const blob = f instanceof Blob ? f : new Blob([f]);
    await store.saveBlob(id, blob);
    blobs.set(id, blob);
    const url = URL.createObjectURL(blob); urls.set(id, url);
    const m = { id, kind, name: f.name || kind, size: blob.size, type: blob.type, added: Date.now() };
    try {
      if (kind === 'video') {
        Object.assign(m, await probeVideo(url));
        m.hasAudio = true; // confirmed when the sound is decoded
      } else if (kind === 'image') {
        const r = await probeImage(url); m.w = r.w; m.h = r.h; m.dur = 0; images.set(id, r.img);
      } else {
        const r = await probeAudio(blob); m.dur = r.dur; audioBufs.set(id, r.buf);
      }
    } catch (e) {
      console.warn('import failed', f.name, e);
      m.error = String(e.message || e);
    }
    if (m.error && kind !== 'audio') continue;
    project.media[id] = m;
    out.push(m);
    if (kind === 'video') decodeAudio(m).then(b => { if (!b) m.hasAudio = false; });
  }
  onProgress?.(1);
  return out;
}

// adds a blob produced inside the app (recordings, reversed clips, frames)
export async function addBlob(project, blob, name, kind) {
  const file = new File([blob], name, { type: blob.type });
  const [m] = await importFiles(project, [file]);
  if (m && kind) m.kind = kind;
  return m;
}

export async function imageFor(mid) {
  if (images.has(mid)) return images.get(mid);
  const u = await urlFor(mid); if (!u) return null;
  const img = new Image(); img.src = u;
  try { await img.decode(); } catch (e) { return null; }
  images.set(mid, img);
  return img;
}
export const imageNow = mid => images.get(mid);

/* ---------- sound ---------- */
async function decodeBlob(blob) {
  const ac = audioCtx();
  const ab = await blob.arrayBuffer();
  return new Promise((res) => {
    try {
      const pr = ac.decodeAudioData(ab, res, () => res(null));
      if (pr?.then) pr.then(res, () => res(null));
    } catch (e) { res(null); }
  });
}
const pending = new Map();
export function decodeAudio(m) {
  if (audioBufs.has(m.id)) return Promise.resolve(audioBufs.get(m.id));
  if (pending.has(m.id)) return pending.get(m.id);
  const p = (async () => {
    const b = await blobFor(m.id);
    let buf = b ? await decodeBlob(b) : null;
    if (buf && buf.duration < 0.05) buf = null;
    audioBufs.set(m.id, buf);
    pending.delete(m.id);
    return buf;
  })();
  pending.set(m.id, p);
  return p;
}
export const audioNow = mid => audioBufs.get(mid);
export const setAudio = (mid, buf) => { audioBufs.set(mid, buf); peaks.delete(mid); };

export function peaksFor(mid, perSec = 50) {
  const key = mid + ':' + perSec;
  if (peaks.has(key)) return peaks.get(key);
  const b = audioBufs.get(mid); if (!b) return null;
  const n = Math.ceil(b.duration * perSec), out = new Float32Array(n), step = b.sampleRate / perSec;
  const chans = [...Array(b.numberOfChannels)].map((_, c) => b.getChannelData(c));
  for (let i = 0; i < n; i++) {
    let mx = 0; const a = Math.floor(i * step), e = Math.min(b.length, Math.floor((i + 1) * step));
    for (const d of chans) for (let j = a; j < e; j += 4) { const v = Math.abs(d[j]); if (v > mx) mx = v; }
    out[i] = mx;
  }
  peaks.set(key, out);
  return out;
}

/* ---------- thumbnails (filmstrip) ---------- */
const thumbQueue = [];
let thumbBusy = false;
const thumbVids = new Map();
export function thumbAt(m, sec, h = 64, onReady) {
  if (m.kind === 'image') {
    const img = images.get(m.id);
    if (!img) { imageFor(m.id).then(() => onReady?.()); return null; }
    let map = thumbs.get(m.id); if (!map) thumbs.set(m.id, map = new Map());
    if (!map.has(0)) map.set(0, drawThumb(img, img.naturalWidth, img.naturalHeight, h));
    return map.get(0);
  }
  const step = m.dur > 120 ? 4 : m.dur > 30 ? 2 : 1, key = clamp(Math.round(sec / step) * step, 0, Math.max(0, m.dur - 0.05));
  const map = thumbs.get(m.id);
  if (map?.has(key)) return map.get(key);
  // nearest ready one meanwhile
  let best = null, bd = 1e9;
  if (map) for (const [k, c] of map) { const d = Math.abs(k - key); if (d < bd) { bd = d; best = c; } }
  if (!thumbQueue.some(q => q.m.id === m.id && q.key === key)) thumbQueue.push({ m, key, h, onReady });
  pumpThumbs();
  return best;
}
function drawThumb(src, w, h, H) {
  const c = document.createElement('canvas'), W = Math.max(1, Math.round(H * w / h));
  c.width = W; c.height = H;
  c.getContext('2d').drawImage(src, 0, 0, W, H);
  return c;
}
async function pumpThumbs() {
  if (thumbBusy) return; thumbBusy = true;
  try {
    while (thumbQueue.length) {
      const { m, key, h, onReady } = thumbQueue.shift();
      if (thumbs.get(m.id)?.has(key)) continue;
      let v = thumbVids.get(m.id);
      if (!v) {
        v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
        v.src = await urlFor(m.id); thumbVids.set(m.id, v);
        try { await withTimeout(once(v, 'loadeddata'), 15000, 'thumb'); } catch (e) { continue; }
      }
      try {
        v.currentTime = key + 0.01;
        await withTimeout(once(v, 'seeked'), 5000, 'thumb seek');
        let map = thumbs.get(m.id); if (!map) thumbs.set(m.id, map = new Map());
        map.set(key, drawThumb(v, v.videoWidth, v.videoHeight, h));
        onReady?.();
      } catch (e) { }
      await sleep(0);
    }
  } finally { thumbBusy = false; }
}

export function forget(mid) {
  const u = urls.get(mid); if (u) URL.revokeObjectURL(u);
  urls.delete(mid); blobs.delete(mid); audioBufs.delete(mid); images.delete(mid); thumbs.delete(mid);
}

// grabs a still frame from a video as a canvas (for posters, face thumbnails)
export async function grabFrame(mid, t, maxW = 640) {
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = await urlFor(mid);
  await withTimeout(once(v, 'loadeddata'), 15000, 'frame');
  v.currentTime = t; await withTimeout(once(v, 'seeked'), 8000, 'frame seek');
  const k = Math.min(1, maxW / v.videoWidth), c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  v.removeAttribute('src'); v.load();
  return c;
}
