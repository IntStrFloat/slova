const fs = require('node:fs');
const path = require('node:path');

/** Файловый JSON-стор с атомарной записью (спека 11). */
function createFileStore(dataPath) {
  function read() {
    try {
      return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch {
      return { users: {} };
    }
  }
  function write(data) {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    const tmp = `${dataPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, dataPath);
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
