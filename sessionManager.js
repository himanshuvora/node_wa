const { default: makeWASocket, makeCacheableSignalKeyStore, useSingleFileAuthState } = require('@whiskeysockets/baileys');
const { default: NodeCache } = require('node-cache');
const fs = require('fs');
const path = require('path');

const sessions = {};

async function getSession(sessionId) {
  if (sessions[sessionId]) return sessions[sessionId];

  const sessionFile = path.join(__dirname, 'sessions', `${sessionId}.json`);
  if (!fs.existsSync('sessions')) fs.mkdirSync('sessions');

  const { state, saveState } = useSingleFileAuthState(sessionFile);

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, new NodeCache())
    },
    browser: ['Baileys', 'Chrome', '120.0.0.0']
  });

  const session = { sock, qr: null };
  sessions[sessionId] = session;

  sock.ev.on('creds.update', saveState);

  sock.ev.on('connection.update', ({ connection, qr }) => {
    console.log(`[${sessionId}] Connection: ${connection}`);
    if (qr) {
      session.qr = qr;
      console.log(`[${sessionId}] QR updated`);
    }
    if (connection === 'close') {
      delete sessions[sessionId];
      console.log(`[${sessionId}] Session closed`);
    }
  });

  return session;
}

module.exports = { getSession };
