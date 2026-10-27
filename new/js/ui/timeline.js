// The timeline: a fixed centre playhead with the tracks scrolling under it (phone-friendly).
import { S, bus, commit, select, sel } from './state.js';
import { h, ico } from './widgets.js';
import { icon } from './icons.js';
import { mainItems, srcTime, srcLen, snapPoints, layoutMain, kfTimes, duration, freeLayer } from '../model.js';
import { thumbAt, peaksFor, audioNow, decodeAudio } from '../media.js';
import { sfxBuffer } from '../sfx.js';
import { audioCtx } from '../media.js';
import { clamp, fmtTime } from '../util.js';

const ROW = 34, MAIN = 60, RULER = 24;
const KIND_ICON = { text: 'text', shape: 'shapes', effect: 'fx', filter: 'filter', blur: 'blurArea', audio: 'sound', image: 'media', video: 'film' };

export class Timeline {
  constructor(root, actions) {
    this.actions = actions;
    this.pps = 60; // pixels per second
    this.el = h('div.tl');
    this.scroll = h('div.tl-scroll');
    this.inner = h('div.tl-inner');
    this.rulerC = h('canvas');
    this.ruler = h('div.ruler', {}, this.rulerC);
    this.scroll.append(this.inner);
    this.inner.append(this.ruler);
    this.el.append(this.scroll, h('div.playhead'));
    root.append(this.el);
    this.lock = false; // ignore scroll events caused by code
    this.scroll.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scroll.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); } }, { passive: false });
    this.pinch();
    this.inner.addEventListener('click', e => { if (e.target === this.inner || e.target.classList.contains('track')) select(null); });
    bus.on('change', () => { if (!this.dragging) this.render(); });
    bus.on('select', () => this.render());
    S.player.on('time', t => this.follow(t));
    new ResizeObserver(() => this.render()).observe(this.el);
  }
  get pad() { return this.el.clientWidth / 2; }
  x(t) { return this.pad + t * this.pps; }

  zoom(f, keepT = S.player.t) {
    this.pps = clamp(this.pps * f, 4, 600);
    this.render(); this.follow(keepT, true);
  }
  pinch() {
    let d0 = 0, p0 = 0;
    this.scroll.addEventListener('touchstart', e => { if (e.touches.length === 2) { d0 = Math.abs(e.touches[0].clientX - e.touches[1].clientX); p0 = this.pps; } }, { passive: true });
    this.scroll.addEventListener('touchmove', e => {
      if (e.touches.length === 2 && d0 > 10) { const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX); const t = S.player.t; this.pps = clamp(p0 * d / d0, 4, 600); this.render(); this.follow(t, true); }
    }, { passive: true });
  }
  onScroll() {
    if (this.lock) { this.lock = false; return; }
    this.drawRuler();
    if (S.player.playing) S.player.pause();
    const t = clamp(this.scroll.scrollLeft / this.pps, 0, duration(S.p));
    S.player.seek(t);
  }
  follow(t, force) {
    const x = Math.round(t * this.pps);
    if (Math.abs(this.scroll.scrollLeft - x) >= 1 || force) { this.lock = true; this.scroll.scrollLeft = x; }
    this.drawRuler();
  }

  rows() {
    const p = S.p;
    const lay = [...new Set(p.items.filter(i => i.track === 'layer').map(i => i.layer))].sort((a, b) => b - a);
    const aud = [...new Set(p.items.filter(i => i.track === 'audio').map(i => i.layer))].sort((a, b) => a - b);
    const ys = { layer: {}, audio: {} };
    let y = RULER + 6;
    for (const l of lay) { ys.layer[l] = y; y += ROW; }
    const mainY = y + (lay.length ? 4 : 10); y = mainY + MAIN + 6;
    for (const l of aud) { ys.audio[l] = y; y += ROW; }
    return { ys, mainY, height: y + 40, lay, aud };
  }

  render() {
    if (!S.p || !this.el.clientWidth) return;
    const p = S.p, pad = this.pad, dur = duration(p);
    const W = pad * 2 + Math.max(dur, 1) * this.pps;
    const R = this.R = this.rows();
    this.inner.style.width = W + 'px';
    this.inner.style.height = Math.max(R.height, this.el.clientHeight) + 'px';
    // clear (keep ruler)
    [...this.inner.children].forEach(c => { if (c !== this.ruler) c.remove(); });
    // track backgrounds
    this.inner.append(h('div.track.main', { style: { top: R.mainY + 'px', height: MAIN + 'px' } }));
    const s = sel();
    const main = mainItems(p);
    if (!main.length) {
      this.inner.append(h('button.addend', { style: { left: pad - 20 + 'px', top: R.mainY + 6 + 'px', height: MAIN - 12 + 'px', width: '140px', gap: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12.5px', fontWeight: 600 }, on: { click: () => this.actions.addMain() } }, ico('import', 's'), 'Add video'));
    }
    for (const it of p.items) {
      const y = it.track === 'main' ? R.mainY : it.track === 'layer' ? R.ys.layer[it.layer] : R.ys.audio[it.layer];
      if (y == null) continue;
      this.inner.append(this.clipEl(it, y, it.track === 'main' ? MAIN : ROW, it === s));
    }
    // transitions between main clips
    main.forEach((a, i) => {
      const b = main[i + 1]; if (!b) return;
      const tx = a.start + a.dur - (a.trans ? a.trans.dur / 2 : 0);
      const btn = h('button.tbtn' + (a.trans ? '.on' : ''), { title: 'Transition', style: { left: this.x(tx) + 'px', top: R.mainY + MAIN / 2 - 11 + 'px' }, html: icon('trans'), on: { click: e => { e.stopPropagation(); select(a.id); this.actions.open('transition'); } } });
      this.inner.append(btn);
    });
    if (main.length) {
      const end = main[main.length - 1];
      this.inner.append(h('button.addend', { title: 'Add video', style: { left: this.x(end.start + end.dur) + 8 + 'px', top: R.mainY + 6 + 'px', height: MAIN - 12 + 'px' }, html: icon('import', 's'), on: { click: () => this.actions.addMain() } }));
    }
    for (const m of p.markers || []) this.inner.append(h('div.mk', { style: { left: this.x(m) + 'px' } }));
    this.follow(S.player.t, true);
  }

  drawRuler() {
    const c = this.rulerC, w = this.el.clientWidth, dpr = devicePixelRatio || 1;
    if (!w) return;
    const left = this.scroll.scrollLeft;
    c.style.left = left + 'px'; c.style.width = w + 'px';
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = RULER * dpr; }
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, RULER);
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const major = steps.find(s => s * this.pps >= 70) || 600, minor = major / (major >= 1 ? 5 : 2);
    const t0 = (left - this.pad) / this.pps, t1 = t0 + w / this.pps;
    ctx.font = '10px ui-monospace, Menlo, monospace'; ctx.textBaseline = 'top';
    for (let t = Math.floor(Math.max(0, t0) / minor) * minor; t <= t1; t += minor) {
      const x = this.pad + t * this.pps - left, isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      ctx.fillStyle = isMajor ? '#7b7d82' : '#4a4c52';
      ctx.fillRect(Math.round(x), isMajor ? 12 : 16, 1, isMajor ? 10 : 6);
      if (isMajor) { ctx.fillStyle = '#8c8f96'; ctx.fillText(major < 1 ? t.toFixed(1) + 's' : fmtTime(t, false), x + 3, 3); }
    }
  }

  clipEl(it, y, hgt, isSel) {
    const p = S.p, x = this.x(it.start), w = Math.max(6, it.dur * this.pps);
    const kind = it.kind === 'audio' ? (it.sub === 'sfx' ? 'sfx' : it.sub === 'voice' ? 'voice' : 'audio') : it.kind;
    const el = h('div.clip.k-' + kind + (isSel ? '.sel' : ''), { style: { left: x + 'px', width: w + 'px', top: y + 3 + 'px', height: hgt - 6 + 'px', bottom: 'auto' } });
    if (isSel) el.style.touchAction = 'none';
    // contents
    if (it.kind === 'video' || it.kind === 'image') el.append(this.strip(it, w, hgt - 6));
    if (it.kind === 'audio') el.append(this.wave(it, w, hgt - 6));
    const label = it.kind === 'text' ? (it.text || '').replace(/\n/g, ' ') : it.kind === 'video' || it.kind === 'image' ? (it.track === 'main' ? '' : p.media[it.mid]?.name || '') : it.name || it.shape || it.kind;
    if (label || it.track !== 'main') el.append(h('span.row', { style: { gap: '4px', position: 'relative', zIndex: 2, minWidth: 0 } }, ico(KIND_ICON[it.kind] || 'film', 'xs'), h('span.nm', {}, label)));
    const badges = [];
    if ((it.speed && it.speed !== 1) || it.curve?.length) badges.push(h('i', {}, it.curve?.length ? 'curve' : it.speed.toFixed(it.speed < 1 ? 2 : 1) + 'x'));
    if (it.faces?.on) badges.push(h('i.acc', {}, 'faces'));
    if (it.mute || (it.track === 'main' && p.muteMain)) badges.push(h('i', {}, 'muted'));
    if (it.reversed) badges.push(h('i', {}, 'rev'));
    if (badges.length && w > 50) el.append(h('div.badge', {}, badges));
    if (isSel) {
      for (const kt of kfTimes(it)) if (kt >= 0 && kt <= it.dur) el.append(h('div.kf', { style: { left: kt * this.pps + 'px' } }));
      const hl = h('div.hd.l'), hr = h('div.hd.r');
      el.append(hl, hr);
      this.trimDrag(hl, it, 'l'); this.trimDrag(hr, it, 'r');
    }
    this.moveDrag(el, it);
    return el;
  }

  strip(it, w, hh) {
    const m = S.p.media[it.mid]; const c = h('canvas.strip');
    if (!m) return c;
    const dpr = Math.min(2, devicePixelRatio || 1), cw = Math.min(Math.round(w * dpr), 8000);
    c.width = cw; c.height = Math.round(hh * dpr); c.style.width = w + 'px';
    const draw = () => {
      if (!c.isConnected && c._drawn) return;
      const ctx = c.getContext('2d'), ar = (m.w || 16) / (m.h || 9), tw = hh * ar, n = Math.ceil(w / tw);
      const kx = cw / w;
      for (let i = 0; i < n; i++) {
        const lt = (i * tw + tw / 2) / this.pps, st = it.kind === 'image' ? 0 : srcTime(it, Math.min(lt, it.dur));
        const th = thumbAt(m, st, 64, () => requestAnimationFrame(draw));
        if (th) ctx.drawImage(th, i * tw * kx, 0, tw * kx, c.height);
      }
      c._drawn = true;
    };
    draw();
    return c;
  }

  wave(it, w, hh) {
    const c = h('canvas.wav'), dpr = Math.min(2, devicePixelRatio || 1), cw = Math.min(Math.round(w * dpr), 8000);
    c.width = cw; c.height = Math.round(hh * dpr); c.style.width = w + 'px';
    const draw = () => {
      const ctx = c.getContext('2d');
      let buf = null, off = 0;
      if (it.sfx) buf = sfxBuffer(audioCtx(), it.sfx.id, (it.sfx.off || 0) + it.dur + 0.5, it.sfx.seed || 1), off = it.sfx.off || 0;
      else { buf = audioNow(it.mid); off = it.in; if (buf === undefined) { decodeAudio(S.p.media[it.mid]).then(() => requestAnimationFrame(draw)); return; } }
      if (!buf) return;
      const d = buf.getChannelData(0), sr = buf.sampleRate, n = cw, mid = c.height / 2;
      ctx.clearRect(0, 0, cw, c.height);
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      for (let i = 0; i < n; i++) {
        const lt0 = i / n * it.dur, lt1 = (i + 1) / n * it.dur;
        const a = Math.floor((it.sfx ? off + lt0 : srcTime(it, lt0)) * sr), b = Math.max(a + 1, Math.floor((it.sfx ? off + lt1 : srcTime(it, lt1)) * sr));
        let mx = 0; for (let j = a; j < b && j < d.length; j += Math.max(1, (b - a) >> 6)) mx = Math.max(mx, Math.abs(d[j]));
        const hgt = Math.max(1, mx * (it.volume ?? 1) * c.height * 0.9);
        ctx.fillRect(i, mid - hgt / 2, 1, hgt);
      }
    };
    draw();
    return c;
  }

  /* ---------- dragging ---------- */
  snap(t, ignore) {
    const pts = [...snapPoints(S.p, ignore), S.player.t], thr = 9 / this.pps;
    let best = null, bd = thr;
    for (const q of pts) { const d = Math.abs(q - t); if (d < bd) { bd = d; best = q; } }
    this.showSnap(best);
    return best ?? t;
  }
  showSnap(t) {
    this.inner.querySelector('.snapline')?.remove();
    if (t == null) return;
    this.inner.append(h('div.snapline', { style: { left: this.x(t) + 'px' } }));
    if (this._lastSnap !== t) { navigator.vibrate?.(6); this._lastSnap = t; }
  }

  trimDrag(handle, it, side) {
    handle.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault(); handle.setPointerCapture(e.pointerId);
      const p = S.p, m = p.media[it.mid], x0 = e.clientX, o = { start: it.start, dur: it.dur, in: it.in, off: it.sfx?.off || 0 };
      const isMedia = it.kind === 'video' || it.kind === 'audio' && it.mid;
      const sp = (it.speed || 1) * (it.curve?.length ? 1 : 1);
      const move = ev => {
        let dt = (ev.clientX - x0) / this.pps;
        if (side === 'l') {
          let ns = it.track === 'main' ? o.start + dt : this.snap(o.start + dt, it); dt = ns - o.start;
          if (isMedia) dt = Math.max(dt, -o.in / sp);
          if (it.sfx && !(it.sfx && SFX_LOOP(it))) dt = Math.max(dt, -o.off);
          dt = Math.min(dt, o.dur - 0.1);
          it.dur = o.dur - dt;
          if (isMedia) it.in = o.in + dt * sp;
          if (it.sfx) it.sfx.off = Math.max(0, o.off + dt);
          if (it.track !== 'main') it.start = o.start + dt;
          this.trimKf(it, dt, o);
        } else {
          let ne = it.track === 'main' ? o.start + o.dur + dt : this.snap(o.start + o.dur + dt, it); dt = ne - o.start - o.dur;
          let nd = Math.max(0.1, o.dur + dt);
          if (isMedia && m?.dur) nd = Math.min(nd, (m.dur - it.in) / sp);
          if (it.sfx && !SFX_LOOP(it)) nd = Math.min(nd, Math.max(0.1, sfxDur(it) - (it.sfx.off || 0)));
          it.dur = nd;
        }
        layoutMain(p);
        const cel = handle.parentElement;
        cel.style.left = this.x(it.start) + 'px'; cel.style.width = it.dur * this.pps + 'px';
        commit({ live: true });
      };
      this.dragging = true;
      const up = () => { this.dragging = false; delete it._kf0; handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); this.showSnap(null); commit({ audio: true }); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
    });
  }
  trimKf(it, dt, o) { /* keyframes stay at their place in the picture: shift by the trimmed amount */
    if (!it.kf) return;
    if (!it._kf0) it._kf0 = JSON.parse(JSON.stringify(it.kf));
    for (const k of Object.keys(it._kf0)) it.kf[k] = it._kf0[k].map(q => ({ ...q, t: q.t - dt }));
  }

  moveDrag(el, it) {
    let timer = null, start = null, moving = false;
    const goMove = () => { moving = true; this.dragging = true; el.classList.add('drag'); navigator.vibrate?.(10); try { el.setPointerCapture(start.id); } catch (e) { } };
    el.addEventListener('pointerdown', e => {
      if (e.button > 0 || e.target.classList.contains('hd')) return;
      start = { x: e.clientX, y: e.clientY, st: it.start, id: e.pointerId, left: parseFloat(el.style.left) };
      if (S.sel !== it.id) timer = setTimeout(goMove, 380);
    });
    // once a move started, the page must not scroll under the finger
    el.addEventListener('touchmove', e => { if (moving) e.preventDefault(); }, { passive: false });
    el.addEventListener('pointermove', e => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moving) {
        if (Math.hypot(dx, dy) > 7) { clearTimeout(timer); if (S.sel === it.id) goMove(); else { start = null; return; } }
        else return;
      }
      if (it.track === 'main') { el.style.transform = `translateX(${dx}px)`; return; }
      const ns = this.snap(Math.max(0, start.st + dx / this.pps), it);
      el.style.left = this.x(ns) + 'px';
      el.style.transform = `translateY(${dy}px)`;
      this._pending = { ns, dy };
    });
    const end = e => {
      clearTimeout(timer);
      if (!start || e.pointerId !== start.id) return;
      const was = moving; moving = false; this.dragging = false;
      const dx = e.clientX - start.x, dy = e.clientY - start.y; start = null;
      this.showSnap(null);
      if (!was) { if (e.type === 'pointerup' && Math.hypot(dx, dy) < 7) select(it.id); return; }
      const p = S.p;
      if (it.track === 'main') {
        const main = mainItems(p), tDrop = it.start + it.dur / 2 + dx / this.pps;
        const others = main.filter(i => i !== it);
        let idx = others.findIndex(i => tDrop < i.start + i.dur / 2);
        const arr = p.items.filter(i => i !== it);
        const pos = idx >= 0 ? arr.indexOf(others[idx]) : (others.length ? arr.indexOf(others[others.length - 1]) + 1 : arr.length);
        arr.splice(pos, 0, it); p.items = arr;
      } else if (this._pending) {
        it.start = this._pending.ns;
        const R = this.R, rows = it.track === 'layer' ? R.lay : R.aud, ys = it.track === 'layer' ? R.ys.layer : R.ys.audio;
        const y = ys[it.layer] + this._pending.dy + ROW / 2;
        let target = it.layer, bestD = 1e9;
        for (const l of rows) { const d = Math.abs(ys[l] + ROW / 2 - y); if (d < bestD) { bestD = d; target = l; } }
        if (it.track === 'layer' && y < ys[rows[0]] - 4) target = Math.max(...rows) + 1;
        if (it.track === 'audio' && y > ys[rows[rows.length - 1]] + ROW + 4) target = Math.max(...rows) + 1;
        const clash = p.items.some(i => i !== it && i.track === it.track && i.layer === target && i.start < it.start + it.dur - 1e-3 && i.start + i.dur > it.start + 1e-3);
        it.layer = clash ? freeLayer(p, it.start, it.dur, it.track, target) : target;
        this._pending = null;
      }
      S.sel = it.id;
      commit({ audio: true }); bus.emit('select', it.id);
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
}
import { sfxById } from '../sfx.js';
const SFX_LOOP = it => !!sfxById(it.sfx?.id)?.loop;
const sfxDur = it => sfxById(it.sfx?.id)?.dur || 1;
