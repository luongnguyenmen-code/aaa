const fs = require('node:fs');
const { writeJSON } = require('./json-store');
const Persistent = require('./persistent-state');
const {configFile: CONFIG_FILE, temporaryConfigFile: TMP_CONFIG_FILE} = require('../core/config');
let memoryConfig = null;
let configStamp = null;


function getConfig() {
  if (Persistent.current()) return Persistent.get('config');
  // 1. Đọc từ CONFIG_FILE gốc trong thư mục dự án (Nguồn dữ liệu chính)
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const stat = fs.statSync(CONFIG_FILE);
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      if (memoryConfig && configStamp === stamp) return memoryConfig;
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8').replace(/^\uFEFF/, '');
      memoryConfig = JSON.parse(raw);
      configStamp = stamp;
      return memoryConfig;
    }
  } catch (e) {
    throw Object.assign(new Error('File cấu hình máy chủ không đọc được.'), { status: 503, cause: e });
  }

  if (memoryConfig) return memoryConfig;

  // 2. Fallback đọc từ TMP_CONFIG_FILE (dành cho môi trường Serverless tạm thời)
  try {
    if (fs.existsSync(TMP_CONFIG_FILE)) {
      const raw = fs.readFileSync(TMP_CONFIG_FILE, 'utf-8').replace(/^\uFEFF/, '');
      memoryConfig = JSON.parse(raw);
      return memoryConfig;
    }
  } catch (_) {}

  memoryConfig = {
    server: { name: "ST25 VIETNAM", short_name: "ST25", max_players: 100 },
    garage: {
      default_slots: 3,
      role_limits: { "default": 3, "admin": 20, "mod": 20, ".": 20 },
      player_custom_slots: {},
      user_roles: {}
    },
    islepilot: {
      enabled: true,
      api_base_url: "https://islepilot.eu/api/v1",
      server_id: "cmufraiwk7fnooa01vpdzdhm4",
      api_token: ""
    }
  };
  return memoryConfig;
}


function saveConfig(cfg) {
  if (Persistent.set('config', cfg)) return true;
  try {
    writeJSON(CONFIG_FILE, cfg);
    memoryConfig = cfg;
    configStamp = null;
  } catch (err) {
    memoryConfig = null;
    configStamp = null;
    throw Object.assign(new Error('Không thể lưu cấu hình máy chủ.'), { status: 503, cause: err });
  }
  return true;
}
module.exports = {getConfig, saveConfig};
