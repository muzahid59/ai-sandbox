require('dotenv').config();
const { createServer } = require('node:http');
const getCompletion = require('./chat_completion.js');

const hostname = '127.0.0.1';
const port = 3000;

const server =  createServer( async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  const completion = await getCompletion();
  res.end(completion);
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
