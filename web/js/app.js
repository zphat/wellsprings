// Shared handles so screens don't import each other. Filled in by main.js.
import { store } from './state.js';

export const app = {
  ctx: null,
  engine: null,
  murmur: null,
  screens: {},
  current: 'pattern',

  toast(msg) {
    const t = document.querySelector('#status .toast');
    if (t) { t.textContent = msg; clearTimeout(this._tt); this._tt = setTimeout(() => (t.textContent = ''), 6000); }
  },

  show(name) {
    this.current = name;
    store.ui.screen = name;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.screen === name));
    const s = this.screens[name];
    if (s && s.shown) s.shown();
  },

  // Undoable change + resync audio graph.
  change(label, fn) {
    store.mutate(label, fn);
  },

  async ensureAudio() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  },
};
