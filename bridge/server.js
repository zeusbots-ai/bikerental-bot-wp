const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.BRIDGE_PORT || '3001', 10);
const FASTAPI_WEBHOOK_URL = process.env.FASTAPI_WEBHOOK_URL || 'http://localhost:8000/api/v1/whatsapp/webhook';
const SESSION_DATA_PATH = process.env.SESSION_DATA_PATH || path.join(__dirname, '..', 'data', 'session');
const MEDIA_STORAGE_PATH = process.env.MEDIA_STORAGE_PATH || path.join(__dirname, '..', 'data', 'media');

// Ensure storage directories exist
if (!fs.existsSync(SESSION_DATA_PATH)) {
    fs.mkdirSync(SESSION_DATA_PATH, { recursive: true });
}
if (!fs.existsSync(MEDIA_STORAGE_PATH)) {
    fs.mkdirSync(MEDIA_STORAGE_PATH, { recursive: true });
}

const app = express();
app.use(express.json({ limit: '50mb' }));

// Client state variables
let clientStatus = 'INITIALIZING'; // INITIALIZING | QR_READY | AUTHENTICATED | READY | DISCONNECTED | AUTH_FAILURE
let latestRawQr = null;
let latestQrDataUrl = null;
let botPhoneNumber = null;

// Determine Chromium path if available
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH ||
    (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' :
    (fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : undefined));

console.log(`[WhatsApp Bridge] Initializing with Session Path: ${SESSION_DATA_PATH}`);
console.log(`[WhatsApp Bridge] Webhook URL: ${FASTAPI_WEBHOOK_URL}`);
if (executablePath) {
    console.log(`[WhatsApp Bridge] Using Chromium binary at: ${executablePath}`);
}

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_DATA_PATH
    }),
    puppeteer: {
        headless: true,
        executablePath: executablePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--single-process'
        ]
    }
});

// Event Listeners
client.on('qr', async (qr) => {
    clientStatus = 'QR_READY';
    latestRawQr = qr;
    try {
        latestQrDataUrl = await QRCode.toDataURL(qr);
    } catch (err) {
        console.error('[WhatsApp Bridge] Error converting QR to data URL:', err);
    }

    console.log('\n================================================================');
    console.log('>>> SCAN THE WHATSAPP QR CODE BELOW WITH YOUR PERSONAL APP <<<');
    console.log('>>> Open WhatsApp -> Settings / Menu -> Linked Devices -> Link <<<');
    console.log('================================================================\n');
    qrcodeTerminal.generate(qr, { small: true });
    console.log('\n================================================================');
    console.log(`[WhatsApp Bridge] Web QR viewer is also available at: http://localhost:${PORT}/qr`);
    console.log('================================================================\n');
});

client.on('authenticated', () => {
    clientStatus = 'AUTHENTICATED';
    console.log('[WhatsApp Bridge] WhatsApp session successfully authenticated!');
});

client.on('auth_failure', (msg) => {
    clientStatus = 'AUTH_FAILURE';
    console.error('[WhatsApp Bridge] Authentication failure:', msg);
});

client.on('ready', () => {
    clientStatus = 'READY';
    latestRawQr = null;
    latestQrDataUrl = null;
    botPhoneNumber = client.info && client.info.wid ? client.info.wid.user : 'Unknown';
    console.log(`[WhatsApp Bridge] WhatsApp client is READY! Connected Phone: +${botPhoneNumber}`);
});

client.on('disconnected', async (reason) => {
    clientStatus = 'DISCONNECTED';
    console.warn(`[WhatsApp Bridge] WhatsApp disconnected. Reason: ${reason}`);
    console.log('[WhatsApp Bridge] Re-initializing client in 5 seconds...');
    setTimeout(() => {
        client.initialize().catch(err => console.error('[WhatsApp Bridge] Reconnect failed:', err));
    }, 5000);
});

client.on('message', async (message) => {
    try {
        // Ignore status broadcasts and messages sent by the bot itself
        if (message.isStatus || message.fromMe) {
            return;
        }

        const senderJid = message.from; // raw JID — may be @c.us, @lid, or @g.us
        const senderPhone = senderJid.replace(/@c\.us$/, '').replace(/@lid$/, '').replace(/@g\.us$/, '');
        let mediaInfo = null;

        if (message.hasMedia) {
            try {
                const downloadedMedia = await message.downloadMedia();
                if (downloadedMedia) {
                    const ext = downloadedMedia.mimetype.split('/')[1]?.split(';')[0] || 'bin';
                    const filename = `media_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
                    const absoluteFilePath = path.join(MEDIA_STORAGE_PATH, filename);

                    fs.writeFileSync(absoluteFilePath, Buffer.from(downloadedMedia.data, 'base64'));
                    mediaInfo = {
                        filename: filename,
                        filePath: absoluteFilePath,
                        mimetype: downloadedMedia.mimetype,
                        filesize: downloadedMedia.filesize || fs.statSync(absoluteFilePath).size
                    };
                }
            } catch (mediaErr) {
                console.error(`[WhatsApp Bridge] Failed to download media from ${senderPhone}:`, mediaErr);
            }
        }

        const payload = {
            message_id: message.id.id,
            from: senderJid,
            sender_jid: senderJid,
            sender_phone: senderPhone,
            body: message.body || '',
            timestamp: message.timestamp,
            has_media: message.hasMedia,
            media: mediaInfo
        };

        // Forward to FastAPI webhook
        axios.post(FASTAPI_WEBHOOK_URL, payload, { timeout: 15000 })
            .catch(err => {
                console.error(`[WhatsApp Bridge] Failed to forward message to FastAPI webhook (${FASTAPI_WEBHOOK_URL}):`, err.message);
            });
    } catch (err) {
        console.error('[WhatsApp Bridge] Error processing incoming message:', err);
    }
});

// REST Endpoints for FastAPI & Monitoring
app.get('/health', (req, res) => {
    res.json({
        ok: true,
        status: clientStatus,
        botPhoneNumber: botPhoneNumber,
        timestamp: new Date().toISOString()
    });
});

app.get('/status', (req, res) => {
    res.json({
        status: clientStatus,
        botPhoneNumber: botPhoneNumber,
        hasQr: !!latestQrDataUrl
    });
});

app.get('/qr', (req, res) => {
    if (clientStatus === 'READY') {
        return res.send(`
            <html>
                <body style="font-family:sans-serif; text-align:center; padding:50px; background:#f0f2f5;">
                    <h2 style="color:#128c7e;">WhatsApp Bot is Connected!</h2>
                    <p>Phone: +${botPhoneNumber || 'Active'}</p>
                    <p>Session is saved in persistent storage.</p>
                </body>
            </html>
        `);
    }
    if (!latestQrDataUrl) {
        return res.send(`
            <html>
                <body style="font-family:sans-serif; text-align:center; padding:50px; background:#f0f2f5;">
                    <h2>Initializing WhatsApp Session...</h2>
                    <p>Status: <strong>${clientStatus}</strong></p>
                    <p>Please refresh this page in a few seconds once the QR code is generated.</p>
                    <script>setTimeout(() => location.reload(), 3000);</script>
                </body>
            </html>
        `);
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp Web QR Login</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #ece5dd; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
                .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
                h2 { color: #075e54; margin-top: 0; }
                img { border: 4px solid #128c7e; border-radius: 8px; margin: 15px 0; max-width: 260px; }
                ol { text-align: left; font-size: 14px; color: #4a4a4a; line-height: 1.6; }
                .status-badge { display: inline-block; background: #e7f8e9; color: #1b5e20; padding: 4px 10px; border-radius: 20px; font-weight: 600; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Scan WhatsApp QR</h2>
                <span class="status-badge">${clientStatus}</span>
                <div>
                    <img src="${latestQrDataUrl}" alt="WhatsApp QR Code" />
                </div>
                <ol>
                    <li>Open WhatsApp on your phone</li>
                    <li>Tap <b>Menu</b> or <b>Settings</b> & select <b>Linked Devices</b></li>
                    <li>Tap <b>Link a Device</b> and point your phone to this screen</li>
                </ol>
                <script>
                    setInterval(async () => {
                        try {
                            const res = await fetch('/status');
                            const data = await res.json();
                            if (data.status === 'READY') {
                                location.reload();
                            }
                        } catch(e) {}
                    }, 4000);
                </script>
            </div>
        </body>
        </html>
    `);
});

app.get('/qr-data', (req, res) => {
    res.json({
        status: clientStatus,
        raw: latestRawQr,
        dataUrl: latestQrDataUrl
    });
});

// WhatsApp has been migrating some contacts to privacy-preserving @lid
// addressing instead of the classic @c.us phone-number JID. Sending directly
// to a guessed @c.us id for such a contact throws "No LID for user". Forcing
// a resolution via getNumberId() makes the client look up the contact's
// current WhatsApp id (whichever form it actually uses) before sending.
async function resolveChatId(rawTo) {
    const toStr = rawTo.toString();
    if (toStr.includes('@')) {
        return toStr; // already a full JID (e.g. stored @lid) — trust it
    }
    const digits = toStr.replace(/[^0-9]/g, '');
    try {
        const numberId = await client.getNumberId(digits);
        if (numberId && numberId._serialized) {
            return numberId._serialized;
        }
    } catch (err) {
        console.warn(`[WhatsApp Bridge] getNumberId lookup failed for ${digits}, falling back to @c.us:`, err.message);
    }
    return `${digits}@c.us`;
}

app.post('/send-message', async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) {
        return res.status(400).json({ error: 'Fields "to" and "message" are required.' });
    }

    if (clientStatus !== 'READY') {
        return res.status(503).json({ error: `WhatsApp client is not ready. Current status: ${clientStatus}` });
    }

    try {
        const chatId = await resolveChatId(to);

        // Optional natural typing simulation delay
        const delayMs = Math.floor(Math.random() * 500) + 300;
        await new Promise(r => setTimeout(r, delayMs));

        const result = await client.sendMessage(chatId, message);
        res.json({ success: true, messageId: result.id.id });
    } catch (err) {
        console.error(`[WhatsApp Bridge] Failed to send message to ${to}:`, err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/send-media', async (req, res) => {
    const { to, filePath, caption, mimetype } = req.body;
    if (!to || !filePath) {
        return res.status(400).json({ error: 'Fields "to" and "filePath" are required.' });
    }

    if (clientStatus !== 'READY') {
        return res.status(503).json({ error: `WhatsApp client is not ready. Current status: ${clientStatus}` });
    }

    try {
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: `File not found at path: ${filePath}` });
        }

        const media = MessageMedia.fromFilePath(filePath);
        if (mimetype) {
            media.mimetype = mimetype;
        }

        const chatId = await resolveChatId(to);

        const result = await client.sendMessage(chatId, media, { caption: caption || '' });
        res.json({ success: true, messageId: result.id.id });
    } catch (err) {
        console.error(`[WhatsApp Bridge] Failed to send media to ${to}:`, err);
        res.status(500).json({ error: err.message });
    }
});

// Start Express server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[WhatsApp Bridge] HTTP Server running on http://0.0.0.0:${PORT}`);
    console.log('[WhatsApp Bridge] Initializing WhatsApp Web Client...');
    client.initialize().catch(err => {
        console.error('[WhatsApp Bridge] Failed to initialize WhatsApp Client:', err);
    });
});
