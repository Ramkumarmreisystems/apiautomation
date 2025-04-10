// utils/helpers/DatabaseReporter.js
const Helper = require("@codeceptjs/helper");
const path = require("path");
const fs = require("fs").promises;
const { Pool } = require("pg");
require("dotenv").config();

class DatabaseReporter extends Helper {
  constructor(config) {
    super(config);
    this.pool = new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT || 5432,
    });

    this.outputDir = path.join(process.cwd(), "output");
    this.currentTest = null;
    this.currentSuite = null;
  }

  async _beforeSuite(suite) {
    this.currentSuite = suite;
    await this.initializeTables();
    // Create test run record
    const result = await this.pool.query(
      `
      INSERT INTO test_runs (
        environment,
        run_status
      ) VALUES ($1, $2) RETURNING id
    `,
      [process.env.TEST_ENV || "development", "running"]
    );
    this.currentRunId = result.rows[0].id;
  }

  async initializeTables() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS test_runs (
          id SERIAL PRIMARY KEY,
          run_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          environment VARCHAR(50),
          run_status VARCHAR(20),
          duration_ms INTEGER,
          total_tests INTEGER,
          passed_tests INTEGER,
          failed_tests INTEGER
        );

        CREATE TABLE IF NOT EXISTS test_results (
          id SERIAL PRIMARY KEY,
          run_id INTEGER REFERENCES test_runs(id),
          feature_file VARCHAR(255),
          scenario_name TEXT,
          status VARCHAR(20),
          duration_ms INTEGER,
          error_message TEXT,
          stack_trace TEXT,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS test_steps (
          id SERIAL PRIMARY KEY,
          test_result_id INTEGER REFERENCES test_results(id),
          step_name TEXT,
          status VARCHAR(20),
          duration_ms INTEGER,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS artifacts (
          id SERIAL PRIMARY KEY,
          test_result_id INTEGER REFERENCES test_results(id),
          file_path TEXT,
          file_type VARCHAR(50),
          file_size BIGINT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } finally {
      client.release();
    }
  }

  async _before(test) {
    this.currentTest = test;
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        INSERT INTO test_results (
          run_id,
          feature_file,
          scenario_name,
          status
        ) VALUES ($1, $2, $3, $4) RETURNING id
      `,
        [this.currentRunId, test.file, test.title, "running"]
      );
      this.currentTestId = result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async _afterStep(step) {
    if (this.currentTestId) {
      const client = await this.pool.connect();
      try {
        await client.query(
          `
          INSERT INTO test_steps (
            test_result_id,
            step_name,
            status,
            duration_ms
          ) VALUES ($1, $2, $3, $4)
        `,
          [this.currentTestId, step.name, step.status, step.duration || 0]
        );

        // If there's a screenshot, save it as an artifact
        if (step.screenshot) {
          await client.query(
            `
            INSERT INTO artifacts (
              test_result_id,
              file_path,
              file_type,
              file_size
            ) VALUES ($1, $2, $3, $4)
          `,
            [
              this.currentTestId,
              step.screenshot,
              "screenshot",
              0, // You could get actual file size if needed
            ]
          );
        }
      } finally {
        client.release();
      }
    }
  }

  async _after(test) {
    if (this.currentTestId) {
      const client = await this.pool.connect();
      try {
        await client.query(
          `
          UPDATE test_results 
          SET status = $1,
              duration_ms = $2,
              error_message = $3,
              stack_trace = $4
          WHERE id = $5
        `,
          [
            test.state,
            test.duration || 0,
            test.err?.message || null,
            test.err?.stack || null,
            this.currentTestId,
          ]
        );
      } finally {
        client.release();
      }
    }
  }

  async _afterSuite(suite) {
    const client = await this.pool.connect();
    try {
      const stats = {
        total: suite.tests.length,
        passed: suite.tests.filter((t) => t.state === "passed").length,
        failed: suite.tests.filter((t) => t.state === "failed").length,
      };

      await client.query(
        `
        UPDATE test_runs 
        SET run_status = $1,
            duration_ms = $2,
            total_tests = $3,
            passed_tests = $4,
            failed_tests = $5
        WHERE id = $6
      `,
        [
          stats.failed > 0 ? "failed" : "passed",
          suite.duration || 0,
          stats.total,
          stats.passed,
          stats.failed,
          this.currentRunId,
        ]
      );
    } finally {
      client.release();
    }
  }

  async _finishTest() {
    await this.pool.end();
  }
}

module.exports = DatabaseReporter;
