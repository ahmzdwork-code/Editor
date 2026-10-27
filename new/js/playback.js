// Live preview: keeps video elements in step with the timeline, plays the sound mix, draws frames.
import { GL } from './gl.js';
import { Composer } from './compose.js';
import { audioCtx, urlNow, urlFor, imageNow, imageFor, audioNow, decodeAudio } from './media.js';
import { schedule } from './audio.js';
import { srcTime, speedAt, duration } from './model.js';
import * as faces from './faces.js';
import { stabAt } from './track.js';
import { Emitter, clamp } from './util.js';

export class Player extends Emitter {
  constructor(canvas) {
    super();
    this.canvas = canvas;
    this.gl = new GL(canvas);
    this.comp = new Composer(this.gl);
    this.p = null; this.t = 0; this.playing = false;
    this.vids = new Map(); // item id -> {el, mid}
    this.nodes = [];
    this.previewLong = 1280;
    this.dirty = true;
    this.overlay = null; // optional drawing hook for UI guides
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.master = null;
  }
  setProject(p) { this.p = p; this.stopAudio(); this.dirty = true; }
  get dur() { return this.p ? duration(this.p) : 0; }
  size() {
    const p = this.p, k = Math.min(1, this.previewLong / Math.max(p.w, p.h));
    return [Math.round(p.w * k / 2) * 2, Math.round(p.h * k / 2) * 2];
  }
  invalidate() { this.dirty = true; }

  /* ---------- video elements ---------- */
  vidFor(it) {
    let v = this.vids.get(it.id);
    if (v && v.mid !== it.mid) { this.dropVid(it.id); v = null; }
    if (!v) {
      const el = document.createElement('video');
      el.muted = true; el.playsInline = true; el.preload = 'auto'; el.crossOrigin = 'anonymous';
      el.setAttribute('playsinline', ''); el.disablePictureInPicture = true;
      const u = urlNow(it.mid);
      if (u) el.src = u; else urlFor(it.mid).then(x => { el.src = x; });
      el.addEventListener('seeked', () => { this.dirty = true; });
      el.addEventListener('loadeddata', () => { this.dirty = true; });
      v = { el, mid: it.mid, want: -1 };
      this.vids.set(it.id, v);
    }
    return v;
  }
  dropVid(id) { const v = this.vids.get(id); if (v) { v.el.pause(); v.el.removeAttribute('src'); v.el.load(); this.vids.delete(id); this.gl.dropSource('v:' + id); } }
  // creates / cleans up elements around time t
  manage(t) {
    const keep = new Set();
    for (const it of this.p.items) {
      if (it.kind !== 'video') continue;
      const near = t >= it.start - 2.5 && t < it.start + it.dur + 0.5;
      if (!near) continue;
      keep.add(it.id);
      const v = this.vidFor(it);
      const active = t >= it.start && t < it.start + it.dur;
      if (!active) {
        // pre-roll: park the next clip at its first frame so the cut is instant
        const want = srcTime(it, 0);
        if (!v.el.paused) v.el.pause();
        if (Math.abs(v.el.currentTime - want) > 0.03 && !v.el.seeking && v.el.readyState >= 1) v.el.currentTime = want;
      }
    }
    for (const id of [...this.vids.keys()]) if (!keep.has(id)) this.dropVid(id);
  }
  syncVideos(t, playing) {
    for (const it of this.p.items) {
      if (it.kind !== 'video' || t < it.start || t >= it.start + it.dur) continue;
      const v = this.vidFor(it), el = v.el, lt = t - it.start, want = srcTime(it, lt);
      const fallbackSound = !audioNow(it.mid) && this.p.media[it.mid]?.hasAudio !== false && !it.mute && !(it.track === 'main' && this.p.muteMain);
      el.muted = !(playing && fallbackSound && audioNow(it.mid) === null);
      if (!playing) {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - want) > 0.02 && el.readyState >= 1) { if (!el.seeking || Math.abs(v.want - want) > 0.02) { el.currentTime = want; v.want = want; } }
        continue;
      }
      const rate = clamp(speedAt(it, lt), 0.0625, 16);
      const drift = el.currentTime - want;
      if (el.paused) {
        if (Math.abs(drift) > 0.05) el.currentTime = want;
        el.playbackRate = rate; el.play().catch(() => {});
      } else if (Math.abs(drift) > 0.3) { el.currentTime = want + 0.05 * rate; }
      else el.playbackRate = clamp(rate * (1 - drift * 0.8), 0.0625, 16);
    }
  }

  /* ---------- provider for the composer ---------- */
  provider() {
    return {
      frame: (it, st) => {
        if (it.kind === 'image') {
          const img = imageNow(it.mid);
          if (!img) { imageFor(it.mid).then(() => { this.dirty = true; }); return null; }
          return { el: img, w: img.naturalWidth, h: img.naturalHeight, key: 'i:' + it.mid, ver: it.mid };
        }
        const v = this.vids.get(it.id) || this.vidFor(it);
        if (v.el.readyState < 2) return null;
        return { el: v.el, w: v.el.videoWidth, h: v.el.videoHeight, key: 'v:' + it.id, ver: null };
      },
      faces: (it, st, w, h) => it.faces?.on ? faces.regions(faces.dataNow(it.mid), it.faces, st, w, h) : null,
      mask: (it, st) => it.cutout?.on ? faces.cutoutAt(it.mid, st) : null,
      stab: (it, st) => stabAt(it.mid, st, it.stab?.strength ?? 0.6),
    };
  }

  draw() {
    if (!this.p) return;
    const [W, H] = this.size();
    try {
      const out = this.comp.render(this.p, this.t, W, H, this.provider(), {});
      this.gl.present(out);
    } catch (e) { console.error(e); }
    this.gl.endFrame();
    this.emit('frame');
  }

  loop() {
    requestAnimationFrame(this.loop);
    if (!this.p) return;
    if (this.playing) {
      const ac = audioCtx();
      let t = this.t0 + (ac.currentTime - this.c0);
      if (ac.state !== 'running') t = this.t0 + (performance.now() - this.w0) / 1000;
      const end = this.rangeEnd ?? this.dur;
      if (t >= end) {
        if (this.loopRange) { this.seek(this.rangeStart ?? 0); this.play(); return; }
        t = end; this.pause(); this.t = Math.max(0, end - 0.001);
      } else this.t = t;
      this.manage(this.t); this.syncVideos(this.t, true);
      this.draw(); this.emit('time', this.t);
    } else if (this.dirty) {
      this.dirty = false; this.manage(this.t); this.syncVideos(this.t, false);
      this.draw();
    } else {
      // keep redrawing while a video is still seeking to the wanted frame
      for (const v of this.vids.values()) if (v.el.seeking) { this.dirty = true; break; }
    }
  }

  async play(opts = {}) {
    if (!this.p) return;
    const ac = audioCtx();
    try { await ac.resume(); } catch (e) { }
    if (this.t >= this.dur - 0.02) this.t = 0;
    for (const m of Object.values(this.p.media)) if (m.kind !== 'image') decodeAudio(m);
    this.playing = true; this.loopRange = !!opts.loop; this.rangeStart = opts.from; this.rangeEnd = opts.to;
    this.t0 = this.t; this.c0 = ac.currentTime + 0.06; this.w0 = performance.now() + 60;
    this.stopAudio();
    if (!this.master) { this.master = ac.createGain(); this.master.connect(ac.destination); }
    this.nodes = schedule(ac, this.master, this.p, this.t, this.c0, { skip: opts.skip });
    this.emit('play');
  }
  pause() {
    this.playing = false; this.stopAudio();
    for (const v of this.vids.values()) v.el.pause();
    this.dirty = true; this.emit('pause'); this.emit('time', this.t);
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  stopAudio() { for (const n of this.nodes) { try { n.src.stop(); } catch (e) { } try { n.g.disconnect(); } catch (e) { } } this.nodes = []; }
  seek(t) {
    const was = this.playing;
    if (was) { this.playing = false; this.stopAudio(); }
    this.t = clamp(t, 0, Math.max(0, this.dur - 0.001));
    this.dirty = true; this.emit('time', this.t);
    if (was) this.play({ loop: this.loopRange, from: this.rangeStart, to: this.rangeEnd });
  }
  // after edits that change sound while playing
  refreshAudio() { if (this.playing) this.seek(this.t); }
  // current frame as a canvas at full project size (for freeze frame / save frame)
  snapshot(full = true) {
    const p = this.p, W = full ? p.w : this.size()[0], H = full ? p.h : this.size()[1];
    const out = this.comp.render(p, this.t, W, H, this.provider(), { full });
    const px = this.gl.read(out, 0, 0, W, H);
    this.gl.endFrame();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const img = new ImageData(W, H);
    // rows come back bottom-up relative to our top-first storage? our targets store the top row first.
    for (let y = 0; y < H; y++) img.data.set(px.subarray(y * W * 4, (y + 1) * W * 4), y * W * 4);
    c.getContext('2d').putImageData(img, 0, 0);
    this.dirty = true;
    return c;
  }
}
