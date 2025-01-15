const { getAIService } = require('../services/ai_services.js');
const { YoutubeTranscript } = require('youtube-transcript');
const { isValidYoutubeUrl } = require('../utils/utils.js');

const aiService = getAIService(process.env.LAMA_API_KEY, 'lama');

async function handleContentCompletion(req, res) {
    console.log('handleContentCompletion', req.body);
    const text = req.body.text;

    let content_context = '';

    if (req.body.image) {
        content_context = await aiService.imageCompletion({image: req.body.image });
        content_context = 'Image Context: ' + content_context;
    } 
    // if (isValidYoutubeUrl(text)) {
    //     const youtubeId = text.split('v=')[1];
    //     console.log('youtubeId', youtubeId);
    //     const trascripts = await YoutubeTranscript.fetchTranscript(youtubeId);
    //     const youtubeTranscript = trascripts.map((item) => item.text).join(' ');
    //     console.log('youtubeTranscript', youtubeTranscript);
    //     content_context = youtubeTranscript; 
    // } else {
    //     console.log('Not a valid youtube url');
    // }

    const completion = await aiService.textCompletion(text + content_context);
    console.log('completion', completion);
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify(completion)}\n\n`);
    res.end();
}

module.exports = { handleContentCompletion };