const fs = require('fs');
const path = require('path');
const logger = require('../src/config/logger').default;
const log = logger.child({ service: 'utils' });
const scriptDir = path.dirname(__filename);


function fileToGenerativePart(path, mimeType) {
  if (!fs.existsSync(path)) {
    log.error({ path }, 'File not found');
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