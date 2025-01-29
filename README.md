# AI Sandbox

AI Sandbox is a comprehensive toolkit that provides various AI-powered features. It's a great place to explore and experiment with AI technologies.

## Features

1. **Text Completion**: Enhance your typing experience with AI-powered text completion. It predicts and suggests the next piece of text as you type.

2. **Streaming Support**: Real-time data streaming is supported, allowing for dynamic and interactive user experiences.

3. **Audio Input**: The application can take audio input, opening up possibilities for voice-activated commands or audio analysis.

## Supported AI Services

1. **OpenAI GPT**: Requires API key from OpenAI
2. **Google Gemini**: Requires API key from Google AI Studio
3. **Llama 3.2**: Runs locally through Ollama
4. **DeepSeek-r1**: Runs locally through Ollama

## Prerequisites

1. **API Keys Setup**:
   - Get OpenAI API key from [OpenAI Platform](https://platform.openai.com)
   - Get Google API key from [Google AI Studio](https://makersuite.google.com/app/apikey)

2. **Ollama Setup** (for Llama and DeepSeek):
   - Install Ollama from [ollama.ai](https://ollama.ai)
   - Pull the models:
     ```bash
     ollama pull llama3.2
     ollama pull deepseek-r1:8b
     ```
   - Start Ollama service locally

## How to Run

### Local Development

**Backend Setup**:
   ```bash
   # Navigate to backend directory
   cd backend

   # Copy environment file and update with your API keys
   cp .env.example .env

   # Install dependencies
   npm install

   # Start the server
   npm start
```
**Frontend Setup**:
   ```bash
   # Navigate to frontend directory
   cd app

   # Install dependencies
   npm install

   # Start the server
   npm start
```

### Docker Development
```bash
# Build and start all services
docker-compose up --build
```
## Access Points
- Frontend: http://localhost:3000
- Backend API: http://localhost:5001
## Environment Variables
Update the .env file in the backend directory with your API keys:

```plaintext
OPENAI_API_KEY=your_openai_key_here
GOOGLE_API_KEY=your_google_key_here
 ```

## Notes
- OpenAI and Google Gemini services require valid API keys in the .env file
- Llama and DeepSeek services require Ollama to be running locally on port 11434
- The application allows switching between different AI models through the interface

Enjoy exploring the AI Sandbox
