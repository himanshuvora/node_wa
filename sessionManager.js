const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

const sessions = {};

async function createSession(sessionId) {
  const sessionFolder = path.join(__dirname, 'sessions', sessionId);

  // Ensure a clean state
  if (fs.existsSync(sessionFolder)) {
    fs.rmSync(sessionFolder, { recursive: true, force: true });
    console.log(`[${sessionId}] Existing session folder deleted`);
  }  
  
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

  // Create early so connection.update can safely use it
  sessions[sessionId] = { sock: null, qr: null };

  const sock = makeWASocket({
    auth: state,
    browser: ['Baileys', 'MacOS', '10.15.7'],
    markOnlineOnConnect: false,
    connectTimeoutMs: 60_000
  });

  sessions[sessionId].sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;
    console.log(`[${sessionId}] Connection: ${connection}`);

    if (qr && sessions[sessionId]) {
      sessions[sessionId].qr = qr;
      console.log(`[${sessionId}] QR updated`);
    }

    if (connection === 'close') {
      const reason =
        lastDisconnect?.error?.output?.payload?.message ||
        lastDisconnect?.error?.message ||
        'unknown';

      console.log(`[${sessionId}] Disconnected. Reason: ${reason}`);

      if (
        reason.includes('Connection Failure') ||
        reason.includes('restart') ||
        reason.includes('timed out')
      ) {
        console.log(`[${sessionId}] Forcing regeneration due to error.`);
        deleteSession(sessionId);
      } else {
        delete sessions[sessionId]; // only clear in-memory if not critical error
      }
    }

    if (connection === 'open') {
      console.log(`[${sessionId}] WhatsApp connected`);
      sessions[sessionId].qr = null;
    }
  });

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
