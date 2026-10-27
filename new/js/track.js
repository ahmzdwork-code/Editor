// Motion tools: following a region through a video (manual blur areas, missed faces) and stabilising shaky footage.
import { withTimeout, once, sleep, clamp } from './util.js';
import { urlFor } from './media.js';
import * as store from './store.js';

async function openVideo(mid) {
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = await urlFor(mid);
  await withTimeout(once(v, 'loadeddata'), 20000, 'video');
  return v;
}
async function seekTo(v, t) { v.currentTime = t; await withTimeout(once(v, 'seeked'), 6000, 'seek'); }
function gray(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  return g;
}
function patch(g, W, x, y, w, h) {
  const p = new Float32Array(w * h); let m = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = g[(y + j) * W + x + i] || 0; p[j * w + i] = v; m += v; }
  m /= p.length; let s = 0; for (let i = 0; i < p.length; i++) { p[i] -= m; s += p[i] * p[i]; }
  return { p, n: Math.sqrt(s) || 1, w, h };
}
function ncc(g, W, H, T, x, y) {
  if (x < 0 || y < 0 || x + T.w > W || y + T.h > H) return -2;
  const step = T.w * T.h > 1200 ? 2 : 1;
  let m = 0, cnt = 0;
  for (let j = 0; j < T.h; j += step) for (let i = 0; i < T.w; i += step) { m += g[(y + j) * W + x + i]; cnt++; }
  m /= cnt;
  let s = 0, ss = 0, tt = 0;
  for (let j = 0; j < T.h; j += step) for (let i = 0; i < T.w; i += step) { const v = g[(y + j) * W + x + i] - m, tp = T.p[j * T.w + i]; s += v * tp; ss += v * v; tt += tp * tp; }
  return s / (Math.sqrt(ss * tt) || 1);
}

/* Follows a box (normalised x,y,w,h at time t0) from `from` to `to`. Returns samples [{t,x,y,w,h}]. */
export async function trackRegion(mid, t0, box, from, to, onProgress, signal, rate = 15) {
  const v = await openVideo(mid);
  const W = 360, H = Math.round(W * v.videoHeight / v.videoWidth), c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const grab = async t => { await seekTo(v, t); ctx.drawImage(v, 0, 0, W, H); return gray(ctx, W, H); };
  const g0 = await grab(t0);
  const bw = Math.max(8, Math.round(box.w * W)), bh = Math.max(8, Math.round(box.h * H));
  const start = { x: Math.round(box.x * W), y: Math.round(box.y * H), w: bw, h: bh };
  const out = [{ t: t0, ...box }];
  const total = Math.ceil((to - from) * rate) + 1; let done = 0;
  for (const dir of [1, -1]) {
    let cur = { ...start }, T = patch(g0, W, clamp(cur.x, 0, W - bw), clamp(cur.y, 0, H - bh), bw, bh), T0 = T, lost = 0;
    for (let t = t0 + dir / rate; dir > 0 ? t <= to : t >= from; t += dir / rate) {
      if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      const g = await grab(clamp(t, 0, to));
      const R = Math.max(6, Math.round(Math.max(cur.w, cur.h) * 0.6));
      let best = { s: -3, x: cur.x, y: cur.y };
      for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) { const s = ncc(g, W, H, T, cur.x + dx, cur.y + dy); if (s > best.s) best = { s, x: cur.x + dx, y: cur.y + dy }; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const s = ncc(g, W, H, T, best.x + dx, best.y + dy); if (s > best.s) best = { s, x: best.x + dx, y: best.y + dy }; }
      if (best.s > 0.35) {
        cur = { ...cur, x: best.x, y: best.y }; lost = 0;
        // adapt slowly to changes in look, anchored to the first view
        const np = patch(g, W, cur.x, cur.y, cur.w, cur.h);
        const mixd = new Float32Array(np.p.length); let s = 0;
        for (let i = 0; i < mixd.length; i++) { mixd[i] = T.p[i] * 0.75 + np.p[i] * 0.15 + T0.p[i] * 0.1; s += mixd[i] * mixd[i]; }
        T = { p: mixd, n: Math.sqrt(s) || 1, w: cur.w, h: cur.h };
      } else lost++;
      out.push({ t, x: cur.x / W, y: cur.y / H, w: cur.w / W, h: cur.h / H, lost: lost > 0 ? 1 : 0 });
      onProgress?.(++done / total);
      if (done % 5 === 0) await sleep(0);
    }
  }
  v.removeAttribute('src'); v.load();
  return out.sort((a, b) => a.t - b.t);
}

/* ---------- stabilisation ---------- */
const stabMem = new Map();
export async function analyseShake(mid, media, onProgress, signal, rate = 30) {
  const v = await openVideo(mid);
  const W = 192, H = Math.round(W * v.videoHeight / v.videoWidth), c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const dur = media.dur || v.duration, N = Math.ceil(dur * rate);
  let prev = null, x = 0, y = 0; const path = [];
  for (let i = 0; i <= N; i++) {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    const t = Math.min(dur - 0.01, i / rate);
    try { await seekTo(v, t); } catch (e) { continue; }
    ctx.drawImage(v, 0, 0, W, H); const g = gray(ctx, W, H);
    if (prev) {
      // shift that best lines up this frame with the last one (centre region)
      const R = 10, m = 16; let best = [0, 0], bs = Infinity;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        let s = 0;
        for (let yy = m; yy < H - m; yy += 3) for (let xx = m; xx < W - m; xx += 3) s += Math.abs(g[yy * W + xx] - prev[(yy + dy) * W + xx + dx]);
        if (s < bs) { bs = s; best = [dx, dy]; }
      }
      x += best[0] / W; y += best[1] / H;
    }
    path.push({ t, x, y }); prev = g;
    onProgress?.(i / N, `Measuring camera shake… ${Math.round(i / N * 100)}%`);
    if (i % 6 === 5) await sleep(0);
  }
  v.removeAttribute('src'); v.load();
  const d = { rate, path };
  stabMem.set(mid, d); await store.cacheSet('stab:' + mid, d);
  return d;
}
export async function getShake(mid) {
  if (stabMem.has(mid)) return stabMem.get(mid);
  const d = await store.cacheGet('stab:' + mid).catch(() => null); stabMem.set(mid, d || null); return d || null;
}
const smoothCache = new Map();
// correction for time t: {dx, dy, zoom}
export function stabAt(mid, t, strength = 0.6) {
  const d = stabMem.get(mid); if (!d?.path?.length) return null;
  const key = mid + ':' + strength;
  let sm = smoothCache.get(key);
  if (!sm) {
    const win = Math.round(d.rate * (0.3 + strength * 2.2)), p = d.path;
    sm = p.map((q, i) => { let sx = 0, sy = 0, n = 0; for (let j = Math.max(0, i - win); j <= Math.min(p.length - 1, i + win); j++) { const w = 1 - Math.abs(j - i) / (win + 1); sx += p[j].x * w; sy += p[j].y * w; n += w; } return { t: q.t, dx: sx / n - q.x, dy: sy / n - q.y }; });
    let mx = 0; for (const q of sm) mx = Math.max(mx, Math.abs(q.dx), Math.abs(q.dy));
    sm.zoom = 1 + Math.min(0.25, mx * 2.2 + 0.02);
    smoothCache.set(key, sm);
  }
  const i = clamp(Math.round(t * d.rate), 0, sm.length - 1);
  return { dx: sm[i].dx, dy: sm[i].dy, zoom: sm.zoom };
}
