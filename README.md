# API Test Automation with Gherkin and AI Integration

This project provides a comprehensive framework for generating Gherkin-based test cases and step definitions for API testing, using AI-powered tools like OpenAI and AWS Bedrock. The project reads Swagger (OpenAPI) documentation, processes the API paths and methods, generates test data, and formats the test cases in Gherkin syntax. Additionally, it generates step definitions for use with CodeceptJS, enabling robust automated API testing.

## Table of Contents

- [Installation](notion://www.notion.so/Personal-Home-81c03e2d6e3c425ea0abba9f6e86f9bc#installation)
- [Usage](notion://www.notion.so/Personal-Home-81c03e2d6e3c425ea0abba9f6e86f9bc#usage)
  - [Configuration](notion://www.notion.so/Personal-Home-81c03e2d6e3c425ea0abba9f6e86f9bc#configuration)
  - [Running the Tests](notion://www.notion.so/Personal-Home-81c03e2d6e3c425ea0abba9f6e86f9bc#running-the-tests)
  - [Test Data Generation](notion://www.notion.so/Personal-Home-81c03e2d6e3c425ea0abba9f6e86f9bc#test-data-generation)
  - [Generating HTML Reports](notion://www.notion.so/Personal-Home-81c03e2d6e3c425ea0abba9f6e86f9bc#generating-html-reports)
- [Project Structure](notion://www.notion.so/Personal-Home-81c03e2d6e3c425ea0abba9f6e86f9bc#project-structure)
- [Contributing](notion://www.notion.so/Personal-Home-81c03e2d6e3c425ea0abba9f6e86f9bc#contributing)
- [License](notion://www.notion.so/Personal-Home-81c03e2d6e3c425ea0abba9f6e86f9bc#license)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/Acarin-Inc/api_test_automation.git
   cd api_test_automation

   ```

2. Install the required dependencies:

   ```bash
   npm install

   ```

3. Install additional dependencies for testing and reporting:

   ```bash
   npm install mochawesome --save-dev

   ```

## Usage

### Setting Up AWS Credentials

Ensure your AWS credentials are set up correctly to use AWS Bedrock for AI model integration.

1. Create a `.env` file at the root directory of your project:

   ```bash
   bashCopy code
   touch .env

   ```

2. Add your AWS credentials to the `.env` file:

   ```bash
   bashCopy code
   AWS_ACCESS_KEY_ID="your_access_key_id"
   AWS_SECRET_ACCESS_KEY="your_secret_access_key"
   AWS_REGION="your_aws_region"

   ```

This step is essential for the project to access AWS services using the Bedrock client.

### Configuration

Before running the project, make sure you have a configuration file in the `config` directory. This file should be named `config.json` and should include the following fields:

```json
{
  "swaggerFilePath": "input/swagger.json",
  "outputDir": "output",
  "modelType": "bedrock",
  "openai": {
    "modelId": "text-davinci-003"
  },
  "bedrock": {
    "modelId": "meta.llama3-8b-instruct-v1:0"
  },
  "generateTestData": true
}
```

### Running the Tests

1. To generate the Gherkin test cases and step definitions, run the following command:

   ```bash
   node index.js

   ```

2. The generated Gherkin feature files and step definitions will be saved in the `output` directory specified in the configuration.

### Test Data Generation

The project can automatically generate test data for the API requests based on the schemas defined in the Swagger file. If the `generateTestData` flag is set to `true` in the configuration, the generated test data will be formatted as Gherkin tables and saved in the `testdata` directory.

### Generating HTML Reports

To generate HTML reports for your API test cases:

1. Add the following to your `codecept.conf.js` configuration:

   ```jsx
   mocha: {
     reporterOptions: {
       reportDir: 'output/reports',
       reportFilename: 'report',
       reportTitle: 'API Test Report',
       inlineAssets: true,
       overwrite: false,
     },
   },

   ```

2. Run your tests with the following command:

   ```bash
   npx codeceptjs run --reporter mochawesome

   ```

3. The HTML report will be generated in the `output/reports` directory.

## Project Structure

```bash
├── config/
│   └── config.json          # Configuration file
├── output/
│   └── features/            # Generated Gherkin feature files
│   └── step_definitions/    # Generated step definition files
│   └── testdata/            # Generated test data
├── utils/
│   ├── bedrockClient.js     # AWS Bedrock client for AI model integration
│   ├── swaggerReader.js     # Utility to read and process Swagger files
│   ├── gherkinFormatter.js  # Formatter for Gherkin test cases and step definitions
│   └── testDataGenerator.js # Generates test data based on API schemas
├── index.js                 # Main script to run the test generation
├── README.md                # Project documentation
└── package.json             # Project dependencies and scripts

```

## Contributing

Contributions are welcome! If you'd like to contribute to this project, please fork the repository and submit a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](notion://www.notion.so/LICENSE) file for details.
