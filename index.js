const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');

const app = express();
app.use(express.json());

let sock;

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth_info'));

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, qr }) => {
    if (qr) {
      fs.writeFileSync('./latest-qr.txt', qr);
    }
    if (connection === 'close') {
      console.log('Connection closed, retrying...');
      startSock(); // Attempt reconnect
    }
    if (connection === 'open') {
      console.log('Connection opened!');
    }
  });

  sock.ev.on('messages.upsert', async m => {
    console.log(JSON.stringify(m, undefined, 2));
  });
}

startSock();

app.get('/qr', (req, res) => {
  if (fs.existsSync('./latest-qr.txt')) {
    res.send({ qr: fs.readFileSync('./latest-qr.txt', 'utf-8') });
  } else {
    res.status(404).send('QR not available');
  }
});

app.post('/send-message', async (req, res) => {
  const { number, message } = req.body;
  try {
    await sock.sendMessage(number + '@s.whatsapp.net', { text: message });
    res.send({ success: true });
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

app.listen(3000, () => console.log('Baileys WhatsApp service running on port 3000'));
