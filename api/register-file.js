const { query } = require("./_utils/db");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).end();
    const body = req.body || {};
    const original_name = body.original_name || body.name;
    const key = body.key;
    const file_size = body.file_size || null;
    if (!original_name || !key) return res.status(400).json({ error: 'original_name and key required' });

    const r = await query(
      `INSERT INTO files(original_name, filename, filepath, file_size, total_pages, tag_count) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [original_name, key, key, file_size, null, 0]
    );
    return res.status(200).json({ success: true, fileId: r.rows[0].id, filename: original_name });
  } catch (err) {
    console.error('/api/register-file error', err && err.message);
    res.status(500).json({ error: err.message });
  }
};
