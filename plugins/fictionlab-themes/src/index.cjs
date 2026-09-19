'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { ThemeStore } = require('./store.cjs');
const { validateTheme, clone, themeCSS } = require('./theme.cjs');
class ThemesPlugin {
  constructor() {
    this.id = 'fictionlab-themes'; this.name = 'Themes'; this.version = '0.1.0';
    this.windows = new Map(); this.channels = []; this.queue = Promise.resolve(); this.active = false;
  }
  enqueue(task) {
    const next = this.queue.then(task);
    this.queue = next.catch(error => this.context?.logger.warn(`Themes: ${error.message}`));
    return next;
  }
  isHost(contents) {
    return !contents.isDestroyed() && /\/dist\/renderer\/index\.html(?:[?#]|$)/.test(contents.getURL());
  }
  async onActivate(context) {
    this.context = context;
    this.store = new ThemeStore(context.services.environment.getUserDataPath());
    this.fontBase = pathToFileURL(path.join(context.plugin.installPath, 'assets', 'fonts')).href;
    try {
      this.state = await this.store.load(); this.current = this.state.applied; this.active = true;
      const handle = (name, fn) => {
        context.ipc.handle(name, (event, ...args) => this.enqueue(async () => {
          if (!this.active || !this.isHost(event.sender)) throw new Error('Theme controls are available only in FictionLab.');
          return fn(event, ...args);
        }));
        this.channels.push(name);
      };
      handle('get', () => clone(this.state));
      handle('preview', async (event, theme) => {
        this.current = validateTheme(theme); this.previewOwner = event.sender.id;
        await this.applyAll(); return true;
      });
      handle('cancel', async () => {
        this.previewOwner = null; this.current = this.state.applied; await this.applyAll(); return clone(this.state);
      });
      handle('apply', async (_event, theme) => {
        const next = { ...this.state, applied: validateTheme(theme) };
        this.state = await this.store.save(next);
        this.previewOwner = null; this.current = this.state.applied; await this.applyAll(); return clone(this.state);
      });
      handle('save-custom', async (_event, name, theme) => {
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) throw new Error('Enter a theme name of 1–60 characters.');
        if (this.state.customs.some(x => x.name.toLowerCase() === name.trim().toLowerCase())) throw new Error('That name already exists. Choose a different name.');
        if (this.state.customs.length >= 100) throw new Error('You have reached the 100-theme limit.');
        const validated = validateTheme(theme);
        if (!validated) throw new Error('Choose a preset to customize first.');
        this.state = await this.store.save({ ...this.state, applied: validated,
          customs: [...this.state.customs, { id: randomUUID(), name: name.trim(), theme: validated }] });
        this.previewOwner = null; this.current = this.state.applied; await this.applyAll(); return clone(this.state);
      });
      this.onWindow = (_event, win) => this.attach(win);
      app.on('browser-window-created', this.onWindow);
      for (const win of BrowserWindow.getAllWindows()) this.attach(win);
      await this.enqueue(() => this.applyAll());
      context.logger.info('Themes activated; settings are stored outside the plugin installation.');
    } catch (error) { await this.onDeactivate(); throw error; }
  }
  attach(win) {
    if (!this.active || this.windows.has(win.id)) return;
    const contents = win.webContents;
    const record = { contents, key: null };
    record.load = () => {
      record.key = null; // Navigation destroys the old document and its inserted CSS.
      this.enqueue(async () => {
        if (this.previewOwner === contents.id) { this.previewOwner = null; this.current = this.state.applied; }
        if (this.active) await this.applyAll();
      });
    };
    record.closed = () => {
      this.windows.delete(win.id);
      if (this.previewOwner === contents.id) this.enqueue(async () => {
        this.previewOwner = null; this.current = this.state.applied; if (this.active) await this.applyAll();
      });
    };
    contents.on('did-finish-load', record.load); win.once('closed', record.closed);
    record.win = win; this.windows.set(win.id, record);
  }
  async applyAll() {
    if (!this.active) return;
    const css = themeCSS(this.current, this.fontBase);
    for (const record of this.windows.values()) {
      if (!this.isHost(record.contents)) continue;
      const oldKey = record.key;
      record.key = css ? await record.contents.insertCSS(css, { cssOrigin: 'user' }) : null;
      if (oldKey) await record.contents.removeInsertedCSS(oldKey);
    }
  }
  async onDeactivate() {
    this.active = false;
    if (this.onWindow) app.removeListener('browser-window-created', this.onWindow);
    for (const name of this.channels) this.context.ipc.removeHandler(name);
    this.channels = [];
    await this.queue;
    for (const record of this.windows.values()) {
      record.contents.removeListener('did-finish-load', record.load);
      record.win.removeListener('closed', record.closed);
      if (record.key && !record.contents.isDestroyed()) {
        try { await record.contents.removeInsertedCSS(record.key); }
        catch (error) { this.context.logger.warn(`Theme removal: ${error.message}`); }
      }
    }
    this.windows.clear(); this.previewOwner = null;
  }
}
module.exports = ThemesPlugin;
