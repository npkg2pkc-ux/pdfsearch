const { Pool } = require("pg");

let pool;
function getPool() {
  if (!pool) {
    const conn = process.env.DATABASE_URL;
    if (!conn) throw new Error("DATABASE_URL not configured");
    pool = new Pool({ connectionString: conn });
  }
  return pool;
}

async function query(text, params) {
  const p = getPool();
  const r = await p.query(text, params);
  return r;
}

module.exports = { getPool, query };
