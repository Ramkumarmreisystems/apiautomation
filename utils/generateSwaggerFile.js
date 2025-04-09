// generateSwaggerFile.js
const Bedrock = require("./bedrockClient");
const fs = require("fs").promises;
const path = require("path");
const yaml = require("js-yaml");
const dotenv = require("dotenv");
const config = require("../config/config.json");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

class SwaggerFileGenerator {
  constructor(bedrockClient) {
    this.bedrockClient = bedrockClient;
  }

  // Function to read the conversation from the input file
  async readConversationFromFile(filePath) {
    try {
      const conversation = await fs.readFile(filePath, "utf8");
      return conversation;
    } catch (error) {
      console.error(`Error reading conversation from ${filePath}:`, error);
      throw error;
    }
  }

  // Function to create a comprehensive Swagger prompt from the conversation
  createComprehensiveSwaggerPrompt(conversation) {
    return `
As an expert API developer, create a comprehensive and fail-safe Swagger (OpenAPI 3.0) specification file for the given API using the contex from the given conversation. Follow these instructions precisely:

conversation:
  ${conversation}

1. Start with the OpenAPI 3.0 header:
   openapi: 3.0.0

2. Provide detailed info:
   info:
     title: [API Name]
     version: [API Version]
     description: [Brief description of the API]

3. Define servers:
   - List all server URLs where the API is hosted

4. For each endpoint:
   - Specify the path
   - Define HTTP method(s)
   - Provide summary and description
   - List all parameters (path, query, header) with types, descriptions, and whether they're required
   - Define request body if applicable
   - Specify responses for all possible status codes (200, 400, 401, 403, 404, 500, etc.)

5. Define components:
   schemas:
   - Create a schema for each unique data structure used in requests or responses
   - Use appropriate data types (string, number, integer, boolean, array, object)
   - Include descriptions for each property
   - Use enums for fields with predefined values
   - Specify formats for special string types (e.g., date, date-time, email)

6. Define security schemes:
   - Specify authentication methods (e.g., API Key, OAuth2, Bearer Token)

7. Apply security globally or to specific operations as needed

8. Include any reusable parameters or request bodies in the components section

To avoid duplicated mapping keys, ensure the following:
- Each schema, parameter, path, and operation ID has a unique name.
- Validate the YAML using tools like Swagger Editor, YAML Lint, or Spectral.
- Use proper naming conventions and namespace similar entities (e.g., \`UserRequest\`, \`UserResponse\`).
- Avoid copying and pasting content without renaming relevant keys.
- Use \`$ref\` to reference components instead of duplicating them.
- Programmatically generate YAML for large files to minimize human error.
- Group paths logically to prevent redundancy.

Your response must be wrapped in the following markers to ensure proper formatting:

START_OPENAPI
[Your OpenAPI YAML content here]
END_OPENAPI

Use the following template for formatting the Swagger file:

START_OPENAPI
openapi: 3.0.0
info:
  title: [API Name]
  version: [API Version]
  description: [Brief description of the API]
servers:
  - url: [Server URL 1]
    description: [Environment description]
  - url: [Server URL 2]
    description: [Environment description]
paths:
  /examplePath:
    get:
      summary: Example GET operation
      description: Retrieve example data.
      parameters:
        - name: exampleParam
          in: query
          required: true
          description: An example parameter.
          schema:
            type: string
      responses:
        '200':
          description: Success response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ExampleSchema'
components:
  schemas:
    ExampleSchema:
      type: object
      properties:
        exampleField:
          type: string
          description: An example field in the schema.
security:
  - ApiKeyAuth: []
END_OPENAPI

`;
  }

  // Function to save Swagger documentation in .yaml format
  async saveSwaggerToYaml(swaggerContent, filename) {
    const filePath = path.join(
      __dirname,
      "..",
      "input",
      "generated",
      `${filename}.yaml`
    );
    try {
      await fs.writeFile(filePath, swaggerContent);
      console.log(`Swagger documentation saved to ${filePath}`);
    } catch (error) {
      console.error(`Error saving Swagger documentation to YAML file:`, error);
    }
  }

  // Function to generate the Swagger file using AWS Bedrock
  async generateSwaggerFile(conversationFilePath, filename) {
    try {
      // Read the conversation from the input file
      const conversation = await this.readConversationFromFile(
        conversationFilePath
      );

      // Create the prompt using the conversation
      const prompt = this.createComprehensiveSwaggerPrompt(conversation);

      // Run the prompt using the Bedrock client
      const response = await this.bedrockClient.runPrompt(
        config.model,
        prompt,
        {
          max_tokens: 8000,
          temperature: 0.7,
          top_p: 0.9,
        }
      );

      // Extract the text content from the response (assuming response contains content key)
      const text = response.content[0]?.text || response; // Adjust if needed based on actual response structure

      // Extract and clean up YAML content
      const yamlContent = this.extractAndCleanOpenApiContent(text);
      const enhancedYaml = await this.validateAndEnhanceSwagger(yamlContent);

      // Save the Swagger file
      await this.saveSwaggerToYaml(enhancedYaml, filename);
    } catch (error) {
      console.error("Error generating Swagger file:", error);
    }
  }

  // Function to extract and clean Swagger content
  extractAndCleanOpenApiContent(text) {
    const startMarker = "START_OPENAPI";
    const endMarker = "END_OPENAPI";

    if (typeof text !== "string") {
      throw new Error(
        "Response is not a string, unable to extract Swagger content"
      );
    }

    const startIndex = text.indexOf(startMarker);
    const endIndex = text.indexOf(endMarker);

    if (startIndex === -1 || endIndex === -1) {
      throw new Error("OpenAPI content markers not found in the response");
    }

    return text.slice(startIndex + startMarker.length, endIndex).trim();
  }

  // Function to validate and enhance Swagger YAML content
  async validateAndEnhanceSwagger(yamlContent) {
    let parsedYaml;
    try {
      parsedYaml = yaml.load(yamlContent);
    } catch (e) {
      console.error("Generated content is not valid YAML:", e);
      throw e;
    }

    // Ensure components section exists
    if (!parsedYaml.components) {
      parsedYaml.components = {};
    }

    // Ensure schemas exist in components
    if (!parsedYaml.components.schemas) {
      parsedYaml.components.schemas = {};
    }

    // Add missing essential schemas as placeholders
    const essentialSchemas = [
      "OpportunitiesResponse",
      "Opportunity",
      "Award",
      "Awardee",
      "PointOfContact",
      "Address",
      "Link",
      "ErrorResponse",
    ];
    for (const schema of essentialSchemas) {
      if (!parsedYaml.components.schemas[schema]) {
        parsedYaml.components.schemas[schema] = {
          type: "object",
          properties: {},
          description: `Schema for ${schema}`,
        };
      }
    }

    // Ensure security schemes exist
    if (!parsedYaml.components.securitySchemes) {
      parsedYaml.components.securitySchemes = {
        ApiKeyAuth: {
          type: "apiKey",
          in: "query",
          name: "api_key",
        },
      };
    }

    // Ensure global security is defined
    if (!parsedYaml.security) {
      parsedYaml.security = [{ ApiKeyAuth: [] }];
    }

    return yaml.dump(parsedYaml);
  }
}

// Example usage
(async () => {
  const bedrock = new Bedrock(
    process.env.AWS_REGION,
    process.env.AWS_ACCESS_KEY_ID,
    process.env.AWS_SECRET_ACCESS_KEY
  );

  const conversationFilePath = path.join(
    __dirname,
    "..",
    "input",
    "swagger_qa_template.txt"
  );

  const swaggerGenerator = new SwaggerFileGenerator(bedrock);
  await swaggerGenerator.generateSwaggerFile(
    conversationFilePath,
    "opportunities_api_swagger"
  );
})();
