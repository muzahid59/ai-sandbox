require('dotenv').config();
const express = require('express');
const logger = require('./src/config/logger').default;
const app = express();
const port = 5001;
const cors = require('cors');
const routes = require('./routes');

app.use(cors())
app.use(express.json({ limit: '20mb' }));
app.use(routes);

app.get('/', (req, res) => {
  res.send('Hi ther! This is the from AI sandbox server');
})

app.listen(port, () => {
  logger.info({ port }, 'Server running');
});