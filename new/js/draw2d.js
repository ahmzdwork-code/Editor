// Text and shape rasterising (2D canvas) — the result is uploaded to the GPU as a layer.
import { rgba, clamp } from './util.js';

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
export const isRtl = s => RTL.test(s || '');
export function fontStack(f) {
  const fb = /Naskh|Amiri|Scheherazade|Lateef|Ruqaa|Nastaliq|Markazi/.test(f) ? 'serif' : 'sans-serif';
  return `"${f}", ${fb}`;
}

const measureCtx = document.createElement('canvas').getContext('2d');

export const DEF_TEXT = {
  text: 'Your text', font: 'Inter', weight: 700, italic: false, size: 76, color: '#ffffff', align: 'center', lh: 1.18, ls: 0,
  stroke: 0, strokeColor: '#000000', shadow: 0, shadowColor: '#000000', shadowX: 0.04, shadowY: 0.06, shadowBlur: 0.12,
  glow: 0, glowColor: '#29e0b4', bg: null, bgAlpha: 1, bgPad: 0.3, bgRadius: 0.2, bgLines: false, upper: false, maxW: 0.86, opacityText: 1,
};

function layout(it, k) {
  const fs = it.size * k, ctx = measureCtx;
  const font = `${it.italic ? 'italic ' : ''}${it.weight || 700} ${fs}px ${fontStack(it.font)}`;
  ctx.font = font;
  const raw = it.upper ? (it.text || '').toUpperCase() : (it.text || '');
  const rtl = isRtl(raw), maxW = (it.maxW || 0.86) * 1080 * k, space = ctx.measureText(' ').width;
  const lines = [];
  let wi = 0;
  for (const para of raw.split('\n')) {
    const words = para.split(/ +/).filter((w, i, a) => w || a.length === 1);
    let line = { tokens: [], w: 0 };
    for (const w of words) {
      const tw = ctx.measureText(w).width + (it.ls || 0) * fs * w.length;
      if (line.tokens.length && line.w + space + tw > maxW) { lines.push(line); line = { tokens: [], w: 0 }; }
      line.w += (line.tokens.length ? space : 0) + tw;
      line.tokens.push({ w, tw, i: wi++ });
    }
    lines.push(line);
  }
  const lh = fs * (it.lh || 1.18);
  const W = Math.max(1, ...lines.map(l => l.w)), H = lines.length * lh;
  return { font, fs, lines, lh, W, H, space, rtl };
}

// text -> canvas. `st` = { reveal (0..1 chars shown), letters (0..1 per-letter rise), words (0..1), hl: active word index, hlStyle }
export function rasterText(it, k, st = {}) {
  const L = layout(it, k), fs = L.fs;
  const pad = fs * (it.bg ? (it.bgPad || 0.3) : 0) + fs * Math.max(it.stroke || 0, (it.shadow ? (it.shadowBlur || 0.12) + Math.max(Math.abs(it.shadowX || 0), Math.abs(it.shadowY || 0)) : 0), it.glow ? 0.5 : 0) + 4 + fs * 0.2;
  const cw = Math.ceil(L.W + pad * 2), ch = Math.ceil(L.H + pad * 2);
  const c = document.createElement('canvas'); c.width = Math.min(8192, cw); c.height = Math.min(8192, ch);
  const ctx = c.getContext('2d');
  ctx.font = L.font; ctx.textBaseline = 'middle'; ctx.direction = L.rtl ? 'rtl' : 'ltr';
  try { ctx.letterSpacing = (it.ls || 0) * fs + 'px'; } catch (e) { }
  const align = it.align || 'center';
  const lineX = l => align === 'left' ? (L.rtl ? pad + l.w : pad) : align === 'right' ? (L.rtl ? cw - pad : cw - pad - l.w) : (cw - l.w) / 2 + (L.rtl ? l.w : 0);
  // token positions
  const toks = [];
  L.lines.forEach((l, li) => {
    let x = lineX(l); const y = pad + li * L.lh + L.lh / 2;
    for (const t of l.tokens) {
      const x0 = L.rtl ? x - t.tw : x;
      toks.push({ ...t, x: x0, y, li });
      x += L.rtl ? -(t.tw + L.space) : t.tw + L.space;
    }
  });
  const total = toks.reduce((a, t) => a + t.w.length, 0);
  const hl = st.hl, hs = st.hlStyle;
  // backgrounds
  if (it.bg && it.bg !== 'transparent') {
    ctx.fillStyle = rgba(it.bg, it.bgAlpha ?? 1);
    const bp = fs * (it.bgPad ?? 0.3), r = fs * (it.bgRadius ?? 0.2);
    if (it.bgLines) L.lines.forEach((l, li) => { const x = lineX(l) - (L.rtl ? l.w : 0); rr(ctx, x - bp, pad + li * L.lh + (L.lh - fs) / 2 - bp * 0.6, l.w + bp * 2, fs + bp * 1.2, r); });
    else rr(ctx, (cw - L.W) / 2 - bp, pad - bp * 0.7, L.W + bp * 2, L.H + bp * 1.4, r);
  }
  if (hs?.mode === 'box' && hl != null) {
    const t = toks.find(q => q.i === hl);
    if (t) { ctx.fillStyle = hs.bg || '#ffd23f'; rr(ctx, t.x - fs * 0.15, t.y - fs * 0.62, t.tw + fs * 0.3, fs * 1.24, fs * 0.18); }
  }
  let shown = st.reveal != null ? Math.floor(st.reveal * total + 0.0001) : total;
  const passes = [];
  if (it.glow) passes.push('glow');
  if (it.shadow) passes.push('shadow');
  if (it.stroke) passes.push('stroke');
  passes.push('fill');
  for (const pass of passes) {
    let chars = 0;
    ctx.save();
    if (pass === 'glow') { ctx.shadowColor = it.glowColor || '#29e0b4'; ctx.shadowBlur = fs * 0.6 * it.glow; ctx.fillStyle = it.glowColor; }
    if (pass === 'shadow') {
      ctx.shadowColor = rgba(it.shadowColor || '#000', clamp(it.shadow, 0, 1)); ctx.shadowBlur = fs * (it.shadowBlur ?? 0.12);
      ctx.shadowOffsetX = fs * (it.shadowX ?? 0.04); ctx.shadowOffsetY = fs * (it.shadowY ?? 0.06);
      ctx.fillStyle = it.color === 'transparent' ? 'rgba(0,0,0,0)' : it.color;
    }
    if (pass === 'stroke') { ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = fs * it.stroke * 2; ctx.strokeStyle = it.strokeColor || '#000'; }
    if (pass === 'fill') ctx.fillStyle = it.color;
    for (const t of toks) {
      if (st.words != null && t.i >= Math.ceil(st.words * toks.length - 0.001)) break;
      if (hs?.mode === 'single' && hl != null && t.i !== hl) { chars += t.w.length; continue; }
      let word = t.w, n = word.length;
      if (chars >= shown) break;
      if (chars + n > shown) { word = [...word].slice(0, shown - chars).join(''); }
      chars += n;
      let color = null, scale = 1;
      if (hs && hl != null && pass === 'fill') {
        if (hs.mode === 'color' && t.i === hl) { color = hs.color; scale = hs.scale || 1; }
        if (hs.mode === 'box' && t.i === hl) color = hs.color;
        if (hs.mode === 'past' && t.i <= hl) color = hs.color;
      }
      if (hs?.mode === 'color' && t.i === hl) scale = hs.scale || 1;
      ctx.save();
      if (scale !== 1) { const cx = t.x + t.tw / 2; ctx.translate(cx, t.y); ctx.scale(scale, scale); ctx.translate(-cx, -t.y); }
      if (color) ctx.fillStyle = color;
      ctx.textAlign = 'left';
      if (st.letters != null && !L.rtl) {
        // each letter rises in turn
        let x = t.x; const arr = [...word];
        arr.forEach((chr, ci) => {
          const idx = (chars - n + ci) / Math.max(1, total), p = clamp((st.letters - idx * 0.7) / 0.3, 0, 1);
          ctx.globalAlpha = p; const dy = (1 - p) * fs * 0.5;
          drawText(ctx, pass, chr, x, t.y + dy);
          x += ctx.measureText(chr).width + (it.ls || 0) * fs;
        });
        ctx.globalAlpha = 1;
      } else {
        if (L.rtl) { ctx.textAlign = 'right'; drawText(ctx, pass, word, t.x + t.tw, t.y); }
        else drawText(ctx, pass, word, t.x, t.y);
      }
      ctx.restore();
    }
    ctx.restore();
  }
  return { canvas: c, w: c.width / k, h: c.height / k };
}
function drawText(ctx, pass, s, x, y) {
  if (pass === 'stroke') ctx.strokeText(s, x, y);
  else ctx.fillText(s, x, y);
}
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
}

/* ---------- shapes ---------- */
export const DEF_SHAPE = { shape: 'rect', w: 420, h: 420, fill: '#d4f75a', fillOn: true, stroke: '#ffffff', sw: 0, radius: 0.18, grad: null, shadow: 0 };

function poly(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
function regular(ctx, cx, cy, rx, ry, n, rot = -Math.PI / 2) {
  const pts = []; for (let i = 0; i < n; i++) { const a = rot + i * 2 * Math.PI / n; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
  poly(ctx, pts);
}
// path for a shape in box (0,0,w,h). Returns 'stroke' for line-like shapes.
export function shapePath(ctx, s, w, h, k = 1) {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * (s.radius ?? 0.18) / 2;
  switch (s.shape) {
    case 'rect': ctx.beginPath(); ctx.rect(0, 0, w, h); return;
    case 'square': { const m = Math.min(w, h); ctx.beginPath(); ctx.rect(cx - m / 2, cy - m / 2, m, m); return; }
    case 'rounded': ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, w, h, Math.max(r, 2)) : ctx.rect(0, 0, w, h); return;
    case 'pill': ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, w, h, Math.min(w, h) / 2) : ctx.rect(0, 0, w, h); return;
    case 'circle': { const m = Math.min(w, h) / 2; ctx.beginPath(); ctx.arc(cx, cy, m, 0, Math.PI * 2); return; }
    case 'ellipse': ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); return;
    case 'ring': { const m = Math.min(w, h) / 2, t = m * 0.28; ctx.beginPath(); ctx.arc(cx, cy, m, 0, Math.PI * 2); ctx.arc(cx, cy, m - t, 0, Math.PI * 2, true); return 'evenodd'; }
    case 'triangle': poly(ctx, [[cx, 0], [w, h], [0, h]]); return;
    case 'rtriangle': poly(ctx, [[0, 0], [w, h], [0, h]]); return;
    case 'diamond': poly(ctx, [[cx, 0], [w, cy], [cx, h], [0, cy]]); return;
    case 'pentagon': regular(ctx, cx, cy * 1.05, w / 2, h / 2 * 1.05, 5); return;
    case 'hexagon': regular(ctx, cx, cy, w / 2, h / 2, 6, 0); return;
    case 'octagon': regular(ctx, cx, cy, w / 2, h / 2, 8, Math.PI / 8); return;
    case 'parallelogram': poly(ctx, [[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h]]); return;
    case 'trapezoid': poly(ctx, [[w * 0.22, 0], [w * 0.78, 0], [w, h], [0, h]]); return;
    case 'semicircle': ctx.beginPath(); ctx.ellipse(cx, h, w / 2, h, 0, Math.PI, 0); ctx.closePath(); return;
    case 'quarter': ctx.beginPath(); ctx.moveTo(0, h); ctx.ellipse(0, h, w, h, 0, -Math.PI / 2, 0); ctx.closePath(); return;
    case 'line': ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); return 'line';
    case 'wave': { ctx.beginPath(); const n = 4; for (let i = 0; i <= 64; i++) { const x = w * i / 64, y = cy + Math.sin(i / 64 * n * Math.PI * 2) * h * 0.3; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } return 'line'; }
    case 'arrow': { const t = h * 0.32, hw = Math.min(w * 0.4, h * 0.9); poly(ctx, [[0, cy - t / 2], [w - hw, cy - t / 2], [w - hw, 0], [w, cy], [w - hw, h], [w - hw, cy + t / 2], [0, cy + t / 2]]); return; }
    case 'darrow': { const t = h * 0.32, hw = Math.min(w * 0.3, h * 0.9); poly(ctx, [[0, cy], [hw, 0], [hw, cy - t / 2], [w - hw, cy - t / 2], [w - hw, 0], [w, cy], [w - hw, h], [w - hw, cy + t / 2], [hw, cy + t / 2], [hw, h]]); return; }
    case 'chevron': poly(ctx, [[0, 0], [w * 0.6, 0], [w, cy], [w * 0.6, h], [0, h], [w * 0.4, cy]]); return;
    case 'bubble': {
      const bh = h * 0.78, rr_ = Math.min(w, bh) * 0.2; ctx.beginPath();
      ctx.moveTo(rr_, 0); ctx.arcTo(w, 0, w, bh, rr_); ctx.arcTo(w, bh, 0, bh, rr_);
      ctx.lineTo(w * 0.36, bh); ctx.lineTo(w * 0.2, h); ctx.lineTo(w * 0.22, bh);
      ctx.arcTo(0, bh, 0, 0, rr_); ctx.arcTo(0, 0, w, 0, rr_); ctx.closePath(); return;
    }
    case 'frame': { const t = Math.min(w, h) * 0.08; ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(t, t, w - 2 * t, h - 2 * t); return 'evenodd'; }
    case 'bracket': {
      const L = Math.min(w, h) * 0.28; ctx.beginPath();
      for (const [x, y, dx, dy] of [[0, 0, 1, 1], [w, 0, -1, 1], [w, h, -1, -1], [0, h, 1, -1]]) { ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L); }
      return 'line';
    }
    case 'dots': { ctx.beginPath(); const n = 5, rad = Math.min(h / 2, w / n / 2 * 0.7); for (let i = 0; i < n; i++) { const x = w * (i + 0.5) / n; ctx.moveTo(x + rad, cy); ctx.arc(x, cy, rad, 0, Math.PI * 2); } return; }
  }
  ctx.beginPath(); ctx.rect(0, 0, w, h);
}

export function rasterShape(it, k) {
  const sw = (it.sw || 0) * k, lineish = ['line', 'wave', 'bracket'].includes(it.shape);
  const lw = lineish ? Math.max(2, (it.sw || 14) * k) : sw;
  const shadow = it.shadow ? 30 * k * it.shadow : 0;
  const w = Math.max(2, it.w * k), h = Math.max(2, (it.shape === 'line' ? Math.max(it.h * 0.1, lw) : it.h) * k);
  const pad = Math.ceil(lw + shadow * 2 + 3);
  const c = document.createElement('canvas'); c.width = Math.ceil(w + pad * 2); c.height = Math.ceil(h + pad * 2);
  const ctx = c.getContext('2d'); ctx.translate(pad, pad);
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = shadow; ctx.shadowOffsetY = shadow * 0.3; }
  const mode = shapePath(ctx, it, w, h, k);
  let fill = it.fill;
  if (it.grad && it.fillOn !== false) {
    const a = (it.grad.angle || 0) * Math.PI / 180, dx = Math.cos(a) * w / 2, dy = Math.sin(a) * h / 2;
    const g = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy); g.addColorStop(0, it.fill); g.addColorStop(1, it.grad.to); fill = g;
  }
  if (mode === 'line') { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = it.fillOn !== false ? fill : it.stroke; ctx.stroke(); }
  else {
    if (it.fillOn !== false) { ctx.fillStyle = fill; ctx.fill(mode === 'evenodd' ? 'evenodd' : 'nonzero'); }
    if (sw > 0) { ctx.shadowColor = 'transparent'; ctx.lineJoin = 'round'; ctx.lineWidth = sw; ctx.strokeStyle = it.stroke; ctx.stroke(); }
  }
  return { canvas: c, w: c.width / k, h: c.height / k };
}

// small preview icon for the shapes panel
export function shapeIcon(id, size = 44, color = '#e9e9e4') {
  const c = document.createElement('canvas'), d = devicePixelRatio || 2; c.width = c.height = size * d;
  const ctx = c.getContext('2d'); ctx.scale(d, d);
  const box = id === 'line' || id === 'wave' || id === 'arrow' || id === 'darrow' || id === 'dots' ? [size * 0.8, size * 0.36] : id === 'ellipse' || id === 'rect' || id === 'pill' || id === 'parallelogram' || id === 'trapezoid' || id === 'semicircle' ? [size * 0.8, size * 0.55] : [size * 0.7, size * 0.7];
  ctx.translate((size - box[0]) / 2, (size - box[1]) / 2);
  const mode = shapePath(ctx, { shape: id, radius: 0.3 }, box[0], box[1]);
  if (mode === 'line') { ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke(); }
  else { ctx.fillStyle = color; ctx.fill(mode === 'evenodd' ? 'evenodd' : 'nonzero'); }
  return c.toDataURL();
}
