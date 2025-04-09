const path = require("path");
const fs = require("fs");
const yaml = require("js-yaml");
const Bedrock = require("./bedrockClient");
const dotenv = require("dotenv");
const { faker } = require("@faker-js/faker");
const config = require("../config/config.json");

dotenv.config();

// Cache configuration
const valueCache = new Map();
const uniqueValueCache = new Map();
const CACHE_EXPIRATION = 3600000; // 1 hour

const bedrock = new Bedrock(
  process.env.AWS_REGION,
  process.env.AWS_ACCESS_KEY_ID,
  process.env.AWS_SECRET_ACCESS_KEY
);

function generateCacheKey(fieldName, schema) {
  return `${fieldName}_${JSON.stringify(schema)}`;
}

function generateUniqueCacheKey(fieldName, schema, index) {
  return `${fieldName}_${JSON.stringify(schema)}_${index}`;
}

function setCacheValue(key, value) {
  valueCache.set(key, {
    value,
    timestamp: Date.now(),
  });
}

function getCacheValue(key) {
  const cached = valueCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_EXPIRATION) {
    return cached.value;
  }
  return null;
}

function resolveRef(ref, swagger) {
  if (!ref) return null;
  return ref
    .replace(/^#\//, "")
    .split("/")
    .reduce((obj, key) => obj && obj[key], swagger);
}

function resolveRequestBodySchema(requestBody, swagger) {
  if (!requestBody?.content) return null;

  if (requestBody.content["application/json"]?.schema) {
    const schema = requestBody.content["application/json"].schema;
    return schema.$ref ? resolveRef(schema.$ref, swagger) : schema;
  }

  const firstContentType = Object.keys(requestBody.content)[0];
  if (firstContentType) {
    const schema = requestBody.content[firstContentType].schema;
    return schema.$ref ? resolveRef(schema.$ref, swagger) : schema;
  }

  return null;
}

function resolveSchemaReferences(schema, swagger) {
  if (!schema) return schema;

  if (schema.$ref) {
    return resolveRef(schema.$ref, swagger);
  }

  if (schema.type === "array" && schema.items) {
    schema.items = resolveSchemaReferences(schema.items, swagger);
  }

  if (schema.type === "object" && schema.properties) {
    Object.keys(schema.properties).forEach((propName) => {
      schema.properties[propName] = resolveSchemaReferences(
        schema.properties[propName],
        swagger
      );
    });
  }

  ["allOf", "anyOf", "oneOf"].forEach((key) => {
    if (Array.isArray(schema[key])) {
      schema[key] = schema[key].map((subSchema) =>
        resolveSchemaReferences(subSchema, swagger)
      );
    }
  });

  return schema;
}

function generateUniqueValue(baseValue, type, schema, index) {
  if (!baseValue) return baseValue;

  switch (type) {
    case "string":
      if (schema.format === "uuid") {
        return faker.string.uuid();
      }
      if (schema.format === "email") {
        const [user, domain] = baseValue.split("@");
        return `${user}${index + 1}@${domain}`;
      }
      if (schema.format === "date" || schema.format === "date-time") {
        const date = new Date(baseValue);
        date.setDate(date.getDate() + index);
        return schema.format === "date"
          ? date.toISOString().split("T")[0]
          : date.toISOString();
      }
      return schema.enum
        ? schema.enum[index % schema.enum.length]
        : `${baseValue}-${index + 1}`;

    case "integer":
    case "number":
      const num = Number(baseValue);
      const min = schema.minimum ?? Number.MIN_SAFE_INTEGER;
      const max = schema.maximum ?? Number.MAX_SAFE_INTEGER;
      const increment = Math.max(1, Math.floor((max - min) / 100));
      return Math.min(max, Math.max(min, num + increment * (index + 1)));

    case "boolean":
      return index % 2 === 0;

    default:
      return baseValue;
  }
}

async function generateValueFromBedrock(fieldName, schema, type, required) {
  const prompt = `Generate a single realistic value for API testing matching the below Field Information:
- Name: "${fieldName}"
- Type: ${type}
- Required: ${required}
Schema: ${JSON.stringify(schema)}

Requirements:
1. Generate a single value that matches the type ${type}
2. Follow the Schema
3. The value must be realistic and suitable for API testing
4. Must conform to any schema constraints (format, pattern, enum, min/max)

Format the response as a single JSON object:
START GENERATED DATA
{"${fieldName}": "generated_value"}
END GENERATED DATA`;

  const maxRetries = 3;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      const response = await bedrock.runPrompt(config.model, prompt, {
        max_tokens: 1000,
        temperature: 0.1,
        top_p: 0.9,
      });

      const data = response.content[0].text.trim();
      const startIdx = data.indexOf("START GENERATED DATA");
      const endIdx = data.indexOf("END GENERATED DATA");

      if (startIdx !== -1 && endIdx !== -1) {
        const extractedContent = data.substring(startIdx + 20, endIdx).trim();
        const parsedObject = JSON.parse(extractedContent);
        const value = parsedObject[fieldName];

        if (validateSingleValue(value, schema, required)) {
          return value;
        }
      }
    } catch (err) {
      console.error(
        `Attempt ${attempts + 1}: Error generating value for ${fieldName}: ${
          err.message
        }`
      );
    }
    attempts++;
  }

  return generateFallbackValue(type, schema, required, fieldName);
}

async function getRealisticValueFromBedrock(
  fieldName,
  schema,
  type,
  required,
  index = 0
) {
  // Check unique value cache first
  const uniqueKey = generateUniqueCacheKey(fieldName, schema, index);
  if (uniqueValueCache.has(uniqueKey)) {
    return uniqueValueCache.get(uniqueKey);
  }

  // Get or generate base value
  const cacheKey = generateCacheKey(fieldName, schema);
  let baseValue = getCacheValue(cacheKey);

  if (baseValue === null) {
    baseValue = await generateValueFromBedrock(
      fieldName,
      schema,
      type,
      required
    );
    if (baseValue !== null) {
      setCacheValue(cacheKey, baseValue);
    }
  }

  // Generate unique value for this index
  const uniqueValue =
    index === 0
      ? baseValue
      : generateUniqueValue(baseValue, type, schema, index);
  uniqueValueCache.set(uniqueKey, uniqueValue);
  return uniqueValue;
}

async function generateTestData(
  swagger,
  method,
  apiPath,
  dataCount = 1,
  baseData = null
) {
  const details = swagger.paths?.[apiPath]?.[method.toLowerCase()];
  if (!details) return null;

  const skipParams = config.skipParamsPath
    ? loadSkipParameters(config.skipParamsPath)
    : { parameters: new Set(), requestBody: new Set() };

  const parameters = (details.parameters || [])
    .filter((param) => !skipParams.parameters.has(param.name))
    .map((param) => ({
      ...param,
      schema: resolveSchemaReferences(param.schema, swagger),
    }));

  const requestBodySchema = resolveRequestBodySchema(
    details.requestBody,
    swagger
  );
  let resolvedRequestBodySchema = null;

  if (requestBodySchema) {
    resolvedRequestBodySchema = resolveSchemaReferences(
      requestBodySchema,
      swagger
    );

    if (resolvedRequestBodySchema.properties) {
      const filteredProperties = {};
      const filteredRequired = [];

      Object.entries(resolvedRequestBodySchema.properties)
        .filter(([key]) => !skipParams.requestBody.has(key))
        .forEach(([key, value]) => {
          filteredProperties[key] = value;
          if (resolvedRequestBodySchema.required?.includes(key)) {
            filteredRequired.push(key);
          }
        });

      resolvedRequestBodySchema = {
        ...resolvedRequestBodySchema,
        properties: filteredProperties,
        required: filteredRequired,
      };
    }
  }

  const maxRetries = 3;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      // First generate base values for consistency if not provided
      let baseValues = {};
      if (!baseData) {
        if (parameters.length > 0) {
          baseValues.parameters = {};
          for (const param of parameters) {
            baseValues.parameters[param.name] =
              await getRealisticValueFromBedrock(
                param.name,
                param.schema,
                param.schema.type,
                param.required,
                0
              );
          }
        }

        if (resolvedRequestBodySchema?.properties) {
          baseValues.requestBody = {};
          for (const [field, schema] of Object.entries(
            resolvedRequestBodySchema.properties
          )) {
            baseValues.requestBody[field] = await getRealisticValueFromBedrock(
              field,
              schema,
              schema.type,
              (resolvedRequestBodySchema.required || []).includes(field),
              0
            );
          }
        }
      } else {
        baseValues = baseData;
      }

      // Generate multiple test cases using the base values
      const generatedData = {
        testData: await Promise.all(
          Array.from({ length: dataCount }, async (_, index) => {
            const testCase = {};

            if (parameters.length > 0) {
              testCase.parameters = {};
              for (const param of parameters) {
                if (index === 0 && baseValues.parameters?.[param.name]) {
                  testCase.parameters[param.name] =
                    baseValues.parameters[param.name];
                } else {
                  testCase.parameters[param.name] =
                    await getRealisticValueFromBedrock(
                      param.name,
                      param.schema,
                      param.schema.type,
                      param.required,
                      index
                    );
                }
              }
            }

            if (resolvedRequestBodySchema?.properties) {
              testCase.requestBody = {};
              for (const [field, schema] of Object.entries(
                resolvedRequestBodySchema.properties
              )) {
                if (index === 0 && baseValues.requestBody?.[field]) {
                  testCase.requestBody[field] = baseValues.requestBody[field];
                } else {
                  testCase.requestBody[field] =
                    await getRealisticValueFromBedrock(
                      field,
                      schema,
                      schema.type,
                      (resolvedRequestBodySchema.required || []).includes(
                        field
                      ),
                      index
                    );
                }
              }
            }

            return testCase;
          })
        ),
      };

      // Validate all generated test cases
      const validationErrors = [];
      for (const testCase of generatedData.testData) {
        const errors = await validateGeneratedData(
          testCase,
          parameters,
          resolvedRequestBodySchema
        );
        validationErrors.push(...errors);
      }

      if (validationErrors.length === 0) {
        return generatedData;
      }
    } catch (error) {
      console.error(`Attempt ${retries + 1} failed: ${error.message}`);
    }
    retries++;
  }

  throw new Error(
    `Failed to generate valid test data after ${maxRetries} attempts`
  );
}

// Validation functions
function validateSingleValue(value, schema, required) {
  if (required && (value === undefined || value === null)) {
    return false;
  }

  if (!required && (value === undefined || value === null)) {
    return true;
  }

  if (!validateType(value, schema.type)) {
    return false;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    return false;
  }

  if (schema.type === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      return false;
    }
    if (schema.minLength && value.length < schema.minLength) {
      return false;
    }
    if (schema.maxLength && value.length > schema.maxLength) {
      return false;
    }
    if (schema.format && !validateFormat(value, schema.format)) {
      return false;
    }
  }

  if (schema.type === "number" || schema.type === "integer") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return false;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return false;
    }
    if (schema.multipleOf && value % schema.multipleOf !== 0) {
      return false;
    }
  }

  return true;
}

function validateType(value, expectedType) {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isInteger(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return (
        typeof value === "object" && value !== null && !Array.isArray(value)
      );
    default:
      return false;
  }
}

function validateFormat(value, format) {
  const formatValidators = {
    date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
    "date-time": (v) => !isNaN(Date.parse(v)),
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    uuid: (v) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    uri: (v) => {
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    },
    ipv4: (v) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v),
    ipv6: (v) => /^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i.test(v),
  };

  return formatValidators[format] ? formatValidators[format](value) : true;
}

function generateFallbackValue(type, schema, required, fieldName) {
  if (!required) return undefined;

  const name = fieldName.toLowerCase();

  switch (type) {
    case "string":
      if (schema.enum) return schema.enum[0];
      if (name.includes("email")) return faker.internet.email();
      if (name.includes("name")) return faker.person.fullName();
      if (name.includes("phone")) return faker.phone.number();
      if (name.includes("date")) return faker.date.recent().toISOString();
      if (name.includes("id") || name.includes("uuid"))
        return faker.string.uuid();
      return faker.string.sample(10);

    case "number":
    case "integer":
      return faker.number.int({
        min: schema.minimum || 0,
        max: schema.maximum || 100,
      });

    case "boolean":
      return faker.datatype.boolean();

    default:
      return null;
  }
}

async function validateGeneratedData(testCase, parameters, requestBodySchema) {
  const errors = [];

  // Validate parameters
  if (testCase.parameters) {
    for (const param of parameters) {
      if (param.required && testCase.parameters[param.name] === undefined) {
        errors.push(`Missing required parameter: ${param.name}`);
      } else if (testCase.parameters[param.name] !== undefined) {
        if (
          !validateSingleValue(
            testCase.parameters[param.name],
            param.schema,
            param.required
          )
        ) {
          errors.push(`Invalid value for parameter: ${param.name}`);
        }
      }
    }
  }

  // Validate request body
  if (testCase.requestBody && requestBodySchema) {
    for (const requiredField of requestBodySchema.required || []) {
      if (testCase.requestBody[requiredField] === undefined) {
        errors.push(`Missing required field in request body: ${requiredField}`);
      }
    }

    for (const [fieldName, value] of Object.entries(testCase.requestBody)) {
      const fieldSchema = requestBodySchema.properties?.[fieldName];
      if (!fieldSchema) {
        errors.push(`Unknown field in request body: ${fieldName}`);
      } else if (
        !validateSingleValue(
          value,
          fieldSchema,
          requestBodySchema.required?.includes(fieldName)
        )
      ) {
        errors.push(`Invalid value for field: ${fieldName}`);
      }
    }
  }

  return errors;
}

function loadSkipParameters(skipFilePath) {
  try {
    if (!fs.existsSync(skipFilePath)) {
      return { parameters: new Set(), requestBody: new Set() };
    }

    const fileContent = fs.readFileSync(skipFilePath, "utf8");
    const extension = path.extname(skipFilePath).toLowerCase();
    let skipConfig;

    if (extension === ".yaml" || extension === ".yml") {
      skipConfig = yaml.load(fileContent);
    } else if (extension === ".json") {
      skipConfig = JSON.parse(fileContent);
    } else {
      throw new Error("Unsupported file format. Use .yaml, .yml, or .json");
    }

    return Array.isArray(skipConfig)
      ? {
          parameters: new Set(skipConfig),
          requestBody: new Set(skipConfig),
        }
      : {
          parameters: new Set(skipConfig.parameters || []),
          requestBody: new Set(skipConfig.requestBody || []),
        };
  } catch (error) {
    console.error(`Error loading skip parameters: ${error.message}`);
    return { parameters: new Set(), requestBody: new Set() };
  }
}

// Clean up resources
async function cleanup() {
  try {
    await bedrock.close();
  } catch (error) {
    console.error("Error during cleanup:", error);
  }
}

// Export the necessary functions
module.exports = {
  generateTestData,
  cleanup,
  validateGeneratedData,
  validateSingleValue,
  generateFallbackValue,
  loadSkipParameters,
  valueCache, // Expose for testing purposes
};
