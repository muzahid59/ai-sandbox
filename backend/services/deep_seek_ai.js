const AIService = require('./ai_services');
const axios = require('axios');

class DeepSeekAI extends AIService {
  constructor(apiKey, baseUrl = 'http://host.docker.internal:11434/api') {
    super();
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async textCompletion(prompt) {
    try {
      const request = {
        "model": "deepseek-r1:8b",
        "prompt": prompt,
        "stream": true,
        "options": {
          "temperature": 0.7,
          "max_tokens": 2048
        }
      };

      console.log('DeepSeek Request:', request);
      const response = await axios.post(`${this.baseUrl}/generate`, request, {
        responseType: 'stream'
      });
      
      console.log('DeepSeek Response:', response);

      return response.data;
  
    } catch (error) {
      console.error("Error calling DeepSeek AI Service:", error.message);
      throw new Error("Failed to complete text request with DeepSeek.");
    }
  }
}

module.exports = { DeepSeekAI };