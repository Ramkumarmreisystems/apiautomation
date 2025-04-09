const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const fs = require("fs").promises;
const path = require("path");

class Bedrock {
  constructor(region, accessKeyId, secretAccessKey, logDir = "./logs") {
    this.client = new BedrockRuntimeClient({
      region: region,
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
      },
    });
    this.logDir = logDir;
    this.isClientClosed = false;
  }

  async log(message, type = "info") {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;

    try {
      await fs.mkdir(this.logDir, { recursive: true });
      await fs.appendFile(path.join(this.logDir, "bedrock.log"), logMessage);
    } catch (error) {
      console.error("Error writing to log file:", error);
    }
  }

  async logPromptAndResponse(model, prompt, response, requestId) {
    const logContent = `
Request ID: ${requestId}
Timestamp: ${new Date().toISOString()}
Model: ${model}

PROMPT:
${prompt}

RESPONSE:
${JSON.stringify(response, null, 2)}

${"=".repeat(80)}
`;

    try {
      await fs.mkdir(this.logDir, { recursive: true });
      await fs.appendFile(
        path.join(this.logDir, "prompt_and_responses.log"),
        logContent
      );
    } catch (error) {
      console.error(`Error writing prompt and response to log file:`, error);
    }
  }

  async runPrompt(model, prompt, options = {}) {
    if (this.isClientClosed) {
      throw new Error("Client is closed. Cannot make new requests.");
    }

    const requestId =
      Date.now().toString(36) + Math.random().toString(36).substr(2);

    try {
      let modelConfig;
      if (model === "llama3") {
        modelConfig = this.getLlama3Config(prompt, options);
      } else if (model === "Claude 3.5 Sonnet") {
        modelConfig = this.getClaudeConfig(prompt, options);
      } else {
        throw new Error("Unsupported model specified");
      }

      await this.log(`Sending Bedrock Request for ${model} ${requestId}...`);
      const command = new InvokeModelCommand(modelConfig);
      const apiResponse = await this.client.send(command);

      const decodedResponseBody = new TextDecoder().decode(apiResponse.body);
      const responseBody = JSON.parse(decodedResponseBody);

      await this.logPromptAndResponse(model, prompt, responseBody, requestId);
      await this.log(
        `Prompt and response logged for ${model} request ${requestId}`,
        "info"
      );

      return responseBody;
    } catch (error) {
      await this.log(`Error ${requestId}: ${error.message}`, "error");
      throw new Error(`Error invoking model: ${error.message}`);
    }
  }

  getLlama3Config(prompt, options) {
    return {
      modelId: "meta.llama3-8b-instruct-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        prompt: prompt,
        max_gen_len: options.max_tokens || 8192,
        temperature: options.temperature || 0.2,
        top_p: options.top_p || 0.7,
      }),
    };
  }

  getClaudeConfig(prompt, options) {
    return {
      modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: options.max_tokens || 8192,
        temperature: options.temperature || 0.7,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      }),
    };
  }

  async close() {
    if (!this.isClientClosed) {
      try {
        await this.log("Closing Bedrock client...");
        await this.client.destroy();
        this.isClientClosed = true;
        await this.log("Bedrock client closed successfully");
      } catch (error) {
        await this.log(`Error closing client: ${error.message}`, "error");
        throw new Error(`Failed to close Bedrock client: ${error.message}`);
      }
    }
  }
}

module.exports = Bedrock;
