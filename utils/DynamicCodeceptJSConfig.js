const path = require("path");
const fs = require("fs").promises;

class CodeceptConfigUpdater {
  constructor(configFilePath) {
    this.configFilePath = configFilePath;
  }

  async updateGherkinConfig(featureFilePath, stepFilePath) {
    try {
      // Normalize paths to use forward slashes
      const normalizedFeaturePath = `./${featureFilePath.replace(/\\/g, "/")}`.replace(/^\.\//, "./");
      const normalizedStepPath = `./${stepFilePath.replace(/\\/g, "/")}`.replace(/^\.\//, "./");
  
      // Read the current codecept.conf.js file
      const configContent = await fs.readFile(this.configFilePath, "utf-8");
  
      // Extract existing features and steps arrays
      const featuresRegex = /(gherkin:\s*\{\s*features:\s*)(\[[^\]]*\])/;
      const stepsRegex = /(steps:\s*)(\[[^\]]*\])/;
  
      const existingFeaturesMatch = configContent.match(featuresRegex);
      const existingStepsMatch = configContent.match(stepsRegex);
  
      const existingFeatures = existingFeaturesMatch
        ? JSON.parse(existingFeaturesMatch[2].replace(/\\/g, ""))
        : [];
      const existingSteps = existingStepsMatch
        ? JSON.parse(existingStepsMatch[2].replace(/\\/g, ""))
        : [];
  
      // Add specific feature and step files
      const updatedFeatures = Array.from(new Set([...existingFeatures, normalizedFeaturePath]));
      const updatedSteps = Array.from(new Set([...existingSteps, normalizedStepPath]));
  
      // Replace the features and steps arrays in the config content
      const updatedContent = configContent
        .replace(featuresRegex, `$1${JSON.stringify(updatedFeatures)}`)
        .replace(stepsRegex, `$1${JSON.stringify(updatedSteps)}`);
  
      // Write the updated configuration back to the file
      await fs.writeFile(this.configFilePath, updatedContent, "utf-8");
      console.log("Codecept configuration file updated successfully.");
    } catch (error) {
      console.error("Failed to update Codecept configuration:", error);
      throw error;
    }
  }
  
}

module.exports = CodeceptConfigUpdater;