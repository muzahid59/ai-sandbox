const express = require('express');
const router = express.Router();
const multer  = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, path.resolve(__dirname, '..', 'uploads'));
    },
    filename: function(req, file, cb) {
        const tempImage = 'sample.png'; // default extension
        cb(null, file.fieldname + '-' + tempImage);
    }
});

const upload = multer({ storage: storage});

router.post('/upload', upload.single('image'), async (req, res) => {
  console.log('upload request:', req.file);
  const completion = { image: req.file.path };
  res.json(completion);
});

module.exports = router;