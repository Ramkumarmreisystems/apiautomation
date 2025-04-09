const path = require("path");
const fs = require("fs").promises;
const { generateTestData } = require("./utils/testDataGenerator");
const generateCodeceptConfig = require("./utils/DynamicCodeceptJSConfig");
const ApiTestPlanGenerator = require("./utils/relationGenerator");
const generateTestCases = require("./utils/generateTestCases");
const kleur = require("kleur");
const yaml = require("js-yaml");
const FileHandler = require("./utils/readWriteToFile");

require("dotenv").config();

const CONFIG_PATH = path.join(__dirname, "config", "config.json");

async function loadConfig() {
  try {
    return JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Error reading config file: ${error.message}`);
  }
}

async function loadSwaggerFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return filePath.endsWith(".yaml") || filePath.endsWith(".yml")
      ? yaml.load(content)
      : JSON.parse(content);
  } catch (error) {
    throw new Error(`Error reading Swagger file: ${error.message}`);
  }
}

async function checkDirectoryHasContents(dir) {
  try {
    return (await fs.readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

function filterTestPlan(testPlan, selectedEndpoints) {
  if (!selectedEndpoints) return testPlan;

  return {
    ...testPlan,
    testPlan: testPlan.testPlan
      .map((group) => ({
        ...group,
        endpoints: group.endpoints.filter((endpoint) =>
          selectedEndpoints.includes(endpoint.path)
        ),
      }))
      .filter((group) => group.endpoints.length > 0),
  };
}

function formatOutput(content, type = "normal") {
  switch (type) {
    case "header":
      return kleur.cyan().bold(content);
    case "file":
      return kleur.yellow().bold(content);
    case "success":
      return kleur.green(content);
    case "error":
      return kleur.red(content);
    case "warning":
      return kleur.yellow(content);
    case "info":
      return kleur.blue(content);
    case "separator":
      return kleur.gray("----------------------------------------");
    default:
      return kleur.white(content);
  }
}

async function promptYesNo(question) {
  return new Promise((resolve) => {
    const readline = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    readline.question(formatOutput(question, "success"), (answer) => {
      readline.close();
      resolve(answer.toLowerCase() === "yes");
    });
  });
}

async function handleModifications(config, type) {
  let directory;
  switch (type) {
    case "test data":
      directory = path.join(__dirname, config.testDataDir);
      break;
    case "validations":
      directory = path.join(__dirname, config.outputDir, "validations");
      break;
    case "scripts":
      directory = path.join(config.outputDir);
      break;
    default:
      directory = path.join(config.outputDir);
  }

  console.log(
    formatOutput(`\nTo modify ${type}, please edit the files in:`, "header")
  );
  console.log(formatOutput(directory, "file"));

  return new Promise((resolve) => {
    const readline = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    readline.question(
      formatOutput(
        `\nPress Enter when you have finished modifying the ${type}...`,
        "success"
      ),
      () => {
        readline.close();
        resolve();
      }
    );
  });
}

async function processTestData(config, testPlan) {
  const testDataDir = path.join(__dirname, config.testDataDir);
  const dataConsistencyMap = new Map();

  try {
    await fs.mkdir(testDataDir, { recursive: true });

    if (await checkDirectoryHasContents(testDataDir)) {
      console.log(formatOutput("Existing test data found.", "info"));
    } else {
      const swagger = await loadSwaggerFile(config.swaggerFilePath);

      // First pass: Generate consistent values for all unique fields
      for (const group of testPlan.testPlan) {
        for (const endpoint of group.endpoints) {
          for (const test of endpoint.tests) {
            console.log(
              formatOutput(
                `Processing field values for ${test.method} ${endpoint.path}...`,
                "info"
              )
            );

            // First generate with consistency map to populate it
            await generateTestData(
              swagger,
              test.method,
              endpoint.path,
              1,
              dataConsistencyMap
            );
          }
        }
      }

      // Second pass: Generate actual test data using consistent values
      for (const group of testPlan.testPlan) {
        for (const endpoint of group.endpoints) {
          for (const test of endpoint.tests) {
            console.log(
              formatOutput(
                `Generating test data for ${test.method} ${endpoint.path}...`,
                "info"
              )
            );

            const testData = await generateTestData(
              swagger,
              test.method,
              endpoint.path,
              config.testDataSetsCount || 1,
              dataConsistencyMap
            );

            if (testData) {
              const fileName = `${test.method.toUpperCase()}${endpoint.path.replace(
                /\//g,
                "_"
              )}`;
              const format = config.testDataFormat;

              await FileHandler.writeToFile(
                path.join(testDataDir, `${fileName}.${format}`),
                testData,
                format
              );
            }
          }
        }
      }
    }

    const shouldReview = await promptYesNo(
      "\nWould you like to review/modify the test data? (yes/no): "
    );
    if (shouldReview) {
      await handleModifications(config, "test data");
      console.log(formatOutput("\nTest data review completed.", "success"));
    }
  } catch (error) {
    console.error(
      formatOutput(`Error in test data processing: ${error}`, "error")
    );
    throw error;
  }
}

async function promptForEndpointSelection(testPlan) {
  const endpoints = [];

  // Collect and number all endpoints
  console.log(formatOutput("\nAvailable Endpoints:", "header"));
  testPlan.testPlan.forEach((group) => {
    console.log(formatOutput(`\nGroup: ${group.name}`, "info"));
    group.endpoints.forEach((endpoint) => {
      endpoints.push(endpoint.path);
      console.log(
        formatOutput(`${endpoints.length}. ${endpoint.path}`, "file")
      );
      endpoint.tests.forEach((test) => {
        console.log(
          formatOutput(`   - ${test.method} ${test.description}`, "normal")
        );
      });
    });
  });

  return new Promise((resolve) => {
    const readline = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    readline.question(
      formatOutput(
        "\nEnter the numbers of endpoints to test (comma-separated, or 'all' for all endpoints): ",
        "success"
      ),
      (answer) => {
        readline.close();
        if (answer.toLowerCase().trim() === "all") {
          resolve(null);
        } else {
          const selectedIndices = answer
            .split(",")
            .map((num) => parseInt(num.trim()) - 1)
            .filter((index) => index >= 0 && index < endpoints.length);

          const selectedPaths = selectedIndices.map(
            (index) => endpoints[index]
          );
          resolve(selectedPaths);
        }
      }
    );
  });
}

async function generateApiTestPlan(config) {
  const testPlanPath = path.join(config.outputDir, "api_test_plan.json");
  console.log(formatOutput("Phase 1: Processing Swagger file...", "header"));

  try {
    const generator = new ApiTestPlanGenerator(config.swaggerFilePath, config);
    const fullTestPlan = await generator.generate();

    const selectedEndpoints = await promptForEndpointSelection(fullTestPlan);
    const filteredTestPlan = filterTestPlan(fullTestPlan, selectedEndpoints);
    await fs.writeFile(testPlanPath, JSON.stringify(filteredTestPlan, null, 2));
    console.log(
      formatOutput("API test plan generated successfully.", "success")
    );

    return filteredTestPlan;
  } catch (error) {
    console.error(
      formatOutput(`Failed to generate API test plan: ${error}`, "error")
    );
    throw error;
  }
}

async function generateTestScripts(config, testPlan, includeValidations) {
  const featureFilesDir = path.join(config.outputDir, "features");
  const stepDefinitionsDir = path.join(config.outputDir, "step_definitions");

  try {
    await fs.mkdir(featureFilesDir, { recursive: true });
    await fs.mkdir(stepDefinitionsDir, { recursive: true });

    let shouldRegenerate = true;

    if (
      (await checkDirectoryHasContents(featureFilesDir)) ||
      (await checkDirectoryHasContents(stepDefinitionsDir))
    ) {
      shouldRegenerate = await promptYesNo(
        "\nExisting test scripts found. Would you like to regenerate them? (yes/no): "
      );
    }

    if (shouldRegenerate) {
      const generator = new generateTestCases(config);
      await generator.generateFiles(testPlan, includeValidations);
    } else {
      console.log(formatOutput("Using existing test scripts.", "info"));
    }
  } catch (error) {
    console.error(
      formatOutput(`Error generating test scripts: ${error}`, "error")
    );
    throw error;
  }
}

async function executeTests(config, environment) {
  console.log(
    formatOutput(
      `\nPhase 4: Executing tests in ${environment} environment...`,
      "header"
    )
  );
  // Implementation for test execution
}

function validateConfig(config) {
  const required = ["outputDir", "swaggerFilePath"];
  const missing = required.filter((key) => !config[key]);

  if (missing.length) {
    throw new Error(
      `Missing required config parameters: ${missing.join(", ")}`
    );
  }
}

async function main() {
  try {
    console.log(formatOutput("\nStarting API Test Framework...", "header"));
    // Load and validate config
    const config = await loadConfig();
    validateConfig(config);

    // Initialize key directories
    const directories = {
      output: config.outputDir,
      testData: path.join(config.outputDir, "testData"),
      features: path.join(config.outputDir, "features"),
      steps: path.join(config.outputDir, "step_definitions"),
    };

    // Phase 1: Generate test plan based on Swagger and endpoint selection
    const testPlan = await generateApiTestPlan(config);

    // Phase 2: Generate test data
    await processTestData(config, testPlan);

    // Phase 3: Ask if user wants validations
    const includeValidations = await promptYesNo(
      "\nWould you like to include validations in your tests? (yes/no): "
    );

    // Phase 4: Generate test scripts with optional validations
    await generateTestScripts(config, testPlan, includeValidations);

    // Phase 5: Test execution (if specified)
    if (process.argv.includes("--mock")) {
      await executeTests(config, "mock");
    } else if (process.argv.includes("--dev")) {
      await executeTests(config, "dev");
    }

    console.log(formatOutput("\nOperation completed successfully.", "success"));
  } catch (error) {
    console.error(formatOutput(`\nAn error occurred: ${error}`, "error"));
    process.exit(1);
  }
}

main();
