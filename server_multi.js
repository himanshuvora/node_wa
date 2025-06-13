const express = require('express');
const fs = require('fs');
const path = require('path');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const app = express();
const port = 3000;
const sessions = {};

async function createSession(sessionId) {
  const sessionDir = path.join(__dirname, 'auth', sessionId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Baileys', 'Chrome', '120'],
  });

  sessions[sessionId] = { sock, qr: null };

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      sessions[sessionId].qr = qr;
      console.log(`[${sessionId}] New QR generated`);
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log(`[${sessionId}] Connection closed: ${reason}`);
      delete sessions[sessionId];
    }

    if (connection === 'open') {
      console.log(`[${sessionId}] Connected to WhatsApp`);
    }
  });

  return sock;
}

function getSession(sessionId) {
  return sessions[sessionId];
}

// === Routes ===

app.get('/status/:id', async (req, res) => {
  const { id } = req.params;

  let session = getSession(id);
  if (!session) {
    await createSession(id);
    session = getSession(id);
  }

  const isConnected = session.sock?.user;
  const qr = session.qr;

  res.json({
    registered: !!isConnected,
    qrAvailable: !!qr,
    qr: qr || null,
  });
});

app.get('/send/:id/:to/:msg', async (req, res) => {
  const { id, to, msg } = req.params;
  const session = getSession(id);

  if (!session || !session.sock.user) {
    return res.status(400).json({ error: 'Session not connected' });
  }

  try {
    const sent = await session.sock.sendMessage(to + '@s.whatsapp.net', { text: msg });
    res.json({ message: 'Message sent', msgId: sent.key.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message', details: err.message });
  }
});

app.get('/delete/:id', async (req, res) => {
  const { id } = req.params;
  const sessionDir = path.join(__dirname, 'auth', id);

  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  if (sessions[id]) {
    delete sessions[id];
  }

  res.json({ message: `Session ${id} deleted` });
});

// Run Server
app.listen(port, () => {
  console.log(`✅ WhatsApp API listening on http://localhost:${port}`);
});
