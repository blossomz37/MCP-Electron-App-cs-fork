const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PRESETS, clone, validateTheme, contrastWarnings, themeCSS, contrast, accentHover, statusColors, inferReference, validateReference, themeName } = require('../src/theme.cjs');
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
  const state = { ...initial, applied: clone(PRESETS.electric), appliedRef: 'custom:example', customs: [{ id: 'example', name: 'Mine', theme: clone(PRESETS.electric) }] };
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
    plugin: { version: '0.1.2', installPath: '/example/plugins/fictionlab-themes' },
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
  const saved = (await call('get')).customs[0];
  assert.equal((await call('get')).appliedRef, `custom:${saved.id}`);
  await call('rename-custom', saved.id, ' My room renamed ');
  assert.equal((await call('get')).customs[0].name, 'My room renamed');
  await assert.rejects(call('rename-custom', saved.id, '  '));
  await assert.rejects(call('delete-custom', 'not-found'));
  for (let i=2; i<=5; i++) await call('save-custom', `Room ${i}`, PRESETS.electric);
  await assert.rejects(call('save-custom', 'Room 6', PRESETS.electric), /five/);
  await assert.rejects(call('rename-custom', saved.id, ' room 2 '), /already exists/);
  const before = JSON.stringify(await call('get'));
  await assert.rejects(call('apply', PRESETS.dark, `custom:${saved.id}`), /does not match/);
  assert.equal(JSON.stringify(await call('get')), before);
  await call('apply', PRESETS.electric, `custom:${saved.id}`);
  await call('delete-custom', (await call('get')).customs[1].id);
  assert.equal((await call('get')).appliedRef, `custom:${saved.id}`);
  await call('save-custom', 'Replacement', PRESETS.electric);
  const active = (await call('get')).appliedRef.slice(7);
  await call('delete-custom', active);
  assert.equal((await call('get')).appliedRef, null);
  assert.equal((await call('get')).applied.colors.chrome, PRESETS.electric.colors.chrome);
  assert.equal(styles.size, 1);

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
  assert.equal((await call('get')).customs[0].name, 'My room renamed');
  await plugin.onDeactivate();
  // An older library above the new cap must remain manageable.
  const legacy = { version:1, applied:PRESETS.electric, customs:Array.from({length:6},(_,i)=>({id:`old-${i}`,name:`Old ${i}`,theme:PRESETS.electric})) };
  await fs.writeFile(plugin.store.file, JSON.stringify(legacy));
  plugin = new mod.exports(); await plugin.onActivate(context);
  await assert.rejects(call('save-custom','Too many',PRESETS.dark),/five/);
  await call('rename-custom','old-0','Kept');
  await call('delete-custom','old-5');
  await assert.rejects(call('save-custom','Still full',PRESETS.dark),/five/);
  await call('delete-custom','old-4');
  await call('save-custom','Now fits',PRESETS.dark);
  assert.equal((await call('get')).customs.length,5);
  assert.equal(plugin.version,'0.1.2');
  await plugin.onDeactivate();
});

test('legacy migration makes an exact backup and preserves over-limit collections', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fl-theme-migrate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ThemeStore(root);
  const custom = clone(PRESETS.electric); custom.fontSize = 16;
  const legacy = { version: 1, applied: custom, customs: Array.from({length:6}, (_,i) => ({id:`id-${i}`, name:`Theme ${i}`, theme:i===0?custom:clone(PRESETS.monochrome)})) };
  const raw = JSON.stringify(legacy, null, 4) + '\n\n';
  await fs.mkdir(path.dirname(store.file), {recursive:true}); await fs.writeFile(store.file, raw);
  const state = await store.load();
  assert.equal(state.version, 2); assert.equal(state.appliedRef, 'custom:id-0'); assert.equal(state.customs.length, 6);
  assert.equal(await fs.readFile(store.file,'utf8'), raw);
  await store.save(state);
  const backup = (await fs.readdir(path.dirname(store.file))).find(x => x.endsWith('.bak'));
  assert.equal(await fs.readFile(path.join(path.dirname(store.file),backup),'utf8'),raw);
  assert.deepEqual(await new ThemeStore(root).load(),state);
  state.customs[0].name = 'Renamed'; await store.save(state);
  assert.equal((await fs.readdir(path.dirname(store.file))).filter(x=>x.endsWith('.bak')).length,1);
});
test('identity distinguishes matching presets and saved custom themes', () => {
  const t = clone(PRESETS.electric), customs = [{id:'a',name:'Mine',theme:t},{id:'b',name:'Twin',theme:t}];
  assert.equal(inferReference(t,customs.slice(0,1)),'custom:a');
  assert.equal(inferReference(t,customs),'preset:electric');
  assert.equal(validateReference('custom:b',t,customs),'custom:b');
  assert.equal(themeName(t,'custom:b',customs),'Twin');
  assert.equal(themeName(t,null,customs),'Custom (unnamed)');
  t.fontSize=17;
  assert.throws(()=>validateReference('preset:electric',t,customs));
  assert.equal(inferReference(t,[]),null);
});
test('dark native controls, status contrast, hover and caret styling', () => {
  for (const preset of Object.values(PRESETS)) {
    const c=preset.colors;
    for (const color of Object.values(statusColors(c.background))) {
      assert.ok(contrast(color,c.background)>=4.5);
      assert.ok(contrast(color,c.surface)>=4.5);
    }
    const hover=accentHover(c.accent,c.onAccent);
    assert.notEqual(hover,c.accent);
    assert.ok(contrast(hover,c.onAccent)>=4.5);
    const css=themeCSS(preset,'file:///fonts');
    assert.match(css,/padding-inline-end:40px/);
    assert.match(css,/:hover/); assert.match(css,/:focus-visible/);
  }
  assert.notEqual(accentHover('#000000','#ffffff'),'#000000');
  assert.notEqual(accentHover('#ffffff','#000000'),'#ffffff');
  assert.match(themeCSS(PRESETS.dark,'file:///fonts'),/color-scheme:dark/);
  assert.match(themeCSS(PRESETS.monochrome,'file:///fonts'),/color-scheme:light/);
});
