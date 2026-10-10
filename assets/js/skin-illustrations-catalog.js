// Match the supplied illustration pages to the species names used by Skin Studio.
(function(root) {
  const catalog = Object.freeze({
    Triceratops: Object.freeze({file:'triceratops.html', name:'Triceratops'}),
    Troodon: Object.freeze({file:'troodon.html', name:'Troodon'}),
    Tyrannosaurus: Object.freeze({file:'tyrannosaurus.html', name:'Tyrannosaurus'})
  });
  if(typeof module === 'object' && module.exports) module.exports = catalog;
  else root.ST25IllustrationCatalog = catalog;
})(typeof globalThis === 'object' ? globalThis : this);
