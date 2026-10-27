// Panels, part two: face blur, blur areas, cut-out, stabilising, captions, voiceover, canvas, export, camera.
import { S, bus, commit, select, sel, now, save } from './state.js';
import { h, ico, slider, seg, colors, toggle, toggleRow, note, toast, busy, confirmBox, promptBox } from './widgets.js';
import { icon } from './icons.js';
import * as A from './actions.js';
import { open, refresh, close, ctx, loadFontCss } from './panels.js';
import { CAPTION_STYLES, FONTS, RATIOS_LIST } from './panels-data.js';
import { srcTime, srcLen, mainItems, duration, baseItem, freeLayer, kfVal } from '../model.js';
import { itemRect } from '../compose.js';
import * as faces from '../faces.js';
import { trackRegion, analyseShake, getShake } from '../track.js';
import { mixdown, wavBlob } from '../audio.js';
import { addBlob, audioCtx } from '../media.js';
import * as cap from '../captions.js';
import { exportVideo, canWebCodecs } from '../export.js';
import { clamp, deep, uid, fmtDur, fmtTime, shareOrSave, pickFiles, downloadBlob, fmtBytes, sleep } from '../util.js';
import { fontStack } from '../draw2d.js';

const live = () => commit({ live: true });
const done = o => commit(o || {});
const pct = v => Math.round(v * 100) + '%';
const tile = (label, on, fn, extra) => h('button.tile' + (on ? '.on' : ''), { on: { click: fn } }, extra, h('span', {}, label));
const field = (label, ...kids) => h('div.field', {}, label ? h('div.lbl', {}, label) : null, ...kids);
const space = (px = 12) => h('div', { style: { height: px + 'px' } });

export const more = {};

/* ======================= FACE BLUR ======================= */
const DEF_FB = { on: true, style: 'blur', strength: 0.85, feather: 0.35, pad: 1.35, shape: 'oval', color: '#000000', hold: 0.4, mode: 'all', off: [], only: [], rate: 12, sens: 0.55, small: true, body: true };
const thumbs = new Map();
function fbOf(it) { it.faces = { ...deep(DEF_FB), ...(it.faces || {}) }; return it.faces; }
more.__faceNames = it => {
  const d = faces.dataNow(it.mid), out = {};
  (d?.tracks || []).forEach((t, i) => { out[t.id] = 'Face ' + (i + 1); });
  (d?.manual || []).forEach((t, i) => { out[t.id] = 'Added ' + (i + 1); });
  return out;
};
more.__toggleFace = (it, id) => {
  const fb = fbOf(it);
  if (fb.mode === 'selected') { const s = new Set(fb.only); s.has(id) ? s.delete(id) : s.add(id); fb.only = [...s]; }
  else { const s = new Set(fb.off); s.has(id) ? s.delete(id) : s.add(id); fb.off = [...s]; }
  done(); refresh(); ctx().gizmo.render();
};
async function scanFaces(it) {
  const fb = fbOf(it), m = S.p.media[it.mid];
  const from = Math.max(0, it.in - 0.5), to = Math.min(m.dur, it.in + srcLen(it) + 0.5);
  const rate = fb.rate === 'all' ? 30 : fb.rate;
  const b = busy('Finding faces');
  b.set(null, 'Faces are found on this device. Nothing is uploaded.');
  try {
    S.player.pause();
    await faces.analyse(it.mid, m, { from, to, rate, sens: fb.sens, small: fb.small, body: fb.body }, (f, t) => b.set(f, t), b.signal);
    fb.on = true; done(); refresh(); ctx().gizmo.render();
    const n = (faces.dataNow(it.mid)?.tracks || []).length;
    toast(n ? `${n} face${n > 1 ? 's' : ''} found and covered` : 'No faces found. Try higher sensitivity, or add one by hand.', 3200);
  } catch (e) {
    if (e.name !== 'AbortError') { console.error(e); toast('Face finder failed: ' + (e.message || e), 4000); }
  } finally { b.close(); }
}
more.faces = {
  title: 'Face blur', needs: ['video'], tall: true, gizmo: 'faces', tabs: () => [['faces', 'Faces'], ['look', 'Look'], ['find', 'Finder']],
  onOpen(it) { faces.getData(it.mid).then(() => { refresh(); ctx().gizmo.render(); }); },
  body(it, tab) {
    const fb = fbOf(it), data = faces.dataNow(it.mid);
    if (tab === 'find' || !data) {
      const els = [];
      if (!data) els.push(note('Finds every face in this clip, follows it as it moves, and covers it in every frame of the preview and the saved video. Everything runs on this device.', '', 'shield'));
      els.push(
        seg([[6, 'Quick'], [12, 'Balanced'], [24, 'Precise'], ['all', 'Every frame']], fb.rate, v => { fb.rate = v; done(); }, 'How closely to look'),
        h('div', { style: { color: 'var(--muted)', fontSize: '12px', margin: '6px 0 14px' } }, 'More checks per second follow fast movement better but take longer.'),
        slider({ label: 'Sensitivity', min: 0, max: 1, step: 0.05, value: fb.sens, fmt: v => v < 0.35 ? 'Only clear faces' : v < 0.7 ? 'Normal' : 'Catch everything', onInput: v => { fb.sens = v; }, onChange: () => done() }),
        toggleRow('Find small, far-away faces', !!fb.small, v => { fb.small = v; done(); }, 'Looks again at each part of the picture, enlarged (slower)'),
        toggleRow('Find heads turned away', fb.body !== false, v => { fb.body = v; done(); }, 'Uses body position to cover side views and the back of heads'),
        h('button.btn.primary.big.block', { on: { click: () => scanFaces(it) } }, ico('face', 's'), data ? 'Look again' : 'Find faces'),
      );
      return els;
    }
    if (tab === 'look') return [
      seg([['blur', 'Blur'], ['mosaic', 'Mosaic'], ['frosted', 'Frosted'], ['solid', 'Solid']], fb.style, v => { fb.style = v; done(); refresh(); }, 'Cover'),
      space(),
      fb.style !== 'solid' ? slider({ label: 'Strength', min: 0.3, max: 1, step: 0.01, value: fb.strength, fmt: pct, onInput: v => { fb.strength = v; live(); }, onChange: () => done() }) : colors(fb.color, c => { if (c) { fb.color = c; done(); } }, { label: 'Colour' }),
      slider({ label: 'Edge fade', min: 0, max: 1.5, step: 0.01, value: fb.feather, fmt: v => v < 0.03 ? 'Sharp' : Math.round(v / 1.5 * 100) + '%', onInput: v => { fb.feather = v; live(); }, onChange: () => done() }),
      h('div', { style: { color: 'var(--muted)', fontSize: '12px', marginTop: '-8px', marginBottom: '14px' } }, 'The face itself stays fully covered; the fade happens outside it.'),
      slider({ label: 'Cover size', min: 1, max: 2.4, step: 0.01, value: fb.pad, fmt: v => Math.round(v * 100) + '%', onInput: v => { fb.pad = v; live(); }, onChange: () => done() }),
      seg([['oval', 'Oval'], ['rect', 'Rounded'], ['box', 'Box']], fb.shape, v => { fb.shape = v; done(); }, 'Shape'),
      space(),
      slider({ label: 'Keep covered after a face is lost', min: 0, max: 1.5, step: 0.05, value: fb.hold, fmt: v => v.toFixed(2) + 's', onInput: v => { fb.hold = v; live(); }, onChange: () => done() }),
    ];
    // faces list
    const names = more.__faceNames(it), list = [...data.tracks.map(t => [t, false]), ...(data.manual || []).map(t => [t, true])];
    const st0 = it.in, st1 = it.in + srcLen(it);
    const inClip = list.filter(([t]) => t.s?.length && t.s[t.s.length - 1].t >= st0 - 0.4 && t.s[0].t <= st1 + 0.4);
    const els = [
      toggleRow('Blur faces in this clip', !!fb.on, v => { fb.on = v; done(); ctx().gizmo.render(); }),
      seg([['all', 'Every face'], ['selected', 'Only chosen faces']], fb.mode, v => { fb.mode = v; done(); refresh(); ctx().gizmo.render(); }),
      h('div', { style: { color: 'var(--muted)', fontSize: '12px', margin: '6px 0 12px' } }, fb.mode === 'all' ? 'Every face is covered. Switch off the ones that may stay visible.' : 'Only the faces you switch on are covered.'),
    ];
    if (!inClip.length) els.push(note('No faces found in this clip. Raise the sensitivity in Finder and look again, or add one by hand below.', 'warn'));
    const rows = h('div.list');
    for (const [t, manual] of inClip) {
      const on = fb.mode === 'selected' ? fb.only.includes(t.id) : !fb.off.includes(t.id);
      const th = h('div.th');
      const key = it.mid + ':' + t.id;
      if (thumbs.has(key)) th.style.backgroundImage = `url(${thumbs.get(key)})`;
      else faces.faceThumb(it.mid, t).then(u => { thumbs.set(key, u); th.style.backgroundImage = `url(${u})`; }).catch(() => {});
      const a = Math.max(0, (t.s[0].t - it.in) / (it.speed || 1)), b = Math.max(a, (t.s[t.s.length - 1].t - it.in) / (it.speed || 1));
      rows.append(h('div.li' + (on ? '' : '.off'), {}, th,
        h('button.grow', { style: { textAlign: 'left' }, on: { click: () => S.player.seek(it.start + Math.min(a, it.dur - 0.01)) } }, h('div.t', {}, names[t.id] || 'Face'), h('div.d', {}, `${fmtTime(a, false)}–${fmtTime(Math.min(b, it.dur), false)}${manual ? ' · added by hand' : ''}`)),
        manual ? h('button.ibtn', { title: 'Remove', html: icon('trash'), on: { click: async () => { data.manual = data.manual.filter(x => x.id !== t.id); await faces.setData(it.mid, data); done(); refresh(); } } }) : null,
        toggle(on, () => more.__toggleFace(it, t.id))));
    }
    els.push(rows, space(),
      h('div.two', {},
        h('button.btn', { on: { click: () => startAddFace(it) } }, ico('hand', 's'), 'Add a missed face'),
        h('button.btn', { on: { click: () => { refresh(); ctx().gizmo.render(); } } }, ico('eye', 's'), 'Show boxes')),
      h('div', { style: { color: 'var(--muted)', fontSize: '12px', marginTop: '10px' } }, 'Tap a box on the preview to switch that face on or off.'));
    return els;
  },
};
function startAddFace(it) {
  S.player.pause();
  ctx().gizmo.setMode('draw', { hint: 'Draw a box around the face. It will be followed through the clip.', target: 'face', it });
  more.__drawTarget = { kind: 'face', it };
}
more.__drew = async (box, g) => {
  const tgt = more.__drawTarget; more.__drawTarget = null;
  const gz = ctx().gizmo;
  if (!tgt) { gz.setMode('item'); return; }
  if (tgt.kind === 'face') {
    const it = tgt.it, r = gz.rectOf(it), geo = gz.geo();
    const [u0, v0] = gz.stageToSrc(it, r, geo, box.x0, box.y0), [u1, v1] = gz.stageToSrc(it, r, geo, box.x1, box.y1);
    const fbox = { x: clamp(Math.min(u0, u1), 0, 1), y: clamp(Math.min(v0, v1), 0, 1), w: Math.abs(u1 - u0), h: Math.abs(v1 - v0) };
    const m = S.p.media[it.mid], st = srcTime(it, now() - it.start);
    const b = busy('Following the face');
    try {
      const s = await trackRegion(it.mid, st, fbox, Math.max(0, it.in - 0.2), Math.min(m.dur, it.in + srcLen(it) + 0.2), f => b.set(f, 'Following it through the clip… ' + Math.round(f * 100) + '%'), b.signal);
      const data = (await faces.getData(it.mid)) || { w: m.w, h: m.h, frames: [], tracks: [], manual: [] };
      data.manual ||= []; data.manual.push({ id: 'm' + uid(), s, t0: s[0].t, t1: s[s.length - 1].t });
      await faces.setData(it.mid, data);
      fbOf(it).on = true; done(); toast('Face added and followed');
    } catch (e) { if (e.name !== 'AbortError') toast('Could not follow: ' + e.message); }
    finally { b.close(); gz.setMode('faces'); refresh(); }
  }
  if (tgt.kind === 'area') { gz.setMode('item'); }
};

/* ======================= BLUR AREA ======================= */
more.blurArea = {
  title: 'Blur area', needs: ['blur'],
  onOpen(it, o) { if (o.track) setTimeout(() => followArea(it), 50); },
  body(it) {
    const st = ['blur', 'mosaic', 'solid', 'frosted'];
    return [
      note('Drag the box on the preview to place it; pull the side handles to change its shape. Use Follow motion to make it move with something in the video.', '', 'blurArea'),
      seg([[0, 'Blur'], [1, 'Mosaic'], [3, 'Frosted'], [2, 'Solid']], it.style ?? 0, v => { it.style = v; done(); refresh(); }, 'Cover'),
      space(),
      it.style === 2 ? colors(it.color, c => { if (c) { it.color = c; done(); } }, { label: 'Colour' }) : slider({ label: 'Strength', min: 0.3, max: 1, step: 0.01, value: it.strength ?? 0.85, fmt: pct, onInput: v => { it.strength = v; it.blocks = Math.round(4 + (1 - v) * 14); live(); }, onChange: () => done() }),
      slider({ label: 'Edge fade', min: 0, max: 1.5, step: 0.01, value: it.feather ?? 0.35, fmt: v => v < 0.03 ? 'Sharp' : Math.round(v / 1.5 * 100) + '%', onInput: v => { it.feather = v; live(); }, onChange: () => done() }),
      seg([[0, 'Oval'], [1, 'Rounded'], [2, 'Box']], it.shapeN ?? 1, v => { it.shapeN = v; done(); }, 'Shape'),
      space(),
      toggleRow('Blur everything except this area', !!it.invert, v => { it.invert = v; done(); }),
      h('button.btn.block', { on: { click: () => followArea(it) } }, ico('target', 's'), 'Follow motion'),
      it.kf?.x?.length ? h('button.btn.sm.ghost', { style: { marginTop: '8px' }, on: { click: () => { delete it.kf.x; delete it.kf.y; delete it.kf.s; done(); toast('Movement removed'); } } }, 'Remove movement') : null,
    ];
  },
};
async function followArea(it) {
  const p = S.p, t = now();
  if (t < it.start || t >= it.start + it.dur) { S.player.seek(it.start); }
  const t0 = S.player.t;
  // the video under the area
  const vids = p.items.filter(v => v.kind === 'video' && t0 >= v.start && t0 < v.start + v.dur).sort((a, b) => (b.track === 'main' ? -1 : b.layer) - (a.track === 'main' ? -1 : a.layer));
  const v = vids[0]; if (!v) return toast('There is no video under the blur area');
  const W = p.w, H = p.h, r = itemRect(p, v, t0 - v.start, W, H), lt = t0 - it.start;
  const cx = W / 2 + kfVal(it, 'x', lt) * W, cy = H / 2 + kfVal(it, 'y', lt) * H, s = kfVal(it, 's', lt);
  const bw = (it.bw || 0.3) * W * s, bh = (it.bh || 0.2) * H * s;
  const toSrc = (x, y) => { const a = -r.rot * Math.PI / 180, dx = x - r.cx, dy = y - r.cy; let lx = (dx * Math.cos(a) - dy * Math.sin(a)) / r.w + 0.5, ly = (dx * Math.sin(a) + dy * Math.cos(a)) / r.h + 0.5; if (v.flipH) lx = 1 - lx; if (v.flipV) ly = 1 - ly; const c = v.crop || [0, 0, 1, 1]; return [c[0] + lx * c[2], c[1] + ly * c[3]]; };
  const [u0, v0] = toSrc(cx - bw / 2, cy - bh / 2), [u1, v1] = toSrc(cx + bw / 2, cy + bh / 2);
  const box = { x: Math.min(u0, u1), y: Math.min(v0, v1), w: Math.abs(u1 - u0), h: Math.abs(v1 - v0) };
  const m = p.media[v.mid];
  const a0 = Math.max(it.start, v.start), a1 = Math.min(it.start + it.dur, v.start + v.dur);
  const b = busy('Following motion');
  try {
    const sTrack = await trackRegion(v.mid, srcTime(v, t0 - v.start), box, srcTime(v, a0 - v.start), Math.min(m.dur, srcTime(v, a1 - v.start - 0.001)), f => b.set(f, 'Following… ' + Math.round(f * 100) + '%'), b.signal);
    const fromSrc = (u, w) => { const c = v.crop || [0, 0, 1, 1]; let lx = (u - c[0]) / c[2], ly = (w - c[1]) / c[3]; if (v.flipH) lx = 1 - lx; if (v.flipV) ly = 1 - ly; const dx = (lx - 0.5) * r.w, dy = (ly - 0.5) * r.h, a = r.rot * Math.PI / 180; return [r.cx + dx * Math.cos(a) - dy * Math.sin(a), r.cy + dx * Math.sin(a) + dy * Math.cos(a)]; };
    // timeline time for each tracked source time (assumes steady speed)
    const sp = v.speed || 1, kx = [], ky = [];
    for (const q of sTrack) {
      const tl = v.start + (q.t - v.in) / sp, l = tl - it.start;
      if (l < -0.01 || l > it.dur + 0.01) continue;
      const [px, py] = fromSrc(q.x + q.w / 2, q.y + q.h / 2);
      kx.push({ t: clamp(l, 0, it.dur), v: (px - W / 2) / W, e: 'linear' }); ky.push({ t: clamp(l, 0, it.dur), v: (py - H / 2) / H, e: 'linear' });
    }
    it.kf ||= {}; it.kf.x = kx; it.kf.y = ky;
    done(); toast('The area now follows the movement');
  } catch (e) { if (e.name !== 'AbortError') toast('Could not follow: ' + e.message); }
  finally { b.close(); refresh(); }
}

/* ======================= CUTOUT ======================= */
more.cutout = {
  title: 'Cutout', needs: ['video'],
  onOpen(it) { faces.getCutout(it.mid).then(() => refresh()); },
  body(it) {
    const c = it.cutout || { on: false, invert: false };
    const has = faces.getCutout && !!(faces.cutoutAt(it.mid, 0));
    return [
      note('Removes the background behind people, so another clip or colour shows through. Put this clip on an overlay track above a background clip.', '', 'cutout'),
      toggleRow('Remove background', !!c.on && has, async v => {
        if (v && !has) {
          const m = S.p.media[it.mid], b = busy('Finding people');
          try { await faces.analyseCutout(it.mid, m, { from: Math.max(0, it.in - 0.3), to: Math.min(m.dur, it.in + srcLen(it) + 0.3), rate: 12 }, (f, t) => b.set(f, t), b.signal); }
          catch (e) { b.close(); if (e.name !== 'AbortError') toast('Could not cut out: ' + e.message); refresh(); return; }
          b.close();
        }
        it.cutout = { ...c, on: v }; done(); refresh();
      }),
      toggleRow('Keep the background, remove the people', !!c.invert, v => { it.cutout = { ...c, invert: v }; done(); }),
    ];
  },
};

/* ======================= STABILISE ======================= */
more.stab = {
  title: 'Stabilise', needs: ['video'],
  onOpen(it) { getShake(it.mid).then(() => refresh()); },
  body(it) {
    const st = it.stab || { on: false, strength: 0.6 };
    return [
      note('Smooths out shaky hand-held footage. The picture is zoomed in slightly to hide the moving edges.', '', 'stab'),
      toggleRow('Stabilise this clip', !!st.on, async v => {
        if (v && !(await getShake(it.mid))) {
          const b = busy('Measuring shake');
          try { await analyseShake(it.mid, S.p.media[it.mid], (f, t) => b.set(f, t), b.signal); }
          catch (e) { b.close(); if (e.name !== 'AbortError') toast('Could not stabilise: ' + e.message); return; }
          b.close();
        }
        it.stab = { ...st, on: v }; done(); refresh();
      }),
      slider({ label: 'Smoothness', min: 0.1, max: 1, step: 0.05, value: st.strength, fmt: pct, onInput: v => { it.stab = { ...st, strength: v }; st.strength = v; live(); }, onChange: () => done() }),
    ];
  },
};

/* ======================= CAPTIONS ======================= */
const capCfg = { lang: 'auto', quality: 'good', maxWords: 5, pos: 'low', look: 'pop', replace: true, translate: false };
more.captions = {
  title: 'Captions', tall: true, tabs: () => [['auto', 'Automatic'], ['style', 'Style'], ['files', 'Subtitle files']],
  onOpen() { loadFontCss(); },
  body(it, tab) {
    const caps = S.p.items.filter(i => i.caption);
    if (tab === 'auto') return [
      note('Listens to the sound of your video and writes timed captions, word by word. The speech program is downloaded once (about 80–250 MB) and then runs on this device.', '', 'captions'),
      field('Spoken language', h('select.inp', { on: { change: e => { capCfg.lang = e.target.value; } } }, cap.LANGS.map(([c, n]) => h('option', { value: c, selected: c === capCfg.lang }, n)))),
      seg([['fast', 'Fast'], ['good', 'Good'], ['best', 'Best']], capCfg.quality, v => { capCfg.quality = v; }, 'Accuracy'),
      space(),
      slider({ label: 'Words per caption', min: 1, max: 10, step: 1, value: capCfg.maxWords, fmt: v => v === 1 ? 'One word' : v, onInput: v => { capCfg.maxWords = v; } }),
      seg([['high', 'Top'], ['mid', 'Middle'], ['low', 'Bottom']], capCfg.pos, v => { capCfg.pos = v; }, 'Position'),
      space(),
      toggleRow('Write them in English', capCfg.translate, v => { capCfg.translate = v; }, 'Translates speech in other languages'),
      caps.length ? toggleRow('Replace the captions already there', capCfg.replace, v => { capCfg.replace = v; }) : null,
      h('button.btn.primary.big.block', { on: { click: () => runCaptions() } }, ico('captions', 's'), 'Write captions'),
    ];
    if (tab === 'style') return [
      caps.length ? null : note('Write captions first, then choose how they look here.'),
      h('div.tiles.wide', {}, CAPTION_STYLES.map(cs => tile(cs.name, capCfg.look === cs.id, () => {
        capCfg.look = cs.id;
        for (const c of caps) { for (const k of ['stroke', 'shadow', 'glow', 'bg', 'bgLines']) c[k] = k === 'bg' ? null : 0; Object.assign(c, deep(cs.s)); c.hl = cs.hl ? deep(cs.hl) : null; }
        done(); refresh();
      }, h('div', { style: { fontWeight: 900, fontSize: '15px', color: cs.s.color, background: cs.s.bg || 'none', padding: '2px 6px', borderRadius: '5px' } }, 'Say ', h('span', { style: { color: cs.hl?.color || cs.s.color, background: cs.hl?.bg || 'none', borderRadius: '4px', padding: '0 3px' } }, 'this'))))),
      space(14),
      caps.length ? slider({ label: 'Size', min: 24, max: 160, step: 1, value: caps[0].size, fmt: v => Math.round(v), onInput: v => { caps.forEach(c => { c.size = v; }); live(); }, onChange: () => done() }) : null,
      caps.length ? slider({ label: 'Height on screen', min: -0.45, max: 0.45, step: 0.005, value: caps[0].tf.y, fmt: v => Math.round((v + 0.5) * 100) + '%', onInput: v => { caps.forEach(c => { c.tf.y = v; }); live(); }, onChange: () => done() }) : null,
      caps.length ? field('Font', h('div.fgrid', {}, FONTS.filter(f => ['sans', 'display', 'arabic'].includes(f[1])).slice(0, 40).map(([f]) => h('button.fopt' + (caps[0].font === f ? '.on' : ''), { style: { fontFamily: fontStack(f), fontWeight: 700 }, on: { click: () => { caps.forEach(c => { c.font = f; }); document.fonts.load(`700 40px "${f}"`).then(() => S.player.invalidate()); done(); refresh(); } } }, 'Aa', h('i', {}, f))))) : null,
      caps.length ? h('button.btn.danger.block', { style: { marginTop: '12px' }, on: { click: async () => { if (await confirmBox('Delete all captions?', '', 'Delete', true)) { S.p.items = S.p.items.filter(i => !i.caption); select(null); done(); refresh(); } } } }, ico('trash', 's'), 'Delete all captions') : null,
    ];
    return [
      h('button.btn.block', { on: { click: async () => {
        const [f] = await pickFiles('.srt,.vtt,text/vtt,application/x-subrip', false); if (!f) return;
        const lines = cap.parseSubs(await f.text()); if (!lines.length) return toast('No subtitles found in that file');
        const look = CAPTION_STYLES.find(c => c.id === capCfg.look);
        A.addCaptionItems(lines, { ...look, hl: null }, { replace: capCfg.replace, y: posY() }); toast(lines.length + ' subtitles added'); refresh();
      } } }, ico('import', 's'), 'Import subtitles (.srt, .vtt)'),
      space(10),
      h('button.btn.block', { disabled: !caps.length, on: { click: () => {
        const lines = caps.sort((a, b) => a.start - b.start).map(c => ({ s: c.start, e: c.start + c.dur, text: c.text }));
        downloadBlob(new Blob([cap.toSrt(lines)], { type: 'application/x-subrip' }), (S.p.name || 'captions') + '.srt');
      } } }, ico('save', 's'), 'Save subtitles (.srt)'),
    ];
  },
};
const posY = () => capCfg.pos === 'high' ? -0.3 : capCfg.pos === 'mid' ? 0 : 0.3;
async function runCaptions() {
  const p = S.p, d = duration(p);
  if (!d) return toast('Add a video first');
  const b = busy('Writing captions');
  try {
    b.set(null, 'Preparing the sound…');
    const buf = await mixdown(p, 0, d, 16000);
    const lines = await cap.transcribe(buf, capCfg, (t, f) => b.set(f, t), b.signal);
    if (!lines.length) { toast('No speech was heard'); return; }
    const look = CAPTION_STYLES.find(c => c.id === capCfg.look);
    A.addCaptionItems(lines, look, { replace: capCfg.replace, y: posY() });
    toast(lines.length + ' captions written'); refresh();
  } catch (e) { if (e.name !== 'AbortError') toast(e.message || 'Captions failed', 5000); }
  finally { b.close(); }
}

/* ======================= VOICEOVER ======================= */
let rec = null;
more.record = {
  title: 'Voiceover',
  body() {
    const btn = h('button', { style: { width: '84px', height: '84px', borderRadius: '50%', border: '4px solid var(--text)', display: 'grid', placeItems: 'center', margin: '8px auto 12px' } },
      h('i', { style: { width: rec ? '30px' : '62px', height: rec ? '30px' : '62px', borderRadius: rec ? '8px' : '50%', background: 'var(--danger)', display: 'block', transition: 'all .15s' } }));
    btn.onclick = () => rec ? stopRec() : startRec();
    return [
      h('div', { style: { textAlign: 'center', color: 'var(--text2)', fontSize: '13px' } }, rec ? 'Recording… tap to stop' : 'Recording starts at the playhead and plays the video along.'),
      btn,
      toggleRow('Mute the video while recording', more._muteRec !== false, v => { more._muteRec = v; }, 'Avoids the video sound being recorded again'),
      toggleRow('Count down 3 seconds', !!more._count, v => { more._count = v; }),
    ];
  },
  onClose() { if (rec) stopRec(); },
};
async function startRec() {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { return toast('Microphone not available: ' + e.message); }
  if (more._count) for (let i = 3; i > 0; i--) { toast(String(i), 900); await sleep(1000); }
  const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(m => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
  const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = [];
  r.ondataavailable = e => e.data.size && chunks.push(e.data);
  const at = now();
  rec = { r, stream, at, chunks, mime };
  r.start(250);
  S.player.play({ skip: more._muteRec !== false ? () => true : null });
  refresh();
}
async function stopRec() {
  const R = rec; rec = null; if (!R) return;
  S.player.pause();
  await new Promise(res => { R.r.onstop = res; R.r.stop(); });
  R.stream.getTracks().forEach(t => t.stop());
  const blob = new Blob(R.chunks, { type: (R.mime || 'audio/webm').split(';')[0] });
  const m = await addBlob(S.p, blob, 'voiceover-' + new Date().toISOString().slice(11, 19).replace(/:/g, '') + (blob.type.includes('mp4') ? '.m4a' : '.webm'), 'audio');
  if (!m || !m.dur) { toast('The recording could not be read'); refresh(); return; }
  const it = Object.assign(baseItem('audio'), { mid: m.id, start: R.at, dur: m.dur, sub: 'voice', name: 'Voiceover' });
  it.layer = freeLayer(S.p, it.start, it.dur, 'audio');
  S.p.items.push(it); done({ audio: true }); select(it.id); toast('Voiceover added');
}

/* ======================= CANVAS ======================= */
more.canvas = {
  title: 'Canvas', tabs: () => [['ratio', 'Size'], ['bg', 'Background']],
  body(it, tab) {
    const p = S.p;
    if (tab === 'ratio') return h('div.tiles', {}, RATIOS_LIST.map(([id, name, w, hh]) => tile(name, p.ratio === id, () => { A.setRatio(id); refresh(); },
      h('div', { style: { width: w ? (w > hh ? 34 : 34 * w / hh) + 'px' : '30px', height: w ? (hh > w ? 34 : 34 * hh / w) + 'px' : '30px', border: '2px solid currentColor', borderRadius: '4px', margin: '4px 0' } }))));
    const bg = p.bg || { type: 'blur', color: '#000000', blur: 0.6 };
    return [
      note('The background shows where a clip does not fill the frame.'),
      seg([['blur', 'Blurred clip'], ['color', 'Colour']], bg.type, v => { p.bg = { ...bg, type: v }; done(); refresh(); }),
      space(),
      bg.type === 'blur' ? slider({ label: 'Blur', min: 0, max: 1, step: 0.01, value: bg.blur ?? 0.6, fmt: pct, onInput: v => { p.bg = { ...bg, blur: v }; bg.blur = v; live(); }, onChange: () => done() })
        : colors(bg.color, c => { if (c) { p.bg = { ...bg, color: c }; done(); } }, { label: 'Colour' }),
    ];
  },
};

/* ======================= EXPORT ======================= */
const ex = { res: 1080, fps: 30, q: 'rec' };
more.export = {
  title: 'Export', tall: true,
  body() {
    const p = S.p, d = duration(p);
    const short = Math.min(p.w, p.h), scale = r => r / short;
    const dims = r => { const k = scale(r); return [Math.round(p.w * k / 2) * 2, Math.round(p.h * k / 2) * 2]; };
    const br = () => { const [w, hh] = dims(ex.res); const px = w * hh * ex.fps; return Math.round(px * ({ low: 0.06, rec: 0.1, high: 0.18 }[ex.q])); };
    const est = h('div', { style: { color: 'var(--muted)', fontSize: '12.5px', margin: '4px 0 14px' } });
    const upd = () => { const [w, hh] = dims(ex.res); est.textContent = `${w}×${hh} · ${ex.fps} fps · about ${fmtBytes(br() / 8 * d + 192000 / 8 * d)} · ${fmtDur(d)}`; };
    upd();
    const anyFaces = p.items.some(i => i.faces?.on), missing = p.items.filter(i => i.faces?.on && !faces.dataNow(i.mid));
    return [
      seg([[720, '720p'], [1080, '1080p'], [1440, '2K'], [2160, '4K']], ex.res, v => { ex.res = v; upd(); }, 'Resolution'),
      space(),
      seg([[24, '24'], [25, '25'], [30, '30'], [50, '50'], [60, '60']], ex.fps, v => { ex.fps = v; upd(); }, 'Frames per second'),
      space(),
      seg([['low', 'Smaller'], ['rec', 'Recommended'], ['high', 'Higher']], ex.q, v => { ex.q = v; upd(); }, 'Quality'),
      est,
      anyFaces ? note(missing.length ? 'Some clips with face blur were not analysed yet — open Face blur on them first.' : 'Face blur is applied to every frame of the saved video.', missing.length ? 'warn' : '', 'shield') : null,
      !canWebCodecs() ? note('This browser will record the video while it plays once in real time.', 'warn') : null,
      h('button.btn.primary.big.block', { disabled: !d, on: { click: () => runExport(dims(ex.res), br()) } }, ico('save', 's'), 'Export video'),
      space(16),
      h('div.cat', {}, 'Other'),
      h('div.two', {},
        h('button.btn', { on: { click: saveFrame } }, ico('frame', 's'), 'Save this frame'),
        h('button.btn', { disabled: !d, on: { click: saveSound } }, ico('sound', 's'), 'Save sound (.wav)')),
    ];
  },
};
async function runExport([w, hh], bitrate) {
  const p = S.p; S.player.pause();
  const b = busy('Exporting');
  b.set(0, 'Getting ready…');
  try {
    const blob = await exportVideo(p, { w, h: hh, fps: ex.fps, bitrate }, (f, t) => b.set(f, t), b.signal);
    b.close();
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm', name = (p.name || 'video').replace(/[^\w\- ]+/g, '').trim() + '.' + ext;
    const url = URL.createObjectURL(blob);
    const bg = h('div.modal-bg', {}, h('div.modal', {},
      h('h3', {}, 'Your video is ready'),
      h('p', {}, `${fmtBytes(blob.size)} · ${name}`),
      h('video', { src: url, controls: true, playsInline: true, style: { width: '100%', maxHeight: '40vh', borderRadius: '10px', background: '#000', marginBottom: '12px' } }),
      h('div.acts', {}, h('button.btn.ghost', { on: { click: () => { bg.remove(); URL.revokeObjectURL(url); } } }, 'Close'),
        h('button.btn.primary', { on: { click: () => shareOrSave(blob, name) } }, ico('share', 's'), 'Save / share'))));
    document.body.append(bg);
  } catch (e) {
    b.close();
    if (e.name !== 'AbortError') { console.error(e); toast('Export failed: ' + (e.message || e), 5000); }
  }
}
async function saveFrame() {
  const c = S.player.snapshot(true);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  shareOrSave(blob, (S.p.name || 'frame') + '-' + fmtTime(now(), false).replace(':', '-') + '.png');
}
async function saveSound() {
  const b = busy('Mixing sound');
  try { const buf = await mixdown(S.p, 0, duration(S.p), 48000, f => b.set(f)); shareOrSave(wavBlob(buf), (S.p.name || 'sound') + '.wav'); }
  catch (e) { toast('Could not save sound: ' + e.message); } finally { b.close(); }
}

/* ======================= MORE (project) ======================= */
more.project = {
  title: 'Project',
  body() {
    const p = S.p;
    return [
      h('button.btn.block', { on: { click: async () => { const n = await promptBox('Project name', p.name); if (n != null) { p.name = n.trim() || 'Untitled'; done(); document.querySelector('.top .name').textContent = p.name; } } } }, ico('edit', 's'), 'Rename'),
      space(10),
      seg([[24, '24'], [25, '25'], [30, '30'], [60, '60']], p.fps || 30, v => { p.fps = v; done(); }, 'Project frame rate (for frame steps)'),
      space(14),
      field('Markers', h('div.two', {},
        h('button.btn', { on: { click: () => { p.markers ||= []; p.markers.push(now()); done(); toast('Marker added (key M)'); } } }, ico('marker', 's'), 'Add at playhead'),
        h('button.btn', { disabled: !p.markers?.length, on: { click: () => { p.markers = []; done(); refresh(); } } }, 'Clear markers'))),
      note('Keyboard: Space play · S split · ←/→ one frame · Delete remove · Ctrl+Z undo · M marker · +/− zoom timeline'),
    ];
  },
};

/* ======================= CAMERA ======================= */
more.__camera = async () => {
  let facing = 'user', stream = null, mr = null, chunks = [], t0 = 0, timer = 0, tele = '', tick = null;
  const vid = h('video', { playsInline: true, muted: true, autoplay: true });
  const time = h('div.ctime.hide'), count = h('div.count.hide'), teleEl = h('div.tele.hide');
  const shoot = h('button.shoot', {}, h('i'));
  const timerBtn = h('button.btn.sm', {}, 'Timer off');
  const box = h('div.cam', {}, vid, teleEl, time, count,
    h('div.ctop', {}, h('button.ibtn', { html: icon('close'), on: { click: () => quit() } }), h('div.row', {},
      h('button.btn.sm', { on: { click: async () => { const t = await promptBox('Teleprompter text', tele, 'Show'); if (t != null) { tele = t; teleEl.textContent = t; teleEl.classList.toggle('hide', !t); } } } }, 'Teleprompter'), timerBtn)),
    h('div.bar', {}, h('div', { style: { width: '60px' } }), shoot, h('button.ibtn', { html: icon('replace'), title: 'Switch camera', on: { click: () => { facing = facing === 'user' ? 'environment' : 'user'; start(); } } })));
  document.body.append(box);
  timerBtn.onclick = () => { timer = timer === 0 ? 3 : timer === 3 ? 10 : 0; timerBtn.textContent = timer ? `Timer ${timer}s` : 'Timer off'; };
  async function start() {
    stream?.getTracks().forEach(t => t.stop());
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true }); vid.srcObject = stream; vid.style.transform = facing === 'user' ? 'scaleX(-1)' : ''; }
    catch (e) { toast('Camera not available: ' + e.message); quit(); }
  }
  function quit() { clearInterval(tick); if (mr?.state === 'recording') mr.stop(); stream?.getTracks().forEach(t => t.stop()); box.remove(); }
  shoot.onclick = async () => {
    if (mr?.state === 'recording') { mr.stop(); return; }
    if (timer) { count.classList.remove('hide'); for (let i = timer; i > 0; i--) { count.textContent = i; await sleep(1000); } count.classList.add('hide'); }
    const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find(m => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
    chunks = []; mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : undefined);
    mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    mr.onstop = async () => {
      clearInterval(tick); shoot.classList.remove('rec'); time.classList.add('hide');
      const blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
      quit();
      const f = new File([blob], 'camera-' + Date.now() + (blob.type.includes('mp4') ? '.mp4' : '.webm'), { type: blob.type });
      await A.addFiles([f], 'main');
    };
    mr.start(500); t0 = Date.now(); shoot.classList.add('rec'); time.classList.remove('hide');
    tick = setInterval(() => { time.textContent = fmtTime((Date.now() - t0) / 1000, false); if (tele) teleEl.scrollTop += 0.6; }, 50);
  };
  start();
};
