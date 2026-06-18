// Scan folder PDF. Parameter folder WAJIB dari caller.
const fs = require("fs").promises;
const path = require("path");
const queries = require("../db/queries");
const { extractPdfAnnotations } = require("./pdfExtractor");

async function scanFolder(folder, { reExtract = false } = {}) {
  if (!folder || typeof folder !== "string") {
    return { ok: false, error: "Folder belum ditentukan. Set folder aktif dulu.", scanned: 0, added: 0, reExtracted: 0, skipped: 0, errors: [] };
  }

  let stat;
  try {
    stat = await fs.stat(folder);
  } catch (err) {
    return { ok: false, error: `Folder tidak ditemukan: ${folder}`, scanned: 0, added: 0, reExtracted: 0, skipped: 0, errors: [err.message] };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: `Path bukan folder: ${folder}`, scanned: 0, added: 0, reExtracted: 0, skipped: 0, errors: [] };
  }

  let entries;
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch (err) {
    return { ok: false, error: `Gagal baca folder: ${err.message}`, scanned: 0, added: 0, reExtracted: 0, skipped: 0, errors: [err.message] };
  }

  let added = 0;
  let reExtracted = 0;
  let skipped = 0;
  const errors = [];
  let pdfCount = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".pdf")) continue;
    pdfCount++;

    const fullPath = path.join(folder, entry.name);

    try {
      const fileStat = await fs.stat(fullPath);
      const existing = await queries.getFileByPath(fullPath);

      if (existing && !reExtract) {
        skipped++;
        continue;
      }

      let fileId;
      if (!existing) {
        fileId = await queries.insertFile({
          filename: entry.name,
          original_name: entry.name,
          filepath: fullPath,
          file_size: fileStat.size,
          total_pages: null,
        });
        added++;
      } else {
        fileId = existing.id;
        reExtracted++;
      }

      const annotations = await extractPdfAnnotations(fullPath);
      const cleaned = annotations
        .filter((a) => a.content && String(a.content).trim().length > 0)
        .map((a) => ({
          content: String(a.content).trim(),
          page: a.page,
          type: a.type || "Unknown",
          author: a.author || null,
        }));

      await queries.replaceTagsForFile(fileId, cleaned);

      if (annotations.length > 0 && annotations[0].totalPages) {
        await queries.updateFileTotalPages(fileId, annotations[0].totalPages);
      }

      console.log(`[scanner] ${entry.name} → ${cleaned.length} anotasi`);
    } catch (err) {
      errors.push(`${entry.name}: ${err.message}`);
      console.error(`[scanner] Gagal proses ${entry.name}:`, err.message);
    }
  }

  return { ok: true, scanned: pdfCount, added, reExtracted, skipped, errors };
}

module.exports = { scanFolder };
