const SwaggerReader = require("./swaggerReader");
const Bedrock = require("./bedrockClient");
const config = require("../config/config.json");

class ApiTestPlanGenerator {
  constructor(swaggerFilePath, config) {
    this.swaggerReader = new SwaggerReader(swaggerFilePath);
    this.bedrock = new Bedrock(
      process.env.AWS_REGION,
      process.env.AWS_ACCESS_KEY_ID,
      process.env.AWS_SECRET_ACCESS_KEY
    );
    this.config = config;
  }

  async generate() {
    await this.swaggerReader.readSwaggerFile();
    const endpoints = this.swaggerReader.getEndpoints();
    return this.generateTestPlan(endpoints);
  }

  async generateTestPlan(endpoints) {
    const prompt = this.createPrompt(endpoints);
    const response = await this.bedrock.runPrompt(config.model, prompt);
    return this.parseResponse(response.content[0].text);
  }

  createPrompt(endpoints) {
    return `
    As an API test plan generator, your task is to create a JSON object containing a comprehensive CRUD (Create, Read, Update, Delete) test plan for the given API endpoints. Follow these instructions precisely:

    1. Your entire response must be a single JSON object.
    2. Do not include any text, code, or explanations outside the JSON object.
    3. Enclose the JSON object with START_JSON and END_JSON markers.
    4. Analyze each endpoint to determine its CRUD operation type.
    5. Group endpoints into logical relations based on their functionality and resource types.
    6. Include ALL endpoints in your test plan.
    7. For each endpoint, provide tests in this order: CREATE (POST), READ (GET), UPDATE (PUT/PATCH), DELETE.
    8. Include validationStep for CREATE, UPDATE, and DELETE operations when a suitable READ (GET) method exists.

    JSON Structure:
    START_JSON
    {
      "testPlan": [
        {
          "name": "<Resource Name>",
          "description": "<Resource Description>",
          "endpoints": [
            {
              "path": "<Endpoint Path>",
              "tests": [
                {
                  "method": "POST",
                  "description": "Create a new <resource>",
                  "expectedStatus": 200,
                  "validationStep": {
                    "method": "GET",
                    "path": "<GET Endpoint Path>",
                    "description": "Validate the created <resource>",
                    "expectedStatus": 200
                  }
                },
                {
                  "method": "GET",
                  "description": "Retrieve <resource> details",
                  "expectedStatus": 200
                },
                {
                  "method": "PUT",
                  "description": "Update <resource> details",
                  "expectedStatus": 200,
                  "validationStep": {
                    "method": "GET",
                    "path": "<GET Endpoint Path>",
                    "description": "Validate the updated <resource>",
                    "expectedStatus": 200
                  }
                },
                {
                  "method": "DELETE",
                  "description": "Delete <resource>",
                  "expectedStatus": 200,
                  "validationStep": {
                    "method": "GET",
                    "path": "<GET Endpoint Path>",
                    "description": "Confirm <resource> deletion",
                    "expectedStatus": 404
                  }
                }
              ]
            }
          ]
        }
      ]
    }
    END_JSON

    API Endpoints:
    ${JSON.stringify(endpoints, null, 2)}

    Instructions for endpoint analysis:
    1. Identify the resource type for each endpoint (e.g., users, products, orders).
    2. Determine the CRUD operation type for each endpoint based on its HTTP method and path:
       - POST methods typically represent CREATE operations
       - GET methods typically represent READ operations
       - PUT/PATCH methods typically represent UPDATE operations
       - DELETE methods typically represent DELETE operations
    3. Group endpoints by resource type in the test plan.
    4. For each resource type, include tests for all available CRUD operations.
    5. If an operation is missing for a resource (e.g., no DELETE endpoint), omit that test from the plan.
    6. Use appropriate status codes based on the operation type (e.g., 200 for successful creation, 200 for successful retrieval/update, 200 for successful deletion).
    7. Include sample request bodies for CREATE and UPDATE operations, using realistic data based on the resource type.

    Remember:
    - Provide only the JSON object, nothing else.
    - Ensure the JSON is valid and follows the exact structure shown above.
    - Use appropriate values based on the provided endpoints and your analysis.
    - Do not omit any required fields in the JSON structure.
    `;
  }

  async parseResponse(response, maxRetries = 3) {
    let attempts = 0;
    while (attempts < maxRetries) {
      try {
        const jsonMatch = response.match(/START_JSON\s*([\s\S]*?)\s*END_JSON/);
        if (!jsonMatch) {
          throw new Error(
            "No JSON object found between START_JSON and END_JSON markers"
          );
        }

        const parsedJSON = JSON.parse(jsonMatch[1]);
        return this.validateTestPlan(parsedJSON);
      } catch (error) {
        attempts++;
        console.error(`Attempt ${attempts}: Error parsing JSON:`, error);

        if (attempts >= maxRetries) {
          console.error("Problematic JSON string:", response);
          throw new Error(`Failed to parse JSON after ${maxRetries} attempts`);
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  validateTestPlan(testPlan) {
    if (!testPlan.testPlan || !Array.isArray(testPlan.testPlan)) {
      throw new Error("Invalid test plan structure");
    }

    testPlan.testPlan.forEach((relation) => {
      if (
        !relation.name ||
        !relation.description ||
        !Array.isArray(relation.endpoints)
      ) {
        throw new Error(`Invalid relation structure in ${relation.name}`);
      }

      relation.endpoints.forEach((endpoint) => {
        if (!endpoint.path || !Array.isArray(endpoint.tests)) {
          throw new Error(`Invalid endpoint structure for ${endpoint.path}`);
        }

        const methodOrder = ["POST", "PUT", "GET", "DELETE"];
        let lastMethodIndex = -1;

        endpoint.tests.forEach((test) => {
          if (!test.method || !test.description || !test.expectedStatus) {
            throw new Error(`Invalid test structure for ${endpoint.path}`);
          }

          const currentMethodIndex = methodOrder.indexOf(test.method);
          if (currentMethodIndex < lastMethodIndex) {
            throw new Error(`Incorrect method order for ${endpoint.path}`);
          }
          lastMethodIndex = currentMethodIndex;
        });
      });
    });

    return testPlan;
  }
}

module.exports = ApiTestPlanGenerator;
