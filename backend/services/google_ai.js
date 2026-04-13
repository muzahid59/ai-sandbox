const AIService = require('./ai_services');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { fileUtils } = require('./utils');
const logger = require('../src/config/logger').default;
const log = logger.child({ service: 'GoogleAI' });

class GoogleAI extends AIService {
    constructor(apiKey) {
      super();
      this.genAI = new GoogleGenerativeAI(apiKey);
    }

    async imageCompletion(prompt) {
      const defalutPromt = "Extract the text from the image by list:";
      const finalPrompt = defalutPromt;
      const model = this.genAI.getGenerativeModel({ model: "gemini-pro-vision" });
      const imagePath = prompt.image;
      const imageParts = [fileUtils(imagePath, "image/png")];
      const result = await model.generateContent([finalPrompt, ...imageParts]);
      const response = result.response;
      log.debug('Image completion response received');
      const text = response.text();
      return text;
    }

    async textCompletion(prompt) {
      const model = this.genAI.getGenerativeModel({ model: "gemini-pro"});
      const result = await model.generateContent(prompt);
      const response = result.response;
      log.debug('Text completion response received');
      return response.text();
    }
  }

  module.exports = { GoogleAI };