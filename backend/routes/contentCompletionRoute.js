const express = require('express');
const router = express.Router();
const contentCompletionController = require('../controllers/contentCompletionController');

router.post('/content-completion', contentCompletionController.handleContentCompletion);

module.exports = router;