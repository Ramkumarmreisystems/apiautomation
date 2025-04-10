// utils/database/dbInit.js
const { Pool } = require("pg");
const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();

async function initializeDatabase() {
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
  });

  try {
    // Read the schema SQL file
    const schemaSQL = await fs.readFile(
      path.join(__dirname, "schema.sql"),
      "utf-8"
    );

    // Execute schema creation
    await pool.query(schemaSQL);
    console.log("✓ Database schema initialized successfully");
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  initializeDatabase().catch(console.error);
}

module.exports = initializeDatabase;
