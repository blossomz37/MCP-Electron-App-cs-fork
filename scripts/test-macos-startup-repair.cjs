// Behavioral checks against the actual staged/installed compiled modules.
// node scripts/test-macos-startup-repair.cjs EXTRACTED_ASAR STAGED_PLUGIN
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const [app, plugin] = process.argv.slice(2);
if (!app || !plugin) throw new Error('Provide extracted app and staged plugin paths');
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function main() {
  const errors = [];
  const updater = {};
  const exports = {};
  vm.runInNewContext(read(app, 'dist/main/auto-updater.js'), {
    exports, setInterval, clearInterval,
    require(name) {
      if (name === 'electron') return { app: { isPackaged: true } };
      if (name === 'electron-updater') return { autoUpdater: updater };
      if (name === './logger') return { __esModule: true, default: { error: (...args) => errors.push(args) } };
      throw new Error(name);
    },
  });
  updater.checkForUpdates = async () => { throw new Error('network unavailable'); };
  await exports.checkForUpdates();
  assert.match(errors.pop()[1].message, /network unavailable/);
  updater.checkForUpdates = async () => ({ downloadPromise: Promise.reject(new Error('ZIP file not provided')) });
  await exports.checkForUpdates();
  assert.match(errors.pop()[1].message, /ZIP file not provided/);
  updater.checkForUpdates = async () => ({ downloadPromise: Promise.resolve() });
  await exports.checkForUpdates();
  updater.checkForUpdates = async () => null;
  await exports.checkForUpdates();
  await tick(); // Strict rejection mode fails the test if a promise escaped.
  assert.equal(errors.length, 0);

  const fakeProcess = new EventEmitter();
  const exits = [];
  fakeProcess.exit = code => exits.push(code);
  const runnerExports = {};
  vm.runInNewContext(read(plugin, 'bundled/workflow-runner/dist/index.js'), {
    exports: runnerExports, require: () => ({}), process: fakeProcess,
    console: { error() {} },
  });
  const failures = [];
  const runner = { failTrackedRuns: async reason => failures.push(reason) };
  runnerExports.WorkflowRunner.prototype.installCrashHandlers.call(runner, { exitProcess: false });
  fakeProcess.emit('unhandledRejection', new Error('update error'));
  fakeProcess.emit('uncaughtException', new Error('host error'));
  await tick();
  assert.deepEqual(failures, ['unhandledRejection', 'uncaughtException']);
  assert.deepEqual(exits, []);
  fakeProcess.removeAllListeners();
  runnerExports.WorkflowRunner.prototype.installCrashHandlers.call({ failTrackedRuns: async () => {} });
  fakeProcess.emit('unhandledRejection', new Error('standalone failure'));
  await tick();
  assert.deepEqual(exits, [1]); // Preserve standalone runner behavior.
  assert.match(read(plugin, 'dist/index.js'), /installCrashHandlers\(\{ exitProcess: false \}\)/);

  const helper = read(app, 'dist/main/macos-tool-path.js');
  const environment = { platform: 'darwin', env: { PATH: '/custom/bin:/usr/bin:/bin' } };
  const context = { process: environment, require: () => ({ existsSync: dir => dir !== '/usr/local/bin' }) };
  vm.runInNewContext(helper, context);
  const result = environment.env.PATH;
  assert.equal(result, '/custom/bin:/usr/bin:/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin');
  vm.runInNewContext(helper, context);
  assert.equal(environment.env.PATH, result);
  environment.platform = 'linux';
  environment.env.PATH = '/custom/bin';
  vm.runInNewContext(helper, context);
  assert.equal(environment.env.PATH, '/custom/bin');
  console.log('PASS: update failures contained; host survives; standalone exit preserved; PATH fallback scoped and idempotent.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
