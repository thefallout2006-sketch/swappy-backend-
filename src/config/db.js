const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || "swappy_db",
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD || "",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ PostgreSQL connection failed:", err.message);
    console.error("   Check your .env DB_* settings and ensure PostgreSQL is running.");
    process.exit(1);
  }
  release();
  console.log("✅ PostgreSQL connected successfully");
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === "development") {
      console.log(`  [SQL] ${duration}ms — ${text.slice(0, 80)}...`);
    }
    return result;
  } catch (err) {
    console.error("SQL Error:", err.message);
    console.error("Query:", text);
    throw err;
  }
};

const getClient = () => pool.connect();

module.exports = { pool, query, getClient };
