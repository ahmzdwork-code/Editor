// Builds one frame of the project at time t on the GPU.
import { placeMatrix } from './gl.js';
import { filterById, effectById, transById, NEEDS_BLUR, BLENDS } from './defs.js';
import { kfVal, srcTime, DEF_ADJ, mainItems } from './model.js';
import { rasterText, rasterShape } from './draw2d.js';
import { hexToRgb, clamp, ease } from './util.js';

const ADJ_KEYS = Object.keys(DEF_ADJ);
const BLEND_N = Object.fromEntries(BLENDS.map(b => [b[0], b[2]]));
const MASK_N = { linear: 1, mirror: 2, circle: 3, rect: 4, triangle: 5, diamond: 6 };

/* ---------- animations ---------- */
export function animState(it, lt) {
  const r = { dx: 0, dy: 0, s: 1, r: 0, o: 1, blur: 0, wipe: null, reveal: null, letters: null, words: null, sx: 1, sy: 1 };
  const A = it.anim || {};
  const apply = (id, p, dir) => {
    // p: 0 = hidden, 1 = fully shown
    const e = ease.out(p), q = 1 - e;
    switch (id) {
      case 'fade': r.o *= p; break;
      case 'slidel': r.dx += -q * 0.6 * dir; r.o *= Math.min(1, p * 2); break;
      case 'slider': r.dx += q * 0.6 * dir; r.o *= Math.min(1, p * 2); break;
      case 'slideu': r.dy += q * 0.35 * dir; r.o *= Math.min(1, p * 2); break;
      case 'slided': r.dy += -q * 0.35 * dir; r.o *= Math.min(1, p * 2); break;
      case 'zoomin': r.s *= 0.4 + 0.6 * e; r.o *= p; break;
      case 'zoomout': r.s *= 1 + 0.8 * q; r.o *= p; break;
      case 'pop': r.s *= ease.back(p); break;
      case 'bounce': r.s *= Math.max(0.01, ease.elastic(p)); break;
      case 'rotate': r.r += q * -90; r.o *= p; r.s *= 0.7 + 0.3 * e; break;
      case 'spin': r.r += q * 360; r.s *= Math.max(0.01, e); break;
      case 'blur': r.blur = Math.max(r.blur, q); r.o *= Math.min(1, p * 1.5); break;
      case 'wipel': r.wipe = [0, 0, e, 1]; break;
      case 'wiper': r.wipe = [1 - e, 0, 1, 1]; break;
      case 'wipeu': r.wipe = [0, 1 - e, 1, 1]; break;
      case 'wiped': r.wipe = [0, 0, 1, e]; break;
      case 'drop': r.dy += -(1 - ease.bounce(p)) * 0.5 * dir; break;
      case 'squeeze': r.sx *= Math.max(0.01, e); break;
      case 'type': r.reveal = p; break;
      case 'letters': r.letters = p; break;
      case 'words': r.words = p; break;
    }
  };
  if (A.in?.id && A.in.dur > 0 && lt < A.in.dur) apply(A.in.id, clamp(lt / A.in.dur, 0, 1), 1);
  if (A.out?.id && A.out.dur > 0 && lt > it.dur - A.out.dur) apply(A.out.id, clamp((it.dur - lt) / A.out.dur, 0, 1), -1);
  if (A.loop?.id) {
    const sp = A.loop.speed || 1, w = lt * sp * Math.PI * 2;
    switch (A.loop.id) {
      case 'pulse': r.s *= 1 + 0.06 * Math.sin(w * 1.2); break;
      case 'float': r.dy += 0.012 * Math.sin(w * 0.6); break;
      case 'sway': r.r += 5 * Math.sin(w * 0.6); break;
      case 'shake': r.dx += 0.006 * Math.sin(w * 7.1); r.dy += 0.006 * Math.cos(w * 9.3); break;
      case 'spin': r.r += (lt * sp * 120) % 360; break;
      case 'blink': r.o *= 0.25 + 0.75 * (Math.sin(w * 1.5) > -0.3 ? 1 : 0); break;
      case 'wiggle': r.r += 4 * Math.sin(w * 3); r.s *= 1 + 0.03 * Math.sin(w * 2.1); break;
      case 'breathe': r.s *= 1 + 0.04 * Math.sin(w * 0.5); r.o *= 0.85 + 0.15 * Math.sin(w * 0.5); break;
      case 'swing': r.r += 12 * Math.sin(w * 0.8) ; break;
      case 'drift': r.dx += 0.02 * Math.sin(w * 0.3); r.dy += 0.015 * Math.cos(w * 0.25); break;
    }
  }
  return r;
}

/* ---------- caches for text/shape rasters ---------- */
const rasterCache = new Map();
function raster(it, k, st) {
  const key = it.kind + JSON.stringify([it.text, it.font, it.weight, it.italic, it.size, it.color, it.align, it.lh, it.ls, it.stroke, it.strokeColor, it.shadow, it.shadowColor, it.shadowX, it.shadowY, it.shadowBlur, it.glow, it.glowColor, it.bg, it.bgAlpha, it.bgPad, it.bgRadius, it.bgLines, it.upper, it.maxW,
    it.shape, it.w, it.h, it.fill, it.fillOn, it.sw, it.radius, it.grad, it.shadow, Math.round(k * 100), st.reveal != null ? Math.round(st.reveal * 300) : null, st.letters != null ? Math.round(st.letters * 60) : null, st.words != null ? Math.round(st.words * 200) : null, st.hl, st.hlStyle?.mode]);
  let r = rasterCache.get(key);
  if (!r) {
    r = it.kind === 'text' ? rasterText(it, k, st) : rasterShape(it, k);
    r.ver = key; rasterCache.set(key, r);
    if (rasterCache.size > 160) rasterCache.delete(rasterCache.keys().next().value);
  }
  return r;
}
export function clearRasterCache() { rasterCache.clear(); }

// caption word highlight
function captionState(it, lt) {
  if (!it.words?.length || !it.hl) return {};
  let idx = null;
  for (let i = 0; i < it.words.length; i++) if (lt >= it.words[i].s - 0.02) idx = i;
  return { hl: idx, hlStyle: it.hl };
}

/* ---------- base size of a layer at scale 1 (output pixels) ---------- */
function mediaSize(it, srcW, srcH, W, H, fit) {
  const cw = srcW * (it.crop ? it.crop[2] : 1), ch = srcH * (it.crop ? it.crop[3] : 1);
  const k = fit === 'fill' ? Math.max(W / cw, H / ch) : Math.min(W / cw, H / ch);
  return [cw * k, ch * k];
}

export class Composer {
  constructor(gl) { this.gl = gl; this.textScale = 1; }

  // provider: { frame(it, srcT) -> {el,w,h,key,ver} | null, faces(it, srcT, srcW, srcH) -> regions|null, mask(it, srcT) -> el|null, stab(it, srcT) -> {dx,dy,zoom}|null }
  render(p, t, W, H, provider, opts = {}) {
    const gl = this.gl;
    this.W = W; this.H = H; this.k = W / 1080; this.prov = provider; this.t = t; this.p = p; this.opts = opts;
    let acc = gl.target(W, H);
    gl.clear(acc, 0, 0, 0, 1);
    // main track
    const main = mainItems(p);
    let a = null, b = null;
    for (let i = 0; i < main.length; i++) {
      const it = main[i];
      if (t >= it.start && t < it.start + it.dur) {
        if (!a) a = it; else { b = it; break; }
      }
    }
    if (a && b && a.trans) {
      const tr = transById(a.trans.id), p01 = clamp((t - b.start) / a.trans.dur, 0, 1);
      const ta = gl.target(W, H), tb = gl.target(W, H);
      gl.clear(ta, 0, 0, 0, 1); gl.clear(tb, 0, 0, 0, 1);
      this.drawItem(a, ta, true); this.drawItem(b, tb, true);
      const m = gl.trans(ta, tb, tr?.t || 1, ease.inout(p01));
      gl.release(acc); gl.release(ta); gl.release(tb); acc = m;
    } else if (a) this.drawItem(b || a, acc, true);

    // layers, bottom first
    const layers = p.items.filter(i => i.track === 'layer' && t >= i.start && t < i.start + i.dur && !i.hidden)
      .sort((x, y) => x.layer - y.layer || x.start - y.start);
    for (const it of layers) {
      if (it.kind === 'effect') acc = this.effectLayer(it, acc);
      else if (it.kind === 'filter') acc = this.filterLayer(it, acc);
      else if (it.kind === 'blur') acc = this.blurLayer(it, acc);
      else this.drawItem(it, acc, false);
    }
    return acc;
  }

  // full chain for one visual item, drawn onto dst
  drawItem(it, dst, isMain) {
    const gl = this.gl, W = this.W, H = this.H, lt = this.t - it.start;
    const an = animState(it, lt);
    let tex = null, sw = 0, sh = 0, bw, bh, own = false;
    if (it.kind === 'video' || it.kind === 'image') {
      const st = srcTime(it, lt);
      const f = this.prov.frame(it, st);
      if (!f) return;
      const s = gl.source(f.key, f.el, f.w, f.h, f.ver ?? null);
      if (!s.ok) return;
      tex = s; sw = f.w; sh = f.h;
      // keep the work proportional to how big it shows
      const fit = isMain ? (it.fit || 'fit') : 'fit';
      [bw, bh] = mediaSize(it, sw, sh, W, H, fit);
      const disp = Math.max(bw, bh) * (it.tf?.s || 1) * 1.15;
      if (Math.max(sw, sh) > disp * 1.6 && !this.opts.full) {
        const k = Math.max(disp / Math.max(sw, sh), 0.1), d = gl.target(sw * k, sh * k); gl.copy(tex, d); tex = d; own = true;
      }
      // privacy cover first, on the untouched picture
      const regs = this.prov.faces?.(it, st, tex.w, tex.h);
      if (regs?.list?.length) { const d = gl.cover(tex, regs.list, { ...regs.opts, t: this.t }); if (own) gl.release(tex); tex = d; own = true; }
      tex = this.colorAndFx(it, tex, own, lt, this.prov.mask?.(it, st));
      own = true;
      if (isMain && !it.bgOff) this.background(it, tex, dst, bw, bh);
    } else if (it.kind === 'text' || it.kind === 'shape') {
      const sc = Math.max(1, ...((it.kf?.s || []).map(k => k.v)), it.tf.s) * an.s;
      const k = this.k * clamp(sc, 0.3, 4) * (this.opts.textScale || 1);
      const r = raster(it, k, { reveal: an.reveal, letters: an.letters, words: an.words, ...captionState(it, lt) });
      tex = gl.source('r:' + it.id, r.canvas, r.canvas.width, r.canvas.height, r.ver);
      bw = r.w * this.k; bh = r.h * this.k;
      if ((it.filter || it.adj || it.fx?.length) && tex.ok) { tex = this.colorAndFx(it, tex, false, lt, null); own = true; }
    }
    if (!tex) return;
    if (an.blur > 0.01) { const d = gl.blurred(tex, Math.max(0.03, 1 - an.blur * 0.97), 2); if (own) gl.release(tex); tex = d; own = true; }
    // transform
    const x = kfVal(it, 'x', lt) + an.dx, y = kfVal(it, 'y', lt) + an.dy, s = kfVal(it, 's', lt) * an.s, rot = kfVal(it, 'r', lt) + an.r, op = kfVal(it, 'o', lt) * an.o;
    let crop = it.crop ? [...it.crop] : [0, 0, 1, 1];
    const stab = it.stab?.on ? this.prov.stab?.(it, srcTime(it, lt)) : null;
    if (stab) { const z = stab.zoom; crop = [crop[0] + crop[2] * (1 - 1 / z) / 2 - stab.dx * crop[2] / z, crop[1] + crop[3] * (1 - 1 / z) / 2 - stab.dy * crop[3] / z, crop[2] / z, crop[3] / z]; }
    const w = bw * s * an.sx, h = bh * s * an.sy;
    const m = placeMatrix(W / 2 + x * W, H / 2 + y * H, w, h, rot);
    const mk = it.mask && it.mask.type !== 'none' ? { type: MASK_N[it.mask.type] || 0, x: it.mask.x ?? 0.5, y: it.mask.y ?? 0.5, w: it.mask.w ?? 0.35, h: it.mask.h ?? 0.35, angle: (it.mask.r || 0) * Math.PI / 180, feather: it.mask.feather || 0, invert: it.mask.invert, round: it.mask.round ?? 0.2 } : null;
    gl.place(tex, dst, m, { crop, opacity: clamp(op, 0, 1), blend: BLEND_N[it.blend] || 0, mask: mk, size: [w, h], wipe: an.wipe, flipX: it.flipH, flipY: it.flipV });
    if (own) gl.release(tex);
  }

  background(it, tex, dst, bw, bh) {
    const gl = this.gl, W = this.W, H = this.H, bg = this.p.bg || { type: 'color', color: '#000000' };
    if (bw >= W - 1 && bh >= H - 1) return;
    if (bg.type === 'blur') {
      const k = Math.max(W / bw, H / bh) * 1.02;
      const b = gl.blurred(tex, 0.04 + (1 - (bg.blur ?? 0.6)) * 0.12, 3);
      gl.place(b, dst, placeMatrix(W / 2, H / 2, bw * k, bh * k, 0), { crop: it.crop || [0, 0, 1, 1], flipX: it.flipH, flipY: it.flipV });
      gl.release(b);
    } else {
      const c = hexToRgb(bg.color || '#000');
      gl.fillRect(dst, placeMatrix(W / 2, H / 2, W, H, 0), [c[0] / 255, c[1] / 255, c[2] / 255, 1]);
    }
  }

  colorAndFx(it, tex, own, lt, mask) {
    const gl = this.gl;
    const f = it.filter ? filterById(it.filter.id) : null, amt = it.filter?.amt ?? 1;
    const needColor = f || (it.adj && Object.values(it.adj).some(v => v)) || it.chroma?.on || mask;
    if (needColor) {
      const adj = ADJ_KEYS.map(k => (it.adj?.[k] || 0) + (f?.adj?.[k] || 0) * amt);
      const key = it.chroma?.on ? { rgb: hexToRgb(it.chroma.color || '#00ff00').map(v => v / 255), sim: it.chroma.sim ?? 0.4, smooth: it.chroma.smooth ?? 0.2, spill: it.chroma.spill ?? 0.5 } : null;
      const d = gl.color(tex, {
        adj, t: this.t, sh: f?.tone ? f.tone.sh.map(v => v / 255) : null, hi: f?.tone ? f.tone.hi.map(v => v / 255) : null,
        tone: f?.tone ? f.tone.amt * amt : 0, mono: f?.mono ? amt : 0, key, mask: mask ? gl.source('m:' + it.id, mask.el, mask.w, mask.h, mask.ver) : null, maskInv: it.cutout?.invert,
      });
      if (own) gl.release(tex); tex = d; own = true;
    }
    for (const e of it.fx || []) {
      const def = effectById(e.id); if (!def) continue;
      const blur = NEEDS_BLUR.has(def.t) ? gl.blurred(tex, def.t === 1 ? 0.5 - (e.a ?? def.a) * 0.46 : 0.08, 2) : null;
      const d = gl.fx(tex, def.t, e.a ?? def.a, e.b ?? def.sp ?? 1, lt, blur);
      if (blur) gl.release(blur);
      if (own) gl.release(tex); tex = d; own = true;
    }
    return tex;
  }

  effectLayer(it, acc) {
    const gl = this.gl, def = effectById(it.fxId); if (!def) return acc;
    const lt = this.t - it.start, a = (it.a ?? def.a) * animState(it, lt).o;
    const blur = NEEDS_BLUR.has(def.t) ? gl.blurred(acc, def.t === 1 ? 0.5 - a * 0.46 : 0.08, 2) : null;
    const d = gl.fx(acc, def.t, a, it.b ?? def.sp ?? 1, lt, blur);
    if (blur) gl.release(blur);
    gl.release(acc); return d;
  }
  filterLayer(it, acc) {
    const d = this.colorAndFx({ ...it, fx: [], chroma: null }, acc, true, this.t - it.start, null);
    return d;
  }
  blurLayer(it, acc) {
    const lt = this.t - it.start, W = this.W, H = this.H;
    const x = kfVal(it, 'x', lt), y = kfVal(it, 'y', lt), s = kfVal(it, 's', lt), r = kfVal(it, 'r', lt);
    const reg = { x: W / 2 + x * W, y: H / 2 + y * H, hw: (it.bw || 0.3) * W * s / 2, hh: (it.bh || 0.2) * H * s / 2, shape: it.shapeN ?? 0, feather: it.feather ?? 0.35, style: it.style ?? 0, angle: r * Math.PI / 180 };
    const d = this.gl.cover(acc, [reg], { style: it.style ?? 0, strength: it.strength ?? 0.8, blocks: it.blocks || 8, color: hexToRgb(it.color || '#000000').map(v => v / 255), invert: it.invert, t: this.t });
    this.gl.release(acc);
    return d;
  }
}

// where an item sits on the canvas at local time lt (no animation): centre, size, rotation in W×H pixels
export function itemRect(p, it, lt, W, H) {
  const x = kfVal(it, 'x', lt), y = kfVal(it, 'y', lt), s = kfVal(it, 's', lt), r = kfVal(it, 'r', lt);
  let bw = 0, bh = 0;
  if (it.kind === 'video' || it.kind === 'image') {
    const m = p.media[it.mid]; if (!m) return null;
    [bw, bh] = mediaSize(it, m.w || 16, m.h || 9, W, H, it.track === 'main' ? (it.fit || 'fit') : 'fit');
  } else if (it.kind === 'text' || it.kind === 'shape') {
    const k = 0.5, rr = raster(it, k, {});
    bw = rr.w * W / 1080; bh = rr.h * W / 1080;
  } else if (it.kind === 'blur') { bw = (it.bw || 0.3) * W; bh = (it.bh || 0.2) * H; }
  else return null;
  return { cx: W / 2 + x * W, cy: H / 2 + y * H, w: bw * s, h: bh * s, rot: r, bw, bh };
}
