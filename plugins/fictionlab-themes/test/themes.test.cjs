const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PRESETS, clone, validateTheme, contrastWarnings, themeCSS } = require('../src/theme.cjs');
const { ThemeStore } = require('../src/store.cjs');
test('preset contrast and strict color/font validation', () => {
  for (const preset of Object.values(PRESETS)) assert.deepEqual(contrastWarnings(preset), []);
  let bad = clone(PRESETS.electric); bad.colors.text = 'red; } body { display:none';
  assert.throws(() => validateTheme(bad));
  bad = clone(PRESETS.electric); bad.fonts.body = 'url(https://example.com)';
  assert.throws(() => validateTheme(bad));
  bad = clone(PRESETS.electric); bad.fontSize = 200; assert.throws(() => validateTheme(bad));
  bad = clone(PRESETS.electric); bad.colors.text = bad.colors.surface;
  assert.ok(contrastWarnings(bad).length);
  assert.equal(themeCSS(null, 'file:///fonts'), '');
});
test('atomic persistence outside plugin folder and corrupt data preservation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fl-theme-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ThemeStore(root), initial = await store.load();
  const state = { ...initial, applied: clone(PRESETS.electric), customs: [{ id: 'example', name: 'Mine', theme: clone(PRESETS.electric) }] };
  await store.save(state);
  await fs.mkdir(path.join(root, 'plugins', 'fictionlab-themes'), { recursive: true });
  await fs.rm(path.join(root, 'plugins', 'fictionlab-themes'), { recursive: true });
  assert.deepEqual(await new ThemeStore(root).load(), state);
  assert.deepEqual(await fs.readdir(path.dirname(store.file)), ['themes.json']);
  await fs.writeFile(store.file, '{broken');
  await assert.rejects(store.load(), /preserved/);
  assert.equal(await fs.readFile(store.file, 'utf8'), '{broken');
});
test('real backend preview/apply/cancel, reload, update, and disable lifecycle', async t => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'fl-theme-lifecycle-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const app = new EventEmitter(), win = new EventEmitter(), contents = new EventEmitter();
  const styles = new Map(); let counter = 0;
  contents.id = 1; contents.isDestroyed = () => false;
  contents.getURL = () => 'file:///Applications/FictionLab.app/Contents/Resources/app.asar/dist/renderer/index.html';
  contents.insertCSS = async css => { const key = String(++counter); styles.set(key, css); return key; };
  contents.removeInsertedCSS = async key => styles.delete(key);
  win.id = 1; win.webContents = contents;
  const handlers = new Map(), mod = { exports: {} };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../src/index.cjs'), 'utf8'), {
    module: mod, require: name => name === 'electron' ? { app, BrowserWindow: { getAllWindows: () => [win] } } :
      name === './store.cjs' ? require('../src/store.cjs') : name === './theme.cjs' ? require('../src/theme.cjs') : require(name)
  });
  const context = { services: { environment: { getUserDataPath: () => userData } },
    plugin: { installPath: '/example/plugins/fictionlab-themes' },
    ipc: { handle: (n, fn) => handlers.set(n, fn), removeHandler: n => handlers.delete(n) },
    logger: { info() {}, warn() {} } };
  const call = (name, ...args) => handlers.get(name)({ sender: contents }, ...args);
  let plugin = new mod.exports(); await plugin.onActivate(context);
  assert.equal(styles.size, 1);
  await call('preview', PRESETS.electric); assert.equal(styles.size, 1);
  assert.match([...styles.values()][0], /#100d24/);
  await call('cancel'); assert.match([...styles.values()][0], /#181818/);
  await call('save-custom', 'My room', PRESETS.electric);
  await assert.rejects(call('save-custom', 'My room', PRESETS.electric), /already exists/);
  assert.equal((await call('get')).customs.length, 1);
  await call('preview', PRESETS.monochrome);
  styles.clear(); contents.emit('did-finish-load'); await plugin.queue;
  assert.equal(styles.size, 1); assert.match([...styles.values()][0], /#100d24/);
  await call('apply', null); assert.equal(styles.size, 0);
  await call('apply', PRESETS.electric);
  await plugin.onDeactivate(); assert.equal(styles.size, 0); assert.equal(handlers.size, 0);
  assert.equal(app.listenerCount('browser-window-created'), 0);
  assert.equal(contents.listenerCount('did-finish-load'), 0);
  plugin = new mod.exports(); await plugin.onActivate(context);
  assert.match([...styles.values()][0], /#100d24/);
  assert.equal((await call('get')).customs[0].name, 'My room');
  await plugin.onDeactivate();
});
