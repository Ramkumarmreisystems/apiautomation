// utils/database/testCaseLoader.js
const fs = require("fs").promises;
const path = require("path");
const DatabaseService = require("./dbService");

class TestCaseLoader {
  constructor() {
    this.db = new DatabaseService();
    this.outputDir = path.join(process.cwd(), "output");
  }

  async loadTestCasesToDB() {
    try {
      // Get all feature files from output directory
      const featuresDir = path.join(this.outputDir, "features");
      const files = await fs.readdir(featuresDir);
      const featureFiles = files.filter((file) => file.endsWith(".feature"));

      for (const file of featureFiles) {
        const filePath = path.join(featuresDir, file);
        const content = await fs.readFile(filePath, "utf8");
        await this.processFeatureFile(filePath, content);
      }

      console.log("✓ Test cases loaded to database successfully");
    } catch (error) {
      console.error("Error loading test cases:", error);
      throw error;
    }
  }

  async processFeatureFile(filePath, content) {
    const featureLines = content.split("\n");
    let currentFeature = null;
    let currentScenario = null;
    let steps = [];

    for (const line of featureLines) {
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith("Feature:")) {
        // Store feature in DB
        currentFeature = await this.db.getOrCreateFeature(
          filePath,
          trimmedLine.replace("Feature:", "").trim()
        );
      } else if (trimmedLine.startsWith("Scenario:")) {
        // Store previous scenario if exists
        if (currentScenario && steps.length) {
          await this.storeScenarioSteps(currentScenario, steps);
          steps = [];
        }

        // Create new scenario
        currentScenario = await this.db.getOrCreateScenario(
          currentFeature,
          trimmedLine.replace("Scenario:", "").trim()
        );
      } else if (/^(Given|When|Then|And|But)\s/.test(trimmedLine)) {
        // Collect steps
        steps.push({
          type: trimmedLine.split(" ")[0],
          name: trimmedLine.substring(trimmedLine.indexOf(" ")).trim(),
        });
      }
    }

    // Store last scenario's steps
    if (currentScenario && steps.length) {
      await this.storeScenarioSteps(currentScenario, steps);
    }
  }

  async storeScenarioSteps(scenarioId, steps) {
    for (const [index, step] of steps.entries()) {
      await this.db.createStep(scenarioId, {
        name: step.name,
        type: step.type,
        order: index + 1,
      });
    }
  }
}

module.exports = TestCaseLoader;
