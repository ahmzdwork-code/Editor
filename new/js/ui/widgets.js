// Small DOM building blocks: elements, sliders, segmented choices, colours, dialogs, toasts.
import { icon } from './icons.js';
import { clamp } from '../util.js';

export function h(tag, attrs = {}, ...kids) {
  const [t, ...cls] = tag.split('.');
  const el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export const ico = (n, cls) => { const s = document.createElement('span'); s.style.display = 'contents'; s.innerHTML = icon(n, cls); return s; };

/* slider: { label, min, max, step, value, fmt, onInput(v), onChange(v), zero } */
export function slider(o) {
  const min = o.min ?? 0, max = o.max ?? 1, step = o.step ?? 0.01;
  let v = o.value ?? min;
  const val = h('span.v'), tr = h('div.tr'), fi = h('div.fi'), th = h('div.th');
  const zero = o.zero != null ? h('div.zero') : null;
  const sl = h('div.sl', {}, tr, zero, fi, th);
  const fmt = o.fmt || (x => (Math.round(x * 100) / 100).toString());
  const pos = x => (x - min) / (max - min);
  const draw = () => {
    const p = clamp(pos(v), 0, 1), z = o.zero != null ? clamp(pos(o.zero), 0, 1) : 0;
    th.style.left = p * 100 + '%';
    fi.style.left = Math.min(p, z) * 100 + '%'; fi.style.width = Math.abs(p - z) * 100 + '%';
    if (zero) zero.style.left = z * 100 + '%';
    val.textContent = fmt(v);
  };
  const setFromX = (x, final) => {
    const r = sl.getBoundingClientRect();
    let nv = min + clamp((x - r.left) / r.width, 0, 1) * (max - min);
    nv = Math.round(nv / step) * step;
    if (o.zero != null && Math.abs(nv - o.zero) < (max - min) * 0.02) nv = o.zero;
    nv = clamp(+nv.toFixed(6), min, max);
    if (nv !== v || final) { v = nv; draw(); final ? o.onChange?.(v) : o.onInput?.(v); }
  };
  let drag = false, startX = 0, startV = 0;
  sl.addEventListener('pointerdown', e => {
    drag = true; sl.setPointerCapture(e.pointerId); startX = e.clientX; startV = v;
    // tap jumps, drag moves relative for precision
    setFromX(e.clientX);
  });
  sl.addEventListener('pointermove', e => { if (drag) setFromX(e.clientX); });
  const end = e => { if (!drag) return; drag = false; setFromX(e.clientX, true); };
  sl.addEventListener('pointerup', end); sl.addEventListener('pointercancel', end);
  sl.addEventListener('dblclick', () => { if (o.reset != null) { v = o.reset; draw(); o.onInput?.(v); o.onChange?.(v); } });
  draw();
  const wrap = h('div.field', {}, o.label ? h('div.lbl', {}, h('span', {}, o.label), val) : null, sl);
  wrap.set = x => { v = x; draw(); };
  return wrap;
}

/* segmented: options [[value, label, iconName?]] */
export function seg(options, value, onPick, label) {
  const box = h('div.seg');
  const btns = options.map(([v, l, ic]) => {
    const b = h('button', { on: { click: () => { btns.forEach(x => x.classList.toggle('on', x === b)); onPick(v); } } }, ic ? ico(ic, 's') : null, l);
    if (v === value) b.classList.add('on');
    box.append(b); return b;
  });
  return label ? h('div.field', {}, h('div.lbl', {}, label), box) : box;
}

export const PALETTE = ['#ffffff', '#000000', '#d4f75a', '#ffd23f', '#ff8a3d', '#e8483b', '#f472b6', '#a78bfa', '#3b82f6', '#29e0b4', '#22c55e', '#8b5e3c', '#6b7280', '#1e293b'];
export function colors(value, onPick, { none = false, label } = {}) {
  const box = h('div.colors');
  const all = [];
  const mark = v => all.forEach(([c, b]) => b.classList.toggle('on', c === v));
  if (none) { const b = h('button.none', { title: 'None', on: { click: () => { mark(null); onPick(null); } } }); all.push([null, b]); box.append(b); }
  for (const c of PALETTE) { const b = h('button', { style: { background: c }, title: c, on: { click: () => { mark(c); onPick(c); } } }); all.push([c, b]); box.append(b); }
  const inp = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ffffff', on: { input: e => { mark(null); onPick(e.target.value); } } });
  box.append(h('label', { title: 'Any colour' }, ico('style', 'xs'), inp));
  mark(value ?? null);
  return label ? h('div.field', {}, h('div.lbl', {}, label), box) : box;
}

export function toggle(on, onChange) {
  const t = h('button.toggle' + (on ? '.on' : ''), { role: 'switch', 'aria-checked': on ? 'true' : 'false' });
  t.addEventListener('click', () => { on = !on; t.classList.toggle('on', on); t.setAttribute('aria-checked', on); onChange(on); });
  return t;
}
export function toggleRow(label, on, onChange, sub) {
  return h('div.field.row', {}, h('div.grow', {}, h('div', { style: { fontWeight: 600, fontSize: '13.5px' } }, label), sub ? h('div', { style: { color: 'var(--muted)', fontSize: '12px' } }, sub) : null), toggle(on, onChange));
}

export function note(text, kind = '', ic = 'info') { return h('div.note' + (kind ? '.' + kind : ''), {}, ico(ic, 's'), h('div', { html: text })); }

let toastT = null;
export function toast(msg, ms = 2200) {
  document.querySelector('.toast')?.remove();
  const t = h('div.toast', {}, msg); document.body.append(t);
  clearTimeout(toastT); toastT = setTimeout(() => t.remove(), ms);
}

export function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise(res => {
    const bg = h('div.modal-bg', { on: { click: e => { if (e.target === bg) { bg.remove(); res(false); } } } },
      h('div.modal', {}, h('h3', {}, title), text ? h('p', {}, text) : null,
        h('div.acts', {}, h('button.btn.ghost', { on: { click: () => { bg.remove(); res(false); } } }, 'Cancel'),
          h('button.btn' + (danger ? '.danger' : '.primary'), { on: { click: () => { bg.remove(); res(true); } } }, okLabel))));
    document.body.append(bg);
  });
}
export function promptBox(title, value = '', okLabel = 'Save') {
  return new Promise(res => {
    const inp = h('input.inp', { value });
    const done = v => { bg.remove(); res(v); };
    const bg = h('div.modal-bg', {}, h('div.modal', {}, h('h3', {}, title), inp,
      h('div.acts', { style: { marginTop: '14px' } }, h('button.btn.ghost', { on: { click: () => done(null) } }, 'Cancel'), h('button.btn.primary', { on: { click: () => done(inp.value) } }, okLabel))));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(inp.value); });
    document.body.append(bg); setTimeout(() => { inp.focus(); inp.select(); }, 50);
  });
}

// full-screen progress with cancel
export function busy(title) {
  const ctl = new AbortController();
  const bar = h('i'), prog = h('div.prog.ind', {}, bar), txt = h('span', {}, '');
  const box = h('div.busy', {}, h('div.box', {}, h('b', {}, title), prog, txt,
    h('div', { style: { marginTop: '16px' } }, h('button.btn.sm', { on: { click: () => ctl.abort() } }, 'Cancel'))));
  document.body.append(box);
  return {
    signal: ctl.signal,
    set(f, text) { if (f == null) prog.classList.add('ind'); else { prog.classList.remove('ind'); bar.style.width = clamp(f, 0, 1) * 100 + '%'; } if (text != null) txt.textContent = text; },
    close() { box.remove(); },
  };
}
