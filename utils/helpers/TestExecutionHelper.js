// utils/helpers/TestExecutionHelper.js
const { Helper } = require("@codeceptjs/helper");
const TestCaseLoader = require("../database/testCaseLoader");
const TestRunReporter = require("../database/testRunReporter");
const event = require("codeceptjs").event;

class TestExecutionHelper extends Helper {
  constructor(config) {
    super(config);
    this.testLoader = new TestCaseLoader();
    this.testReporter = new TestRunReporter();
  }

  async _beforeSuite() {
    // Load test cases to DB before starting execution
    await this.testLoader.loadTestCasesToDB();
  }

  async _finishTest(suite) {
    try {
      // Process test results after completion
      const results = {
        start: suite.startTime,
        end: new Date(),
        suites: [suite],
        total: suite.tests.length,
        failures: suite.tests.filter((t) => t.state === "failed").length,
        passes: suite.tests.filter((t) => t.state === "passed").length,
        skipped: suite.tests.filter((t) => t.state === "skipped").length,
      };

      const runId = await this.testReporter.processTestRun(results);
      console.log(`✓ Test results saved to database (Run ID: ${runId})`);
    } catch (error) {
      console.error("Error saving test results:", error);
    }
  }
}

module.exports = TestExecutionHelper;
