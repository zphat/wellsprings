// Plugin registry. Instruments and effects are looked up by id.
import * as sigil from './sigil.js';
import * as abyss from './abyss.js';
import * as ouroboros from './ouroboros.js';
import * as halo from './halo.js';
import * as seal from './seal.js';
import { eq3, comp, filter, utility } from './basics.js';

const all = [sigil, abyss, ouroboros, halo, seal, eq3, comp, filter, utility];
export const PLUGINS = Object.fromEntries(all.map(m => [m.meta.id, m]));
export const FX_LIST = all.filter(m => m.meta.kind === 'fx').map(m => m.meta);
export const INSTRUMENT_LIST = all.filter(m => m.meta.kind === 'instrument').map(m => m.meta);

export function createPlugin(ctx, id, state) {
  const m = PLUGINS[id];
  if (!m) throw new Error(`Unknown plugin ${id}`);
  const p = m.create(ctx, state || undefined);
  if (state && p.setState) p.setState(state);
  return p;
}
