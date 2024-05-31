const { AIService, getAIService } = require('../services/ai_services.js');
const { isValidYoutubeUrl } = require('../utils/utils.js');
const aiService = getAIService(process.env.GOOGLE_API_KEY, 'google');
async function handleContentCompletion(req, res) {
    console.log('handleContentCompletion', req.body);
    const text = req.body.text;

    let image_context = '';

    if (req.body.image) {
    image_context = await aiService.imageCompletion({ text, image: req.body.image });
    image_context = 'Prefix: ' + image_context;
    } 
    if (isValidYoutubeUrl(text)) {
    const youtubeId = text.split('v=')[1];
    console.log('youtubeId', youtubeId);
    const trascripts = await YoutubeTranscript.fetchTranscript(youtubeId);
    const youtubeTranscript = trascripts.map((item) => item.text).join(' ');
    console.log('youtubeTranscript', youtubeTranscript);
    image_context = youtubeTranscript; 
    } else {
    console.log('Not a valid youtube url');
    }
    const completion = await aiService.textCompletion(text + image_context);
    console.log('completion', completion);
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify(completion)}\n\n`);
    res.end();
}

module.exports = { handleContentCompletion };