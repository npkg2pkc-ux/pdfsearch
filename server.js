// ============================================================================
// PDF Tag Search - Express Server (pakai sqlite3 async)
// ============================================================================
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const cors = require("cors");
const { PORT, UPLOAD_DIR_FALLBACK, MAX_FILE_SIZE_MB } = require("./config");
const queries = require("./db/queries");
const { scanFolder } = require("./services/pdfScanner");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Serve PDF.js library locally from node_modules/pdfjs-dist/build/
// This avoids CDN/CORS issues and makes the viewer work offline.
app.use(
  "/pdfjs",
  express.static(path.join(__dirname, "node_modules", "pdfjs-dist", "build"), {
    setHeaders: (res, filePath) => {
      // PDF.js worker and main module must be served as JavaScript modules
      if (filePath.endsWith(".mjs") || filePath.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript");
      }
    },
  })
);

function getActiveUploadDir() {
  // Sync fallback; endpoint /settings akan validasi path di server-side
  return UPLOAD_DIR_FALLBACK;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Pakai folder aktif kalau sudah diset, fallback ke uploads
    queries.getActiveFolder().then((folder) => {
      const dir = folder || UPLOAD_DIR_FALLBACK;
      try {
        if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    }).catch((err) => cb(err));
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
    cb(null, unique + "-" + file.originalname);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Hanya file PDF yang diperbolehkan"));
    }
  },
});

// ============================================================================
// GET /settings
// ============================================================================
app.get("/settings", async (req, res) => {
  try {
    const folder = await queries.getActiveFolder();
    res.json({ active_folder: folder || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /settings
// ============================================================================
app.post("/settings", async (req, res) => {
  try {
    const folder = (req.body?.active_folder || "").trim();
    if (!folder) return res.status(400).json({ error: "active_folder wajib diisi" });

    let stat;
    try {
      stat = await fs.stat(folder);
    } catch {
      return res.status(400).json({ error: `Folder tidak ditemukan: ${folder}` });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `Path bukan folder: ${folder}` });
    }

    await queries.setActiveFolder(folder);
    console.log(`[settings] Folder aktif diset ke: ${folder}`);
    res.json({ success: true, active_folder: folder });
  } catch (err) {
    console.error("[settings] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /scan
// ============================================================================
app.post("/scan", async (req, res) => {
  try {
    const folder = await queries.getActiveFolder();
    if (!folder) {
      return res.status(400).json({ error: "Folder aktif belum diset. POST /settings dulu." });
    }
    const reExtract = req.query.reExtract === "true";
    const result = await scanFolder(folder, { reExtract });
    res.json(result);
  } catch (err) {
    console.error("[scan] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /upload
// ============================================================================
app.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Tidak ada file yang diupload" });
    const filePath = req.file.path;
    const stat = await fs.stat(filePath);
    const fileId = await queries.insertFile({
      filename: req.file.filename,
      original_name: req.file.originalname,
      filepath: filePath,
      file_size: stat.size,
      total_pages: null,
    });
    console.log(`[upload] ${req.file.originalname} → id=${fileId}, ukuran=${stat.size} bytes`);
    res.json({ success: true, fileId, filename: req.file.originalname, message: "File berhasil diupload" });
  } catch (err) {
    console.error("[upload] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// GET /search
// ============================================================================
app.get("/search", async (req, res) => {
  try {
    const { keyword } = req.query;
    const results = await queries.searchByKeyword(keyword);
    res.json({ results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// GET /files
// ============================================================================
app.get("/files", async (req, res) => {
  try {
    const files = await queries.listFiles();
    res.json({ files, count: files.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// GET /files/:id/tags
// ============================================================================
app.get("/files/:id/tags", async (req, res) => {
  try {
    const tags = await queries.getTagsByFileId(Number(req.params.id));
    res.json({ tags, count: tags.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// DELETE /files/:id
// ============================================================================
app.get("/files/:id/pdf", async (req, res) => { try { const id = Number(req.params.id); const file = await queries.getFileById(id); if (!file) return res.status(404).json({ error: "File tidak ditemukan" }); const fsSync = require("fs"); if (!fsSync.existsSync(file.filepath)) return res.status(404).json({ error: "File PDF tidak ada di disk" }); const stat = fsSync.statSync(file.filepath); const range = req.headers.range; res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.original_name)}"`); res.setHeader("Accept-Ranges", "bytes"); if (range) { const parts = range.replace(/bytes=/, "").split("-"); const start = parseInt(parts[0], 10); const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1; const chunkSize = end - start + 1; res.status(206); res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`); res.setHeader("Content-Length", chunkSize); fsSync.createReadStream(file.filepath, { start, end }).pipe(res); } else { res.setHeader("Content-Length", stat.size); fsSync.createReadStream(file.filepath).pipe(res); } } catch (err) { console.error("[pdf-stream] Error:", err.message); res.status(500).json({ error: err.message }); } });
app.delete("/files/:id", async (req, res) => {
  try {
    await queries.deleteFileById(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Start server
// ============================================================================
app.listen(PORT, () => {
  console.log(`\n  ===========================================`);
  console.log(`  PDF Tag Search running on http://localhost:${PORT}`);
  console.log(`  Pilih folder PDF dari UI untuk mulai.`);
  console.log(`  ===========================================\n`);
});

