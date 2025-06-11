const express = require('express');
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// const http = require('http');

// const options = {
//   key: fs.readFileSync('/etc/letsencrypt/live/clients.evotters.com/privkey.pem'),
//   cert: fs.readFileSync('/etc/letsencrypt/live/clients.evotters.com/fullchain.pem')
// };

// http.createServer(options, app).listen(3000, () => {
//   console.log('WhatsApp API running on HTTP port 3000');
// });

const sessions = {}; // key: token, value: sock instance
const tokens = {};   // key: sessionId, value: token
const blockTimestamps = {}; // sessionId -> timestamp of last 515 error

const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

function getAuthFolderPath(sessionId) {
  return path.join(SESSION_DIR, sessionId);
}

function getQRPath(sessionId) {
  return path.join(SESSION_DIR, `${sessionId}.qr`);
}

async function createSession(sessionId) {
  const { state, saveCreds } = await useMultiFileAuthState(getAuthFolderPath(sessionId));

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['Baileys', 'MacOS', '10.15.7'],
    markOnlineOnConnect: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;
    console.log(`[${sessionId}] Connection update:`, connection);

    if (lastDisconnect?.error) {
      const reason = new Boom(lastDisconnect.error)?.output?.statusCode;
      console.log(`[${sessionId}] Disconnected. Reason:`, reason, lastDisconnect.error.message);
    }

    if (qr) {
      fs.writeFileSync(path.join(SESSION_DIR, `${sessionId}.qr`), qr);
      console.log(`[${sessionId}] QR updated`);
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`[${sessionId}] disconnected with reason:`, reason);

      if (reason === DisconnectReason.loggedOut || reason === 515 || reason === 440) {
        if (reason === 515) {
          blockTimestamps[sessionId] = Date.now();
          console.log(`[${sessionId}] temporarily blocked. Cooldown started.`);
        }
        return;
      } else {
        console.log(`[${sessionId}] reconnecting...`);
        createSession(sessionId);
      }
    }

    if (connection === 'open') {
      console.log(`[${sessionId}] connected.`);
      const token = uuidv4();
      sessions[token] = sock;
      tokens[sessionId] = token;
    }
  });

  return sock;
}

function deleteSessionFolder(sessionId) {
  const folder = getAuthFolderPath(sessionId);
  const qrPath = getQRPath(sessionId);

  if (fs.existsSync(qrPath)) fs.unlinkSync(qrPath);

  if (fs.existsSync(folder)) {
    fs.readdirSync(folder).forEach(file => {
      fs.unlinkSync(path.join(folder, file));
    });
    fs.rmdirSync(folder);
    console.log(`[${sessionId}] session folder deleted`);
  }
}

// Start session (after checking cooldown)
app.post('/start/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;

  if (blockTimestamps[sessionId]) {
    const elapsed = Date.now() - blockTimestamps[sessionId];
    if (elapsed < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      return res.status(429).send({ error: `Blocked by WhatsApp. Retry in ${remaining} seconds.` });
    } else {
      delete blockTimestamps[sessionId];
    }
  }

  await createSession(sessionId);
  res.send({ success: true });
});

// Check QR availability & cooldown status
app.get('/status/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;

  if (blockTimestamps[sessionId]) {
    const elapsed = Date.now() - blockTimestamps[sessionId];
    if (elapsed < COOLDOWN_MS) {
      return res.send({
        blocked: true,
        remaining: Math.ceil((COOLDOWN_MS - elapsed) / 1000)
      });
    }
  }

  const qrAvailable = fs.existsSync(getQRPath(sessionId));
  res.send({ blocked: false, qrAvailable });
});

// Get QR code
app.get('/qr/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const qrPath = getQRPath(sessionId);
  if (fs.existsSync(qrPath)) {
    const qr = fs.readFileSync(qrPath, 'utf-8');
    res.send({ qr });
  } else {
    res.status(404).send({ error: 'QR not found' });
  }
});

// Get token
app.get('/token/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  if (tokens[sessionId]) {
    res.send({ token: tokens[sessionId] });
  } else {
    res.status(404).send({ error: 'Token not found or not connected' });
  }
});

// Send message
app.post('/send', async (req, res) => {
  const { token, number, message } = req.body;

  if (!sessions[token]) {
    return res.status(401).send({ error: 'Invalid token or session expired' });
  }

  try {
    await sessions[token].sendMessage(number + '@s.whatsapp.net', { text: message });
    res.send({ success: true });
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

// Reset session
app.delete('/reset/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  deleteSessionFolder(sessionId);
  res.send({ success: true });
});

app.listen(3000, () => console.log('Multi-user WhatsApp API running on port 3000'));
