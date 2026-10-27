// Bottom sheets for every tool.
import { S, bus, commit, select, sel, now } from './state.js';
import { h, ico, slider, seg, colors, toggle, toggleRow, note, toast, busy, confirmBox, promptBox } from './widgets.js';
import { icon } from './icons.js';
import * as A from './actions.js';
import { FILTERS, ADJUST, EFFECTS, TRANSITIONS, ANIM_IN, ANIM_OUT, ANIM_LOOP, BLENDS, MASKS, SHAPES, FONTS, FONT_CATS, TEXT_STYLES, CAPTION_STYLES, effectById, filterById } from '../defs.js';
import { mainItems, setSpeed, srcLen, kfVal, setProp, srcTime, DEF_ADJ, curveMean, duration, layoutMain } from '../model.js';
import { shapeIcon, fontStack } from '../draw2d.js';
import { SFX, sfxBuffer, sfxById } from '../sfx.js';
import { audioCtx, decodeAudio, addBlob, grabFrame } from '../media.js';
import { VOICES, normalizeGain, mixdown, wavBlob } from '../audio.js';
import * as faces from '../faces.js';
import { trackRegion, analyseShake, getShake } from '../track.js';
import { clamp, deep, uid, fmtDur, fmtTime, shareOrSave, pickFiles, downloadBlob, fmtBytes, hexToRgb, rgbToHex } from '../util.js';
import { more } from './panels2.js';

let C = null, cur = null;
export function init(c) { C = c; cur = null; }

const live = () => commit({ live: true });
const done = (o) => commit(o || {});
const L = it => clamp(now() - it.start, 0, it.dur);

export function open(name, opts = {}) {
  const def = SHEETS[name] || more[name];
  if (!def) return console.warn('no sheet', name);
  const it = sel();
  if (def.needs && (!it || !def.needs.includes(it.kind))) { toast('Select a clip first'); return; }
  if (cur) close(true);
  const el = h('div.sheet' + (def.tall ? '.tall' : ''));
  cur = { name, def, opts, el, tab: opts.tab || def.tabs?.(it, opts)?.[0]?.[0] };
  C.stage.parentElement.append(el);
  render();
  if (def.gizmo) C.gizmo.setMode(def.gizmo);
  def.onOpen?.(it, opts);
}
export function close(immediate) {
  if (!cur) return;
  const c = cur; cur = null;
  c.def.onClose?.();
  C.gizmo?.setMode('item');
  if (immediate) c.el.remove();
  else { c.el.classList.add('closing'); setTimeout(() => c.el.remove(), 200); }
}
export function refresh() { if (cur) render(); }
function render() {
  const { def, el, opts } = cur, it = sel();
  const sb = el.querySelector('.sh-body'), keep = sb?.scrollTop || 0;
  el.innerHTML = '';
  const title = typeof def.title === 'function' ? def.title(it, opts) : def.title;
  el.append(h('div.sh-head', {}, h('h2', {}, title), h('button.ibtn', { title: 'Done', html: icon('check'), on: { click: () => close() } })));
  const tabs = def.tabs?.(it, opts);
  if (tabs?.length) el.append(h('div.sh-tabs', {}, tabs.map(([id, l]) => h('button' + (cur.tab === id ? '.on' : ''), { on: { click: () => { cur.tab = id; render(); } } }, l))));
  const body = h('div.sh-body');
  try { body.append(...[def.body(it, cur.tab, opts)].flat().filter(Boolean)); } catch (e) { console.error(e); body.append(note('Something went wrong: ' + e.message, 'err')); }
  el.append(body);
  if (keep) body.scrollTop = keep;
}
bus.on('select', () => {
  if (!cur) return;
  const it = sel();
  if (cur.def.needs && (!it || !cur.def.needs.includes(it.kind))) close();
  else render();
});
bus.on('change', o => { if (cur && o?.undo) render(); });

const tile = (label, on, fn, extra) => h('button.tile' + (on ? '.on' : ''), { on: { click: fn } }, extra, h('span', {}, label));
const field = (label, ...kids) => h('div.field', {}, label ? h('div.lbl', {}, label) : null, ...kids);
const pct = v => Math.round(v * 100) + '%';
const sgn = v => (v > 0 ? '+' : '') + Math.round(v * 100);

/* ======================================================================= */
const SHEETS = {};

/* ---------- speed ---------- */
const CURVES = {
  montage: [{ p: 0, v: 1 }, { p: 0.3, v: 1 }, { p: 0.45, v: 3 }, { p: 0.55, v: 0.3 }, { p: 0.7, v: 1 }, { p: 1, v: 1 }],
  hero: [{ p: 0, v: 1.5 }, { p: 0.35, v: 1.5 }, { p: 0.5, v: 0.25 }, { p: 0.65, v: 1.5 }, { p: 1, v: 1.5 }],
  bullet: [{ p: 0, v: 2 }, { p: 0.4, v: 0.2 }, { p: 0.6, v: 0.2 }, { p: 1, v: 2 }],
  jump: [{ p: 0, v: 1 }, { p: 0.45, v: 1 }, { p: 0.5, v: 5 }, { p: 0.55, v: 1 }, { p: 1, v: 1 }],
  flashin: [{ p: 0, v: 5 }, { p: 0.4, v: 1 }, { p: 1, v: 1 }],
  flashout: [{ p: 0, v: 1 }, { p: 0.6, v: 1 }, { p: 1, v: 5 }],
  ease: [{ p: 0, v: 0.4 }, { p: 0.5, v: 1.6 }, { p: 1, v: 0.4 }],
};
SHEETS.speed = {
  title: 'Speed', needs: ['video', 'audio'], tabs: () => [['normal', 'Normal'], ['curve', 'Curve']],
  body(it, tab) {
    if (tab === 'normal') {
      const toS = x => +Math.pow(10, x).toFixed(2), toX = s => Math.log10(s);
      const info = h('div', { style: { color: 'var(--muted)', fontSize: '12px', marginTop: '-4px', marginBottom: '12px' } });
      const upd = () => { info.textContent = `Length ${fmtDur(it.dur)} · source ${fmtDur(srcLen(it))}`; };
      upd();
      return [
        slider({ label: 'Speed', min: -1, max: 1, step: 0.005, value: toX(it.speed || 1), zero: 0, reset: 0, fmt: x => toS(x) + 'x',
          onInput: x => { setSpeed(it, toS(x), null); upd(); live(); }, onChange: () => done({ audio: true }) }),
        info,
        h('div.tiles', { style: { gridTemplateColumns: 'repeat(6,1fr)', marginBottom: '14px' } }, [0.25, 0.5, 1, 1.5, 2, 4].map(s => tile(s + 'x', Math.abs((it.speed || 1) - s) < 0.01 && !it.curve, () => { setSpeed(it, s, null); done({ audio: true }); refresh(); }))),
        toggleRow('Keep voice pitch', it.keepPitch !== false, v => { it.keepPitch = v; done({ audio: true }); }, 'Speeds up the sound without making voices high or deep'),
      ];
    }
    const names = [['none', 'None'], ['montage', 'Montage'], ['hero', 'Hero'], ['bullet', 'Bullet'], ['jump', 'Jump cut'], ['flashin', 'Flash in'], ['flashout', 'Flash out'], ['ease', 'Ease'], ['custom', 'Custom']];
    const curName = it.curve ? (Object.keys(CURVES).find(k => JSON.stringify(CURVES[k]) === JSON.stringify(it.curve)) || 'custom') : 'none';
    const cv = h('canvas.curve');
    const els = [h('div.tiles', {}, names.map(([k, l]) => tile(l, curName === k, () => {
      setSpeed(it, it.speed || 1, k === 'none' ? null : k === 'custom' ? deep(it.curve || [{ p: 0, v: 1 }, { p: 0.5, v: 1 }, { p: 1, v: 1 }]) : deep(CURVES[k]));
      done({ audio: true }); refresh();
    })))];
    if (it.curve) {
      els.push(field('Drag the points (up = faster). Double-tap to add or remove a point.', cv));
      requestAnimationFrame(() => curveEditor(cv, it));
    }
    return els;
  },
};
function curveEditor(cv, it) {
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  const vy = v => H - 10 - (Math.log2(v) + 3.3) / 6.6 * (H - 20), yv = y => Math.pow(2, (H - 10 - y) / (H - 20) * 6.6 - 3.3);
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#2c2e34'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, vy(1)); ctx.lineTo(W, vy(1)); ctx.stroke();
    ctx.strokeStyle = '#d4f75a'; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x <= W; x += 2) { const p = x / W, y = vy(clamp(curveVal(it.curve, p), 0.1, 10)); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    for (const q of it.curve) { ctx.fillStyle = '#ecebe4'; ctx.beginPath(); ctx.arc(q.p * W, vy(q.v), 6, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#74767b'; ctx.font = '10px ui-monospace'; ctx.fillText('10x', 4, 12); ctx.fillText('0.1x', 4, H - 4);
  };
  const curveVal = (c, p) => { for (let i = 1; i < c.length; i++) if (p <= c[i].p) { const a = c[i - 1], b = c[i], k = (p - a.p) / (b.p - a.p || 1); const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; return a.v + (b.v - a.v) * e; } return c[c.length - 1].v; };
  let drag = -1, last = 0;
  cv.onpointerdown = e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    drag = it.curve.findIndex(q => Math.hypot(q.p * W - x, vy(q.v) - y) < 16);
    const t = performance.now();
    if (t - last < 300) { // double tap
      if (drag > 0 && drag < it.curve.length - 1) it.curve.splice(drag, 1);
      else if (drag < 0) { it.curve.push({ p: clamp(x / W, 0.02, 0.98), v: clamp(yv(y), 0.1, 10) }); it.curve.sort((a, b) => a.p - b.p); }
      drag = -1; it.curve = [...it.curve]; setSpeed(it, it.speed || 1, it.curve); draw(); done({ audio: true }); last = 0; return;
    }
    last = t; if (drag >= 0) cv.setPointerCapture(e.pointerId);
  };
  cv.onpointermove = e => {
    if (drag < 0) return; const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, q = it.curve[drag];
    q.v = +clamp(yv(y), 0.1, 10).toFixed(2);
    if (drag > 0 && drag < it.curve.length - 1) q.p = clamp(x / W, it.curve[drag - 1].p + 0.02, it.curve[drag + 1].p - 0.02);
    it.curve = [...it.curve]; setSpeed(it, it.speed || 1, it.curve); draw(); live();
  };
  cv.onpointerup = () => { if (drag >= 0) { drag = -1; done({ audio: true }); } };
  draw();
}

/* ---------- volume ---------- */
SHEETS.volume = {
  title: 'Volume', needs: ['video', 'audio'],
  body(it) {
    const lt = L(it);
    const els = [
      slider({ label: 'Volume', min: 0, max: 4, step: 0.01, value: kfVal(it, 'vol', lt), zero: 1, reset: 1, fmt: v => Math.round(v * 100) + '%',
        onInput: v => { setProp(it, 'vol', v, lt); live(); }, onChange: () => done({ audio: true }) }),
      slider({ label: 'Fade in', min: 0, max: Math.min(10, it.dur / 2), step: 0.05, value: it.fadeIn || 0, fmt: v => v.toFixed(1) + 's', onInput: v => { it.fadeIn = v; live(); }, onChange: () => done({ audio: true }) }),
      slider({ label: 'Fade out', min: 0, max: Math.min(10, it.dur / 2), step: 0.05, value: it.fadeOut || 0, fmt: v => v.toFixed(1) + 's', onInput: v => { it.fadeOut = v; live(); }, onChange: () => done({ audio: true }) }),
      toggleRow('Mute this clip', !!it.mute, v => { it.mute = v; done({ audio: true }); }),
    ];
    if (it.track === 'main') els.push(toggleRow('Mute all main track sound', !!S.p.muteMain, v => { S.p.muteMain = v; done({ audio: true }); }, 'Like the speaker button at the start of the main track'));
    els.push(h('button.btn.sm', { on: { click: () => { it.volume = clamp(it.volume * normalizeGain(it, S.p), 0, 4); delete it.kf?.vol; done({ audio: true }); refresh(); toast('Level evened out'); } } }, ico('wave', 's'), 'Even out the level'));
    if (it.kf?.vol?.length) els.unshift(note('This clip has volume keyframes: the slider sets the level at the playhead.'));
    return els;
  },
};

/* ---------- animation ---------- */
SHEETS.anim = {
  title: 'Animation', needs: ['video', 'image', 'text', 'shape'], tabs: () => [['in', 'In'], ['out', 'Out'], ['loop', 'Loop']],
  body(it, tab) {
    it.anim ||= { in: null, out: null, loop: null };
    const list = (tab === 'in' ? ANIM_IN : tab === 'out' ? ANIM_OUT : ANIM_LOOP).filter(a => !a[2] || a[2] === it.kind);
    const curA = it.anim[tab];
    const els = [h('div.tiles', {}, tile('None', !curA, () => { it.anim[tab] = null; done(); refresh(); }),
      list.map(([id, name]) => tile(name, curA?.id === id, () => {
        it.anim[tab] = tab === 'loop' ? { id, speed: curA?.speed || 1 } : { id, dur: curA?.dur || Math.min(0.6, it.dur / 2) };
        done(); refresh(); previewRange(it, tab);
      }, h('div.sw', { style: { display: 'grid', placeItems: 'center', background: 'var(--bg4)' }, html: icon('anim') }))))];
    if (curA && tab !== 'loop') els.unshift(slider({ label: 'Duration', min: 0.1, max: Math.max(0.2, it.dur * (tab === 'in' ? 1 : 1)), step: 0.05, value: curA.dur, fmt: v => v.toFixed(1) + 's', onInput: v => { curA.dur = v; live(); }, onChange: () => { done(); previewRange(it, tab); } }));
    if (curA && tab === 'loop') els.unshift(slider({ label: 'Speed', min: 0.2, max: 4, step: 0.05, value: curA.speed || 1, zero: 1, fmt: v => v.toFixed(1) + 'x', onInput: v => { curA.speed = v; live(); }, onChange: () => done() }));
    return els;
  },
};
function previewRange(it, tab) {
  const a = it.anim[tab]; if (!a) return;
  const from = tab === 'out' ? it.start + it.dur - (a.dur || 1) - 0.2 : it.start, to = tab === 'in' ? it.start + (a.dur || 1) + 0.4 : tab === 'out' ? it.start + it.dur : it.start + Math.min(it.dur, 3);
  S.player.seek(Math.max(it.start, from)); S.player.play({ from: Math.max(it.start, from), to });
}

/* ---------- filters ---------- */
let thumbJob = 0;
SHEETS.filters = {
  title: 'Filters', tabs: () => [['all', 'All'], ...[...new Set(FILTERS.map(f => f.cat))].map(c => [c, c])],
  body(it, tab, opts) {
    const target = it && (it.kind === 'video' || it.kind === 'image' || it.kind === 'filter' || it.kind === 'text') ? it : null;
    const curF = target?.filter;
    const list = FILTERS.filter(f => tab === 'all' || f.cat === tab);
    const tiles = h('div.tiles');
    const pick = id => {
      let t = target;
      if (!t) { t = A.addFilterLayer(id); }
      else t.filter = id ? { id, amt: t.filter?.amt ?? 1 } : null;
      done(); refresh();
    };
    tiles.append(tile('None', !curF, () => pick(null), h('div.sw', { style: { background: 'var(--bg4)' } })));
    for (const f of list) tiles.append(tile(f.name, curF?.id === f.id, () => pick(f.id), h('div.sw', { 'data-f': f.id })));
    filterThumbs(tiles);
    const els = [];
    if (curF) els.push(slider({ label: 'Strength', min: 0, max: 1, step: 0.01, value: curF.amt ?? 1, fmt: pct, onInput: v => { curF.amt = v; live(); }, onChange: () => done() }));
    if (!target) els.push(note('Adds a filter on its own track over everything below it. Select a clip first to filter just that clip.'));
    els.push(tiles);
    return els;
  },
};
// small previews of each filter on the current frame
async function filterThumbs(root) {
  const job = ++thumbJob;
  await new Promise(r => setTimeout(r, 30));
  let src;
  try { src = S.player.snapshot(false); } catch (e) { return; }
  const k = 120 / Math.max(src.width, src.height), w = Math.round(src.width * k), hh = Math.round(src.height * k);
  const { GL } = await import('../gl.js');
  const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
  let gl; try { gl = new GL(cv); } catch (e) { return; }
  const small = document.createElement('canvas'); small.width = w; small.height = hh; small.getContext('2d').drawImage(src, 0, 0, w, hh);
  const tex = gl.source('s', small, w, hh, 1);
  const KEYS = Object.keys(DEF_ADJ);
  for (const el of root.querySelectorAll('[data-f]')) {
    if (job !== thumbJob) break;
    const f = filterById(el.dataset.f);
    const out = gl.color(tex, { adj: KEYS.map(k2 => f.adj?.[k2] || 0), sh: f.tone ? f.tone.sh.map(v => v / 255) : null, hi: f.tone ? f.tone.hi.map(v => v / 255) : null, tone: f.tone?.amt || 0, mono: f.mono ? 1 : 0 });
    gl.present(out); gl.endFrame();
    el.style.backgroundImage = `url(${cv.toDataURL('image/jpeg', 0.75)})`;
    await new Promise(r => setTimeout(r, 0));
  }
  gl.gl.getExtension('WEBGL_lose_context')?.loseContext();
}

/* ---------- adjust ---------- */
SHEETS.adjust = {
  title: 'Adjust', needs: ['video', 'image', 'filter', 'text', 'shape'],
  body(it) {
    it.adj ||= {};
    return [
      ...ADJUST.map(a => slider({ label: a.name, min: a.min ?? -1, max: 1, step: 0.01, value: it.adj[a.k] || 0, zero: 0, reset: 0, fmt: sgn,
        onInput: v => { it.adj[a.k] = v; live(); }, onChange: () => done() })),
      h('button.btn.sm', { on: { click: () => { it.adj = {}; done(); refresh(); } } }, 'Reset all'),
    ];
  },
};

/* ---------- effects ---------- */
SHEETS.effects = {
  title: (it, o) => o.layer && !(it && ['video', 'image', 'text', 'shape'].includes(it.kind) && !o.replace) ? 'Effects' : 'Clip effects',
  tabs: (it, o) => [...(it && it.fx?.length && !o.layer ? [['applied', 'Applied']] : []), ...[...new Set(EFFECTS.map(e => e.cat))].map(c => [c, c])],
  body(it, tab, o) {
    const clipMode = it && ['video', 'image', 'text', 'shape'].includes(it.kind) && !o.layer;
    const layerItem = it?.kind === 'effect' ? it : null;
    if (tab === 'applied' && clipMode) {
      return it.fx.map((e, i) => {
        const d = effectById(e.id);
        return h('div', { style: { borderBottom: '1px solid var(--line)', paddingBottom: '8px', marginBottom: '10px' } },
          h('div.row', {}, h('b.grow', {}, d.name), h('button.btn.sm.ghost.danger', { on: { click: () => { it.fx.splice(i, 1); done(); refresh(); } } }, 'Remove')),
          slider({ label: 'Strength', min: 0, max: 1, step: 0.01, value: e.a ?? d.a, fmt: pct, onInput: v => { e.a = v; live(); }, onChange: () => done() }),
          d.sp ? slider({ label: 'Speed', min: 0.1, max: 4, step: 0.05, value: e.b ?? d.sp, zero: 1, fmt: v => v.toFixed(1) + 'x', onInput: v => { e.b = v; live(); }, onChange: () => done() }) : null);
      });
    }
    const els = [];
    if (layerItem) {
      const d = effectById(layerItem.fxId);
      els.push(slider({ label: d.name + ' · strength', min: 0, max: 1, step: 0.01, value: layerItem.a ?? d.a, fmt: pct, onInput: v => { layerItem.a = v; live(); }, onChange: () => done() }));
      if (d.sp) els.push(slider({ label: 'Speed', min: 0.1, max: 4, step: 0.05, value: layerItem.b ?? d.sp, zero: 1, fmt: v => v.toFixed(1) + 'x', onInput: v => { layerItem.b = v; live(); }, onChange: () => done() }));
    }
    const list = EFFECTS.filter(e => e.cat === tab);
    els.push(h('div.tiles', {}, list.map(e => {
      const on = clipMode ? it.fx?.some(f => f.id === e.id) : layerItem?.fxId === e.id;
      return tile(e.name, on, () => {
        if (clipMode) { it.fx ||= []; const i = it.fx.findIndex(f => f.id === e.id); i >= 0 ? it.fx.splice(i, 1) : it.fx.push({ id: e.id, a: e.a, b: e.sp }); done(); refresh(); }
        else if (layerItem) { layerItem.fxId = e.id; layerItem.a = e.a; layerItem.b = e.sp ?? 1; layerItem.name = e.name; done(); refresh(); }
        else { A.addEffectLayer(e.id); refresh(); }
        S.player.play({ from: now(), to: Math.min(duration(S.p), now() + 2) });
      }, h('div.sw', { style: { display: 'grid', placeItems: 'center', background: 'var(--bg4)' }, html: icon('fx') }));
    })));
    if (!clipMode && !layerItem) els.unshift(note('Effects go on their own track and change everything under them. Select a clip and use Clip effects to change one clip only.'));
    return els;
  },
};

/* ---------- mask ---------- */
SHEETS.mask = {
  title: 'Mask', needs: ['video', 'image', 'text', 'shape'], gizmo: 'mask',
  body(it) {
    const m = it.mask;
    const els = [h('div.tiles', {}, MASKS.map(([id, name]) => tile(name, (m?.type || 'none') === id, () => {
      it.mask = id === 'none' ? null : { type: id, x: 0.5, y: 0.5, w: id === 'circle' ? 0.3 : 0.35, h: id === 'circle' ? 0.3 * (S.p.w / S.p.h) : 0.25, r: 0, feather: 0.1, invert: false, round: 0.15, ...(m && m.type !== 'none' ? { x: m.x, y: m.y, feather: m.feather, invert: m.invert } : {}) };
      if (id === 'mirror') it.mask.h = 0.15;
      done(); refresh(); C.gizmo.setMode('mask');
    }, h('div.sw', { style: { display: 'grid', placeItems: 'center', background: 'var(--bg4)' }, html: icon('mask') }))))];
    if (m) {
      els.unshift(
        note('Drag the dashed shape on the preview to move it; use the handles to size and turn it.'),
        slider({ label: 'Edge fade', min: 0, max: 1, step: 0.01, value: m.feather || 0, fmt: pct, onInput: v => { m.feather = v; live(); }, onChange: () => done() }),
        m.type === 'rect' ? slider({ label: 'Rounded corners', min: 0, max: 1, step: 0.01, value: m.round ?? 0.15, fmt: pct, onInput: v => { m.round = v; live(); }, onChange: () => done() }) : null,
        toggleRow('Invert', !!m.invert, v => { m.invert = v; done(); }),
      );
    }
    return els;
  },
};

/* ---------- crop ---------- */
SHEETS.crop = {
  title: 'Crop', needs: ['video', 'image'],
  body(it) {
    const m = S.p.media[it.mid];
    const c = it.crop || [0, 0, 1, 1];
    const set = (l, t, r, b) => { const w = Math.max(0.05, 1 - l - r), hh = Math.max(0.05, 1 - t - b); it.crop = l || t || r || b ? [l, t, w, hh] : null; live(); };
    let l = c[0], t = c[1], r = 1 - c[0] - c[2], b = 1 - c[1] - c[3];
    const preset = (rw, rh) => {
      const ar = (m.w / m.h), want = rw / rh;
      if (!rw) { it.crop = null; done(); refresh(); return; }
      let w = 1, hh = 1; if (want > ar) hh = ar / want; else w = want / ar;
      it.crop = [(1 - w) / 2, (1 - hh) / 2, w, hh]; done(); refresh();
    };
    return [
      h('div.tiles', { style: { marginBottom: '14px' } }, [['Free', 0, 0], ['1:1', 1, 1], ['9:16', 9, 16], ['16:9', 16, 9], ['4:5', 4, 5], ['4:3', 4, 3], ['3:4', 3, 4], ['21:9', 21, 9]].map(([n, rw, rh]) => tile(n, false, () => preset(rw, rh)))),
      slider({ label: 'Left', min: 0, max: 0.9, step: 0.005, value: l, fmt: pct, onInput: v => { l = v; set(l, t, r, b); }, onChange: () => done() }),
      slider({ label: 'Right', min: 0, max: 0.9, step: 0.005, value: r, fmt: pct, onInput: v => { r = v; set(l, t, r, b); }, onChange: () => done() }),
      slider({ label: 'Top', min: 0, max: 0.9, step: 0.005, value: t, fmt: pct, onInput: v => { t = v; set(l, t, r, b); }, onChange: () => done() }),
      slider({ label: 'Bottom', min: 0, max: 0.9, step: 0.005, value: b, fmt: pct, onInput: v => { b = v; set(l, t, r, b); }, onChange: () => done() }),
      h('button.btn.sm', { on: { click: () => { it.crop = null; done(); refresh(); } } }, 'Reset'),
    ];
  },
};

/* ---------- transform ---------- */
SHEETS.transform = {
  title: 'Transform', needs: ['video', 'image', 'text', 'shape'],
  body(it) {
    const lt = L(it);
    const els = [
      h('div.tiles', { style: { gridTemplateColumns: 'repeat(4,1fr)', marginBottom: '14px' } },
        tile('Flip', !!it.flipH, () => { it.flipH = !it.flipH; done(); refresh(); }, ico('flipH')),
        tile('Flip up', !!it.flipV, () => { it.flipV = !it.flipV; done(); refresh(); }, ico('flipV')),
        tile('Rotate', false, () => { setProp(it, 'r', (Math.round(kfVal(it, 'r', lt) / 90) * 90 + 90) % 360, lt); done(); refresh(); }, ico('rotate')),
        tile('Centre', false, () => { setProp(it, 'x', 0, lt); setProp(it, 'y', 0, lt); done(); refresh(); }, ico('target'))),
    ];
    if (it.track === 'main') els.push(seg([['fit', 'Fit', 'fit'], ['fill', 'Fill', 'fill']], it.fit || 'fit', v => { it.fit = v; done(); }, 'Size in frame'), h('div', { style: { height: '12px' } }));
    els.push(
      slider({ label: 'Scale', min: 0.05, max: 5, step: 0.01, value: kfVal(it, 's', lt), zero: 1, reset: 1, fmt: pct, onInput: v => { setProp(it, 's', v, lt); live(); }, onChange: () => done() }),
      slider({ label: 'Rotation', min: -180, max: 180, step: 0.5, value: kfVal(it, 'r', lt), zero: 0, reset: 0, fmt: v => Math.round(v) + '°', onInput: v => { setProp(it, 'r', v, lt); live(); }, onChange: () => done() }),
      slider({ label: 'Left / right', min: -1, max: 1, step: 0.002, value: kfVal(it, 'x', lt), zero: 0, reset: 0, fmt: sgn, onInput: v => { setProp(it, 'x', v, lt); live(); }, onChange: () => done() }),
      slider({ label: 'Up / down', min: -1, max: 1, step: 0.002, value: kfVal(it, 'y', lt), zero: 0, reset: 0, fmt: sgn, onInput: v => { setProp(it, 'y', v, lt); live(); }, onChange: () => done() }),
    );
    if (it.track === 'main') els.push(toggleRow('Show background around this clip', !it.bgOff, v => { it.bgOff = !v; done(); }));
    return els;
  },
};

/* ---------- opacity & blend ---------- */
SHEETS.opacity = {
  title: 'Opacity & blend', needs: ['video', 'image', 'text', 'shape'],
  body(it) {
    const lt = L(it);
    return [
      slider({ label: 'Opacity', min: 0, max: 1, step: 0.01, value: kfVal(it, 'o', lt), fmt: pct, onInput: v => { setProp(it, 'o', v, lt); live(); }, onChange: () => done() }),
      field('Blend', h('div.tiles', {}, BLENDS.map(([id, name]) => tile(name, (it.blend || 'normal') === id, () => { it.blend = id; done(); refresh(); })))),
    ];
  },
};

/* ---------- chroma key ---------- */
let picking = null;
SHEETS.chroma = {
  title: 'Chroma key', needs: ['video', 'image'],
  body(it) {
    const k = it.chroma || { on: false, color: '#00ff00', sim: 0.4, smooth: 0.2, spill: 0.5 };
    const set = () => { it.chroma = k; };
    return [
      toggleRow('Remove a colour', !!k.on, v => { k.on = v; set(); done(); refresh(); }, 'For green or blue screen'),
      field('Colour to remove', h('div.row', {},
        colors(k.color, c => { if (!c) return; k.color = c; k.on = true; set(); done(); }, {}),
        h('button.btn.sm', { on: { click: () => startPick(it) } }, ico('target', 's'), 'Pick'))),
      slider({ label: 'Strength', min: 0, max: 1, step: 0.01, value: k.sim, fmt: pct, onInput: v => { k.sim = v; set(); live(); }, onChange: () => done() }),
      slider({ label: 'Soft edge', min: 0, max: 1, step: 0.01, value: k.smooth, fmt: pct, onInput: v => { k.smooth = v; set(); live(); }, onChange: () => done() }),
      slider({ label: 'Remove colour spill', min: 0, max: 1, step: 0.01, value: k.spill, fmt: pct, onInput: v => { k.spill = v; set(); live(); }, onChange: () => done() }),
    ];
  },
};
function startPick(it) {
  toast('Tap the colour on the preview');
  const stage = C.stage;
  const handler = e => {
    e.stopPropagation(); e.preventDefault();
    stage.removeEventListener('pointerdown', handler, true);
    const snap = S.player.snapshot(false), r = S.player.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * snap.width), y = Math.floor((e.clientY - r.top) / r.height * snap.height);
    // the snapshot already has keying applied: read the untouched clip
    const k = it.chroma; const was = k?.on; if (k) k.on = false;
    const raw = S.player.snapshot(false); if (k) k.on = was;
    const d = raw.getContext('2d').getImageData(clamp(x, 0, raw.width - 1), clamp(y, 0, raw.height - 1), 1, 1).data;
    it.chroma = { ...(it.chroma || { sim: 0.4, smooth: 0.2, spill: 0.5 }), on: true, color: rgbToHex(d[0], d[1], d[2]) };
    done(); refresh();
  };
  stage.addEventListener('pointerdown', handler, true);
}

/* ---------- transitions ---------- */
SHEETS.transition = {
  title: 'Transition', needs: ['video', 'image'], tabs: () => [...new Set(TRANSITIONS.map(t => t.cat))].map(c => [c, c]),
  body(it, tab) {
    const main = mainItems(S.p), i = main.indexOf(it);
    if (it.track !== 'main' || i < 0 || !main[i + 1]) return note('Transitions go between two clips on the main track. Tap the small button between two clips.');
    const tr = it.trans;
    const max = Math.min(it.dur, main[i + 1].dur) * 0.5;
    const els = [h('div.tiles', {}, tile('None', !tr, () => { it.trans = null; done(); refresh(); }), TRANSITIONS.filter(t => t.cat === tab).map(t => tile(t.name, tr?.id === t.id, () => {
      it.trans = { id: t.id, dur: tr?.dur || Math.min(0.6, max) }; done(); refresh();
      const nx = main[i + 1]; S.player.play({ from: Math.max(0, nx.start - 0.6), to: nx.start + it.trans.dur + 0.5 });
    }, h('div.sw', { style: { display: 'grid', placeItems: 'center', background: 'var(--bg4)' }, html: icon('trans') }))))];
    if (tr) els.unshift(
      slider({ label: 'Duration', min: 0.1, max: Math.max(0.15, max), step: 0.05, value: tr.dur, fmt: v => v.toFixed(2) + 's', onInput: v => { tr.dur = v; live(); }, onChange: () => done({ audio: true }) }),
      h('button.btn.sm', { style: { marginBottom: '12px' }, on: { click: () => { main.forEach((c, j) => { if (main[j + 1]) c.trans = { ...tr }; }); done({ audio: true }); toast('Applied to all cuts'); } } }, 'Apply to all cuts'));
    return els;
  },
};

/* ---------- voice effects & clean-up ---------- */
SHEETS.voicefx = {
  title: 'Voice & sound', needs: ['video', 'audio'], tabs: () => [['voice', 'Voice effects'], ['clean', 'Clean up']],
  body(it, tab) {
    if (tab === 'clean') return [
      note('Reduce noise learns the steady background sound (hum, wind, air conditioning) from the quiet parts and removes it.'),
      slider({ label: 'Reduce noise', min: 0, max: 1, step: 0.05, value: it.denoise || 0, fmt: v => v ? pct(v) : 'Off', onInput: v => { it.denoise = v; }, onChange: () => { done({ audio: true }); toast('Processing sound…'); } }),
      toggleRow('Enhance voice', !!it.enhance, v => { it.enhance = v; done({ audio: true }); }, 'Removes rumble, adds clarity and evens out loud and quiet words'),
    ];
    return h('div.tiles', {}, VOICES.map(([id, name]) => tile(name, (it.voice || 'none') === id, () => { it.voice = id === 'none' ? null : id; done({ audio: true }); refresh(); S.player.play({ from: Math.max(it.start, now()), to: Math.min(it.start + it.dur, now() + 3) }); }, h('div.sw', { style: { display: 'grid', placeItems: 'center', background: 'var(--bg4)' }, html: icon('voice') }))));
  },
};

/* ---------- sound effects ---------- */
let sfxNode = null;
function playSfx(id) {
  const ac = audioCtx(); ac.resume();
  try { sfxNode?.stop(); } catch (e) { }
  const def = sfxById(id), b = sfxBuffer(ac, id, def.loop ? Math.min(def.dur, 5) : def.dur, 1);
  const s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(); sfxNode = s;
}
SHEETS.sfx = {
  title: 'Sound effects', tall: true, tabs: () => [...new Set(SFX.map(s => s.cat))].map(c => [c, c]),
  body(it, tab) {
    return [
      note('Tap to listen, then add at the playhead. No music: only everyday, camera and nature sounds made by the app.', '', 'sound'),
      h('div.list', {}, SFX.filter(s => s.cat === tab).map(s => h('div.li', {},
        h('button.ibtn', { title: 'Listen', html: icon('play'), on: { click: () => playSfx(s.id) } }),
        h('div.grow', {}, h('div.t', {}, s.name), h('div.d', {}, s.loop ? 'Ambience · any length' : fmtDur(s.dur))),
        h('button.btn.sm', { on: { click: () => { try { sfxNode?.stop(); } catch (e) { } A.addSfx(s.id); toast(s.name + ' added'); } } }, 'Add')))),
    ];
  },
  onClose() { try { sfxNode?.stop(); } catch (e) { } },
};

/* ---------- shapes ---------- */
SHEETS.shapes = {
  title: 'Shapes',
  body() {
    return h('div.tiles', {}, SHAPES.map(([id, name]) => tile(name, false, () => { A.addShape(id); open('shape'); }, h('img', { src: shapeIcon(id), alt: '' }))));
  },
};
SHEETS.shape = {
  title: 'Shape', needs: ['shape'], tabs: () => [['shape', 'Shape'], ['fill', 'Fill'], ['line', 'Outline'], ['shadow', 'Shadow']],
  body(it, tab) {
    if (tab === 'shape') return [
      h('div.tiles', { style: { marginBottom: '14px' } }, SHAPES.map(([id, name]) => tile(name, it.shape === id, () => { it.shape = id; done(); refresh(); }, h('img', { src: shapeIcon(id), alt: '' })))),
      slider({ label: 'Width', min: 10, max: 2400, step: 1, value: it.w, fmt: v => Math.round(v), onInput: v => { it.w = v; live(); }, onChange: () => done() }),
      slider({ label: 'Height', min: 10, max: 2400, step: 1, value: it.h, fmt: v => Math.round(v), onInput: v => { it.h = v; live(); }, onChange: () => done() }),
      ['rounded', 'rect'].includes(it.shape) ? slider({ label: 'Corner radius', min: 0, max: 1, step: 0.01, value: it.radius ?? 0.18, fmt: pct, onInput: v => { it.radius = v; if (it.shape === 'rect' && v > 0) it.shape = 'rounded'; live(); }, onChange: () => done() }) : null,
    ];
    if (tab === 'fill') return [
      toggleRow('Fill', it.fillOn !== false, v => { it.fillOn = v; done(); }),
      colors(it.fill, c => { if (c) { it.fill = c; done(); } }, { label: 'Colour' }),
      toggleRow('Gradient', !!it.grad, v => { it.grad = v ? { to: '#29e0b4', angle: 90 } : null; done(); refresh(); }),
      it.grad ? colors(it.grad.to, c => { if (c) { it.grad.to = c; done(); } }, { label: 'Second colour' }) : null,
      it.grad ? slider({ label: 'Gradient angle', min: 0, max: 360, step: 1, value: it.grad.angle, fmt: v => Math.round(v) + '°', onInput: v => { it.grad.angle = v; live(); }, onChange: () => done() }) : null,
    ];
    if (tab === 'line') return [
      slider({ label: 'Width', min: 0, max: 80, step: 1, value: it.sw || 0, fmt: v => Math.round(v), onInput: v => { it.sw = v; live(); }, onChange: () => done() }),
      colors(it.stroke, c => { if (c) { it.stroke = c; if (!it.sw) it.sw = 8; done(); refresh(); } }, { label: 'Colour' }),
    ];
    return [slider({ label: 'Shadow', min: 0, max: 1, step: 0.01, value: it.shadow || 0, fmt: pct, onInput: v => { it.shadow = v; live(); }, onChange: () => done() })];
  },
};

/* ---------- text ---------- */
let fontsLoaded = false;
function loadFontCss() {
  if (fontsLoaded) return; fontsLoaded = true;
  import('../defs.js').then(d => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = d.fontsCssUrl(); document.head.append(l); l.onload = () => document.fonts.ready.then(() => { S.player?.invalidate(); }); });
}
export { loadFontCss };
SHEETS.text = {
  title: 'Text', needs: ['text'], tall: false, tabs: () => [['edit', 'Text'], ['font', 'Font'], ['style', 'Style'], ['box', 'Background'], ['layout', 'Layout']],
  onOpen() { loadFontCss(); },
  body(it, tab) {
    if (tab === 'edit') {
      const ta = h('textarea.txt', { value: it.text, dir: 'auto', on: { input: e => { it.text = e.target.value; it.words = null; live(); }, change: () => done() } });
      setTimeout(() => { if (cur?.tab === 'edit') { ta.focus(); ta.select(); } }, 120);
      return [ta, field('Looks', h('div.tiles', { style: { marginTop: '10px' } }, TEXT_STYLES.map(st => tile(st.name, false, () => {
        for (const k of ['stroke', 'shadow', 'glow', 'bg', 'bgLines', 'weight']) delete it[k];
        Object.assign(it, { stroke: 0, shadow: 0, glow: 0, bg: null, bgLines: false, weight: 700 }, deep(st.s)); done(); refresh();
      }, h('div', { style: { fontWeight: 800, fontSize: '18px', color: st.s.color === 'transparent' ? 'transparent' : st.s.color, WebkitTextStroke: st.s.stroke ? '1px ' + st.s.strokeColor : '', background: st.s.bg || 'none', padding: '0 6px', borderRadius: '5px', textShadow: st.s.shadow ? '0 2px 4px #000' : st.s.glow ? '0 0 8px ' + st.s.glowColor : '' } }, 'Aa')))))];
    }
    if (tab === 'font') {
      const catOf = f => FONTS.find(x => x[0] === f)?.[1];
      const c0 = cur.fontCat || catOf(it.font) || 'sans';
      return [
        h('div.seg', { style: { marginBottom: '12px', overflowX: 'auto' } }, FONT_CATS.map(([id, l]) => h('button' + (c0 === id ? '.on' : ''), { on: { click: () => { cur.fontCat = id; refresh(); } } }, l))),
        h('div.fgrid', {}, FONTS.filter(f => f[1] === c0).map(([f]) => h('button.fopt' + (it.font === f ? '.on' : ''), { style: { fontFamily: fontStack(f), fontWeight: 700 }, on: { click: () => { it.font = f; document.fonts.load(`700 40px "${f}"`).then(() => { S.player.invalidate(); live(); }); done(); refresh(); } } }, c0 === 'arabic' ? 'نص عربي' : 'Aa Text', h('i', {}, f)))),
        h('div', { style: { height: '12px' } }),
        seg([[400, 'Regular'], [700, 'Bold'], [900, 'Heavy']], it.weight || 700, v => { it.weight = v; done(); }, 'Weight'),
        h('div', { style: { height: '10px' } }),
        toggleRow('Italic', !!it.italic, v => { it.italic = v; done(); }),
        toggleRow('Capital letters', !!it.upper, v => { it.upper = v; done(); }),
      ];
    }
    if (tab === 'style') return [
      colors(it.color, c => { it.color = c || 'transparent'; done(); }, { label: 'Colour', none: true }),
      slider({ label: 'Size', min: 12, max: 300, step: 1, value: it.size, fmt: v => Math.round(v), onInput: v => { it.size = v; live(); }, onChange: () => done() }),
      slider({ label: 'Outline', min: 0, max: 0.3, step: 0.005, value: it.stroke || 0, fmt: v => Math.round(v / 0.3 * 100) + '%', onInput: v => { it.stroke = v; live(); }, onChange: () => done() }),
      colors(it.strokeColor, c => { if (c) { it.strokeColor = c; if (!it.stroke) it.stroke = 0.08; done(); refresh(); } }, { label: 'Outline colour' }),
      slider({ label: 'Shadow', min: 0, max: 1, step: 0.01, value: it.shadow || 0, fmt: pct, onInput: v => { it.shadow = v; live(); }, onChange: () => done() }),
      it.shadow ? colors(it.shadowColor, c => { if (c) { it.shadowColor = c; done(); } }, { label: 'Shadow colour' }) : null,
      it.shadow ? slider({ label: 'Shadow softness', min: 0, max: 0.6, step: 0.01, value: it.shadowBlur ?? 0.12, fmt: v => Math.round(v / 0.6 * 100) + '%', onInput: v => { it.shadowBlur = v; live(); }, onChange: () => done() }) : null,
      it.shadow ? slider({ label: 'Shadow distance', min: 0, max: 0.3, step: 0.005, value: Math.hypot(it.shadowX ?? 0.04, it.shadowY ?? 0.06), fmt: v => Math.round(v * 100), onInput: v => { it.shadowX = v * 0.55; it.shadowY = v * 0.83; live(); }, onChange: () => done() }) : null,
      slider({ label: 'Glow', min: 0, max: 1, step: 0.01, value: it.glow || 0, fmt: pct, onInput: v => { it.glow = v; live(); }, onChange: () => done() }),
      it.glow ? colors(it.glowColor, c => { if (c) { it.glowColor = c; done(); } }, { label: 'Glow colour' }) : null,
    ];
    if (tab === 'box') return [
      colors(it.bg, c => { it.bg = c; done(); refresh(); }, { label: 'Background', none: true }),
      it.bg ? slider({ label: 'Background opacity', min: 0, max: 1, step: 0.01, value: it.bgAlpha ?? 1, fmt: pct, onInput: v => { it.bgAlpha = v; live(); }, onChange: () => done() }) : null,
      it.bg ? slider({ label: 'Padding', min: 0, max: 1, step: 0.01, value: it.bgPad ?? 0.3, fmt: pct, onInput: v => { it.bgPad = v; live(); }, onChange: () => done() }) : null,
      it.bg ? slider({ label: 'Rounded corners', min: 0, max: 1, step: 0.01, value: it.bgRadius ?? 0.2, fmt: pct, onInput: v => { it.bgRadius = v; live(); }, onChange: () => done() }) : null,
      it.bg ? toggleRow('Separate box for each line', !!it.bgLines, v => { it.bgLines = v; done(); }) : null,
    ];
    return [
      seg([['left', 'Left', 'align'], ['center', 'Centre', 'align'], ['right', 'Right', 'align']], it.align || 'center', v => { it.align = v; done(); }, 'Align'),
      h('div', { style: { height: '12px' } }),
      slider({ label: 'Letter spacing', min: -0.1, max: 0.6, step: 0.005, value: it.ls || 0, zero: 0, fmt: v => Math.round(v * 100), onInput: v => { it.ls = v; live(); }, onChange: () => done() }),
      slider({ label: 'Line spacing', min: 0.8, max: 2.4, step: 0.01, value: it.lh || 1.18, fmt: v => v.toFixed(2), onInput: v => { it.lh = v; live(); }, onChange: () => done() }),
      slider({ label: 'Line width', min: 0.2, max: 1.6, step: 0.01, value: it.maxW || 0.86, fmt: pct, onInput: v => { it.maxW = v; live(); }, onChange: () => done() }),
    ];
  },
};

export { SHEETS };
export const toggleFace = (...a) => more.__toggleFace(...a);
export const drew = (...a) => more.__drew(...a);
export const faceNames = (...a) => more.__faceNames(...a);
export const camera = (...a) => more.__camera(...a);
export const ctx = () => C;
