require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
delete require.cache[require.resolve('./src/ai_services.js')];
const { AIService, getAIService } = require('./src/ai_services');

const app = express();
const port = 3000;
const upload = multer({ dest: 'uploads/'});
app.use(cors());
app.use(express.json()); // for parsing application/json

const aiService = getAIService(process.env.GOOGLE_API_KEY, 'google');

app.post('/text-completion', async (req, res) => {
  console.log('text-completion', req.body);
  const text = req.body.text;
  const completion = await aiService.textCompletion(text);
  console.log('completion', completion);
  res.setHeader('Content-Type', 'text/event-stream');
  res.write(`data: ${JSON.stringify(completion)}\n\n`);
  res.end();
});

app.post('/content-completion', async (req, res) => {
  console.log('text-completion', req.body);
  const text = req.body.text;
  const imagePath = req.body.image;
  const completion = await aiService.imageCompletion({ text, image: imagePath });
  console.log('completion', completion);
  res.setHeader('Content-Type', 'text/event-stream');
  res.write(`data: ${JSON.stringify(completion)}\n\n`);
  res.end();
});

app.post('/upload', upload.single('image'), async (req, res) => {
  console.log('Received image:', req.file);
  const completion = { image: req.file.path };
  res.setHeader('Content-Type', 'text/event-stream');
  res.write(`data: ${JSON.stringify(completion)}\n\n`);
  res.end();
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});