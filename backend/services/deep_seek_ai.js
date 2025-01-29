const AIService = require('./ai_services');
const axios = require('axios');

class DeepSeekAI extends AIService {
  constructor(apiKey, baseUrl = 'http://host.docker.internal:11434/api') {
    super();
    this.apiKey = apiKey;  // Note: Ollama typically doesn't require API keys
    this.baseUrl = baseUrl;
  }

  async textCompletion(prompt) {
    try {
      const request = {
        "model": "deepseek-r1:8b",  // Use the exact model name you used with Ollama
        "prompt": prompt,
        "stream": false,
        "options": {
          "temperature": 0.7,      // Optional: Adjust parameters as needed
          "max_tokens": 2048       // Optional: Adjust based on your needs
        }
      };

      console.log('DeepSeek Request:', request);
      const response = await axios.post(`${this.baseUrl}/generate`, request);
      console.log("DeepSeek AI Response:", response.data);
      
      return response.data.response;
    } catch (error) {
      console.error("Error calling DeepSeek AI Service:", error.message);
      throw new Error("Failed to complete text request with DeepSeek.");
    }
  }
}

module.exports = { DeepSeekAI };
