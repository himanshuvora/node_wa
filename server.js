const express = require('express');
const path = require('path');
const cors = require('cors');
const { getSession, deleteSession } = require('./sessionManager');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

function isSocketConnected(sock) {
  return sock?.ws?.readyState === 1;
}

// API to get QR or status
app.get('/status/:sessionId', async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    let session = await getSession(sessionId);

    if (!session || !session.sock || session.sock.ws?.readyState !== 1) {
      console.log(`[${sessionId}] Socket closed. Deleting and regenerating session...`);
      deleteSession(sessionId);
      session = await getSession(sessionId);
    }

    // Wait for QR to be available (max 5 seconds)
    let retries = 0;
    while (!session.qr && retries < 10) {
      await new Promise(r => setTimeout(r, 500));
      retries++;
    }

    res.json({
      qrAvailable: !!session.qr,
      qr: session.qr,
      registered: !!session.sock?.user,
      connected: session.sock?.ws?.readyState === 1
    });
  } catch (err) {
    console.error('Error in /status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API to send message
app.get('/send/:id/:to/:msg', async (req, res) => {
  const { id, to, msg } = req.params;
  const session = await getSession(id);

  if (!session || !session.sock || !session.sock.user || !isSocketConnected(session.sock)) {
    return res.status(400).json({ error: 'Session not connected or invalid' });
  }

  try {
    const sent = await session.sock.sendMessage(to + '@s.whatsapp.net', { text: msg });
    res.json({ message: 'Message sent', msgId: sent.key.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message', details: err.message });
  }
});

app.get('/delete/:sessionId', async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    console.log(`[${sessionId}] Manual delete requested...`);

    deleteSession(sessionId);
    const session = await getSession(sessionId); // recreate session

    res.json({
      message: 'Session delete successful',
      qrAvailable: !!session.qr,
      qr: session.qr
    });
  } catch (err) {
    console.error(`Error in /delete/${req.params.sessionId}:`, err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
