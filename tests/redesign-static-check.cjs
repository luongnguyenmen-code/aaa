const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let pages=0,scripts=0;
for(const name of fs.readdirSync(path.join(root,'src/pages')).filter(name=>name.endsWith('.html')&&!name.startsWith('islepilot_'))){
  const html=fs.readFileSync(path.join(root,'src/pages',name),'utf8');
  assert.ok(html.includes('assets/css/redesign.css'),name);
  assert.ok(html.includes('/src/features/shared/ui.js'),name);
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc=/.test(match[1])){new vm.Script(match[2],{filename:name});scripts++;}
  for(const [,reference] of html.matchAll(/(?:src|href)="(assets\/[^"?]+)(?:\?[^" ]*)?"/g))assert.ok(fs.existsSync(path.join(root,reference)),`${name}: ${reference}`);
  pages++;
}
for(const file of ['src/features/shared/ui.js','src/features/shared/app.js'])new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
assert.ok(fs.existsSync(path.join(root,'assets/imges/st25-favicon.png')));
console.log(`PASS ${pages} theme pages, ${scripts} inline scripts, local asset references and shared UI syntax`);
