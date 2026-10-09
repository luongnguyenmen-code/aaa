const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const app = require('../src/app');
const server = app.listen(0, '127.0.0.1');
const request = url => new Promise((resolve, reject) => {
  http.get({host:'127.0.0.1', port:server.address().port, path:url}, res => {
    let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));
  }).on('error',reject);
});
(async () => {
  if (!server.listening) await new Promise(resolve=>server.once('listening',resolve));
  for (const name of fs.readdirSync(path.join(root,'src/pages')).filter(n=>n.endsWith('.html')&&!n.startsWith('islepilot_')&&n!=='song-bac.html')) {
    const response=await request('/'+name);
    assert.equal(response.status,200,name);
    assert.equal((response.body.match(/<header\b/g)||[]).length,1,name);
    const source=fs.readFileSync(path.join(root,'src/pages',name),'utf8');
    assert.equal((response.body.match(/<footer\b/g)||[]).length,source.includes('<!-- include:footer -->')?1:0,name);
    assert.ok(!response.body.includes('<!-- include:'),name);
    for (const [,src] of response.body.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      if (/^https?:/.test(src)) continue;
      assert.equal((await request('/'+src.replace(/^\//,''))).status,200, name+': '+src);
    }
  }
  const homepage=await request('/');assert.match(homepage.body,/aria-current="page"/);
  for (const url of ['/src/core/server-config.json','/src/core/config.js','/src/core/auth.js','/src/models/data/portal-data.json','/src/controllers/portal.js']) assert.equal((await request(url)).status,404,url);
  const context=vm.createContext({});
  vm.runInContext((await request('/src/core/web-config.js')).body+'\n'+(await request('/src/api/endpoints.js')).body+'\nglobalThis.url=API.playerVitals;',context);
  assert.equal(context.url,'/api/player/vitals');
  assert.equal((await request('/assets/js/app.js')).status,200);
  console.log('PASS structure: rendered pages, shared layout, active navigation, script URLs, API registry, private source/config and legacy URLs');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
