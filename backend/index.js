require('dotenv').config();
const { createServer } = require('node:http');
const { AIService, getAIService } = require('./src/ai_services');

const hostname = '127.0.0.2';
const port = 4000;

const server =  createServer( async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  const aiService = getAIService(process.env.GOOGLE_API_KEY, 'google');
  const completion = await aiService.textCompletion("Write a story about a magic backpack.");
  // res.end(completion);
  // const completion2 = await aiService.imageCompletion("What's different between these pictures?");
  res.end(completion2);
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
