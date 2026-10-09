const path = require('node:path');
const { ROOT } = require('../core/config');
const files = {
  "assets/js/app.js": "src/features/shared/app.js",
  "assets/js/gara.js": "src/features/gara/gara.js",
  "assets/js/home.js": "src/features/home/home.js",
  "assets/js/map.js": "src/features/map/map.js",
  "assets/js/motion.js": "src/features/shared/motion.js",
  "assets/js/quests.js": "src/features/nhiem-vu/quests.js",
  "assets/js/skin-3d.js": "src/features/skin/skin-3d.js",
  "assets/js/skin-editor-ui.js": "src/features/skin/skin-editor-ui.js",
  "assets/js/skin-models.mjs": "src/features/skin/skin-models.mjs",
  "assets/js/skin-viewer.mjs": "src/features/skin/skin-viewer.mjs",
  "assets/js/skin.js": "src/features/skin/skin.js",
  "assets/js/ui.js": "src/features/shared/ui.js",
  "assets/js/zones-data.js": "src/features/map/zones-data.js"
};
module.exports = app => {
  app.get('/assets/js/:file', (req, res, next) => {
    const file = files['assets/js/' + req.params.file];
    if (!file) return next();
    res.sendFile(path.join(ROOT, file));
  });
};
