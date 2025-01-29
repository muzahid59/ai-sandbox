const express = require('express');
const router = express.Router();

const textCompletionRoute = require('./textCompletionRoute');
const contentCompletionRoute = require('./contentCompletionRoute'); 
const uploadRoute = require('./uploadRoute');

router.use(textCompletionRoute);
router.use(contentCompletionRoute);
router.use(uploadRoute);

module.exports = router;