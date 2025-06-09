// app.js (Node.js server for multiple WhatsApp sessions)
const express = require('express');
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const sessions = {}; // key: token, value: sock instance
const tokens = {};   // key: sessionId (user id), value: token

const SESSION_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

function getAuthFilePath(sessionId) {
  return path.join(SESSION_DIR, `${sessionId}.json`);
}

async function createSession(sessionId) {
  const { state, saveCreds } = await useMultiFileAuthState(getAuthFolderPath(sessionId));
  //const sock = makeWASocket({ auth: state, printQRInTerminal: false });
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['LocalhostApp', 'Chrome', '13.233.170.46'],
    markOnlineOnConnect: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      fs.writeFileSync(path.join(SESSION_DIR, `${sessionId}.qr`), qr);
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`[${sessionId}] disconnected with reason:`, reason);

      if (reason === DisconnectReason.loggedOut || reason === 515 || reason === 440) {
        console.log(`[${sessionId}] session invalid. Resetting...`);
        //deleteSessionFolder(sessionId);
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
  const qrPath = path.join(SESSION_DIR, `${sessionId}.qr`);

  if (fs.existsSync(qrPath)) fs.unlinkSync(qrPath);

  if (fs.existsSync(folder)) {
    fs.readdirSync(folder).forEach(file => {
      fs.unlinkSync(path.join(folder, file));
    });
    fs.rmdirSync(folder);
    console.log(`[${sessionId}] session folder deleted`);
  }
}


app.post('/start/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  await createSession(sessionId);
  res.send({ success: true });
});

app.get('/qr/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const qrPath = path.join(SESSION_DIR, `${sessionId}.qr`);
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
    await sessions[token].sendMessage(number + '@s.whatsapp.net', { text: message });
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

function getAuthFolderPath(sessionId) {
  return path.join(SESSION_DIR, sessionId);
}

app.listen(3000, () => console.log('Multi-user WhatsApp API running on port 3000'));
