const { getAIService } = require('../services/ai_factory');

async function handleContentCompletion(req, res) {
    console.log('handleContentCompletion', req.body);
    const { text, model, image } = req.body;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const aiService = getAIService(process.env[`${model.toUpperCase()}_API_KEY`], model);
        let content_context = '';

        if (image) {
            content_context = await aiService.imageCompletion({image: image});
            content_context = 'Image Context: ' + content_context;
        }

        const parserStream = await aiService.textCompletion(text + content_context);
        
        parserStream.on('data', (parsedData) => {
            if (parsedData.text) {
                res.write(`data: ${JSON.stringify({ text: parsedData.text })}\n\n`);
            }
        });

        parserStream.on('end', () => {
            res.end();
        });

        parserStream.on('error', (error) => {
            console.error('Stream error:', error);
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        });

    } catch (error) {
        console.error('Error:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
}

module.exports = {
    handleContentCompletion
};