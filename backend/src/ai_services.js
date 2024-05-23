const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const scriptDir = path.dirname(__filename);

class AIService {  
  async textCompletion(prompt) {
    throw new Error('Method not implemented.');
  }

  async imageCompletion(prompt) {
    throw new Error('Method not implemented.');
  }
}

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

class GoogleAIService extends AIService {
    constructor(apiKey) {
      super();
      this.genAI = new GoogleGenerativeAI(apiKey);
    }

    async imageCompletion(prompt) {
      const defalutPromt = "Give me a description of this image.";
      const finalPrompt = defalutPromt + prompt.text;
      const model = this.genAI.getGenerativeModel({ model: "gemini-pro-vision" });
      console.log('prompt', prompt);
      console.log(process.cwd());
      const imagePath1 = prompt.image;
      const imagePath2 = path.join(scriptDir, 'image2.jpeg');
      console.log('imagePath1', imagePath1);
      console.log('imagePath2', imagePath2);
      const imageParts = [
        fileToGenerativePart(imagePath1, "image/png")
      ];
      console.log('imageParts', imageParts);
      const result = await model.generateContent([finalPrompt, ...imageParts]);
      const response = result.response;
      const text = response.text();
      return text;
    }

    async textCompletion(prompt) {
      console.log('prompt', prompt);
      // gemini-pro-vision
      const model = this.genAI.getGenerativeModel({ model: "gemini-pro"});
      console.log('model', model);
      const result = await model.generateContent(prompt);
      console.log(result);
      const response = result.response;
      return response.text();
    }
  }


  class OpenAIService extends AIService {
    constructor(apiKey) {
      super();
      this.openai = new OpenAI(apiKey);
    }
  
    async textCompletion(prompt) {
      const completion = await this.openai.chat.completions.create({
        messages: [{"role": "system", "content": "You are a helpful assistant."},
          {"role": "user", "content": prompt}],
        model: "gpt-3.5-turbo",
      });
      return completion.choices[0].text;
    }
  }

  function getAIService(apiKey, type) {
    switch (type) {
      case 'google':
        return new GoogleAIService(apiKey);
      case 'openai':
        return new OpenAIService(apiKey);
      default:
        throw new Error(`Unsupported AI service type: ${type}`);
    }
  }

  module.exports = { AIService, getAIService };

