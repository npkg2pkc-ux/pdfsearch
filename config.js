// Konfigurasi aplikasi
const path = require("path");
const fs = require("fs");

// Port server
const PORT = process.env.PORT || 3000;

// Path database (bisa dioverride lewat env DB_PATH)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "db", "data.db");

// Upload dir fallback (jika folder aktif belum diset). Bisa dioverride lewat env UPLOAD_DIR_FALLBACK
const UPLOAD_DIR_FALLBACK = process.env.UPLOAD_DIR_FALLBACK || path.join(__dirname, "uploads");

// Pastikan folder fallback ada
if (!fs.existsSync(UPLOAD_DIR_FALLBACK)) {
  fs.mkdirSync(UPLOAD_DIR_FALLBACK, { recursive: true });
}

module.exports = {
  PORT,
  DB_PATH,
  UPLOAD_DIR_FALLBACK,
  MAX_FILE_SIZE_MB: 50,
};
