const { query } = require("./_utils/db");

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return res.status(405).end();
    const r = await query("SELECT id, original_name, filename, file_size, total_pages, tag_count FROM files ORDER BY id DESC");
    return res.status(200).json({ files: r.rows || [], count: (r.rows || []).length });
  } catch (err) {
    console.error("/api/files error", err && err.message);
    res.status(500).json({ error: err.message });
  }
};
