const fs = require("fs").promises;
const yaml = require("js-yaml");

class SwaggerReader {
  constructor(filePath) {
    this.filePath = filePath;
    this.swaggerData = null;
  }

  async readSwaggerFile() {
    try {
      const data = await fs.readFile(this.filePath, "utf8");
      const fileExtension = this.filePath.split(".").pop().toLowerCase();

      if (fileExtension === "json") {
        this.swaggerData = JSON.parse(data);
      } else if (fileExtension === "yaml" || fileExtension === "yml") {
        this.swaggerData = yaml.load(data);
      } else {
        throw new Error("Unsupported file format. Please use JSON or YAML.");
      }

      return this.swaggerData;
    } catch (err) {
      throw new Error(`Error reading the file: ${err.message}`);
    }
  }

  getEndpoints() {
    if (!this.swaggerData) {
      throw new Error(
        "Swagger data not loaded. Please read the Swagger file first."
      );
    }

    const paths = this.swaggerData.paths;
    const endpoints = [];

    // Process properly nested endpoints
    Object.keys(paths).forEach((path) => {
      const methods = Object.keys(paths[path]);
      const endpointData = {
        path: path,
        methods: methods.map((method) => ({
          method: method,
          summary: paths[path][method].summary || "",
          description: paths[path][method].description || "",
        })),
      };
      endpoints.push(endpointData);
    });

    // Process endpoints that are direct children of the root object
    Object.keys(this.swaggerData).forEach((key) => {
      if (
        typeof this.swaggerData[key] === "object" &&
        this.swaggerData[key] !== null
      ) {
        Object.keys(this.swaggerData[key]).forEach((method) => {
          if (
            ["get", "post", "put", "delete", "patch"].includes(
              method.toLowerCase()
            )
          ) {
            const endpointData = {
              path: key,
              methods: [
                {
                  method: method.toLowerCase(),
                  summary: this.swaggerData[key][method].summary || "",
                  description: this.swaggerData[key][method].description || "",
                },
              ],
            };
            endpoints.push(endpointData);
          }
        });
      }
    });

    return endpoints;
  }

  getSchemas() {
    if (!this.swaggerData) {
      throw new Error(
        "Swagger data not loaded. Please read the Swagger file first."
      );
    }

    const schemas = this.swaggerData.components.schemas;
    return schemas;
  }

  getMethods() {
    const methods = endpoints.forEach((endpoint) => {
      endpoint.methods.forEach((method) => {
        return method;
      });
    });

    return methods;
  }
}

module.exports = SwaggerReader;
