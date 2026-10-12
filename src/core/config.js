const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');

// Shell/hosting values take precedence over the local .env file.
for (const name of ['.env.local', '.env']) {
  const envFile = path.join(root, name);
  if (!fs.existsSync(envFile)) continue;
  for (const line of fs.readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}
const dataDirectory = process.env.ST25_DATA_DIR;
const temporaryDirectory = path.join(os.tmpdir(), 'st25-' + require('node:crypto').createHash('sha256').update(root).digest('hex').slice(0, 12));

module.exports = Object.freeze({
  root,
  port: process.env.PORT || 3000,
  pagesDir: path.join(root, 'src/pages'),
  partialsDir: path.join(root, 'src/views/partials'),
  assetsDir: path.join(root, 'assets'),
  featuresDir: path.join(root, 'src/features'),
  configFile: dataDirectory ? path.resolve(dataDirectory, 'server-config.json') : path.join(root, 'src/core/server-config.json'),
  dataFile: dataDirectory ? path.resolve(dataDirectory, 'portal-data.json') : path.join(root, 'src/models/data/portal-data.json'),
  mutationJournalFile: path.join(dataDirectory ? path.resolve(dataDirectory) : path.join(root, 'src/models/data'), 'mutation-journal.json'),
  temporaryConfigFile: path.join(temporaryDirectory, 'server-config.json'),
  temporaryDataFile: path.join(temporaryDirectory, 'portal-data.json'),
  upstreamBaseURL: process.env.ISLEPILOT_API_BASE_URL || 'https://islepilot.eu/api/v1'
});
