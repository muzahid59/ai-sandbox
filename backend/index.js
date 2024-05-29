require('dotenv').config();
const express = require('express');
const multer  = require('multer')
const cors = require('cors');
const path = require('path')
const { AIService, getAIService } = require('./src/ai_services');
const app = express();
const port = 3999;

const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, path.dirname(__filename) + '/uploads');
  },
  filename: function(req, file, cb) {
    const tempImage = 'sample.png'; // default extension
    cb(null, file.fieldname + '-' + tempImage);
  }
});

const upload = multer({ storage: storage});
app.use(cors())
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
  
  let image_context = '';

  if (req.body.image) {
    image_context = await aiService.imageCompletion({ text, image: req.body.image });
    image_context = 'Prefix: ' + image_context;
  } 
  let query =  '';
  if (image_context !== '' && text !== '') {
    
  }
  const completion = await aiService.textCompletion(text + image_context);
  console.log('completion', completion);
  res.setHeader('Content-Type', 'text/event-stream');
  res.write(`data: ${JSON.stringify(completion)}\n\n`);
  res.end();
});

app.post('/upload', upload.single('image'), async (req, res) => {
  console.log('Received image:', req.file);
  const completion = { image: req.file.path };
  res.json(completion);
});

app.get('/', (req, res) => {
  res.send('Hi ther! This is the from AI sandbox server');
})

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});