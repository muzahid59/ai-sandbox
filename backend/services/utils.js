const fs = require('fs');
const path = require('path');
const scriptDir = path.dirname(__filename);


function fileToGenerativePart(path, mimeType) {
  if (!fs.existsSync(path)) {
    console.error(`File not found: ${path}`);
    return null;
  }

  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(path)).toString("base64"),
      mimeType
    },
  };
}

module.exports = { fileToGenerativePart };