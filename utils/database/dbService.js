// utils/database/dbService.js
const { Pool } = require("pg");
const path = require("path");
require("dotenv").config();

class DatabaseService {
  constructor() {
    this.pool = new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT || 5432,
    });
  }

  async getOrCreateFeature(featurePath) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Check if feature exists
      const featureResult = await client.query(
        "SELECT id FROM features WHERE file_path = $1",
        [featurePath]
      );

      if (featureResult.rows.length > 0) {
        return featureResult.rows[0].id;
      }

      // Create new feature
      const newFeature = await client.query(
        `INSERT INTO features (feature_name, file_path) 
         VALUES ($1, $2) RETURNING id`,
        [path.basename(featurePath, ".feature"), featurePath]
      );

      await client.query("COMMIT");
      return newFeature.rows[0].id;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getOrCreateScenario(featureId, scenarioName, tags = []) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Check if scenario exists
      const scenarioResult = await client.query(
        "SELECT id FROM scenarios WHERE feature_id = $1 AND scenario_name = $2",
        [featureId, scenarioName]
      );

      if (scenarioResult.rows.length > 0) {
        return scenarioResult.rows[0].id;
      }

      // Create new scenario
      const newScenario = await client.query(
        `INSERT INTO scenarios (feature_id, scenario_name, tags) 
         VALUES ($1, $2, $3) RETURNING id`,
        [featureId, scenarioName, tags]
      );

      await client.query("COMMIT");
      return newScenario.rows[0].id;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createTestRun(environment) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO test_runs (environment, run_status) 
         VALUES ($1, 'pending') RETURNING id`,
        [environment]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async startFeatureExecution(runId, featureId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO feature_executions 
         (run_id, feature_id, execution_status, started_at) 
         VALUES ($1, $2, 'pending', CURRENT_TIMESTAMP) 
         RETURNING id`,
        [runId, featureId]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async startScenarioExecution(featureExecutionId, scenarioId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO scenario_executions 
         (feature_execution_id, scenario_id, execution_status, started_at) 
         VALUES ($1, $2, 'pending', CURRENT_TIMESTAMP) 
         RETURNING id`,
        [featureExecutionId, scenarioId]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async recordStepExecution(
    scenarioExecutionId,
    stepName,
    status,
    duration,
    error = null
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Create or get step
      const stepResult = await client.query(
        `INSERT INTO steps (scenario_id, step_name, step_type, step_order)
         SELECT s.scenario_id, $1, 'step', COALESCE(MAX(steps.step_order), 0) + 1
         FROM scenario_executions se
         JOIN scenarios s ON se.scenario_id = s.id
         LEFT JOIN steps ON steps.scenario_id = s.id
         WHERE se.id = $2
         GROUP BY s.scenario_id
         RETURNING id`,
        [stepName, scenarioExecutionId]
      );

      // Record step execution
      await client.query(
        `INSERT INTO step_executions 
         (scenario_execution_id, step_id, execution_status, duration_ms, error_message, executed_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [scenarioExecutionId, stepResult.rows[0].id, status, duration, error]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordArtifact(stepExecutionId, artifactPath, type) {
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO artifacts 
         (step_execution_id, artifact_type, file_path, file_size) 
         VALUES ($1, $2, $3, $4)`,
        [stepExecutionId, type, artifactPath, 0] // File size could be calculated if needed
      );
    } finally {
      client.release();
    }
  }

  async finishScenarioExecution(scenarioExecutionId, status, error = null) {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE scenario_executions 
         SET execution_status = $1, 
             error_message = $2,
             completed_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [status, error, scenarioExecutionId]
      );
    } finally {
      client.release();
    }
  }

  async finishFeatureExecution(featureExecutionId, status) {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE feature_executions 
         SET execution_status = $1, 
             completed_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [status, featureExecutionId]
      );
    } finally {
      client.release();
    }
  }

  async finishTestRun(runId, status) {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE test_runs 
         SET run_status = $1, 
             duration_ms = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - run_timestamp)) * 1000
         WHERE id = $2`,
        [status, runId]
      );
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = DatabaseService;
