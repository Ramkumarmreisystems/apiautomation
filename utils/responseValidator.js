const axios = require("axios");

class ResponseValidator {
  constructor(swaggerData, config) {
    this.swagger = swaggerData;
    this.config = config;
  }

  async validateCrudOperation(method, path, requestData, responseData) {
    const pathObject = this.swagger.paths[path];
    if (!pathObject) {
      throw new Error(`Path ${path} not found in Swagger definition`);
    }

    const operationObject = pathObject[method.toLowerCase()];
    if (!operationObject) {
      throw new Error(`Method ${method} not defined for path ${path}`);
    }

    switch (method.toUpperCase()) {
      case "POST":
        return this.validatePostResponse(path, requestData, responseData);
      case "PUT":
        return this.validatePutResponse(path, requestData, responseData);
      case "DELETE":
        return this.validateDeleteResponse(path, responseData);
      case "GET":
        return this.validateGetResponse(path, responseData);
      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  async validatePostResponse(path, requestData, responseData) {
    // Validate that the response contains the created resource
    const getPath = this.findGetPathForResource(path);
    if (!getPath) {
      throw new Error(
        `Unable to find GET path for resource created at ${path}`
      );
    }

    const createdResourceId = this.extractResourceIdFromResponse(responseData);
    const getResponse = await this.makeGetRequest(getPath, createdResourceId);

    return this.compareObjects(requestData, getResponse);
  }

  async validatePutResponse(path, requestData, responseData) {
    // Validate that the response reflects the updates made
    const getPath = this.findGetPathForResource(path);
    if (!getPath) {
      throw new Error(
        `Unable to find GET path for resource updated at ${path}`
      );
    }

    const updatedResourceId = this.extractResourceIdFromPath(path);
    const getResponse = await this.makeGetRequest(getPath, updatedResourceId);

    return this.compareObjects(requestData, getResponse);
  }

  async validateDeleteResponse(path, responseData) {
    // Validate that the resource has been deleted
    const getPath = this.findGetPathForResource(path);
    if (!getPath) {
      throw new Error(
        `Unable to find GET path for resource deleted at ${path}`
      );
    }

    const deletedResourceId = this.extractResourceIdFromPath(path);
    try {
      await this.makeGetRequest(getPath, deletedResourceId);
      return false; // If the GET request succeeds, the resource wasn't deleted
    } catch (error) {
      return error.response && error.response.status === 404;
    }
  }

  validateGetResponse(path, responseData) {
    // Validate that the response matches the schema defined in Swagger
    const responseSchema = this.getResponseSchema(path, "get");
    return this.validateAgainstSchema(responseData, responseSchema);
  }

  findGetPathForResource(path) {
    // Logic to find the corresponding GET path for a resource
    // This might involve parsing the path and looking for a matching GET operation
    // For example, if we have a POST to /users, we might look for a GET to /users/{id}
    // This is a simplified version and might need to be adjusted based on your API structure
    const pathParts = path.split("/");
    const resourceName = pathParts[pathParts.length - 1];
    const potentialGetPath = `/${resourceName}/{id}`;

    return this.swagger.paths[potentialGetPath] &&
      this.swagger.paths[potentialGetPath].get
      ? potentialGetPath
      : null;
  }

  extractResourceIdFromResponse(responseData) {
    // Logic to extract the ID of the created/updated resource from the response
    // This might vary depending on your API's response structure
    return responseData.id || responseData._id;
  }

  extractResourceIdFromPath(path) {
    // Logic to extract the ID from the path (for PUT/DELETE operations)
    const pathParts = path.split("/");
    return pathParts[pathParts.length - 1];
  }

  async makeGetRequest(path, id) {
    // Make a GET request to retrieve the resource
    const url = `${this.config.baseUrl}${path.replace("{id}", id)}`;
    const response = await axios.get(url);
    return response.data;
  }

  compareObjects(obj1, obj2) {
    // Compare two objects, ignoring any extra fields in obj2
    return Object.keys(obj1).every(
      (key) => JSON.stringify(obj1[key]) === JSON.stringify(obj2[key])
    );
  }

  getResponseSchema(path, method) {
    // Get the response schema from the Swagger definition
    const responses = this.swagger.paths[path][method].responses;
    const successResponse = responses["200"] || responses["201"];
    return successResponse.content["application/json"].schema;
  }

  validateAgainstSchema(data, schema) {
    // Implement schema validation logic here
    // You might want to use a library like Ajv for more robust validation
    // This is a simplified version
    return Object.keys(schema.properties).every(
      (prop) => typeof data[prop] === schema.properties[prop].type
    );
  }
}

module.exports = ResponseValidator;
