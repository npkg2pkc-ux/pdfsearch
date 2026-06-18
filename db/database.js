// Koneksi SQLite + inisialisasi skema.
// Pakai sqlite3 (pure JS, tidak perlu build tools/Visual Studio).
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const { DB_PATH } = require("../config");

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("[db] Gagal buka database:", err.message);
    process.exit(1);
  }
  console.log(`[db] Database siap di: ${DB_PATH}`);
});

db.serialize(() => {
  db.run(`PRAGMA journal_mode = WAL`);
  db.run(`PRAGMA foreign_keys = ON`);

  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      filename      TEXT    NOT NULL UNIQUE,
      original_name TEXT    NOT NULL,
      filepath      TEXT    NOT NULL,
      file_size     INTEGER,
      total_pages   INTEGER,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id    INTEGER NOT NULL,
      content    TEXT    NOT NULL,
      page       INTEGER NOT NULL,
      type       TEXT    NOT NULL,
      author     TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_tags_file_id ON tags(file_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tags_content ON tags(content)`);
});

// Wrapper async supaya query lebih mudah dipakai
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

module.exports = { db, all, get, run };
