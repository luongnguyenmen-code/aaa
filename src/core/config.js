const path = require('node:path');
const os = require('node:os');
const ROOT = path.resolve(__dirname, '../..');
module.exports = Object.freeze({
  ROOT, PORT: process.env.PORT || 3000,
  PAGES: path.join(ROOT, 'src/pages'),
  ASSETS: path.join(ROOT, 'assets'),
  CONFIG_FILE: path.join(__dirname, 'server-config.json'),
  TMP_CONFIG_FILE: path.join(os.tmpdir(), 'server-config.json'),
  DATA_FILE: path.join(ROOT, 'src/models/data/portal-data.json'),
  TMP_DATA_FILE: path.join(os.tmpdir(), 'portal-data.json')
});
