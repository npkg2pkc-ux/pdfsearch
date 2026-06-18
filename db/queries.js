// Helper query database (async, pakai sqlite3).
const { all, get, run } = require("./database");

// ====== FILES ======

async function insertFile({ filename, original_name, filepath, file_size, total_pages }) {
  const r = await run(
    `INSERT INTO files (filename, original_name, filepath, file_size, total_pages)
     VALUES (?, ?, ?, ?, ?)`,
    [filename, original_name, filepath, file_size ?? null, total_pages ?? null]
  );
  return r.lastID;
}

async function getFileByFilename(filename) {
  return await get(`SELECT * FROM files WHERE filename = ?`, [filename]);
}

async function getFileByPath(filepath) {
  return await get(`SELECT * FROM files WHERE filepath = ?`, [filepath]);
}

async function getFileById(id) {
  return await get(`SELECT * FROM files WHERE id = ?`, [id]);
}

async function listFiles() {
  return await all(`
    SELECT f.*,
           (SELECT COUNT(*) FROM tags t WHERE t.file_id = f.id) AS tag_count
    FROM files f
    ORDER BY f.created_at DESC
  `);
}

async function deleteFileById(id) {
  await run(`DELETE FROM tags WHERE file_id = ?`, [id]);
  await run(`DELETE FROM files WHERE id = ?`, [id]);
}

// ====== TAGS ======

async function insertTag({ file_id, content, page, type, author }) {
  await run(
    `INSERT INTO tags (file_id, content, page, type, author) VALUES (?, ?, ?, ?, ?)`,
    [file_id, content, page, type || "Unknown", author ?? null]
  );
}

async function replaceTagsForFile(file_id, tagsArray) {
  await run(`DELETE FROM tags WHERE file_id = ?`, [file_id]);
  for (const t of tagsArray) {
    await insertTag({
      file_id,
      content: t.content,
      page: t.page,
      type: t.type,
      author: t.author,
    });
  }
}

async function getTagsByFileId(file_id) {
  return await all(
    `SELECT id, content, page, type, author FROM tags WHERE file_id = ? ORDER BY page, id`,
    [file_id]
  );
}

// ====== SEARCH ======

async function searchByKeyword(keyword) {
  if (!keyword || !keyword.trim()) return [];
  const pattern = `%${keyword.trim()}%`;
  const rows = await all(
    `SELECT f.id        AS file_id,
            f.filename,
            f.original_name,
            f.filepath,
            t.id        AS tag_id,
            t.content,
            t.page,
            t.type,
            t.author
     FROM tags t
     JOIN files f ON f.id = t.file_id
     WHERE t.content LIKE ?
     ORDER BY f.original_name, t.page`,
    [pattern]
  );

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.file_id)) {
      map.set(r.file_id, {
        file_id: r.file_id,
        filename: r.filename,
        original_name: r.original_name,
        filepath: r.filepath,
        tags: [],
      });
    }
    map.get(r.file_id).tags.push({
      id: r.tag_id,
      content: r.content,
      page: r.page,
      type: r.type,
      author: r.author,
    });
  }
  return Array.from(map.values());
}

// ====== SETTINGS ======

async function getSetting(key) {
  const row = await get(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row ? row.value : null;
}

async function setSetting(key, value) {
  await run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value)]
  );
}

async function getActiveFolder() {
  return await getSetting("active_folder");
}

async function setActiveFolder(folder) {
  return await setSetting("active_folder", folder);
}

// Helper: update total_pages sebuah file
async function updateFileTotalPages(id, totalPages) {
  await run(`UPDATE files SET total_pages = ? WHERE id = ?`, [totalPages, id]);
}

module.exports = {
  insertFile,
  getFileByFilename,
  getFileByPath,
  getFileById,
  listFiles,
  deleteFileById,
  insertTag,
  replaceTagsForFile,
  getTagsByFileId,
  searchByKeyword,
  getSetting,
  setSetting,
  getActiveFolder,
  setActiveFolder,
  updateFileTotalPages,
};
