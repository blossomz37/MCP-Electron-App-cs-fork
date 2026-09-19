const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const manifest = require('./plugin.json');
const pkg = require('./package.json');
pkg.version = manifest.version;
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
for (const dir of ['dist', 'dist-renderer']) fs.mkdirSync(path.join(root, dir), { recursive: true });
for (const file of ['index.cjs', 'store.cjs', 'theme.cjs']) {
  fs.copyFileSync(path.join(root, 'src', file), path.join(root, 'dist', file));
}
const shared = fs.readFileSync(path.join(root, 'src/theme.cjs'), 'utf8');
fs.writeFileSync(path.join(root, 'dist-renderer/theme.js'), shared.replace('module.exports =', 'export'));
fs.copyFileSync(path.join(root, 'src/view.mjs'), path.join(root, 'dist-renderer/index.js'));
console.log('Built dependency-free backend and browser modules.');
