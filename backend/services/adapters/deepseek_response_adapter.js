const ResponseAdapter = require('./base_response_adapter');

class DeepseekResponseAdapter extends ResponseAdapter {
    parseStreamResponse(chunk) {
        const data = JSON.parse(chunk);
        return {
            text: data.response || '',
            done: data.done || false
        };
    }
}

module.exports = DeepseekResponseAdapter;