class AIService {
  constructor() {}

  async textCompletion(prompt) {
    throw new Error('Method not implemented.');
  }

  async imageCompletion(prompt) {
    throw new Error(`Image analysis is not supported by ${this.constructor.name}. Please use Google Gemini for image inputs.`);
  }

  /**
   * Chat completion with tool calling support.
   * Override in subclasses that support tool calling.
   * @param {object} options - { messages, tools, model }
   * @returns {Promise<{ text: string, toolCalls: Array, stopReason: string }>}
   */
  async chatCompletion(options) {
    throw new Error(`chatCompletion is not supported by ${this.constructor.name}.`);
  }
}

module.exports =  AIService ;

