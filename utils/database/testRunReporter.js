// utils/database/testRunReporter.js
const path = require("path");
const fs = require("fs").promises;
const DatabaseService = require("./dbService");

class TestRunReporter {
  constructor() {
    this.db = new DatabaseService();
    this.outputDir = path.join(process.cwd(), "output");
  }

  async processTestRun(results) {
    const runId = await this.db.createTestRun({
      startTime: results.start,
      endTime: results.end,
      environment: process.env.TEST_ENV || "development",
      status: this.calculateOverallStatus(results),
    });

    for (const suite of results.suites) {
      await this.processSuite(runId, suite);
    }

    // Store artifacts
    await this.processArtifacts(runId);

    return runId;
  }

  calculateOverallStatus(results) {
    if (results.failures > 0) return "failed";
    if (results.skipped === results.total) return "skipped";
    return "passed";
  }

  async processSuite(runId, suite) {
    const featureExecution = await this.db.createFeatureExecution(runId, {
      featurePath: suite.file,
      startTime: suite.start,
      endTime: suite.end,
      status: suite.status,
    });

    for (const test of suite.tests) {
      await this.processTest(featureExecution.id, test);
    }
  }

  async processTest(featureExecutionId, test) {
    const scenarioExecution = await this.db.createScenarioExecution(
      featureExecutionId,
      {
        name: test.title,
        status: test.state,
        duration: test.duration,
        error: test.err,
        startTime: test.start,
        endTime: test.end,
      }
    );

    if (test.steps) {
      for (const step of test.steps) {
        await this.processStep(scenarioExecution.id, step);
      }
    }
  }

  async processStep(scenarioExecutionId, step) {
    await this.db.createStepExecution(scenarioExecutionId, {
      name: step.name,
      status: step.status,
      duration: step.duration,
      error: step.error,
      screenshot: step.screenshot,
    });
  }

  async processArtifacts(runId) {
    try {
      const files = await this.scanOutputDirectory();
      for (const file of files) {
        await this.db.createArtifact(runId, {
          type: this.getArtifactType(file),
          path: file,
          size: (await fs.stat(file)).size,
        });
      }
    } catch (error) {
      console.error("Error processing artifacts:", error);
    }
  }

  async scanOutputDirectory(dir = this.outputDir) {
    const files = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.scanOutputDirectory(fullPath)));
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  getArtifactType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const dirname = path.dirname(filePath);

    if (dirname.includes("screenshots")) return "screenshot";
    if (ext === ".feature") return "feature";
    if (ext === ".js" && dirname.includes("step_definitions"))
      return "step_definition";
    if (ext === ".json") return "json";
    if (ext === ".html") return "html";
    if (ext === ".log") return "log";
    return "other";
  }
}

module.exports = TestRunReporter;
