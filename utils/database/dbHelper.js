// utils/database/dbHelper.js
const { Pool } = require("pg");
const path = require("path");
require("dotenv").config();

class DatabaseHelper {
  constructor() {
    this.pool = new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT || 5432,
    });

    // Adjust paths to match your project structure
    this.outputDir = path.join(process.cwd(), "output");
    this.featuresDir = path.join(this.outputDir, "features");
    this.stepDefsDir = path.join(this.outputDir, "step_definitions");
  }

  async initializeTables() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS test_runs (
          id SERIAL PRIMARY KEY,
          run_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          feature_path TEXT,
          step_def_path TEXT,
          total_scenarios INTEGER,
          passed_scenarios INTEGER,
          failed_scenarios INTEGER,
          skipped_scenarios INTEGER,
          duration_ms INTEGER,
          environment VARCHAR(50)
        );

        CREATE TABLE IF NOT EXISTS test_results (
          id SERIAL PRIMARY KEY,
          run_id INTEGER REFERENCES test_runs(id),
          feature_file VARCHAR(255),
          scenario_name TEXT,
          status VARCHAR(50),
          error_message TEXT,
          stack_trace TEXT,
          steps_json JSONB,
          screenshot_paths TEXT[],
          duration_ms INTEGER,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS test_steps (
          id SERIAL PRIMARY KEY,
          test_result_id INTEGER REFERENCES test_results(id),
          step_name TEXT,
          status VARCHAR(50),
          duration_ms INTEGER,
          screenshot_path TEXT,
          error_message TEXT
        );

        CREATE TABLE IF NOT EXISTS test_artifacts (
          id SERIAL PRIMARY KEY,
          run_id INTEGER REFERENCES test_runs(id),
          artifact_type VARCHAR(50),
          relative_path TEXT,
          full_path TEXT,
          file_size BIGINT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log("✓ Database tables initialized successfully");
    } catch (error) {
      console.error("Error initializing database tables:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async saveTestRun(feature, stats) {
    const client = await this.pool.connect();
    try {
      // Get relative paths for feature and step definition files
      const featurePath = path.relative(this.outputDir, feature.file);
      const stepDefPath = path.relative(
        this.outputDir,
        path.join(
          this.stepDefsDir,
          path.basename(feature.file, ".feature") + ".js"
        )
      );

      const result = await client.query(
        `
        INSERT INTO test_runs (
          feature_path,
          step_def_path,
          total_scenarios,
          passed_scenarios,
          failed_scenarios,
          skipped_scenarios,
          duration_ms,
          environment
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
        [
          featurePath,
          stepDefPath,
          stats.tests,
          stats.passes,
          stats.failures,
          stats.skipped,
          stats.duration,
          process.env.TEST_ENV || "development",
        ]
      );

      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async saveTestResult(runId, test) {
    const client = await this.pool.connect();
    try {
      // Start a transaction
      await client.query("BEGIN");

      // Save test result
      const resultRes = await client.query(
        `
        INSERT INTO test_results (
          run_id,
          feature_file,
          scenario_name,
          status,
          error_message,
          stack_trace,
          steps_json,
          screenshot_paths,
          duration_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `,
        [
          runId,
          path.relative(this.outputDir, test.file),
          test.title,
          test.state,
          test.err?.message,
          test.err?.stack,
          JSON.stringify(test.steps || []),
          test.artifacts?.screenshots || [],
          test.duration,
        ]
      );

      const testResultId = resultRes.rows[0].id;

      // Save individual steps if available
      if (test.steps && test.steps.length > 0) {
        for (const step of test.steps) {
          await client.query(
            `
            INSERT INTO test_steps (
              test_result_id,
              step_name,
              status,
              duration_ms,
              screenshot_path,
              error_message
            ) VALUES ($1, $2, $3, $4, $5, $6)
          `,
            [
              testResultId,
              step.name,
              step.status,
              step.duration || 0,
              step.screenshot,
              step.error?.message,
            ]
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveArtifacts(runId) {
    const client = await this.pool.connect();
    try {
      // Get all files in output directory
      const artifacts = await this.scanDirectory(this.outputDir);

      for (const artifact of artifacts) {
        const stats = await fs.stat(artifact.fullPath);
        await client.query(
          `
          INSERT INTO test_artifacts (
            run_id,
            artifact_type,
            relative_path,
            full_path,
            file_size,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `,
          [
            runId,
            artifact.type,
            artifact.relativePath,
            artifact.fullPath,
            stats.size,
            stats.mtime,
          ]
        );
      }
    } finally {
      client.release();
    }
  }

  async scanDirectory(dirPath, baseDir = this.outputDir) {
    const artifacts = [];
    const files = await fs.readdir(dirPath);

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stats = await fs.stat(fullPath);

      if (stats.isDirectory()) {
        const subDirArtifacts = await this.scanDirectory(fullPath, baseDir);
        artifacts.push(...subDirArtifacts);
      } else {
        artifacts.push({
          type: this.getArtifactType(fullPath),
          relativePath: path.relative(baseDir, fullPath),
          fullPath: fullPath,
        });
      }
    }

    return artifacts;
  }

  getArtifactType(filePath) {
    const dir = path.dirname(filePath);
    if (dir.includes("features")) return "feature";
    if (dir.includes("step_definitions")) return "step_definition";
    if (dir.includes("screenshots")) return "screenshot";
    return "other";
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = DatabaseHelper;
