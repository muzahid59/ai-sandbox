// const multer  = require('multer')

// const storage = multer.diskStorage({
//     destination: function(req, file, cb) {
//         cb(null, path.dirname(__filename) + '/uploads');
//     },
//     filename: function(req, file, cb) {
//         const tempImage = 'sample.png'; // default extension
//         cb(null, file.fieldname + '-' + tempImage);
//     }
// });

// const upload = multer({ storage: storage});

// async function handleUpload(req, res) {
//     console.log('Received image:', req.file);
//     const completion = { image: req.file.path };
//     res.json(completion);
// };