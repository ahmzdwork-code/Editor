// Start-up: projects screen and editor.
import { showHome } from './ui/home.js';
import { openEditor } from './ui/editor.js';
import { addFiles } from './ui/actions.js';
import * as panels from './ui/panels.js';
import * as store from './store.js';
import { toast } from './ui/widgets.js';

store.persist();
async function openProject(p, o = {}) {
  await openEditor(p, home);
  if (o.files?.length) await addFiles(o.files, 'main', 0);
  if (o.cam) panels.camera();
  panels.loadFontCss();
}
function home() { showHome(openProject); }
home();

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !/localhost|127\.0\.0\.1/.test(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.addEventListener('unhandledrejection', e => { console.error(e.reason); });
window.__app = { store };
