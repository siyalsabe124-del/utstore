/**
 * UTStore — WhatsApp Bot Server (with FREE persistent save)
 * --------------------------------------------------------------
 *  1) /qr page  → WhatsApp QR scan se login (EK DAFA — session MongoDB mein SAVE rehta hai)
 *  2) POST /order → website ka order owner ke WhatsApp pe auto-send + database mein save
 *  3) GET /orders?key=... → save huye saare orders browser mein dekhein
 *  4) Auto-reply → koi rate pooche to website ke data se khud jawab
 *
 * FREE + SAVED combo:
 *   MongoDB Atlas (free)  → session + orders hamesha save, restart pe kuch nahi urta
 *   cron-job.org (free)   → /health ko har 5 min ping → free hosting kabhi sleep nahi karti
 */
const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

/* ================= SETTINGS (env vars ya defaults) ================= */
const PORT      = process.env.PORT || 3000;
const OWNER     = (process.env.OWNER_WA || '923245443606').replace(/\D/g, '');
const STORE     = process.env.STORE_NAME || 'UTStore Store';
const SITE_URL  = process.env.SITE_URL || '';
const MONGO_URI = process.env.MONGO_URI || '';   // MongoDB Atlas ka free connection string
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123'; // /orders page ka key — ZAROOR badlein

/* ---- AUTO PDF → GMAIL settings ----
   EMAIL_USER: aapki Gmail (orders jis pe aayen)
   EMAIL_PASS: Gmail ka 16-digit "App Password" (myaccount.google.com/apppasswords)
   EMAIL_TO  : jis pe PDF bhejni hai (khali = EMAIL_USER pe hi)              */
const EMAIL_USER = process.env.EMAIL_USER || 'siyalsabe124@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const EMAIL_TO   = process.env.EMAIL_TO   || EMAIL_USER;

/* ---- AI REPLIES (Gemini YA OpenRouter — dono free options) ----
   AI kaam aise karega:
    1) GEMINI_API_KEY    → Google Gemini (free tier, ai.google.dev)
    2) OPENROUTER_API_KEY → OpenRouter (ek key, saare models: ChatGPT/Claude/Llama/DeepSeek… free models bhi)
   dono mein se jo key ho wo use hogi. Key na ho to simple greeting + rate search chalta hai. */
let GEMINI_KEY = process.env.GEMINI_API_KEY || '';
let OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
let OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat-v3-0324:free'; // free model default

const fmt = n => 'PKR ' + Number(n || 0).toLocaleString('en-PK');

/* ================= PRODUCTS (data.js se, har 5 min auto-refresh) ================= */
function loadProducts() {
  for (const p of [path.join(__dirname, 'data.js'), path.join(__dirname, '..', 'data.js')]) {
    try {
      const txt = fs.readFileSync(p, 'utf8');
      const m = txt.match(/DEFAULT_PRODUCTS\s*=\s*(\[[\s\S]*?\])\s*;/);
      if (m) { const arr = JSON.parse(m[1]); return arr; }
    } catch (e) {}
  }
  return [];
}
let PRODUCTS = loadProducts();
console.log(`📦 ${PRODUCTS.length} products loaded`);
setInterval(() => { PRODUCTS = loadProducts(); }, 5 * 60 * 1000);

/* ================= STOCK TRACKING (volume par save — redeploy pe nahi jata) ================= */
const STOCK_FILE = path.join(process.env.STOCK_PATH || path.join(__dirname, '.wwebjs_auth'), 'stock.json');
const STOCK = {};   // id -> qty (remaining)
const SOLD = {};    // id -> total sold count
function loadStock() {
  try {
    const d = JSON.parse(fs.readFileSync(STOCK_FILE, 'utf8'));
    Object.assign(STOCK, d.stock || {});
    Object.assign(SOLD, d.sold || {});
    console.log(`📦 Stock loaded (${Object.keys(STOCK).length} items)`);
  } catch (e) { console.log('📦 Naya stock state — fresh shuru'); }
}
function saveStock() {
  try {
    fs.mkdirSync(path.dirname(STOCK_FILE), { recursive: true });
    fs.writeFileSync(STOCK_FILE, JSON.stringify({ stock: STOCK, sold: SOLD }));
  } catch (e) { console.log('stock save error:', e.message); }
}
function applyStockFromProducts(products) {
  for (const p of products) {
    if (typeof p.qty === 'number' && p.qty >= 0) STOCK[p.id] = p.qty;
  }
  saveStock();
}
function stockOf(p) { return (STOCK[p.id] !== undefined) ? STOCK[p.id] : (typeof p.qty === 'number' ? p.qty : -1); }
function soldOf(id) { return SOLD[id] || 0; }
function consumeStock(items) {
  let changed = false;
  for (const it of (items || [])) {
    if (STOCK[it.id] !== undefined && STOCK[it.id] > 0) {
      STOCK[it.id] = Math.max(0, STOCK[it.id] - (it.qty || 1));
      SOLD[it.id] = (SOLD[it.id] || 0) + (it.qty || 1);
      changed = true;
    }
  }
  if (changed) saveStock();
}
loadStock();

/* Mobile accessories pehle dikhao, phir baaki sab */
const MOBILE_TERMS = ['mobile', 'phone', 'earbud', 'headphone', 'bluetooth', 'charger', 'camera',
  'sim card', 'keychain', 'pod', 'buds', 'cable', 'tablet', 'power bank', 'laptop bag',
  'wifi camera', 'ring light', 'tripod', 'selfie', 'wireless', 'ipad', 'screen guard',
  'mobile cover', 'phone case'];
function isMobileAccessory(p) {
  const name = (p.name || '').toLowerCase();
  return MOBILE_TERMS.some(t => new RegExp('(^|[^a-z])' + t.replace(/ /g, '\\s') + '([^a-z]|$)').test(name));
}
function orderProducts(list) {
  return list.slice().sort((a, b) => (isMobileAccessory(b) ? 1 : 0) - (isMobileAccessory(a) ? 1 : 0));
}

function searchProducts(query, limit = 3) {
  const words = query.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  if (!words.length) return [];
  return orderProducts(PRODUCTS.map(p => {
    const name = p.name.toLowerCase();
    let score = 0;
    for (const w of words) if (name.includes(w)) score += w.length >= 4 ? 2 : 1;
    return { p, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.p));
}

/* ---- GEMINI AI: human-like reply in ANY language ----
   Free tier: ai.google.dev → API key. Bina key ke ye function false return karta hai. */
function buildProductContext(query, limit = 8) {
  const found = searchProducts(query, limit);
  if (found.length) {
    return found.map(p => `- ${p.name}  →  PKR ${p.price}${p.badges.includes('Free delivery') ? ' (Free delivery)' : ''}`).join('\n');
  }
  return orderProducts(PRODUCTS).slice(0, 15).map(p => `- ${p.name}  →  PKR ${p.price}`).join('\n');
}
async function geminiReply(userText) {
  if (!GEMINI_KEY) return null;
  const ctx = buildProductContext(userText, 10);
  const system = `Tum "${STORE}" ke WhatsApp customer-service assistant ho (Pakistan, COD e-commerce).
  Job: customer ka message samjho (KISI BHI language mein ho — Urdu, Roman Urdu, English, mixed), aur NATURAL insani jawab do.
  Rules:
  - Apne andar ke product rates inhi se lo (sirf yahi source):\n${ctx}
  - Agar user ne product/rate poocha to rate + delivery (FREE ya fee) batao aur order karne ko keh sakte ho.
  - Agar product na mila to politely doosre options pucho ya store ka link do: ${SITE_URL || 'website'}.
  - Roman Urdu / Urdu / English mein jawab do — jis language mein user ne likha usi mein reply karo.
  - Chhota, friendly, 2-4 line ka reply — emojis thode se. Koi promo/marketing bahana na lagao.
  - Agar order/COD/delivery ke baare mein puchhe to: "Cash on Delivery available hai, 3-5 din mein delivery, order ke liye store visit karein ya naam bhejein" bolo.
  - Kabhi mat bolo ke tum AI/robot ho.`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: system + '\n\nCustomer message: ' + userText }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
  };
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(GEMINI_KEY), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!r.ok) { console.log('gemini http', r.status); return null; }
  const j = await r.json();
  const txt = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0].text;
  return txt ? txt.trim() : null;
}

/* ---- OpenRouter AI (same system prompt — ChatGPT/Claude/Llama/DeepSeek free models) ---- */
async function openrouterReply(userText) {
  if (!OPENROUTER_KEY) return null;
  const ctx = buildProductContext(userText, 10);
  const system = `Tum "${STORE}" ke WhatsApp customer-service assistant ho (Pakistan, COD e-commerce).
  Job: customer ka message samjho (KISI BHI language mein ho — Urdu, Roman Urdu, English, mixed), aur NATURAL insani jawab do.
  Rules:
  - Apne andar ke product rates inhi se lo (sirf yahi source):\n${ctx}
  - Agar user ne product/rate poocha to rate + delivery (FREE ya fee) batao aur order karne ko keh sakte ho.
  - Agar product na mila to politely doosre options pucho ya store ka link do: ${SITE_URL || 'website'}.
  - Roman Urdu / Urdu / English mein jawab do — jis language mein user ne likha usi mein reply karo.
  - Chhota, friendly, 2-4 line ka reply — emojis thode se. Koi promo/marketing bahana na lagao.
  - Agar order/COD/delivery ke baare mein puchhe to: "Cash on Delivery available hai, 3-5 din mein delivery, order ke liye store visit karein ya naam bhejein" bolo.
  - Kabhi mat bolo ke tum AI/robot ho.`;
  const body = {
    model: OPENROUTER_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userText }
    ],
    temperature: 0.7,
    max_tokens: 300
  };
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OPENROUTER_KEY, 'HTTP-Referer': SITE_URL || 'https://localhost', 'X-Title': STORE },
    body: JSON.stringify(body)
  });
  if (!r.ok) { console.log('openrouter http', r.status); return null; }
  const j = await r.json();
  const txt = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  return txt ? txt.trim() : null;
}

/* ---- Unified: pehle Gemini, warna OpenRouter (jo key available ho) ---- */
async function aiReply(userText) {
  if (GEMINI_KEY) { const g = await geminiReply(userText); if (g) return g; }
  if (OPENROUTER_KEY) { const o = await openrouterReply(userText); if (o) return o; }
  return null;
}

/* ================= PDF INVOICE (auto-generate) ================= */
const PDFDocument = require('pdfkit');
function makeOrderPDF(o) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 46 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const g = '#0b5d43';
    // header
    doc.rect(0, 0, 595.28, 96).fill(g);
    doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text(STORE, 46, 30);
    doc.fontSize(10).font('Helvetica').text('Online Shopping — Cash on Delivery across Pakistan', 46, 58);
    doc.fontSize(14).font('Helvetica-Bold').text('ORDER RECEIPT', 400, 34, { width: 150, align: 'right' });
    doc.fontSize(10).font('Helvetica').text(o.oid, 400, 56, { width: 150, align: 'right' });

    doc.fillColor('#17211c');
    doc.moveDown(2.2);
    const top = 118;
    doc.fontSize(11).font('Helvetica-Bold').text('Customer Details', 46, top);
    doc.font('Helvetica').fontSize(10)
      .text('Name:    ' + (o.name || '-'), 46, top + 18)
      .text('Phone:   ' + (o.phone || '-'), 46, top + 33)
      .text('Address: ' + (o.addr || '-'), 46, top + 48, { width: 330 });
    doc.font('Helvetica-Bold').text('Order Date:', 400, top)
      .font('Helvetica').text(new Date().toLocaleString('en-PK'), 400, top + 15)
      .font('Helvetica-Bold').text('Payment:', 400, top + 38)
      .font('Helvetica').text('Cash on Delivery', 400, top + 53);

    // items table
    let y = top + 96;
    doc.rect(46, y, 503, 22).fill('#e7f4ee');
    doc.fillColor(g).fontSize(10).font('Helvetica-Bold');
    doc.text('ITEM', 54, y + 7); doc.text('QTY', 330, y + 7, { width: 45, align: 'center' });
    doc.text('PRICE', 390, y + 7, { width: 70, align: 'right' }); doc.text('TOTAL', 470, y + 7, { width: 72, align: 'right' });
    y += 22;
    doc.fillColor('#17211c').font('Helvetica');
    (o.items || []).forEach(it => {
      const lineTotal = it.price * it.qty;
      doc.fontSize(9.5)
        .text(String(it.name).slice(0, 62), 54, y + 6, { width: 265 })
        .text(String(it.qty), 330, y + 6, { width: 45, align: 'center' })
        .text(fmt(it.price), 390, y + 6, { width: 70, align: 'right' })
        .text(fmt(lineTotal), 470, y + 6, { width: 72, align: 'right' });
      const h = Math.max(18, doc.heightOfString(String(it.name), { width: 265 }) + 11);
      doc.moveTo(46, y + h).lineTo(549, y + h).strokeColor('#e4ece7').lineWidth(0.7).stroke();
      y += h;
    });

    // totals
    y += 12;
    doc.fontSize(10).font('Helvetica')
      .text('Subtotal:', 380, y, { width: 100, align: 'right' }).text(fmt(o.sub), 480, y, { width: 62, align: 'right' });
    y += 16;
    doc.text('Delivery:', 380, y, { width: 100, align: 'right' }).text(o.fee ? fmt(o.fee) : 'FREE', 480, y, { width: 62, align: 'right' });
    y += 6;
    doc.rect(370, y + 8, 179, 26).fill(g);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11)
      .text('TOTAL (COD)', 380, y + 15).text(fmt(o.total), 470, y + 15, { width: 72, align: 'right' });

    // footer
    doc.fillColor('#5b6b62').font('Helvetica').fontSize(9)
      .text('Shukriya! Pay cash when your parcel arrives. 7-day easy returns. 3-5 day nationwide delivery.',
        46, 770, { width: 503, align: 'center' });
    doc.end();
  });
}

/* ---- send PDF to Gmail ---- */
async function emailPDF(o, pdfBuf) {
  if (!EMAIL_PASS) { console.log('ℹ️  EMAIL_PASS set nahi — email skip (README dekhein)'); return false; }
  const nodemailer = require('nodemailer');
  const mailer = nodemailer.createTransport({ service: 'gmail', auth: { user: EMAIL_USER, pass: EMAIL_PASS.replace(/\s/g, '') } });
  let items = (o.items || []).map(it => `• ${it.name}  ×${it.qty}  — ${fmt(it.price * it.qty)}`).join('\n');
  await mailer.sendMail({
    from: `"${STORE}" <${EMAIL_USER}>`,
    to: EMAIL_TO,
    subject: `🛍 New Order ${o.oid} — ${fmt(o.total)} (COD)`,
    text: `New order received!\n\nOrder: ${o.oid}\nName: ${o.name}\nPhone: ${o.phone}${o.email ? '\nEmail: ' + o.email : ''}\nAddress: ${o.addr}\n\n${items}\n\nSubtotal: ${fmt(o.sub)}\nDelivery: ${o.fee ? fmt(o.fee) : 'FREE'}\nTOTAL (COD): ${fmt(o.total)}\n\nPDF receipt attached.`,
    attachments: [{ filename: `Order-${o.oid}.pdf`, content: pdfBuf, contentType: 'application/pdf' }]
  });
  console.log('📧 PDF email bhej di:', EMAIL_TO);
  return true;
}

/* ================= ODOO (optional — orders ka Odoo mein auto entry) ================= */
let ODOO = null;
try { ODOO = require('./odoo'); console.log(ODOO.configured() ? '🗂 Odoo: configured ✓' : 'ℹ️  Odoo env vars nahi — ODOO_URL/DB/USER/API_KEY lagayein to orders Odoo mein bhi jayenge (README dekhein)'); }
catch (e) { console.log('odoo.js load error:', e.message); }

/* ================= ORDER STORE (MongoDB ya in-memory fallback) ================= */
let OrderModel = null;
const MEM_ORDERS = [];   // jab MONGO_URI set na ho to orders yahan keep — jab tak server chalta hai

async function saveOrder(o) {
  o.status = o.status || 'new';
  if (OrderModel) { try { await OrderModel.create(o); console.log('💾 Order DB mein save:', o.oid); return true; } catch (e) { console.log('db save error:', e.message); } }
  MEM_ORDERS.unshift(o);
  return true;
}
async function listOrders(limit = 200) {
  if (OrderModel) return await OrderModel.find().sort({ ts: -1 }).limit(limit).lean();
  return MEM_ORDERS.slice(0, limit);
}
async function updateOrderStatus(oid, status) {
  if (OrderModel) { await OrderModel.updateOne({ oid }, { $set: { status } }); return true; }
  const o = MEM_ORDERS.find(x => x.oid === oid);
  if (o) { o.status = status; return true; }
  return false;
}

async function makeAuth() {
  if (!MONGO_URI) {
    console.log('ℹ️  MONGO_URI set nahi — LocalAuth (local files). Free save ke liye MONGO_URI lagayein (README dekhein).');
    return new LocalAuth();
  }
  const mongoose = require('mongoose');
  const { MongoStore } = require('wwebjs-mongo');
  await mongoose.connect(MONGO_URI);
  console.log('🍃 MongoDB connected — session + orders SAVE honge');
  OrderModel = mongoose.model('Order', new mongoose.Schema({
    oid: String, name: String, phone: String, email: String, addr: String,
    items: Array, sub: Number, fee: Number, total: Number,
    status: { type: String, default: 'new' }, ts: { type: Date, default: Date.now }
  }));
  const store = new MongoStore({ mongoose });
  return new RemoteAuth({ clientId: 'utstore-bot', store, backupSyncIntervalMs: 300000 });
}

/* ================= WHATSAPP CLIENT ================= */
let qrString = null, connected = false, client = null;

async function start() {
  const auth = await makeAuth();
  client = new Client({ authStrategy: auth, puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] } });

  client.on('qr', qr => { qrString = qr; connected = false; console.log('📲 QR ready — /qr kholein'); });
  client.on('ready', () => { connected = true; qrString = null; console.log('✅ WhatsApp CONNECTED — bot live!'); });
  client.on('authenticated', () => console.log('🔑 Authenticated (session saved ✓)'));
  client.on('remote_session_saved', () => console.log('💾 Session MongoDB mein save ho gaya'));
  client.on('auth_failure', m => console.log('❌ Auth failure:', m));
  client.on('disconnected', r => { connected = false; console.log('🔌 Disconnected:', r); });

  /* ---------- AUTO REPLY (Gemini AI human-like + local rate fallback) ---------- */
  client.on('message', async msg => {
    try {
      if (msg.fromMe || msg.from === 'status@broadcast' || msg.from.endsWith('@g.us')) return;
      const text = (msg.body || '').trim();
      if (text.length < 3) return;
      const low = text.toLowerCase();

      /* 1) PEHLE AI — any language, human jaisa jawab (Gemini ya OpenRouter) */
      if (GEMINI_KEY || OPENROUTER_KEY) {
        try {
          const aiReplyText = await aiReply(text);
          if (aiReplyText) { await msg.reply(aiReplyText); return; }
        } catch (e) { console.log('ai error:', e.message); }
      }

      /* 2) Nahi to simple greeting */
      if (/^(hi|hello|salam|assalam|aoa|hey|adab)\b/.test(low)) {
        await msg.reply(
          `Assalam o Alaikum! 👋 *${STORE}* mein khush aamdeed.\n\n` +
          `💰 Kisi bhi product ka *rate* jannay ke liye uska naam likh dein — masalan:\n"3 pcs lawn suit ka rate?"\n\n` +
          (SITE_URL ? `🛍 Poori store: ${SITE_URL}\n` : '') +
          `🚚 COD available all over Pakistan`);
        return;
      }

      /* 3) Local rate search (free, AI key ka intezar nahi) */
      const asksPrice = /rate|price|keemat|kimat|qimat|kitn[aeiy]|cost|₨|pkr|rs\b/.test(low);
      const cleaned = low.replace(/rate|price|keemat|kimat|qimat|kitn[aeiy]a?|kitnay|ki|ka|ke|kya|hai|batao|batayein|bata|please|plz|pls|is|kaa|mein|\?|cost|of|the|pkr|rs\b/g, ' ').replace(/\s+/g, ' ').trim();
      const results = searchProducts(cleaned.length >= 3 ? cleaned : low);

      if (results.length) {
        let out = `💰 *Rate mil gaya!* (${STORE})\n━━━━━━━━━━━━━━━\n`;
        results.forEach(p => {
          const disc = p.badges.find(b => /^-\d+%$/.test(b)) || '';
          out += `\n🛍 *${p.name}*\n💵 ${fmt(p.price)}${disc ? '  (' + disc + ' OFF)' : ''}${p.badges.includes('Free delivery') ? ' · 🚚 Free delivery' : ''}\n`;
          if (SITE_URL) out += `🔗 ${SITE_URL}\n`;
        });
        out += `\n━━━━━━━━━━━━━━━\n💵 Cash on Delivery · ↩️ 7-day returns\nOrder ke liye website visit karein ya yahan reply karein 😊`;
        await msg.reply(out);
      } else if (asksPrice) {
        const mobiles = orderProducts(PRODUCTS).filter(isMobileAccessory).slice(0, 4);
        let out = `Maaf kijiye — "${text}" wala product nahi mil saka 🙁\n\n`;
        if (mobiles.length) {
          out += `📱 *Mobile Accessories* (hamari pehli pasand):\n`;
          mobiles.forEach(p => { out += `• ${p.name} — ${fmt(p.price)}\n`; });
        }
        out += `\nThora aur naam likh kar poochein (masalan "unstitched suit", "earbuds", "makeup kit")\n` +
          (SITE_URL ? `ya poori store yahan dekhein: ${SITE_URL}` : '');
        await msg.reply(out);
      }
    } catch (e) { console.log('reply error:', e.message); }
  });

  client.initialize().catch(e => {
    console.log('⚠️ WhatsApp initialize fail (Chrome nahi mila ya koi aur issue):', e.message);
    console.log('   Server chal raha hai — orders/API kaam karte rahenge. QR login ke liye Chrome zaroori hai.');
  });
}

/* ================= WEB SERVER ================= */
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* QR login page */
app.get('/qr', async (req, res) => {
  if (connected) return res.send(page('✅', '#0b5d43', 'WhatsApp connected!', 'Bot live hai — session saved hai, restart pe bhi login rahega. Ye page band kar dein.'));
  if (!qrString) return res.send(page('⏳', '#8a6100', 'QR tayyar ho raha hai…', '10–15 second mein page khud refresh ho jayega.', true));
  try {
    const img = await QRCode.toDataURL(qrString, { width: 320, margin: 1 });
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp QR Login</title>
    <style>body{font-family:Segoe UI,Arial,sans-serif;background:#063325;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}
    .card{background:#fff;color:#17211c;border-radius:22px;padding:34px;max-width:420px;box-shadow:0 30px 80px rgba(0,0,0,.4)}
    img{border-radius:14px}h1{font-size:21px}.step{font-size:13.5px;color:#5b6b62;text-align:left;line-height:2;margin-top:16px}
    .b{display:inline-block;background:#e7f4ee;color:#0b5d43;font-weight:700;border-radius:8px;padding:2px 9px;font-size:12px}</style></head>
    <body><div class="card"><h1>📲 WhatsApp Login — QR Scan karein</h1>
    <img src="${img}" alt="QR">
    <div class="step">1️⃣ Phone pe <b>WhatsApp</b> kholein<br>2️⃣ <b>⋮ Menu → Linked devices</b><br>3️⃣ <span class="b">Link a device</span> → QR scan karein<br><br>💾 Session <b>save</b> ho jayega — sirf EK dafa scan karna hai.<br><small>QR har ~30 sec badalta hai — expire ho to refresh karein.</small></div>
    <meta http-equiv="refresh" content="25"></div></body></html>`);
  } catch (e) { res.status(500).send('QR error: ' + e.message); }
});

function page(icon, color, title, sub, refresh) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? '<meta http-equiv="refresh" content="8">' : ''}
  <style>body{font-family:Segoe UI,Arial,sans-serif;background:#063325;display:grid;place-items:center;min-height:100vh;margin:0}
  div{background:#fff;border-radius:20px;padding:40px;text-align:center;max-width:380px}
  span{font-size:52px}h1{font-size:20px;color:${color}}p{font-size:13.5px;color:#5b6b62;line-height:1.7}</style></head>
  <body><div><span>${icon}</span><h1>${title}</h1><p>${sub}</p></div></body></html>`;
}

app.get('/health', (req, res) => res.json({ ok: true, connected, mongo: !!OrderModel, odoo: !!(ODOO && ODOO.configured()), email: !!EMAIL_PASS, ai: !!(GEMINI_KEY || OPENROUTER_KEY), aiProvider: GEMINI_KEY ? 'gemini' : (OPENROUTER_KEY ? 'openrouter' : 'none'), owner: OWNER, products: PRODUCTS.length }));

/* Admin se AI keys set karein (bina redeploy) — GEMINI_API_KEY / OPENROUTER_API_KEY / OPENROUTER_MODEL */
app.get('/api/config', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  res.json({ ok: true, aiProvider: GEMINI_KEY ? 'gemini' : (OPENROUTER_KEY ? 'openrouter' : 'none'), gemini: !!GEMINI_KEY, openrouter: !!OPENROUTER_KEY, model: OPENROUTER_MODEL });
});
app.post('/api/config', (req, res) => {
  const key = (req.body || {}).key || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const b = req.body || {};
  if (typeof b.geminiKey === 'string') GEMINI_KEY = b.geminiKey.trim();
  if (typeof b.openrouterKey === 'string') OPENROUTER_KEY = b.openrouterKey.trim();
  if (typeof b.model === 'string' && b.model.trim()) OPENROUTER_MODEL = b.model.trim();
  console.log('🤖 AI config update — gemini:', !!GEMINI_KEY, '· openrouter:', !!OPENROUTER_KEY, '· model:', OPENROUTER_MODEL);
  res.json({ ok: true });
});

/* ================= EMAIL OTP SIGNUP/LOGIN (customer apni Gmail se PIN le kar login) ================= */
const crypto = require('crypto');
const pins = new Map();           // email -> {pin, exp, count}
const sessionTokens = new Map();  // token -> {email, ts}

app.post('/auth/start', async (req, res) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Email durust nahi' });
    if (!EMAIL_PASS) return res.status(503).json({ ok: false, error: 'Email service set nahi — bot mein EMAIL_PASS lagayein' });
    const cur = pins.get(email);
    if (cur && cur.count >= 3 && Date.now() < cur.exp) return res.status(429).json({ ok: false, error: 'Bohat si koshishen — 10 minute baad try karein' });
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    pins.set(email, { pin, exp: Date.now() + 10 * 60 * 1000, count: (cur ? cur.count : 0) + 1 });
    const nodemailer = require('nodemailer');
    const mailer = nodemailer.createTransport({ service: 'gmail', auth: { user: EMAIL_USER, pass: EMAIL_PASS.replace(/\s/g, '') } });
    await mailer.sendMail({
      from: `"${STORE}" <${EMAIL_USER}>`, to: email,
      subject: `${pin} — aapka ${STORE} login PIN`,
      text: `Assalam o Alaikum!\n\nAapka ${STORE} login PIN hai:\n\n   ${pin}\n\nYe PIN 10 minute tak valid hai.\nAgar aap ne nahi manga to is email ko ignore karein.\n\n— ${STORE}`
    });
    console.log('🔐 PIN bheja:', email);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/auth/verify', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const pin = String((req.body || {}).pin || '').trim();
  const rec = pins.get(email);
  if (!rec || Date.now() > rec.exp) return res.status(400).json({ ok: false, error: 'PIN expire ho gaya — dobara mangwayein' });
  if (rec.pin !== pin) return res.status(400).json({ ok: false, error: 'Ghalat PIN — dobara dekh kar likhein' });
  pins.delete(email);
  const token = crypto.randomBytes(24).toString('hex');
  sessionTokens.set(token, { email, ts: Date.now() });
  console.log('✅ Login hua:', email);
  res.json({ ok: true, token, email });
});

app.post('/auth/check', (req, res) => {
  const t = sessionTokens.get(String((req.body || {}).token || ''));
  if (!t) return res.status(401).json({ ok: false });
  res.json({ ok: true, email: t.email });
});

/* Order aaya → PDF banao → WhatsApp (text + PDF) + Gmail (PDF) + DATABASE save */
app.post('/order', async (req, res) => {
  try {
    const o = req.body || {};
    if (!o.oid || !o.name) return res.status(400).json({ ok: false, error: 'invalid order' });
    await saveOrder(o);
    consumeStock(o.items);

    /* 2) Odoo mein Sale Order (agar configured hai) */
    let odooSO = null;
    if (ODOO && ODOO.configured()) {
      try { odooSO = await ODOO.createSaleOrder(o); console.log('🗂 Odoo Sale Order ban gaya:', odooSO.name, '(' + odooSO.state + ')', fmt(o.total)); }
      catch (e) { console.log('odoo error:', e.message); }
    }

    /* 3) PDF invoice auto-generate */
    let pdfBuf = null;
    try { pdfBuf = await makeOrderPDF(o); console.log('📄 PDF ban gayi:', o.oid); }
    catch (e) { console.log('pdf error:', e.message); }

    /* 4) Gmail pe PDF (agar EMAIL_PASS set hai) */
    let emailed = false;
    if (pdfBuf) { try { emailed = await emailPDF(o, pdfBuf); } catch (e) { console.log('email error:', e.message); } }

    /* 3) WhatsApp pe text + PDF document */
    let waSent = false;
    if (connected) {
      let text = `🛍 *NEW ORDER — ${o.oid}*\n━━━━━━━━━━━━━━━\n\n`;
      (o.items || []).forEach(it => { text += `▪️ ${it.name}\n    Qty: ${it.qty} × ${fmt(it.price)} = ${fmt(it.price * it.qty)}\n`; });
      text += `\nSubtotal: ${fmt(o.sub)}\nDelivery: ${o.fee ? fmt(o.fee) : 'FREE'}\n*TOTAL (COD): ${fmt(o.total)}*\n\n`;
      text += `👤 Name: ${o.name}\n📱 Phone: ${o.phone}${o.email ? '\n📧 Email: ' + o.email : ''}\n📍 Address: ${o.addr}\n\n💵 Payment: Cash on Delivery`;
      if (odooSO) text += `\n🗂 Odoo: ${odooSO.name} (${odooSO.state}) ban gaya ✓`;
      await client.sendMessage(OWNER + '@c.us', text);
      console.log('📨 Order sent to owner:', o.oid, fmt(o.total));
      if (pdfBuf) {
        const { MessageMedia } = require('whatsapp-web.js');
        const media = new MessageMedia('application/pdf', pdfBuf.toString('base64'), `Order-${o.oid}.pdf`);
        await client.sendMessage(OWNER + '@c.us', media, { caption: `📄 Invoice — ${o.oid}` });
        console.log('📄 PDF WhatsApp pe bhej di');
      }
      waSent = true;
    }
    if (!waSent) console.log('⚠️ WhatsApp connected nahi — order DB' + (emailed ? ' + email' : '') + ' mein save ho gaya');
    res.json({ ok: true, saved: !!OrderModel || MEM_ORDERS.length > 0, waSent, emailed, pdf: !!pdfBuf, odoo: odooSO ? odooSO.name : null });
  } catch (e) {
    console.log('order error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* Save huye orders browser mein dekhein: /orders?key=ADMIN_KEY
   Admin Panel ke liye JSON: /api/orders?key=ADMIN_KEY&format=json */
app.get('/orders', async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).send(page('🔒', '#e5484d', 'Unauthorized', 'Sahi key ke saath kholein: /orders?key=YOUR_KEY'));
  if (!OrderModel && !MEM_ORDERS.length) return res.send(page('🍃', '#8a6100', 'Koi order nahi', 'MongoDB set nahi — orders in-memory save honge jab tak server chalta hai. MONGO_URI lagayein to permanently save rahenge (README dekhein).'));
  const list = await listOrders(200);
  const rows = list.map(o => `<tr><td><b>${o.oid}</b><br><small>${new Date(o.ts).toLocaleString('en-PK')}</small></td>
    <td>${(o.items || []).map(i => '▪️ ' + i.name + ' ×' + i.qty).join('<br>')}</td>
    <td>👤 ${o.name}<br>📱 ${o.phone}<br><small>📍 ${o.addr}</small></td>
    <td><b>${fmt(o.total)}</b><br><small>${o.status}</small></td></tr>`).join('');
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orders — ${STORE}</title>
  <style>body{font-family:Segoe UI,Arial,sans-serif;background:#f4f7f5;margin:0;padding:24px}h1{color:#0b5d43;font-size:22px}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(8,68,51,.08)}
  th{background:#0b5d43;color:#fff;text-align:left;padding:12px 14px;font-size:12px;text-transform:uppercase}
  td{padding:12px 14px;border-bottom:1px solid #eef3f0;font-size:13px;vertical-align:top}.meta{color:#5b6b62;font-size:13px;margin:6px 0 18px}</style></head>
  <body><h1>🧾 Saved Orders — ${STORE}</h1><div class="meta">${list.length} orders · ${OrderModel ? 'database mein permanently save' : 'in-memory (MONGO_URI lagayein to permanent)'} · <a href="?key=${req.query.key}">refresh</a></div>
  <table><thead><tr><th>Order</th><th>Items</th><th>Customer</th><th>Total</th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:40px;color:#5b6b62">Abhi koi order nahi</td></tr>'}</tbody></table></body></html>`);
});

/* Admin Panel ke liye JSON API — live orders + status update + sales stats */
app.get('/api/orders', async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized — sahi ADMIN_KEY use karein' });
  const list = await listOrders(Number(req.query.limit) || 500);
  const active = list.filter(o => o.status !== 'cancelled');
  const revenue = active.reduce((s, o) => s + (o.total || 0), 0);
  const subTotal = active.reduce((s, o) => s + (o.sub || 0), 0);
  let soldItems = 0;
  const byId = {};
  active.forEach(o => (o.items || []).forEach(it => {
    soldItems += it.qty || 1;
    byId[it.id] = (byId[it.id] || 0) + (it.qty || 1);
  }));
  res.json({
    ok: true, orders: list, mongo: !!OrderModel,
    stats: {
      orders: active.length, revenue, subTotal, soldItems,
      byStatus: { new: active.filter(o => o.status === 'new').length, confirmed: active.filter(o => o.status === 'confirmed').length, delivered: active.filter(o => o.status === 'delivered').length, cancelled: list.filter(o => o.status === 'cancelled').length },
      sold: byId
    }
  });
});

/* Low-stock list (admin ke liye) — jinke qty threshold se kam hai */
app.get('/api/lowstock', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const threshold = Number(req.query.threshold) || 10;
  const low = PRODUCTS.map(p => ({ id: p.id, name: p.name, price: p.price, qty: stockOf(p), sold: soldOf(p.id) }))
    .filter(p => p.qty >= 0 && p.qty <= threshold)
    .sort((a, b) => a.qty - b.qty);
  res.json({ ok: true, threshold, low, total: PRODUCTS.length });
});

/* Admin Panel se products LIVE publish (rates/images update hote hi website pe) */
app.get('/api/products', (req, res) => {
  const products = PRODUCTS.map(p => ({ ...p, qty: stockOf(p) >= 0 ? stockOf(p) : p.qty, sold: soldOf(p.id) }));
  res.json({ ok: true, products });
});
app.post('/api/products', (req, res) => {
  const key = (req.body || {}).key || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const arr = (req.body || {}).products;
  if (!Array.isArray(arr)) return res.status(400).json({ ok: false, error: 'products array chahiye' });
  PRODUCTS = arr;
  applyStockFromProducts(arr);
  console.log('📦 Admin se ' + arr.length + ' products LIVE update ho gaye');
  res.json({ ok: true, count: arr.length });
});

app.post('/api/order/status', async (req, res) => {
  const key = (req.body || {}).key || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const { oid, status } = req.body || {};
  if (!oid || !['new', 'confirmed', 'delivered', 'cancelled'].includes(status)) return res.status(400).json({ ok: false, error: 'invalid oid/status' });
  const ok = await updateOrderStatus(oid, status);
  res.json({ ok });
});

app.get('/', (req, res) => res.redirect('/qr'));

app.listen(PORT, () => {
  console.log(`\n🚀 ${STORE} — WhatsApp Bot chal raha hai`);
  console.log(`📲 QR login:      http://localhost:${PORT}/qr`);
  console.log(`📨 Orders POST:   http://localhost:${PORT}/order`);
  console.log(`🧾 Saved orders:  http://localhost:${PORT}/orders?key=${ADMIN_KEY}\n`);
  start().catch(e => console.log('start error:', e.message));
});
