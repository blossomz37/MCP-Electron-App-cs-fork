'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PRESETS, clone, validateTheme, validateReference, inferReference } = require('./theme.cjs');
function validateState(state) {
  if (!state || ![1, 2].includes(state.version) || !Array.isArray(state.customs) || state.customs.length > 100) {
    throw new Error('Unrecognized theme settings. Original file was preserved.');
  }
  const ids = new Set();
  const applied = validateTheme(state.applied);
  const customs = state.customs.map(item => {
    if (typeof item.id !== 'string' || !/^[a-z\d-]{1,64}$/i.test(item.id) || ids.has(item.id) ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60) throw new Error('Invalid saved theme. Original file was preserved.');
    ids.add(item.id);
    const theme = validateTheme(item.theme);
    if (!theme) throw new Error('A custom theme must have colors and fonts.');
    return { id: item.id, name: item.name.trim(), theme };
  });
  const appliedRef = state.version === 1 ? inferReference(applied, customs) : validateReference(state.appliedRef, applied, customs);
  return { version: 2, applied, appliedRef, customs };
}
class ThemeStore {
  constructor(userData) { this.file = path.join(userData, 'plugin-settings', 'fictionlab-themes', 'themes.json'); }
  async load() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw), state = validateState(parsed);
      this.legacyRaw = parsed.version === 1 ? raw : null;
      return state;
    }
    catch (error) {
      if (error.code === 'ENOENT') return { version: 2, applied: clone(PRESETS.monochrome), appliedRef: 'preset:monochrome', customs: [] };
      throw new Error(`Unable to read theme settings; preserved at ${this.file}. ${error.message}`);
    }
  }
  async save(state) {
    const valid = validateState(state);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    if (this.legacyRaw != null) {
      // Preserve the exact legacy bytes before the first migrated write.
      await fs.writeFile(`${this.file}.v1-${randomUUID()}.bak`, this.legacyRaw, { mode: 0o600, flag: 'wx' });
      this.legacyRaw = null;
    }
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(valid, null, 2) + '\n', { mode: 0o600 });
      await fs.rename(temporary, this.file);
    } finally { await fs.rm(temporary, { force: true }); }
    return valid;
  }
}
module.exports = { ThemeStore, validateState };
