const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

const sessions = {};

async function createSession(sessionId) {
  const sessionFolder = path.join(__dirname, 'sessions', sessionId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

  const sock = makeWASocket({
    auth: state,
    browser: ['Baileys', 'MacOS', '10.15.7']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;
    console.log(`[${sessionId}] Connection: ${connection}`);

    if (qr) {
      sessions[sessionId].qr = qr;
      console.log(`[${sessionId}] QR updated`);
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.payload?.message || 'unknown';
      console.log(`[${sessionId}] Disconnected. Reason: ${reason}`);
      delete sessions[sessionId]; // clear memory reference
    }

    if (connection === 'open') {
      console.log(`[${sessionId}] WhatsApp connected`);
      sessions[sessionId].qr = null; // clear QR once connected
    }
  });

  sessions[sessionId] = { sock, qr: null };
}

async function getSession(sessionId) {
  if (!sessions[sessionId]) {
    await createSession(sessionId);
  }
  return sessions[sessionId];
}

function deleteSession(sessionId) {
  const sessionPath = path.join(__dirname, 'sessions', sessionId);
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
    console.log(`[${sessionId}] Session files deleted`);
  }
  delete sessions[sessionId];
}

module.exports = { getSession, deleteSession };
