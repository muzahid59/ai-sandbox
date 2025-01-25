const OpenAI = require('openai');
const AIService = require('./ai_services');

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

module.exports = { OpenAI: OpenAIService };