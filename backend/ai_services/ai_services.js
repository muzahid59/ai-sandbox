const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require('openai');

class AIService {  
  async textCompletion(prompt) {
    throw new Error('Method not implemented.');
  }
}

class GoogleAIService extends AIService {
    constructor(apiKey) {
      super();
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  
    async textCompletion(prompt) {
      console.log('prompt', prompt);
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

