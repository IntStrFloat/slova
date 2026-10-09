const fs = require('node:fs');
const path = require('node:path');

/** Файловый JSON-стор с атомарной записью (спека 11). */
function createFileStore(dataPath, { strict = false, durable = false } = {}) {
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      if (strict && (!data || typeof data !== 'object' || Array.isArray(data))) throw new Error('invalid_store');
      return data;
    } catch (error) {
      if (strict && error.code !== 'ENOENT') throw new Error('store_unavailable');
      return { users: {} };
    }
  }
  function write(data) {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    const tmp = `${dataPath}.tmp`;
    if (durable) {
      const fd = fs.openSync(tmp, 'w', 0o600);
      try {
        fs.fchmodSync(fd, 0o600);
        fs.writeFileSync(fd, JSON.stringify(data));
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
    } else { fs.writeFileSync(tmp, JSON.stringify(data)); }
    fs.renameSync(tmp, dataPath);
    if (durable && process.platform !== 'win32') {
      const directory = fs.openSync(path.dirname(dataPath), 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  }
  return { read, write };
}

/** In-memory стор для тестов. */
function createMemoryStore(initial = { users: {} }) {
  let data = JSON.parse(JSON.stringify(initial));
  return {
    read: () => JSON.parse(JSON.stringify(data)),
    write: (d) => {
      data = JSON.parse(JSON.stringify(d));
    },
  };
}

module.exports = { createFileStore, createMemoryStore };
