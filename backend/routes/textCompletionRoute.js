const express = require('express');
const router = express.Router();
const textCompletionController = require('../controllers/textCompletionController');

router.post('/text-completion', textCompletionController.handleTextCompletion);

module.exports = router;