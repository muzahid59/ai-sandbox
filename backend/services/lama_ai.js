const  AIService  = require('./ai_services');
const axios = require('axios');
const { Transform } = require('stream');

class LamaAI extends AIService {
  constructor(apiKey, baseUrl = 'http://host.docker.internal:11434/api') {
    super();
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  createParserStream() {
    return new Transform({
      objectMode: true,
      transform(chunk, encoding, callback) {
        try {
          const data = JSON.parse(chunk);
          this.push({
            text: data.response || '',
            done: data.done || false
          });
        } catch (error) {
          console.error("Error parsing chunk:", error);
        }
        callback();
      }
    });
  }

  async textCompletion(prompt) {
    try {
      const request = {
        "model": "llama3.2",
        "prompt": prompt,
        "stream": true
      };
      
      const response = await axios.post(`${this.baseUrl}/generate`, request, {
        responseType: 'stream'
      });

      const parserStream = this.createParserStream();
      response.data.pipe(parserStream);
      
      return parserStream;

    } catch (error) {
      console.error("Error calling Lama AI Service:", error.message);
      throw new Error("Failed to complete text request.");
    }
  }
}

module.exports = { LamaAI };