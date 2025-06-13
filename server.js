const express = require('express');
const path = require('path');
const cors = require('cors');
const { getSession } = require('./sessionManager');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// API to get QR or status
app.get('/status/:sessionId', async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const session = await getSession(sessionId);

    res.json({
      qrAvailable: !!session.qr,
      qr: session.qr,
      registered: !!session.sock?.user
    });
  } catch (err) {
    console.error('Error in /status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
