// Projects screen.
import * as store from '../store.js';
import { newProject } from '../model.js';
import { h, ico, confirmBox, promptBox, toast } from './widgets.js';
import { icon } from './icons.js';
import { fmtDur, fmtBytes, pickFiles } from '../util.js';
import { duration } from '../model.js';

export async function showHome(openProject) {
  const app = document.getElementById('app'); app.innerHTML = '';
  const list = await store.listProjects();
  const startNew = async (files, cam) => {
    const p = newProject('Project ' + (list.length + 1));
    await store.saveProject(p);
    openProject(p, { files, cam });
  };
  const home = h('div.home', {},
    h('h1', {}, 'Start'),
    h('div.starts', {},
      h('button.start.main', { on: { click: async () => { const f = await pickFiles('video/*,image/*'); if (f.length) startNew(f); } } }, ico('newp', 'l'), h('div', {}, h('b', {}, 'New project'), h('br'), h('span', {}, 'Pick videos and photos from your device'))),
      h('button.start', { on: { click: () => startNew(null, true) } }, ico('camera'), h('div', {}, h('b', {}, 'Record'), h('br'), h('span', {}, 'Film with the camera'))),
      h('button.start', { on: { click: () => startNew(null) } }, ico('film'), h('div', {}, h('b', {}, 'Empty project'), h('br'), h('span', {}, 'Add things later')))),
    h('h1', {}, 'Projects'),
    list.length ? h('div.plist', {}, list.map(p => card(p))) : h('div.empty', {}, 'Your projects will show here. They are kept on this device only.'),
    h('div.storage', {}, 'Videos are never uploaded: everything is edited and saved on this device.'));
  app.append(home);
  store.usage().then(u => { if (u?.usage) home.querySelector('.storage').textContent += ` Using ${fmtBytes(u.usage)}.`; });

  function card(p) {
    const d = duration(p);
    const el = h('div.pcard', {},
      h('button', { style: { width: '100%', textAlign: 'left' }, on: { click: () => openProject(p) } },
        h('div.th', { style: p.thumb ? { backgroundImage: `url(${p.thumb})` } : {} }, d ? h('span.dur', {}, fmtDur(d)) : null),
        h('div.nm', {}, p.name)),
      h('div.row', {}, h('div.dt.grow', {}, new Date(p.updated).toLocaleDateString()),
        h('button.ibtn', { style: { width: '30px', height: '28px' }, title: 'Options', html: icon('more'), on: { click: () => menu(p) } })));
    return el;
  }
  async function menu(p) {
    const bg = h('div.modal-bg', { on: { click: e => { if (e.target === bg) bg.remove(); } } }, h('div.modal', {}, h('h3', {}, p.name),
      h('div.list', {},
        h('button.li', { on: { click: async () => { bg.remove(); const n = await promptBox('Rename', p.name); if (n != null) { p.name = n.trim() || p.name; await store.saveProject(p); showHome(openProject); } } } }, ico('edit', 's'), 'Rename'),
        h('button.li', { on: { click: async () => { bg.remove(); const c = JSON.parse(JSON.stringify(p)); c.id = Math.random().toString(36).slice(2); c.name = p.name + ' copy'; c.updated = Date.now(); await store.saveProject(c); showHome(openProject); } } }, ico('copy', 's'), 'Duplicate'),
        h('button.li', { style: { color: 'var(--danger)' }, on: { click: async () => { bg.remove(); if (await confirmBox('Delete project?', 'Its videos are removed from this app (not from your gallery).', 'Delete', true)) { await store.deleteProject(p); showHome(openProject); } } } }, ico('trash', 's'), 'Delete'))));
    document.body.append(bg);
  }
}
