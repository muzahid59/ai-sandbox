const { getAIService } = require('../services/ai_factory');
const logger = require('../src/config/logger').default;
const log = logger.child({ service: 'contentCompletion' });

async function handleContentCompletion(req, res) {
    log.info({ model: req.body.model }, 'Content completion request');
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
            log.error({ err: error }, 'Stream error');
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        });

    } catch (error) {
        log.error({ err: error }, 'Content completion failed');
        const userMessage = error.message || 'Something went wrong. Please try again.';
        res.write(`data: ${JSON.stringify({ error: userMessage })}\n\n`);
        res.end();
    }
}

module.exports = {
    handleContentCompletion
};