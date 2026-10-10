const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
// The editor must remain deployable even when its entry page is accidentally removed.
for (const file of ['skin.html', 'assets/js/skin.js', 'assets/js/skin-editor-ui.js', 'assets/css/skin-editor.css']) {
  assert.ok(fs.existsSync(path.join(root, file)), `Skin editor: missing required file ${file}`);
}
let scripts = 0, json = 0, pages = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name) || /^\.(?:redesign|quests)-browser-/.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:js|cjs)$/.test(file)) { new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }); scripts++; }
    else if (file.endsWith('.json')) { JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); json++; }
    else if (file.endsWith('.html')) {
      const html = fs.readFileSync(file, 'utf8');
      for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/\bsrc\s*=|\btype\s*=\s*["'](?:application\/[^"']+|module)/i.test(match[1])) continue;
        new vm.Script(match[2], { filename: file }); scripts++;
      }
      if (path.dirname(file) === root && !entry.name.startsWith('islepilot_')) {
        for (const [, ref] of html.replace(/<script\b[\s\S]*?<\/script>/gi, '').matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
          const clean = ref.split(/[?#]/)[0];
          if (!clean || /^(?:[a-z]+:|\/\/|\/api\/)/i.test(clean)) continue;
          const local = path.resolve(root, clean.replace(/^\//, ''));
          assert.ok(fs.existsSync(local), `${entry.name}: missing ${ref}`);
        }
      }
      pages++;
    }
  }
}
walk(root);
console.log(`PASS project syntax: ${pages} HTML files, ${scripts} scripts, ${json} JSON files; public page local links/assets`);
