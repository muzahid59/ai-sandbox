const  AIService  = require('./ai_services');
const axios = require('axios');
const { Transform } = require('stream');
const logger = require('../src/config/logger').default;

const log = logger.child({ service: 'LamaAI' });

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
          log.error({ err: error }, 'Error parsing stream chunk');
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
      log.error({ err: error }, 'textCompletion failed');
      throw new Error("Failed to complete text request.");
    }
  }

  /**
   * Chat completion with tool calling support.
   * Uses Ollama's /api/chat endpoint which supports tools natively.
   */
  async chatCompletion({ messages, tools, model }) {
    const ollamaModel = model || 'llama3.2';

    // Convert tool definitions to Ollama format
    const ollamaTools = tools && tools.length > 0
      ? tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : undefined;

    // Convert structured messages to Ollama chat format
    const ollamaMessages = messages.map((msg) => {
      const formatted = { role: msg.role };

      if (typeof msg.content === 'string') {
        formatted.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Extract text from content blocks
        const textParts = msg.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text);
        formatted.content = textParts.join(' ');

        // Handle tool_result content blocks → role: tool
        const toolResult = msg.content.find((b) => b.type === 'tool_result');
        if (toolResult) {
          formatted.role = 'tool';
          formatted.content = toolResult.content || '';
        }
      }

      return formatted;
    });

    try {
      const request = {
        model: ollamaModel,
        messages: ollamaMessages,
        stream: false,
      };

      if (ollamaTools) {
        request.tools = ollamaTools;
      }

      const response = await axios.post(`${this.baseUrl}/chat`, request);
      const msg = response.data.message;

      // Check if the model wants to call tools
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const toolCalls = msg.tool_calls.map((tc, index) => ({
          id: `call_${Date.now()}_${index}`,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));

        return {
          text: msg.content || '',
          toolCalls,
          stopReason: 'tool_use',
        };
      }

      return {
        text: msg.content || '',
        toolCalls: [],
        stopReason: 'end_turn',
      };
    } catch (error) {
      log.error({ err: error }, 'chatCompletion failed');
      throw new Error('Failed to complete chat request with tools.');
    }
  }
}

module.exports = { LamaAI };