const AIService = require('./ai_services');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { fileUtils } = require('./utils')

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
      console.log("Image Completion Response:", JSON.stringify(response, null, 2));
      const text = response.text();
      return text;
    }

    async textCompletion(prompt) {
      console.log('prompt', prompt);
      // gemini-pro-vision
      const model = this.genAI.getGenerativeModel({ model: "gemini-pro"});
      console.log('model', model);
      const result = await model.generateContent(prompt);
      const response = result.response;
      console.log("Text Completion Response:", JSON.stringify(response, null, 2));
      return response.text();
    }
  }

  module.exports = { GoogleAI };