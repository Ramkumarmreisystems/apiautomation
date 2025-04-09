const path = require("path");
const fs = require("fs").promises;
const Bedrock = require("./bedrockClient.js");
const FileHandler = require("./readWriteToFile.js");
const dotenv = require("dotenv");
const CodeceptConfigUpdater = require("./DynamicCodeceptJSConfig.js")

dotenv.config();

class generateTestCases {
  constructor(config) {
    if (!config?.outputDir) {
      throw new Error("outputDir is required in config");
    }

    this.config = config;
    this.codeceptConfigUpdater = new CodeceptConfigUpdater(this.config.codeceptConfigFilePath);
    this.useMockServer = config.useMockServer
    this.featureOutputDir = path.join(config.outputDir, "features");
    this.stepOutputDir = path.join(config.outputDir, "step_definitions");
    this.testDataDir = path.join(config.outputDir, "testData");

    if (this.useMockServer) {
      this.mockServerTestDir = path.join(config.outputDir, "mock_server_tests");
    }

    this.bedrock = new Bedrock(
      process.env.AWS_REGION,
      process.env.AWS_ACCESS_KEY_ID,
      process.env.AWS_SECRET_ACCESS_KEY
    );
  }

  async initialize() {
    await fs.mkdir(this.featureOutputDir, { recursive: true });
    await fs.mkdir(this.stepOutputDir, { recursive: true });

    if (this.useMockServer) {
      await fs.mkdir(this.mockServerTestDir, { recursive: true });
    }
  }
  resolveSchemaRefs(schema, swaggerDoc) {
    if (!schema) return schema;

    // Create a deep copy of the schema to avoid modifying the original one
    const resolvedSchema = JSON.parse(JSON.stringify(schema));

    // Helper function to recursively resolve the references
    const resolveRef = (obj) => {
      if (typeof obj !== "object" || obj === null) return obj;

      if (obj.$ref) {
        // Extract reference path and navigate through the Swagger document
        const refPath = obj.$ref.replace("#/", "").split("/");
        let resolved = swaggerDoc;

        for (const segment of refPath) {
          if (!resolved || !resolved[segment]) {
            console.warn(`Unable to resolve reference path: ${obj.$ref}`);
            return obj; // Return the original reference if it cannot be resolved
          }
          resolved = resolved[segment];
        }

        // Recursively resolve the reference to handle nested references
        return resolveRef(resolved);
      }

      if (Array.isArray(obj)) {
        return obj.map((item) => resolveRef(item));
      }

      // If it's an object, iterate over its properties and resolve references
      const resolvedObj = {};
      for (const [key, value] of Object.entries(obj)) {
        resolvedObj[key] = resolveRef(value);
      }
      return resolvedObj;
    };

    return resolveRef(resolvedSchema);
  }

  analyzeEndpointSchema(swaggerDoc, path, method) {
    const endpoint = swaggerDoc.paths[path]?.[method.toLowerCase()];
    if (!endpoint) {
      console.warn(`Endpoint not found: ${method} ${path}`);
      return {
        summary: "",
        operationId: "",
        parameters: [],
        requestSchema: null,
        responseSchema: null,
        errorResponses: [],
      };
    }

    const requestSchema =
      endpoint.requestBody?.content?.["application/json"]?.schema;
    const responseSchema =
      endpoint.responses?.["200"]?.content?.["application/hal+json"]?.schema;

    return {
      summary: endpoint.summary || "",
      operationId: endpoint.operationId || "",
      parameters: endpoint.parameters || [],
      requestSchema: requestSchema
        ? this.resolveSchemaRefs(requestSchema, swaggerDoc)
        : null,
      responseSchema: responseSchema
        ? this.resolveSchemaRefs(responseSchema, swaggerDoc)
        : null,
      errorResponses: Object.entries(endpoint.responses || {})
        .filter(([code]) => code !== "200")
        .map(([code, response]) => ({
          code,
          description: response.description || "",
          schema: response.content?.["*/*"]?.schema
            ? this.resolveSchemaRefs(response.content["*/*"].schema, swaggerDoc)
            : null,
        })),
    };
  }

  extractFieldValidations(schema) {
    if (!schema) {
      return {
        required: new Set(),
        types: {},
        constraints: {},
      };
    }

    const validations = {
      required: new Set(schema.required || []),
      types: {},
      constraints: {},
    };

    const processProperties = (properties) => {
      if (!properties) return;

      for (const [field, details] of Object.entries(properties)) {
        validations.types[field] = details.type || "unknown";

        const constraints = {};
        const validationFields = [
          "minLength",
          "maxLength",
          "format",
          "enum",
          "pattern",
          "minimum",
          "maximum",
        ];

        validationFields.forEach((field) => {
          if (details[field] !== undefined) {
            constraints[field] = details[field];
          }
        });

        if (Object.keys(constraints).length > 0) {
          validations.constraints[field] = constraints;
        }

        if (details.type === "object" && details.properties) {
          validations.types[field] = {
            type: "object",
            nested: this.extractFieldValidations({
              properties: details.properties,
              required: details.required || [],
            }),
          };
        }

        if (details.type === "array" && details.items) {
          validations.types[field] = {
            type: "array",
            items: this.extractFieldValidations({
              properties: details.items.properties || {},
              required: details.items.required || [],
            }),
          };
        }
      }
    };

    processProperties(schema.properties);
    return validations;
  }

  generatePrompt = async (
    testData,
    fileName,
    endpoint,
    swaggerDoc,
    includeValidations
  ) => {
    // Base API information
    const baseInfo = `
API Details:
- Method: ${endpoint.method}
- Path: ${endpoint.path}
- Summary: ${endpoint.summary}
- Operation ID: ${endpoint.operationId}`;

    // Function to merge queryData into mockData
    const mergeQueryDataIntoMockData = (mockData, queryData) => {
      if (!queryData || typeof queryData !== "object") return mockData;

      if (Array.isArray(mockData.data)) {
        // Apply merge to each element if mockData.data is an array
        mockData.data = mockData.data.map((item) => {
          let updatedItem = { ...item };
          for (const key in queryData) {
            if (queryData.hasOwnProperty(key)) {
              updatedItem[key] = queryData[key];
            }
          }
          return updatedItem;
        });
        return mockData;
      }

      // Handle non-array case
      for (const key in queryData) {
        if (queryData.hasOwnProperty(key) && mockData.hasOwnProperty(key)) {
          if (
            typeof mockData[key] === "object" &&
            !Array.isArray(mockData[key])
          ) {
            mergeQueryDataIntoMockData(mockData[key], queryData[key]);
          } else {
            mockData[key] = queryData[key];
          }
        }
      }

      return mockData;
    };

    // Function to generate mock data using Faker.js
    const generateMockDataFromSchemaWithFaker = (schema, queryData = null) => {
      if (!schema || !schema.type) return {};

      const generateMockValue = (fieldSchema) => {
        if (!fieldSchema || !fieldSchema.type) return null;

        switch (fieldSchema.type) {
          case "string":
            if (fieldSchema.format === "email") {
              return faker.internet.email();
            } else if (fieldSchema.format === "uuid") {
              return faker.datatype.uuid();
            } else if (fieldSchema.format === "date-time") {
              return faker.date.recent().toISOString();
            } else {
              return fieldSchema.example || faker.lorem.words(3);
            }
          case "integer":
          case "number":
            return (
              fieldSchema.example ||
              faker.datatype.number({ min: 1, max: 1000 })
            );
          case "boolean":
            return fieldSchema.example || faker.datatype.boolean();
          case "array":
            if (fieldSchema.items) {
              return [generateMockValue(fieldSchema.items)];
            }
            return [];
          case "object":
            return generateMockDataFromSchemaWithFaker(fieldSchema);
          default:
            return null;
        }
      };

      let mockData = {};
      if (schema.type === "object" && schema.properties) {
        for (const [key, propertySchema] of Object.entries(schema.properties)) {
          mockData[key] = generateMockValue(propertySchema);
        }
      }

      return mergeQueryDataIntoMockData(mockData, queryData);
    };

    // Function to generate mock data using Bedrock
    const generateMockDataFromSchemaWithBedrock = async (
      schema,
      queryData = null
    ) => {
      if (!schema || !schema.type) return {};

      const prompt = `You are an AI designed to generate realistic mock data based on a given JSON schema. Here is the schema:
${JSON.stringify(schema, null, 2)}

Generate ${this.config.testDataSetsCount} realistic mock data for this schema, and ensure it is in valid JSON format. The output should have the following format:

- If the schema defines an array of objects, generate multiple realistic items in the array.
- Make sure to use realistic and context-appropriate values.
- Ensure the format of the output is JSON with "data" as the root key containing an array of objects.

The expected output format is:
---MOCK_DATA_START---
{
  "data": [
    {
      // Your generated mock data object 1 here
    },
    
    // Additional items as needed...
  ]
}
---MOCK_DATA_END---

Please adhere to this structure strictly while generating the output.`;

      const response = await this.bedrock.runPrompt(this.config.model, prompt, {
        max_tokens: 8000,
        temperature: 0.7,
        top_p: 0.9,
      });

      const mockDataMatch = response?.content?.[0]?.text.match(
        /---MOCK_DATA_START---([\s\S]*?)---MOCK_DATA_END---/
      );
      let mockData = mockDataMatch ? mockDataMatch[1].trim() : "{}";

      try {
        mockData = JSON.parse(mockData);
        return mergeQueryDataIntoMockData(mockData, queryData);
      } catch (error) {
        console.error("Error parsing Bedrock response into JSON:", error);
        return {};
      }
    };

    // Main function to generate mock data based on schema
    const generateMockDataFromSchema = async (
      schema,
      useBedrock = false,
      queryData = null
    ) => {
      if (useBedrock) {
        return await generateMockDataFromSchemaWithBedrock(schema, queryData);
      } else {
        return generateMockDataFromSchemaWithFaker(schema, queryData);
      }
    };

    // Method-specific request configuration
    const getMethodSpecificRequestConfig = (method, data) => {
      switch (method.toUpperCase()) {
        case "GET":
          return { query: data };
        case "POST":
        case "PUT":
        case "PATCH":
          return { body: data };
        case "DELETE":
          return { query: data };
        default:
          return { body: data };
      }
    };

    // Extracting response schema from Swagger if available
    const responseSchema =
      swaggerDoc.paths[endpoint.path]?.[endpoint.method.toLowerCase()]
        ?.responses?.["200"]?.content?.["application/json"] ||
      swaggerDoc.paths[endpoint.path]?.[endpoint.method.toLowerCase()]
        ?.responses?.["200"]?.content?.["application/hal+json"]?.schema;

    const resolvedResponseSchema = responseSchema
      ? this.resolveSchemaRefs(responseSchema, swaggerDoc)
      : null;

    // Feature template generation
    const featureTemplate = `
Feature: Test ${endpoint.method} ${endpoint.path} API Endpoint
  As an API user
  I want to test the ${endpoint.method} ${endpoint.path} endpoint
  So that I can verify its functionality and validation rules

  Background:
    Given I have the test data from "${fileName}"
    And I set the headers
      | Content-Type | application/json |
      | Accept       | application/json |`;

    // Generate dynamic steps for the scenarios
    const generateDynamicSteps = async (
      testData,
      endpoint,
      resolvedResponseSchema
    ) => {
      return await Promise.all(
        testData.testData.map(async (data, index) => {
          const requestConfig = getMethodSpecificRequestConfig(
            endpoint.method,
            data
          );

          const mockResponseBody = resolvedResponseSchema
            ? await generateMockDataFromSchema(
                resolvedResponseSchema,
                true,
                requestConfig.query
              )
            : {};

          // console.log(mockResponseBody);

          const mockInteraction = this.useMockServer
            ? `{
  "request": {
    "method": "${endpoint.method.toUpperCase()}",
    "path": "${endpoint.path}",
    ${Object.keys(requestConfig)[0]}: ${JSON.stringify(data)}
  },
  "response": {
    "status": ${data.responseStatus || 200},
    "body": ${JSON.stringify(mockResponseBody, null, 2)}
  }
}`
            : null;

          const responseValidation = includeValidations
            ? `
    And the response should match the following values:
    """
    ${JSON.stringify(mockResponseBody.data[0], null, 2)}
    """`
            : "";

          const getRandomPartialContentValidationFromMockResponse = (
            mockResponseBody,
            includeValidations
          ) => {
            if (
              !includeValidations ||
              !mockResponseBody ||
              typeof mockResponseBody !== "object" ||
              !Array.isArray(mockResponseBody.data)
            ) {
              return "";
            }

            const randomIndex = Math.floor(
              Math.random() * mockResponseBody.data.length
            );
            const randomItem = mockResponseBody.data[randomIndex];
            const keys = Object.keys(randomItem);

            // If no keys found in randomItem, return empty string
            if (keys.length === 0) {
              return "";
            }

            // Randomly pick one field from randomItem
            const randomField = keys[Math.floor(Math.random() * keys.length)];
            const content = randomItem[randomField];

            // Return the validation step for this randomly chosen field
            return `
    And the response field "${randomField}" should contain "${content}"`;
          };

          const partialContentValidation =
            getRandomPartialContentValidationFromMockResponse(
              mockResponseBody,
              includeValidations
            );

          return `
  Scenario: Test Case ${index + 1}
    Given I have request payload from test data
    ${
      this.useMockServer
        ? `And I configure the mock server with the following interaction:
    """
    ${mockInteraction}
    """`
        : ""
    }
    When I send a "${endpoint.method.toUpperCase()}" request to "${
            endpoint.path
          }"
    Then the response status code should be ${
      data.responseStatus || 200
    }${responseValidation}${partialContentValidation}`;
        })
      );
    };

    // Generate the dynamic steps
    const dynamicSteps = await generateDynamicSteps(
      testData,
      endpoint,
      resolvedResponseSchema
    );

    const stepDefinitionRules = `
Step Definition Rules:
1. Required Helper Methods:
   REST Helper:
   - sendGetRequest, sendPostRequest, sendPutRequest, sendPatchRequest, sendDeleteRequest
   - seeResponseCodeIs, seeResponseContainsJson, seeResponseMatchesJsonSchema
   
   Additional Methods:
   - I.haveRequestHeaders for setting headers
   - I.addInteractionToMockServer for mock server configuration
   
   Mockserver helper (required if mockServer flag is true):
   - startMockServer, stopMockServer, addInteractionToMockServer

2. Core Requirements:
   - Use 'const { I } = inject();'
   - Must handle multiple test data rows using TestDataIterator class
   - Each step must exactly match feature file steps
   - Must use try-catch blocks in all steps
   - Must include Before/After hooks if mock server is used

3. Payload Handling:
   Example for handling request payload:
   \`\`\`javascript
   Given('I have request payload from test data', () => {
       const currentData = testContext.testData[testContext.currentDataIndex];
       testContext.requestPayload = currentData;
       testContext.currentDataIndex = (testContext.currentDataIndex + 1) % testContext.testData.length;
   });
   \`\`\`
   - Include standard test data loading function (fs, path, csv-parse/sync, xlsx)
   - Each step must exactly match feature file steps
   - Use provided test data loader function for file handling (JSON, CSV, XLS/XLSX)
    \`\`\`javascript
      const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const xlsx = require('xlsx');

const loadTestData = (filename) => {
${this.useMockServer ? `const filePath = path.join(__dirname, "../../../../../testData", filename);` : `const filePath = path.join(__dirname, "../../../../testData", filename);`}
    
    if (!fs.existsSync(filePath)) {
        throw new Error(\`Test data file not found: \${filename}\`);
    }

    const fileExtension = path.extname(filename).toLowerCase();
    
    try {
        switch (fileExtension) {
            case '.json':
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
                
            case '.csv':
                const csvContent = fs.readFileSync(filePath, 'utf8');
                return csv.parse(csvContent, {
                    columns: true,
                    skip_empty_lines: true,
                    cast: true // Automatically convert strings to numbers where appropriate
                });
                
            case '.xls':
            case '.xlsx':
                const workbook = xlsx.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                return xlsx.utils.sheet_to_json(worksheet, {
                    raw: true,
                    defval: null // Default value for empty cells
                });
                
            default:
                throw new Error(\`Unsupported file format: \${fileExtension}\`);
        }
    } catch (error) {
        throw new Error(\`Error reading file \${filename}: \${error.message}\`);
    }
};
      \`\`\`
   - Must maintain testContext for state management
   - Each step must exactly match feature file steps

4. Response Validation Requirements:
   - For response field validation:
     \`\`\`javascript
     Then('the response should match the following values:', async (values) => {
         try {
             const expectedValues = JSON.parse(values.content);
             await I.seeResponseContainsJson({
                 data: [expectedValues]
             });
         } catch (error) {
             console.error(\`Error validating response values: \${error.message}\`);
             throw error;
         }
     });
     \`\`\`

   - For specific field content validation:
     \`\`\`javascript
     Then('the response field {string} should contain {string}', async (field, value) => {
         try {
             await I.seeResponseContainsJson({
                 data: [{
                     [field]: value
                 }]
             });
         } catch (error) {
             console.error(\`Error checking response field content: \${error.message}\`);
             throw error;
         }
     });
     \`\`\`

5. Mock Server Requirements:
   - If ANY scenario in the feature file uses mock server interactions (indicated by 'I configure the mock server' step),
     MUST include these hooks:
     \`\`\`javascript
      Before(async () => {
          await I.startMockServer();
          testContext = { currentDataIndex: 0 };
      });

     After(async () => {
       await I.stopMockServer();
       testContext = {}; // Clean up
     });
     \`\`\`
   - These hooks are REQUIRED if ANY scenario uses mock configuration, regardless of HTTP method
   - Example mock interaction steps in feature file:
     \`\`\`gherkin
     Given I configure the mock server with the following interaction:
     """
     {
       "request": { ... },
       "response": { ... }
     }
     """
     \`\`\`

6. Test context management:
   - Store only necessary data
   - Clear context between scenarios

7. JSON Parsing Rule:
   - When parsing JSON from feature file docstrings ("""), ALWAYS use JSON.parse(parameter.content)
   - NEVER use JSON.parse(parameter) directly
   - Example for payload parsing:
     ✓ Correct: const data = JSON.parse(payload.content);
     × Incorrect: const data = JSON.parse(payload);
   - Example for mock configuration:
     ✓ Correct: const mockConfig = JSON.parse(interaction.content);
     × Incorrect: const mockConfig = JSON.parse(interaction);
   - This applies to ALL JSON parsing from docstrings in step definitions
   
8. DataTable Parsing Rule:
   - When parsing datatable rows, access cell values using row.cells[index].value
   - Example for headers datatable:
     \`\`\`gherkin
     And I set the headers
       | Content-Type | application/json |
       | Accept       | application/json |
     \`\`\`
     ✓ Correct:
     \`\`\`javascript
     Given('I set the headers', (table) => {
       table.rows.forEach(row => {
         I.haveRequestHeaders({
           [row.cells[0].value]: row.cells[1].value
         });
       });
     });
     \`\`\`
     × Incorrect:
     \`\`\`javascript
     Given('I set the headers', (table) => {
       const headers = table.rows;
       for (const i of headers) {
         I.haveRequestHeaders({ [key]: value });  // key and value not defined
       }
     });
     \`\`\`
   - DataTable structure reference:
     rows = [
       {
         cells: [
           { value: 'header_name' },
           { value: 'header_value' }
         ]
       }
     ]
     
9. When working with test data use this class:

      \`\`\`javascript
      class TestDataIterator {
      constructor(data) {
        this.data = data;
        this.currentIndex = 0;
      }

      next() {
          if (!this.data || !this.data.length) {
            throw new Error("No test data available");
          }
          const currentData = this.data[this.currentIndex];
          this.currentIndex = (this.currentIndex + 1) % this.data.length;
          return currentData;
        }
      }
      \`\`\`
      \`\`\`javascript
            try {
          if (!testContext.dataIterator || testContext.currentFile !== filename) {
            const data = loadTestData(filename);
            testContext.dataIterator = new TestDataIterator(data);
            testContext.currentFile = filename;
          }
        } catch (error) {
          console.error(\`Error loading test data: \${error.message}\`);
          throw error;
        }
     \`\`\`
10. Response Structure:
   - All response validations must account for the 'data' array structure
   - Example expected response format:
     {
         "data": [
             {
                 "field1": "value1",
                 "field2": "value2"
             }
         ]
     }
11. HTTP Method Handling:
   Basic request handling for all methods:
\`\`\`javascript
When('I send a {string} request to {string}', async (method, endpoint) => {
    try {
        switch (method.toUpperCase()) {
            case 'GET':
                await I.sendGetRequest(endpoint);
                break;
            case 'POST':
                await I.sendPostRequest(endpoint, testContext.requestPayload);
                break;
            case 'PUT':
                await I.sendPutRequest(endpoint, testContext.requestPayload);
                break;
            case 'PATCH':
                await I.sendPatchRequest(endpoint, testContext.requestPayload);
                break;
            case 'DELETE':
                await I.sendDeleteRequest(endpoint);
                break;
            default:
                throw new Error(\`Unsupported HTTP method: \${method}\`);
        }
    } catch (error) {
        console.error(\`Error sending request: \${error.message}\`);
        throw error;
    }
});
\`\`\` 
     `;

    return `Generate both feature file and step definitions for testing the ${
      endpoint.method
    } ${endpoint.path} API endpoint and place them between the markers.

${baseInfo}

${
  this.useMockServer
    ? `Note: Mock server is enabled for this test generation.`
    : `Note: Mock server is disabled for this test generation.`
}

Part 1: Feature File
-------------------
Place feature file between markers and use the given request body:
---FEATURE_FILE_START---
${featureTemplate}

${dynamicSteps.join("\n")}
[Generate feature file following the above template]
---FEATURE_FILE_END---

Part 2: Step Definitions
-----------------------
${stepDefinitionRules}

Place step definitions between markers:
---STEP_FILE_START---
[Generate step definitions following the above rules, exactly matching the feature file steps]
---STEP_FILE_END---`;
  };

  async enhanceStepDefinitionsWithAllure(stepContent) {
    const allureRules = `Rules and best practices for integrating Allure reporting seamlessly into your test framework:

1. Add Detailed Attachments
Attachments should be meaningful and concise. Always include:
Example:
\`\`\`javascript
allure.attachment('Request Details', JSON.stringify(requestDetails, null, 2), 'application/json');
allure.attachment('Response Body', JSON.stringify(response.data, null, 2), 'application/json');
\`\`\`

2. Parameterized Tests
Ensure each iteration is uniquely identifiable in Allure by using dynamic names:
\`\`\`javascript
const testData = [{ id: 1, name: 'Test1' }, { id: 2, name: 'Test2' }];

testData.forEach((data) => {
  Scenario(\`Validate data for \${data.name}\`, async () => {
    allure.addParameter('Test Data', JSON.stringify(data, null, 2));
    const response = await I.sendGetRequest(\`/api/data/\${data.id}\`);
    allure.attachment('Response', JSON.stringify(response.data, null, 2), 'application/json');
    // Add assertions
  });
});
\`\`\`

3. Behavior-based Hierarchy
Assign names of epics, features, or user stories for a test, as part of Allure's behavior-based hierarchy:
\`\`\`javascript
const allure = require("allure-js-commons");

Feature("Test My Website");

Scenario("Test Authentication", async () => {
  await allure.epic("Web interface");
  await allure.feature("Essential features");
  await allure.story("Authentication");
  // ...
});
\`\`\`

4. Test Steps
Define test steps or sub-steps with the given name:
\`\`\`javascript
const allure = require("allure-js-commons");
const { Status } = require("allure-js-commons");

Feature("Test My Website");

Scenario("Test Authentication", async () => {
  await allure.step("Step 1", async () => {
    await allure.step("Sub-step 1", async (ctx) => {
      await ctx.parameter("foo", "1");
      // ...
    });
    await allure.step("Sub-step 2", async (ctx) => {
      await ctx.parameter("foo", "2");
      // ...
    });
  });
  await allure.logStep("Step 2", Status.SKIPPED);
});
\`\`\`

5. Parameterized Tests
Specify a name and value of a parameter that was used during this test:
\`\`\`javascript
const allure = require("allure-js-commons");

Feature("Test My Website");

let accounts = new DataTable(["login", "password"]);
accounts.add(["johndoe", "qwerty"]);
accounts.add(["admin", "qwerty"]);

Data(accounts).Scenario("Test Authentication", async ({ current }) => {
  await allure.parameter("Login", current.login);
  await allure.parameter("Password", current.password);
  // ...
});
\`\`\`

6. Use this Import statement 
\`\`\`javascript
const allure = require("allure-js-commons");
\`\`\`
`;

const enhancedStepsPrompt = `
Enhance these step definitions with Allure reporting based on these rules:
${allureRules}
Original step definitions:
${stepContent}

Add appropriate Allure reporting following these requirements:
1. Use endpoint schema information to add:
   - Test descriptions based on endpoint summary
   - Labels for endpoint operationId
   - Parameter validations based on schema constraints
   - Response schema validations
   - Error response handling based on defined responses
2. Add allure.attachment for:
   - Request payloads (matching request schema)
   - Response bodies (matching response schema)
   - Error details (matching error responses)
   - Schema validation results
3. Include test metadata:
   - Feature: Based on endpoint path
   - Story: Based on endpoint method and summary
   - Severity: Based on endpoint criticality
4. Add parameter reporting based on schema definitions
5. Keep all existing functionality intact

Provide the enhanced step definitions between these markers:
---ENHANCED_STEPS_START---
[Enhanced step definitions with all Allure reporting added]
---ENHANCED_STEPS_END---`;


    const response = await this.bedrock.runPrompt(
      this.config.model,
      enhancedStepsPrompt,
      {
        max_tokens: 8192,
        temperature: 0.6,
        top_p: 0.9,
      }
    );

    const enhancedStep = response.content[0].text;

    // console.log("enhancedStep: \n", enhancedStep);

    const enhancedStart = "---ENHANCED_STEPS_START---";
    const enhancedEnd = "---ENHANCED_STEPS_END---";
    const startIndex =
      enhancedStep.indexOf(enhancedStart) + enhancedStart.length;
    const endIndex = enhancedStep.indexOf(enhancedEnd);

    const enhancedStepContent =
      startIndex >= 0 && endIndex >= 0
        ? enhancedStep.slice(startIndex, endIndex).trim()
        : null;

    if (!enhancedStepContent) {
      throw new Error("Could not find enhanced markers in response");
    }

    // console.log("enhancedStepContent: \n", enhancedStepContent);
    try {
      return enhancedStepContent;
    } catch (error) {
      throw new Error(`Failed to parse enhanced response: ${error.message}`);
    }
  }

  extractGeneratedContent = (response) => {
    // Extract feature file content
    const featureStart = "---FEATURE_FILE_START---";
    const featureEnd = "---FEATURE_FILE_END---";
    const featureStartIndex =
      response.indexOf(featureStart) + featureStart.length;
    const featureEndIndex = response.indexOf(featureEnd);
    const featureContent =
      featureStartIndex >= 0 && featureEndIndex >= 0
        ? response.slice(featureStartIndex, featureEndIndex).trim()
        : null;

    // Extract step definitions content
    const stepStart = "---STEP_FILE_START---";
    const stepEnd = "---STEP_FILE_END---";
    const stepStartIndex = response.indexOf(stepStart) + stepStart.length;
    const stepEndIndex = response.indexOf(stepEnd);
    const stepContent =
      stepStartIndex >= 0 && stepEndIndex >= 0
        ? response.slice(stepStartIndex, stepEndIndex).trim()
        : null;

    if (!featureContent || !stepContent) {
      throw new Error(
        "Failed to extract both feature and step content from response"
      );
    }

    return {
      featureContent,
      stepContent,
    };
  };

  // Function to validate extracted content
  validateExtractedContent = ({ featureContent, enhancedStepContent }) => {
    // Validate feature file content
    const featureRequired = ["Feature:", "Scenario:", "Given", "When", "Then"];
    const missingFeature = featureRequired.filter(
      (item) => !featureContent.includes(item)
    );

    if (missingFeature.length > 0) {
      throw new Error(
        `Invalid feature file: missing ${missingFeature.join(", ")}`
      );
    }

    // console.log("includes: \n", enhancedStepContent);

    // Validate step definitions content
    const stepRequired = ["const { I }", "Given(", "When(", "Then("];
    const missingStep = stepRequired.filter(
      (item) => !enhancedStepContent.includes(item)
    );

    if (missingStep.length > 0) {
      throw new Error(
        `Invalid step definitions: missing ${missingStep.join(", ")}`
      );
    }

    return {
      featureContent: featureContent.trim(),
      enhancedStepContent: enhancedStepContent.trim(),
    };
  };

  generateValidationPrompt(featureContent, enhancedStepContent) {
    return `Please validate if the following feature file and step definitions are compatible and will run correctly together. Check for:
1. All steps in feature file have corresponding step definitions
2. Step definition parameters match feature file usage
3. Step definition implementations are complete and correct
4. No syntax errors or missing dependencies
5. Proper handling of data tables and doc strings
6. Remove unused steps in both feature and step definition file and logically does not do much in the test cases
7. Adherence to comprehensive step definition guidelines, including:
   - Helper methods
   - Core requirements
   - Response validation
   - JSON parsing
   - HTTP method handling
   Ensure compatibility with the feature file and test scenarios.

Feature File:
\`\`\`gherkin
${featureContent}
\`\`\`

Step Definitions:
\`\`\`javascript
${enhancedStepContent}
\`\`\`

Please analyze and respond in the following format:
---VALIDATION_START---
{
  "isValid": boolean,
  "issues": array of strings describing any problems found,
  "correctedFeature": [corrected feature file content if needed, or null],
  "correctedSteps": [corrected step definitions if needed, or null]
}
---VALIDATION_END---`;
  }

  parseValidationResponse(response) {
    const validationStart = "---VALIDATION_START---";
    const validationEnd = "---VALIDATION_END---";
    const startIndex =
      response.indexOf(validationStart) + validationStart.length;
    const endIndex = response.indexOf(validationEnd);

    if (startIndex < 0 || endIndex < 0) {
      throw new Error("Could not find validation markers in response");
    }

    const validationContent = response.slice(startIndex, endIndex).trim();
    try {
      return JSON.parse(validationContent);
    } catch (error) {
      throw new Error(`Failed to parse validation response: ${error.message}`);
    }
  }

  async validateAndCorrectTestFiles(featureContent, enhancedStepContent) {
    const validationPrompt = this.generateValidationPrompt(
      featureContent,
      enhancedStepContent
    );

    const response = await this.bedrock.runPrompt(
      this.config.model,
      validationPrompt,
      {
        max_tokens: 8192,
        temperature: 0.1,
        top_p: 0.7,
      }
    );

    const validationContent = response.content[0].text;

    const validation = this.parseValidationResponse(validationContent);

    if (!validation.isValid) {
      console.log("Validation issues found:", validation.issues);
      return {
        featureContent: validation.correctedFeature || featureContent,
        enhancedStepContent: validation.correctedSteps || enhancedStepContent,
        isValid: false,
        issues: validation.issues,
      };
    }

    return {
      featureContent,
      enhancedStepContent,
      isValid: true,
      issues: [],
    };
  }

  async generateFiles(testPlan, includeValidations) {
    try {
      const swaggerDoc = JSON.parse(
        await fs.readFile("input/swagger/sample-api-doc.json", "utf8")
      );
      await this.initialize();

      for (const group of testPlan.testPlan) {
        console.log(`\nProcessing group: ${group.name}`);

        const groupFeatureDir = path.join(this.featureOutputDir);
        const groupStepDir = path.join(this.stepOutputDir);

        await fs.mkdir(groupFeatureDir, { recursive: true });
        await fs.mkdir(groupStepDir, { recursive: true });

        for (const endpoint of group.endpoints) {
          console.log(`\nProcessing endpoint: ${endpoint.path}`);

          for (const test of endpoint.tests) {
            const fileName = `${test.method.toUpperCase()}${endpoint.path.replace(
              /\//g,
              "_"
            )}.${this.config.testDataFormat}`;
            const testDataPath = path.join(this.testDataDir, fileName);

            console.log(
              `Generating ${includeValidations ? "validated " : ""}test for: ${
                test.method
              } ${endpoint.path} - ${test.description}`
            );

            try {
              const testData = await this.readTestData(
                testDataPath,
                this.config.testDataFormat
              );
              if (!testData?.testData?.length) {
                throw new Error(`Invalid test data structure in ${fileName}`);
              }

              const endpointSchema = this.analyzeEndpointSchema(
                swaggerDoc,
                endpoint.path,
                test.method
              );
              const validations = this.extractFieldValidations(
                endpointSchema.requestSchema
              );

              const endpointInfo = {
                ...endpoint,
                method: test.method,
                path: endpoint.path,
                summary: endpointSchema.summary,
                operationId: endpointSchema.operationId,
                description: test.description,
                requiredFields: Array.from(validations.required).join(", "),
                validations: Object.entries(validations.constraints)
                  .map(([field, constraints]) => {
                    const rules = Object.entries(constraints)
                      .map(([rule, value]) => `${rule}: ${value}`)
                      .join(", ");
                    return `${field}: ${rules}`;
                  })
                  .join("\n"),
                errorResponses: endpointSchema.errorResponses,
                testCase: test,
              };

              const prompt = await this.generatePrompt(
                testData,
                fileName,
                endpointInfo,
                swaggerDoc,
                includeValidations
              );
              // print
              // console.log(prompt);

              const response = await this.bedrock.runPrompt(
                this.config.model,
                prompt,
                {
                  max_tokens: 8192,
                  temperature: 0.1,
                  top_p: 0.7,
                }
              );

              const { featureContent, stepContent } =
                this.extractGeneratedContent(response.content[0].text);
              // console.log("StepContent: \n", stepContent);

              const enhancedStepContent =
                await this.enhanceStepDefinitionsWithAllure(stepContent);

              // console.log("enhancedStepContent: \n", enhancedStepContent);
              const validatedContent = this.validateExtractedContent({
                featureContent,
                enhancedStepContent,
              });

              // Add validation step
              console.log("Validating generated test files...");
              const validationResult = await this.validateAndCorrectTestFiles(
                validatedContent.featureContent,
                validatedContent.enhancedStepContent
              );

              if (!validationResult.isValid) {
                console.log(
                  "Test files required corrections. Issues found:",
                  validationResult.issues
                );
                console.log("Applying corrections...");
              }

              const baseFeatureFileName = `${test.method}${endpoint.path}.feature`.replace(/\\/g, "_");
              const baseStepFileName = `${test.method}${endpoint.path}.js`.replace(/\\/g, "_");

              await Promise.all([
                this.saveTestFiles(baseFeatureFileName, baseStepFileName, validationResult.featureContent, validationResult.enhancedStepContent)
              ]);

              console.log(
                `✓ Successfully generated ${
                  includeValidations ? "validated " : ""
                }test files for ${test.method} ${endpoint.path} - ${
                  test.description
                }`
              );
            } catch (error) {
              console.error(
                `Error processing test case ${test.method} ${endpoint.path} - ${test.description}:`,
                error
              );
              continue;
            }
          }
        }
      }

      console.log(
        `\n✨ All ${
          includeValidations ? "validated " : ""
        }test files generated successfully`
      );
    } catch (error) {
      console.error("Error in test generation:", error);
      throw error;
    }
  }

  async readTestData(filePath, Format) {
    try {
      return await FileHandler.readFromFile(filePath, Format);
    } catch (error) {
      console.error("Error reading test data:", error);
      throw error;
    }
  }

  async saveTestFiles(baseFeatureFileName, baseStepFileName, featureContent, stepContent) {

    const featureFilePath = path.join(
      this.useMockServer ? path.join(this.mockServerTestDir, "features") : this.featureOutputDir,
      baseFeatureFileName
    );
    const stepFilePath = path.join(
      this.useMockServer ? path.join(this.mockServerTestDir, "step_definitions") : this.stepOutputDir,
      baseStepFileName
    );

    await Promise.all([
      this.saveFile(featureFilePath, featureContent),
      this.saveFile(stepFilePath, stepContent),
    ]);

    await this.codeceptConfigUpdater.updateGherkinConfig(featureFilePath, stepFilePath);

    console.log(`Successfully saved test files to: ${this.useMockServer ? this.mockServerTestDir : this.featureOutputDir}`);
  }

  async saveFile(filePath, content) {
    try {
      await FileHandler.writeToFile(filePath, content);
      console.log(`Successfully saved file to: ${filePath}`);
    } catch (error) {
      console.error(`Error saving file to ${filePath}:`, error);
      throw error;
    }
  }
}

module.exports = generateTestCases;
