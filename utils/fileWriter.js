const fs = require("fs").promises;
const path = require("path");

async function writeToFile(outputPath, data) {
  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, data, "utf-8");
    console.log(`Response saved to ${outputPath}`);
  } catch (error) {
    throw new Error(`Error writing to file: ${error.message}`);
  }
}

module.exports = writeToFile;
