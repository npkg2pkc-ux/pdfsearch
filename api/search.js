const { query } = require("./_utils/db");

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return res.status(405).end();
    const kw = (req.query.keyword || "").trim();
    if (!kw) return res.status(200).json({ results: [], count: 0 });
    // Simple ILIKE search over tags.content and join files
    const r = await query(
      `SELECT f.id as file_id, f.original_name, array_agg(t.*) as tags
       FROM tags t JOIN files f ON t.file_id = f.id
       WHERE t.content ILIKE $1
       GROUP BY f.id, f.original_name
       ORDER BY f.id DESC`,
      [`%${kw}%`]
    );
    const results = (r.rows || []).map((r) => ({ file_id: r.file_id, original_name: r.original_name, tags: r.tags || [] }));
    res.status(200).json({ results, count: results.length });
  } catch (err) {
    console.error("/api/search error", err && err.message);
    res.status(500).json({ error: err.message });
  }
};
