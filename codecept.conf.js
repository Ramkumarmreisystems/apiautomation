exports.config = {
  output: "./",
  helpers: {
    REST: {
      endpoint: process.env.API_ENDPOINT || "http://localhost:9393",
      defaultHeaders: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
    MockServer: {
      port: process.env.MOCK_PORT || 9393,
      host: process.env.MOCK_HOST || "0.0.0.0",
    },
    JSONResponse: {
      // For response validation
      requestHelper: "REST",
    },
    ChaiWrapper: {
      require: "codeceptjs-chai",
    },
    // DatabaseReporter: {
    //   require: "./utils/helpers/DatabaseReporter.js",
    // },
    // TestExecution: {
    //   require: "./utils/helpers/TestExecutionHelper",
    // },
  },
  include: {
    I: "./steps_file.js",
    support: "./support/support.js",
  },
  bootstrap: null,
  timeout: null,
  teardown: null,
  hooks: [],
  gherkin: {
    features: ["./output/mock_server_tests/features/POST/helpdesk-ticket/v1/tickets.feature","./output/mock_server_tests/features/GET/helpdesk-ticket/v1/tickets.feature"],
    steps: ["./output/mock_server_tests/step_definitions/POST/helpdesk-ticket/v1/tickets.js","./output/mock_server_tests/step_definitions/GET/helpdesk-ticket/v1/tickets.js"],
  },
  plugins: {
    screenshotOnFail: {
      enabled: true,
    },
    allure: {
      enabled: true,
      require: "allure-codeceptjs",
      outputDir: "./allure-results",
    },
    fakerTransform: {
      enabled: true,
    },
  },
  stepTimeout: 0,
  stepTimeoutOverride: [
    {
      pattern: "wait.*",
      timeout: 0,
    },
    {
      pattern: "amOnPage",
      timeout: 0,
    },
  ],
  name: "partner-api-tests",
};
