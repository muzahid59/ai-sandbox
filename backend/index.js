require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { AIService, getAIService } = require('./src/ai_services');

const app = express();
const port = 3000;
app.use(cors());

app.use(express.json()); // for parsing application/json

const aiService = getAIService(process.env.GOOGLE_API_KEY, 'google');

app.post('/text-completion', async (req, res) => {
  console.log('text-completion', req.body);
  const text = req.body.text;
  const completion = await aiService.textCompletion(text);
  res.send(completion);
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});