const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// A failed write must leave the previous valid JSON file intact.
function writeJSON(file, data) {
  const text = JSON.stringify(data, null, 2);
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') console.error('Unable to clean temporary JSON file:', error.code); }
  }
}
module.exports = { writeJSON };
