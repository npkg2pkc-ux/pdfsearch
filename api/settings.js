const { query } = require("./_utils/db");

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const r = await query("SELECT value FROM settings WHERE key = $1", ["active_folder"]).catch(() => null);
      const active = r && r.rows && r.rows[0] ? r.rows[0].value : null;
      return res.status(200).json({ active_folder: active });
    }
    if (req.method === "POST") {
      const body = req.body || {};
      const active = (body.active_folder || "").trim();
      if (!active) return res.status(400).json({ error: "active_folder wajib diisi" });
      await query(
        `INSERT INTO settings(key, value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
        ["active_folder", active]
      );
      return res.status(200).json({ success: true, active_folder: active });
    }
    res.setHeader("Allow", "GET,POST");
    res.status(405).end("Method Not Allowed");
  } catch (err) {
    console.error("/api/settings error", err && err.message);
    res.status(500).json({ error: err.message });
  }
};
