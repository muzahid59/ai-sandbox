require('dotenv').config();
const { createServer } = require('node:http');
const { AIService, getAIService } = require('./ai_services/ai_services');

const hostname = '127.0.0.1';
const port = 3000;

const server =  createServer( async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  const aiService = getAIService(process.env.GOOGLE_API_KEY, 'google');
  // const completion = await aiService.textCompletion("Write a story about a magic backpack.");
  // res.end(completion);
  const completion2 = await aiService.imageCompletion("What's different between these pictures?");
  res.end(completion2);
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
