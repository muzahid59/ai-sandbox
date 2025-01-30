const express = require('express');
const router = express.Router();
const { handleContentCompletion } = require('../controllers/contentCompletionController');

router.post('/content-completion', handleContentCompletion);

module.exports = router;