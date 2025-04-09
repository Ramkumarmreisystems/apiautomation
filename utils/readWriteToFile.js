const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const XLSX = require("xlsx");
const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

class FileHandler {
  // Generic file writer for any format
  static async writeToFile(outputPath, data, format = null) {
    try {
      await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });

      if (format) {
        switch (format.toLowerCase()) {
          case "json":
            await this.writeJsonFile(outputPath, data);
            break;
          case "csv":
            await this.writeCsvFile(outputPath, data);
            break;
          case "xls":
          case "xlsx":
            await this.writeExcelFile(outputPath, data);
            break;
          default:
            // If format is provided but not supported, write it as plain text
            try {
              await fsPromises.writeFile(outputPath, data, "utf-8");
            } catch (error) {
              throw new Error(`Error writing to file: ${error.message}`);
            }
        }
      } else {
        // If no format is provided, use the default action to write plain text
        try {
          await fsPromises.writeFile(outputPath, data, "utf-8");
        } catch (error) {
          throw new Error(`Error writing to file: ${error.message}`);
        }
      }
    } catch (error) {
      throw new Error(`Error writing to file: ${error.message}`);
    }
  }

  // Generic file reader for any format
  static async readFromFile(filePath, format) {
    try {
      if (!(await this.fileExists(filePath))) {
        throw new Error(`File not found: ${filePath}`);
      }

      switch (format.toLowerCase()) {
        case "json":
          return await this.readJsonFile(filePath);
        case "csv":
          return await this.readCsvFile(filePath);
        case "xls":
        case "xlsx":
          return await this.readExcelFile(filePath);
        default:
          throw new Error(`Unsupported file format: ${format}`);
      }
    } catch (error) {
      throw new Error(`Error reading from file: ${error.message}`);
    }
  }

  // Format-specific writers
  static async writeJsonFile(filePath, data) {
    await fsPromises.writeFile(
      filePath,
      JSON.stringify(data, null, 2),
      "utf-8"
    );
  }

  static async writeCsvFile(filePath, data) {
    try {
      await fsPromises.mkdir(path.dirname(filePath), { recursive: true });

      const testData = Array.isArray(data) ? data : data.testData;
      if (!testData || !testData.length) {
        throw new Error("No valid data to write to CSV");
      }

      const formattedData = testData.map(
        (item) => item.requestBody || item.parameters
      );

      const header = Object.keys(formattedData[0]).map((id) => ({
        id,
        title: id,
      }));

      const csvWriter = createCsvWriter({
        path: filePath,
        header,
      });

      await csvWriter.writeRecords(formattedData);
    } catch (error) {
      throw new Error(`Error writing to CSV file: ${error.message}`);
    }
  }

  static async writeExcelFile(filePath, data) {
    const testData = Array.isArray(data) ? data : data.testData;
    if (!testData || !testData.length) {
      throw new Error("No valid data to write to Excel");
    }

    const formattedData = testData.map(
      (item) => item.requestBody || item.parameters
    );

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "TestData");
    XLSX.writeFile(workbook, filePath);
  }

  // Format-specific readers
  static async readJsonFile(filePath) {
    const content = await fsPromises.readFile(filePath, "utf-8");
    return JSON.parse(content);
  }

  static async readExcelFile(filePath) {
    try {
      if (!(await this.fileExists(filePath))) {
        throw new Error(`File not found: ${filePath}`);
      }

      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);

      return { testData: data };
    } catch (error) {
      throw new Error(`Error reading from Excel file: ${error.message}`);
    }
  }

  static async readCsvFile(filePath) {
    try {
      if (!(await this.fileExists(filePath))) {
        throw new Error(`File not found: ${filePath}`);
      }

      return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath) // Using regular fs here instead of fs.promises
          .pipe(csv())
          .on("data", (data) => results.push(data))
          .on("end", () => {
            resolve({ testData: results });
          })
          .on("error", (error) => reject(error));
      });
    } catch (error) {
      throw new Error(`Error reading from CSV file: ${error.message}`);
    }
  }

  // Utility methods
  static async fileExists(filePath) {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  static getFileExtension(filePath) {
    return path.extname(filePath).toLowerCase().slice(1);
  }

  static async ensureDirectoryExists(dirPath) {
    await fsPromises.mkdir(dirPath, { recursive: true });
  }
}

module.exports = FileHandler;
