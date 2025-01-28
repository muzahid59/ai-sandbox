const { LamaAI } = require('./lama_ai');
const { OpenAI } = require('./open_ai');
const { DeepSeekAI } = require('./deep_seek_ai');
const { GoogleAI } = require('./google_ai');

function getAIService(apiKey, type) {
    switch (type) {
      case 'google':
        return new GoogleAI(apiKey);
      case 'openai':
        return new OpenAI(apiKey);
      case 'deepseek':
        return new DeepSeekAI(apiKey);  
      case 'lama':
        return new LamaAI(apiKey);
      default:
        throw new Error(`Unsupported AI service type: ${type}`);
    }
  }

  module.exports = { getAIService };