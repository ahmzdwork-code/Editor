// On-screen handles over the preview: move / scale / rotate items, masks, face boxes, drawing areas.
import { S, bus, commit, select, sel } from './state.js';
import { h } from './widgets.js';
import { itemRect } from '../compose.js';
import { kfVal, setProp, srcTime, mainItems } from '../model.js';
import * as faces from '../faces.js';
import { clamp } from '../util.js';

export class Gizmo {
  constructor(stage, canvas, hooks) {
    this.stage = stage; this.canvas = canvas; this.hooks = hooks;
    this.root = h('div.overlay');
    stage.append(this.root);
    this.mode = 'item'; // item | mask | faces | draw | none
    this.ptrs = new Map();
    this.root.addEventListener('pointerdown', e => this.down(e));
    this.root.addEventListener('pointermove', e => this.move(e));
    this.root.addEventListener('pointerup', e => this.up(e));
    this.root.addEventListener('pointercancel', e => this.up(e));
    this.root.addEventListener('wheel', e => this.wheel(e), { passive: false });
    bus.on('select', () => this.render());
    bus.on('change', () => { if (!this.op) this.render(); });
    S.player.on('time', () => { if (!this.op) this.render(); });
  }
  setMode(m, opts = {}) { this.mode = m; this.modeOpts = opts; this.render(); }

  // stage <-> project pixels
  geo() {
    const r = this.canvas.getBoundingClientRect(), s = this.stage.getBoundingClientRect(), p = S.p;
    return { ox: r.left - s.left, oy: r.top - s.top, k: r.width / p.w, W: p.w, H: p.h, sr: s };
  }
  rectOf(it) { const p = S.p; return itemRect(p, it, S.player.t - it.start, p.w, p.h); }
  active(it) { const t = S.player.t; return t >= it.start && t < it.start + it.dur; }

  render() {
    this.root.innerHTML = '';
    if (!S.p) return;
    const it = sel(), g = this.geo();
    if (this.mode === 'faces') return this.renderFaces(g);
    if (this.mode === 'draw') { if (this.drawBox) this.root.append(this.drawBox); this.root.append(h('div.stage-note', {}, this.modeOpts.hint || 'Draw a box')); return; }
    if (!it || !this.active(it) || !['video', 'image', 'text', 'shape', 'blur'].includes(it.kind)) return;
    const r = this.rectOf(it); if (!r) return;
    if (this.mode === 'mask' && it.mask && it.mask.type !== 'none') return this.renderMask(it, r, g);
    const box = h('div.gz', { style: this.css(r, g) });
    if (it.kind === 'blur') box.append(h('div.h.ew', { 'data-h': 'ew' }), h('div.h.ns', { 'data-h': 'ns' }));
    box.append(h('div.h.sc', { 'data-h': 'sc' }), h('div.h.ro', { 'data-h': 'ro' }));
    this.root.append(box);
    this.box = box;
  }
  css(r, g) {
    return { left: g.ox + (r.cx - r.w / 2) * g.k + 'px', top: g.oy + (r.cy - r.h / 2) * g.k + 'px', width: Math.abs(r.w) * g.k + 'px', height: Math.abs(r.h) * g.k + 'px', transform: `rotate(${r.rot}deg)` };
  }
  renderMask(it, r, g) {
    const m = it.mask, w = r.w * g.k, hh = r.h * g.k;
    const frame = h('div', { style: { position: 'absolute', ...this.css(r, g), pointerEvents: 'none' } });
    const isLine = m.type === 'linear' || m.type === 'mirror';
    const mw = isLine ? w * 2 : (m.w ?? 0.35) * 2 * w, mh = m.type === 'linear' ? 0 : (m.h ?? 0.35) * 2 * hh;
    const mb = h('div.gz.thin', { 'data-mask': '1', style: { left: (m.x ?? 0.5) * w - mw / 2 + 'px', top: (m.y ?? 0.5) * hh - mh / 2 + 'px', width: mw + 'px', height: Math.max(2, mh) + 'px', transform: `rotate(${m.r || 0}deg)`, pointerEvents: 'auto', borderRadius: m.type === 'circle' ? '50%' : '0' } });
    if (!isLine) mb.append(h('div.h.sc', { 'data-h': 'msc' }), h('div.h.ew', { 'data-h': 'mew' }), h('div.h.ns', { 'data-h': 'mns' }));
    else if (m.type === 'mirror') mb.append(h('div.h.ns', { 'data-h': 'mns' }));
    mb.append(h('div.h.ro', { 'data-h': 'mro' }));
    frame.append(mb); this.root.append(frame);
    this.maskFrame = { r, g };
  }
  // face boxes of the selected clip, tap to switch a face on/off
  renderFaces(g) {
    const it = sel(); if (!it || it.kind !== 'video' || !this.active(it)) return;
    const data = faces.dataNow(it.mid); if (!data) return;
    const st = srcTime(it, S.player.t - it.start), fb = it.faces || {};
    const r = this.rectOf(it); if (!r) return;
    const list = [...(data.tracks || []).map(t => ({ tr: t, manual: false })), ...(data.manual || []).map(t => ({ tr: t, manual: true }))];
    const names = this.hooks.faceNames?.(it) || {};
    for (const { tr, manual } of list) {
      const b = faces.boxAt(tr, st, 0.35); if (!b) continue;
      const on = fb.mode === 'selected' ? (fb.only || []).includes(tr.id) : !(fb.off || []).includes(tr.id);
      const [x0, y0] = this.srcToStage(it, r, g, b.x, b.y), [x1, y1] = this.srcToStage(it, r, g, b.x + b.w, b.y + b.h);
      const el = h('div.fbox' + (on ? '' : '.off'), { style: { left: Math.min(x0, x1) + 'px', top: Math.min(y0, y1) + 'px', width: Math.abs(x1 - x0) + 'px', height: Math.abs(y1 - y0) + 'px', borderRadius: manual ? '6px' : '40%' } },
        h('span', {}, (names[tr.id] || (manual ? 'Area' : 'Face ' + tr.id)) + (on ? '' : ' · off')));
      el.addEventListener('pointerdown', e => { e.stopPropagation(); this.hooks.toggleFace?.(it, tr.id); });
      this.root.append(el);
    }
  }
  // source-normalised point -> stage pixels (honours crop, flips, scale and rotation)
  srcToStage(it, r, g, u, v) {
    const c = it.crop || [0, 0, 1, 1];
    let lx = (u - c[0]) / c[2], ly = (v - c[1]) / c[3];
    if (it.flipH) lx = 1 - lx; if (it.flipV) ly = 1 - ly;
    const dx = (lx - 0.5) * r.w, dy = (ly - 0.5) * r.h, a = r.rot * Math.PI / 180;
    const px = r.cx + dx * Math.cos(a) - dy * Math.sin(a), py = r.cy + dx * Math.sin(a) + dy * Math.cos(a);
    return [g.ox + px * g.k, g.oy + py * g.k];
  }
  stageToSrc(it, r, g, sx, sy) {
    const px = (sx - g.ox) / g.k - r.cx, py = (sy - g.oy) / g.k - r.cy, a = -r.rot * Math.PI / 180;
    const dx = px * Math.cos(a) - py * Math.sin(a), dy = px * Math.sin(a) + py * Math.cos(a);
    let lx = dx / r.w + 0.5, ly = dy / r.h + 0.5;
    if (it.flipH) lx = 1 - lx; if (it.flipV) ly = 1 - ly;
    const c = it.crop || [0, 0, 1, 1];
    return [c[0] + lx * c[2], c[1] + ly * c[3]];
  }

  /* ---------- pointer handling ---------- */
  pt(e) { const s = this.stage.getBoundingClientRect(); return { x: e.clientX - s.left, y: e.clientY - s.top }; }
  down(e) {
    this.root.setPointerCapture(e.pointerId);
    const p = this.pt(e); this.ptrs.set(e.pointerId, p);
    if (this.mode === 'draw') { this.op = { type: 'draw', a: p }; return; }
    if (this.mode === 'faces') { this.op = null; return; }
    const it = sel();
    if (this.ptrs.size === 2 && it && this.op?.type !== 'mask') { this.startPinch(it); return; }
    const hd = e.target.dataset?.h;
    if (hd && it) {
      const r = this.rectOf(it), g = this.geo();
      this.op = { type: hd, it, r, g, p0: p, base: this.snapshot(it) };
      return;
    }
    if (e.target.dataset?.mask && it) { this.op = { type: 'mmove', it, p0: p, base: { ...it.mask } }; return; }
    // tap: pick what is under the finger; drag the selected item
    const hit = this.hit(p);
    if (it && hit === it) { this.op = { type: 'move', it, p0: p, base: this.snapshot(it), moved: false }; return; }
    this.op = { type: 'tap', p0: p, hit };
    const now = performance.now();
    if (hit && hit === this.lastTap?.it && now - this.lastTap.t < 320) this.hooks.dblTap?.(hit);
    this.lastTap = { it: hit, t: now };
  }
  snapshot(it) { const lt = S.player.t - it.start; return { x: kfVal(it, 'x', lt), y: kfVal(it, 'y', lt), s: kfVal(it, 's', lt), r: kfVal(it, 'r', lt), bw: it.bw, bh: it.bh }; }
  hit(p) {
    const g = this.geo(), x = (p.x - g.ox) / g.k, y = (p.y - g.oy) / g.k, t = S.player.t;
    const cands = S.p.items.filter(i => this.active(i) && ['video', 'image', 'text', 'shape', 'blur'].includes(i.kind))
      .sort((a, b) => (b.track === 'main' ? -1 : b.layer) - (a.track === 'main' ? -1 : a.layer));
    for (const it of cands) {
      const r = this.rectOf(it); if (!r) continue;
      const a = -r.rot * Math.PI / 180, dx = x - r.cx, dy = y - r.cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      const pad = 12 / g.k;
      if (Math.abs(lx) <= Math.abs(r.w) / 2 + pad && Math.abs(ly) <= Math.abs(r.h) / 2 + pad) return it;
    }
    return null;
  }
  startPinch(it) {
    const [a, b] = [...this.ptrs.values()];
    this.op = { type: 'pinch', it, d0: Math.hypot(b.x - a.x, b.y - a.y), a0: Math.atan2(b.y - a.y, b.x - a.x), base: this.snapshot(it), c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  move(e) {
    if (!this.ptrs.has(e.pointerId)) return;
    const p = this.pt(e); this.ptrs.set(e.pointerId, p);
    const op = this.op; if (!op) return;
    const lt = op.it ? S.player.t - op.it.start : 0;
    const set = (prop, v) => setProp(op.it, prop, v, lt);
    const g = this.geo();
    this.guides([]);
    if (op.type === 'draw') {
      const a = op.a, x = Math.min(a.x, p.x), y = Math.min(a.y, p.y);
      this.drawBox ||= h('div.drawbox');
      Object.assign(this.drawBox.style, { left: x + 'px', top: y + 'px', width: Math.abs(p.x - a.x) + 'px', height: Math.abs(p.y - a.y) + 'px' });
      if (!this.drawBox.isConnected) this.root.append(this.drawBox);
      return;
    }
    if (op.type === 'tap') { if (Math.hypot(p.x - op.p0.x, p.y - op.p0.y) > 8 && op.hit && op.hit === sel()) { this.op = { type: 'move', it: op.hit, p0: op.p0, base: this.snapshot(op.hit) }; } return; }
    if (op.type === 'pinch') {
      const [a, b] = [...this.ptrs.values()]; if (!b) return;
      const d = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x), c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (op.it.kind === 'blur') { op.it.bw = clamp(op.base.bw * d / op.d0, 0.02, 2); op.it.bh = clamp(op.base.bh * d / op.d0, 0.02, 2); }
      else set('s', clamp(op.base.s * d / op.d0, 0.02, 20));
      let r = op.base.r + (ang - op.a0) * 180 / Math.PI; r = this.snapAngle(r); set('r', r);
      set('x', op.base.x + (c.x - op.c0.x) / g.k / g.W); set('y', op.base.y + (c.y - op.c0.y) / g.k / g.H);
      commit({ live: true }); this.renderLive(); return;
    }
    const dx = (p.x - op.p0.x) / g.k, dy = (p.y - op.p0.y) / g.k;
    if (op.type === 'move') {
      let x = op.base.x + dx / g.W, y = op.base.y + dy / g.H; const gd = [];
      // centre snapping
      if (Math.abs(x) < 8 / g.k / g.W) { x = 0; gd.push('v'); }
      if (Math.abs(y) < 8 / g.k / g.H) { y = 0; gd.push('h'); }
      set('x', x); set('y', y); this.guides(gd);
    } else if (op.type === 'sc') {
      const r = op.r, c = { x: g.ox + r.cx * g.k, y: g.oy + r.cy * g.k }, d0 = Math.hypot(op.p0.x - c.x, op.p0.y - c.y), d = Math.hypot(p.x - c.x, p.y - c.y);
      if (op.it.kind === 'blur') { op.it.bw = clamp(op.base.bw * d / d0, 0.02, 2); op.it.bh = clamp(op.base.bh * d / d0, 0.02, 2); }
      else set('s', clamp(op.base.s * d / d0, 0.02, 20));
    } else if (op.type === 'ro') {
      const r = op.r, c = { x: g.ox + r.cx * g.k, y: g.oy + r.cy * g.k };
      const a = Math.atan2(p.y - c.y, p.x - c.x) * 180 / Math.PI + 90;
      set('r', this.snapAngle(a));
    } else if (op.type === 'ew' || op.type === 'ns') {
      const r = op.r, a = r.rot * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
      const proj = op.type === 'ew' ? (dx * ux + dy * uy) : (-dx * uy + dy * ux);
      if (op.type === 'ew') op.it.bw = clamp(op.base.bw + proj * 2 / g.W / (op.base.s || 1), 0.02, 2);
      else op.it.bh = clamp(op.base.bh + proj * 2 / g.H / (op.base.s || 1), 0.02, 2);
    } else if (op.type === 'mmove') {
      const r = this.rectOf(op.it), a = -r.rot * Math.PI / 180, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      op.it.mask.x = op.base.x + lx / r.w; op.it.mask.y = op.base.y + ly / r.h;
    } else if (op.type === 'msc' || op.type === 'mew' || op.type === 'mns' || op.type === 'mro') {
      const it = op.it, m = it.mask, r = this.rectOf(it);
      op.mbase ||= { ...m };
      const cx = g.ox + (r.cx + ((m.x ?? 0.5) - 0.5) * r.w) * g.k, cy = g.oy + (r.cy + ((m.y ?? 0.5) - 0.5) * r.h) * g.k;
      if (op.type === 'mro') { m.r = this.snapAngle(Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90 - r.rot); }
      else {
        const d0 = Math.hypot(op.p0.x - cx, op.p0.y - cy) || 1, d = Math.hypot(p.x - cx, p.y - cy), f = d / d0;
        if (op.type !== 'mns') m.w = clamp(op.mbase.w * f, 0.01, 3);
        if (op.type !== 'mew') m.h = clamp(op.mbase.h * f, 0.01, 3);
      }
    }
    commit({ live: true }); this.renderLive();
  }
  snapAngle(r) { for (const s of [-180, -90, 0, 90, 180, 270, 360]) if (Math.abs(r - s) < 4) return s; return r; }
  renderLive() { cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame(() => { const op = this.op; this.op = null; this.render(); this.op = op; }); }
  guides(list) {
    this.root.querySelectorAll('.guide').forEach(e => e.remove());
    const g = this.geo();
    for (const k of list) this.root.append(h('div.guide.' + k, { style: k === 'v' ? { left: g.ox + g.W * g.k / 2 + 'px' } : { top: g.oy + g.H * g.k / 2 + 'px' } }));
  }
  up(e) {
    this.ptrs.delete(e.pointerId);
    const op = this.op;
    if (op?.type === 'pinch' && this.ptrs.size === 1) { this.op = null; commit(); return; }
    if (this.ptrs.size) return;
    this.op = null; this.guides([]);
    if (!op) return;
    if (op.type === 'draw') {
      const a = op.a, b = this.pt(e);
      this.drawBox?.remove(); this.drawBox = null;
      if (Math.abs(b.x - a.x) > 8 && Math.abs(b.y - a.y) > 8) this.hooks.drew?.({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }, this);
      return;
    }
    if (op.type === 'tap') { if (op.hit) select(op.hit.id); else select(null); this.render(); return; }
    commit();
    this.render();
  }
  wheel(e) {
    const it = sel(); if (!it || !this.active(it)) return;
    e.preventDefault();
    const lt = S.player.t - it.start, f = Math.exp(-e.deltaY * 0.0015);
    if (e.shiftKey) setProp(it, 'r', kfVal(it, 'r', lt) + e.deltaY * 0.1, lt);
    else if (it.kind === 'blur') { it.bw *= f; it.bh *= f; }
    else setProp(it, 's', clamp(kfVal(it, 's', lt) * f, 0.02, 20), lt);
    commit({ live: true }); this.render();
    clearTimeout(this._wt); this._wt = setTimeout(() => commit(), 300);
  }
}
