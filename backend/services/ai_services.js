class AIService {  
  constructor() {} 

  async textCompletion(prompt) {
    throw new Error('Method not implemented.');
  }

  async imageCompletion(prompt) {
    throw new Error(`Image analysis is not supported by ${this.constructor.name}. Please use Google Gemini for image inputs.`);
  }
}

module.exports =  AIService ;

