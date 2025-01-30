const { getAIService } = require('../services/ai_factory');
const OllamaAdapter = require('../services/adapters/deepseek_response_adapter');

async function handleContentCompletion(req, res) {
    console.log('handleContentCompletion', req.body);
    const { text, model, image } = req.body;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const aiService = getAIService(process.env[`${model.toUpperCase()}_API_KEY`], model);
        const responseAdapter = new OllamaAdapter(); // Will be factory-based when adding more adapters
        let content_context = '';

        if (image) {
            content_context = await aiService.imageCompletion({image: image});
            content_context = 'Image Context: ' + content_context;
        }

        const stream = await aiService.textCompletion(text + content_context);
        
        stream.on('data', (chunk) => {
            try {
                const adaptedResponse = responseAdapter.parseStreamResponse(chunk);
                if (adaptedResponse.text) {
                    res.write(`data: ${JSON.stringify({ text: adaptedResponse.text })}\n\n`);
                }
            } catch (error) {
                console.error('Error parsing chunk:', error);
            }
        });

        stream.on('end', () => {
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