const fs = require("fs");
const path = require("path");

// Function to load the Swagger file
const loadSwaggerFile = (filePath) => {
  if (typeof filePath !== "string") {
    throw new TypeError(
      `The "filePath" argument must be of type string. Received ${typeof filePath}`
    );
  }

  try {
    const absolutePath = path.resolve(filePath);
    const swaggerData = fs.readFileSync(absolutePath, "utf8");
    return JSON.parse(swaggerData);
  } catch (error) {
    console.error(`Failed to load Swagger file: ${error.message}`);
    throw error;
  }
};

// Function to extract parameters for specific endpoints
const extractParametersForEndpoints = (filePath, endpoints) => {
  const swagger = loadSwaggerFile(filePath);
  const { paths } = swagger;
  const parameters = {};

  endpoints.forEach((endpoint) => {
    const endpointData = paths[endpoint];
    if (endpointData) {
      parameters[endpoint] = Object.fromEntries(
        Object.entries(endpointData).map(([method, details]) => [
          method,
          details.parameters || [],
        ])
      );
    }
  });

  return parameters;
};

// Function to extract schemas related to specific endpoints
const extractSchemasForEndpoints = (filePath, endpoints) => {
  const swagger = loadSwaggerFile(filePath);
  const { paths, components } = swagger;
  const schemas = {};

  endpoints.forEach((endpoint) => {
    const endpointData = paths[endpoint];
    if (endpointData) {
      Object.values(endpointData).forEach((details) => {
        if (details.responses) {
          Object.values(details.responses).forEach((response) => {
            const schemaRef =
              response.content?.["application/json"]?.schema?.["$ref"];
            if (schemaRef) {
              const schemaName = schemaRef.split("/").pop();
              schemas[schemaName] = components.schemas[schemaName];
            }
          });
        }
      });
    }
  });

  return schemas;
};

module.exports = {
  extractParametersForEndpoints,
  extractSchemasForEndpoints,
};
