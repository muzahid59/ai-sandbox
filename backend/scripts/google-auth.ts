#!/usr/bin/env ts-node

import 'dotenv/config';
import { google } from 'googleapis';
import http from 'http';
import { exec } from 'child_process';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3333/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env first.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/calendar.readonly'],
  prompt: 'consent',
});

console.log('\n=== Google Calendar OAuth Setup ===\n');
console.log('Opening browser for authorization...\n');

const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
exec(`${openCmd} "${authUrl}"`);

const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
  if (!req.url?.startsWith('/callback')) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost:3333');
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('Missing authorization code');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Success!</h1><p>You can close this tab and return to the terminal.</p>');

    console.log('\nSuccess! Add this to your backend/.env:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

    server.close();
    process.exit(0);
  } catch (error) {
    res.writeHead(500);
    res.end('Failed to exchange code for token');
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error exchanging code:', msg);
    server.close();
    process.exit(1);
  }
});

server.listen(3333, () => {
  console.log('Waiting for authorization callback on http://localhost:3333/callback ...\n');
  console.log('If the browser did not open, visit this URL manually:');
  console.log(authUrl + '\n');
});
