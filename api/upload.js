const formidable = require("formidable");
const { uploadBuffer } = require("./_utils/s3");
const { query } = require("./_utils/db");
const fs = require("fs");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).end();
    const form = formidable({ multiples: false });
    form.parse(req, async (err, fields, files) => {
      if (err) return res.status(400).json({ error: err.message });
      const file = files.pdf;
      if (!file) return res.status(400).json({ error: "Tidak ada file pdf" });
      const buffer = fs.readFileSync(file.filepath);
      const key = `uploads/${Date.now()}-${file.originalFilename}`;
      try {
        await uploadBuffer(key, buffer, file.mimetype || "application/pdf");
        const r = await query(
          `INSERT INTO files(original_name, filename, filepath, file_size, total_pages, tag_count)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
          [file.originalFilename, key, key, buffer.length, null, 0]
        );
        return res.status(200).json({ success: true, fileId: r.rows[0].id, filename: file.originalFilename });
      } catch (err2) {
        console.error("upload error", err2 && err2.message);
        return res.status(500).json({ error: err2.message });
      }
    });
  } catch (err) {
    console.error("/api/upload error", err && err.message);
    res.status(500).json({ error: err.message });
  }
};
