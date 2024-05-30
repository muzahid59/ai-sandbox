require('dotenv').config();
const express = require('express');
const multer  = require('multer')
const cors = require('cors');
const { ToutubeTranscript, YoutubeTranscript } = require('youtube-transcript');
const path = require('path')
const { AIService, getAIService } = require('./src/ai_services');
const { isValidYoutubeUrl } = require('./utils/utils.js');
const contentCompletionRoute = require('./routes/ContentCompletionRoute');
const uploadRoute = require('./routes/uploadRoute');
const app = express();
const port = 3999;


app.use(cors())
app.use(express.json()); // for parsing application/json
app.use(contentCompletionRoute);
app.use(uploadRoute);

// app.post('/text-completion', async (req, res) => {
//   console.log('text-completion', req.body);
//   const text = req.body.text;
//   const completion = await aiService.textCompletion(text);
//   console.log('completion', completion);
//   res.setHeader('Content-Type', 'text/event-stream');
//   res.write(`data: ${JSON.stringify(completion)}\n\n`);
//   res.end();
// });


app.get('/', (req, res) => {
  res.send('Hi ther! This is the from AI sandbox server');
})

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});