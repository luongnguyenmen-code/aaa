const fs = require('node:fs');
const path = require('node:path');
const Core = require('../core/config');
const catalog = require('../../assets/js/skin-illustrations-catalog');

function renderIllustration(file, embedded = false) {
  const entry=Object.values(catalog).find(entry=>entry.file===file);
  if (!entry) return null;
  const source = fs.readFileSync(path.join(Core.pagesDir, 'illustrations', file), 'utf8');
  if (!embedded) return source;
  // The original page remains intact on disk; the embedded view fits the preview.
  const styles = `<style>
    html,body{height:100%;overflow:hidden}main{height:100%;max-width:none;padding:0!important;display:flex;flex-direction:column}
    main>header,main>p{display:none}#stage{flex:1;height:auto;min-height:0;margin:0;border-radius:0}
    .controls{flex:none;gap:8px;padding:10px;background:#101810}
    button{min-height:36px;padding:7px 10px;font-size:12px}label{font-size:11px;gap:6px}input{width:75px}
    @media(prefers-reduced-motion:reduce){#fallback{animation:none}}
  </style>`;
  const reducedMotion = `<script>
    if(matchMedia('(prefers-reduced-motion: reduce)').matches) document.getElementById('play').click();
    function reportReady() {
      requestAnimationFrame(() => requestAnimationFrame(() => parent.postMessage({
        type:'st25-illustration-ready', species:${JSON.stringify(entry.name)},
        image:document.getElementById('fallback').naturalWidth>0,
        rendered:frames>0
      }, '*')));
    }
    if(document.getElementById('fallback').complete) reportReady();
    else document.getElementById('fallback').addEventListener('load',reportReady,{once:true});
  </script>`;
  return source.replace('</style>', '</style>'+styles).replace('</html>', reducedMotion+'</html>');
}
module.exports = {renderIllustration};
