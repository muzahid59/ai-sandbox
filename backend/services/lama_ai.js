const  AIService  = require('./ai_services');
const axios = require('axios');

class LamaAI extends AIService {
  constructor(apiKey, baseUrl = 'http://host.docker.internal:11434/api') {
    super();
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async textCompletion(prompt) {
    try {
      const request = {
        "model": "llama3.2",
        "prompt": prompt,
        "stream": false
      };
      console.log('request', request);
      const response = await axios.post(`${this.baseUrl}/generate`, request);
      console.log("Lama AI Response:", response.data);
      const formattedResponse = response.data.response;
      return formattedResponse;
    } catch (error) {
      console.error("Error calling Lama AI Service:", error.message);
      throw new Error("Failed to complete text request.");
    }
  }
}

  module.exports = { LamaAI };