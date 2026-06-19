const path = require('path');
const os = require('os');
const fs = require('fs');
const { getObjectStream } = require('../api/_utils/s3');
const { query } = require('../api/_utils/db');
const { extractPdfAnnotations } = require('../services/pdfExtractor');

async function downloadToTemp(key) {
  const tmpDir = os.tmpdir();
  const filename = path.join(tmpDir, `pdf_${Date.now()}_${Math.random().toString(36).slice(2,8)}.pdf`);
  const resp = await getObjectStream(key);
  // resp.Body is a stream (Readable)
  const stream = resp.Body;
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(filename);
    stream.pipe(w);
    stream.on('error', reject);
    w.on('finish', resolve);
    w.on('error', reject);
  });
  return filename;
}

async function processOne() {
  // Find a file with total_pages IS NULL (not processed yet)
  const r = await query("SELECT id, filename, filepath, original_name FROM files WHERE total_pages IS NULL ORDER BY id ASC LIMIT 1");
  const row = r.rows && r.rows[0];
  if (!row) return false;
  console.log('Processing file', row.id, row.original_name);
  try {
    const tmp = await downloadToTemp(row.filepath);
    const ann = await extractPdfAnnotations(tmp);
    let tagCount = 0;
    for (const a of ann) {
      const page = a.page || 1;
      const type = a.type || 'Unknown';
      const author = a.author || null;
      const content = a.content || '';
      await query(
        `INSERT INTO tags(file_id, page, type, author, content) VALUES($1,$2,$3,$4,$5)`,
        [row.id, page, type, author, content]
      );
      tagCount++;
    }
    const totalPages = ann && ann.length > 0 && ann[0].totalPages ? ann[0].totalPages : null;
    await query(`UPDATE files SET total_pages = $1, tag_count = $2 WHERE id = $3`, [totalPages, tagCount, row.id]);
    try { fs.unlinkSync(tmp); } catch {}
    console.log(`Processed ${row.id}: tags=${tagCount} pages=${totalPages}`);
    return true;
  } catch (err) {
    console.error('Failed processing file', row.id, err && err.message);
    return true; // skip to avoid tight loop
  }
}

async function mainLoop() {
  while (true) {
    try {
      const did = await processOne();
      if (!did) {
        // nothing to do, sleep
        await new Promise((r) => setTimeout(r, 5000));
      }
    } catch (err) {
      console.error('Worker error', err && err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

if (require.main === module) {
  console.log('Starting PDF processor worker');
  mainLoop().catch((err) => { console.error(err); process.exit(1); });
}
