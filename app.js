const express = require('express');
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

const sessions = {};
const tokens = {};
const blockTimestamps = {};

const COOLDOWN_MS = 15 * 60 * 1000;
const SESSION_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

function getAuthFolderPath(sessionId) {
  return path.join(SESSION_DIR, sessionId);
}

function getQRPath(sessionId) {
  return path.join(SESSION_DIR, `${sessionId}.qr`);
}

async function createSession(sessionId) {
  if (sessions[sessionId]) {
    console.log(`[${sessionId}] session already exists.`);
    return;
  }

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

    if (qr) {
      fs.writeFileSync(getQRPath(sessionId), qr);
      console.log(`[${sessionId}] QR updated`);
    }

    if (connection === 'open') {
      console.log(`[${sessionId}] connected.`);

      const token = uuidv4();
      if (sock.user && sock.authState.creds.registered) {
        sessions[token] = sock;
        tokens[sessionId] = token;

        const qrPath = getQRPath(sessionId);
        if (fs.existsSync(qrPath)) fs.unlinkSync(qrPath);
      }
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`[${sessionId}] disconnected with reason:`, reason);

      if ([DisconnectReason.loggedOut, 515, 440].includes(reason)) {
        if (reason === 515) {
          blockTimestamps[sessionId] = Date.now();
          console.log(`[${sessionId}] temporarily blocked. Cooldown started.`);
        }
        delete sessions[sessionId];
        return;
      }

      console.log(`[${sessionId}] reconnecting...`);
      delete sessions[sessionId];
      createSession(sessionId);
    }
  });

  sessions[sessionId] = sock;
  return sock;
}

function deleteSessionFolder(sessionId) {
  const folder = getAuthFolderPath(sessionId);
  const qrPath = getQRPath(sessionId);

  if (fs.existsSync(qrPath)) fs.unlinkSync(qrPath);
  if (fs.existsSync(folder)) {
    fs.readdirSync(folder).forEach(file => fs.unlinkSync(path.join(folder, file)));
    fs.rmdirSync(folder);
    console.log(`[${sessionId}] session folder deleted`);
  }

  delete tokens[sessionId];
  delete sessions[sessionId];
}

app.post('/start/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;

  if (blockTimestamps[sessionId]) {
    const elapsed = Date.now() - blockTimestamps[sessionId];
    if (elapsed < COOLDOWN_MS) {
      return res.status(429).send({ error: `Blocked by WhatsApp. Retry in ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)} seconds.` });
    } else {
      delete blockTimestamps[sessionId];
    }
  }

  await createSession(sessionId);
  res.send({ success: true });
});

app.get('/status/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;

  if (blockTimestamps[sessionId]) {
    const elapsed = Date.now() - blockTimestamps[sessionId];
    if (elapsed < COOLDOWN_MS) {
      return res.send({
        blocked: true,
        remaining: Math.ceil((COOLDOWN_MS - elapsed) / 1000),
        qrAvailable: false,
        registered: false
      });
    }
  }

  const qrAvailable = fs.existsSync(getQRPath(sessionId));
  let registered = false;

  const credsPath = path.join(getAuthFolderPath(sessionId), 'creds.json');
  if (fs.existsSync(credsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsPath));
      registered = creds.registered;
    } catch {}
  }

  res.send({ blocked: false, qrAvailable, registered });
});

app.get('/qr/:sessionId', (req, res) => {
  const qrPath = getQRPath(req.params.sessionId);
  if (fs.existsSync(qrPath)) {
    const qr = fs.readFileSync(qrPath, 'utf-8');
    res.send({ qr });
  } else {
    res.status(404).send({ error: 'QR not found' });
  }
});

app.get('/token/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  if (tokens[sessionId]) {
    res.send({ token: tokens[sessionId] });
  } else {
    res.status(404).send({ error: 'Token not found or not connected' });
  }
});

app.post('/send', async (req, res) => {
  const { token, number, message } = req.body;

  if (!sessions[token]) {
    return res.status(401).send({ error: 'Invalid token or session expired' });
  }

  try {
    await sessions[token].sendMessage(`${number}@s.whatsapp.net`, { text: message });
    res.send({ success: true });
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

app.delete('/reset/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  deleteSessionFolder(sessionId);
  res.send({ success: true });
});

app.listen(3000, () => console.log('Multi-user WhatsApp API running on port 3000'));
