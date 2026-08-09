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
const OWNER     = (process.env.OWNER_WA || '923001234567').replace(/\D/g, '');
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

function searchProducts(query, limit = 3) {
  const words = query.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  if (!words.length) return [];
  return PRODUCTS.map(p => {
    const name = p.name.toLowerCase();
    let score = 0;
    for (const w of words) if (name.includes(w)) score += w.length >= 4 ? 2 : 1;
    return { p, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.p);
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
    text: `New order received!\n\nOrder: ${o.oid}\nName: ${o.name}\nPhone: ${o.phone}\nAddress: ${o.addr}\n\n${items}\n\nSubtotal: ${fmt(o.sub)}\nDelivery: ${o.fee ? fmt(o.fee) : 'FREE'}\nTOTAL (COD): ${fmt(o.total)}\n\nPDF receipt attached.`,
    attachments: [{ filename: `Order-${o.oid}.pdf`, content: pdfBuf, contentType: 'application/pdf' }]
  });
  console.log('📧 PDF email bhej di:', EMAIL_TO);
  return true;
}

/* ================= ODOO (optional — orders ka Odoo mein auto entry) ================= */
let ODOO = null;
try { ODOO = require('./odoo'); console.log(ODOO.configured() ? '🗂 Odoo: configured ✓' : 'ℹ️  Odoo env vars nahi — ODOO_URL/DB/USER/API_KEY lagayein to orders Odoo mein bhi jayenge (README dekhein)'); }
catch (e) { console.log('odoo.js load error:', e.message); }

/* ================= MONGO (optional — session + orders SAVE) ================= */
let OrderModel = null;
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
    oid: String, name: String, phone: String, addr: String,
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

  /* ---------- AUTO RATE-REPLY ---------- */
  client.on('message', async msg => {
    try {
      if (msg.fromMe || msg.from === 'status@broadcast' || msg.from.endsWith('@g.us')) return;
      const text = (msg.body || '').trim();
      if (text.length < 3) return;
      const low = text.toLowerCase();

      if (/^(hi|hello|salam|assalam|aoa|hey|adab)\b/.test(low)) {
        await msg.reply(
          `Assalam o Alaikum! 👋 *${STORE}* mein khush aamdeed.\n\n` +
          `💰 Kisi bhi product ka *rate* jannay ke liye uska naam likh dein — masalan:\n"3 pcs lawn suit ka rate?"\n\n` +
          (SITE_URL ? `🛍 Poori store: ${SITE_URL}\n` : '') +
          `🚚 COD available all over Pakistan`);
        return;
      }

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
        await msg.reply(
          `Maaf kijiye — "${text}" wala product nahi mil saka 🙁\n` +
          `Thora aur naam likh kar poochein (masalan "unstitched suit", "earbuds", "makeup kit")\n` +
          (SITE_URL ? `ya poori store yahan dekhein: ${SITE_URL}` : ''));
      }
    } catch (e) { console.log('reply error:', e.message); }
  });

  client.initialize();
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

app.get('/health', (req, res) => res.json({ ok: true, connected, mongo: !!OrderModel, odoo: !!(ODOO && ODOO.configured()), owner: OWNER, products: PRODUCTS.length }));

/* Order aaya → PDF banao → WhatsApp (text + PDF) + Gmail (PDF) + DATABASE save */
app.post('/order', async (req, res) => {
  try {
    const o = req.body || {};
    if (!o.oid || !o.name) return res.status(400).json({ ok: false, error: 'invalid order' });
    if (OrderModel) { try { await OrderModel.create(o); console.log('💾 Order DB mein save:', o.oid); } catch (e) { console.log('db save error:', e.message); } }

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
      text += `👤 Name: ${o.name}\n📱 Phone: ${o.phone}\n📍 Address: ${o.addr}\n\n💵 Payment: Cash on Delivery`;
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
    res.json({ ok: true, saved: !!OrderModel, waSent, emailed, pdf: !!pdfBuf, odoo: odooSO ? odooSO.name : null });
  } catch (e) {
    console.log('order error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* Save huye orders browser mein dekhein: /orders?key=ADMIN_KEY */
app.get('/orders', async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).send(page('🔒', '#e5484d', 'Unauthorized', 'Sahi key ke saath kholein: /orders?key=YOUR_KEY'));
  if (!OrderModel) return res.send(page('🍃', '#8a6100', 'MongoDB set nahi', 'Orders save karne ke liye MONGO_URI env variable lagayein — README dekhein.'));
  const list = await OrderModel.find().sort({ ts: -1 }).limit(200).lean();
  const rows = list.map(o => `<tr><td><b>${o.oid}</b><br><small>${new Date(o.ts).toLocaleString('en-PK')}</small></td>
    <td>${(o.items || []).map(i => '▪️ ' + i.name + ' ×' + i.qty).join('<br>')}</td>
    <td>👤 ${o.name}<br>📱 ${o.phone}<br><small>📍 ${o.addr}</small></td>
    <td><b>${fmt(o.total)}</b><br><small>${o.status}</small></td></tr>`).join('');
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orders — ${STORE}</title>
  <style>body{font-family:Segoe UI,Arial,sans-serif;background:#f4f7f5;margin:0;padding:24px}h1{color:#0b5d43;font-size:22px}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(8,68,51,.08)}
  th{background:#0b5d43;color:#fff;text-align:left;padding:12px 14px;font-size:12px;text-transform:uppercase}
  td{padding:12px 14px;border-bottom:1px solid #eef3f0;font-size:13px;vertical-align:top}.meta{color:#5b6b62;font-size:13px;margin:6px 0 18px}</style></head>
  <body><h1>🧾 Saved Orders — ${STORE}</h1><div class="meta">${list.length} orders · database mein permanently save · <a href="?key=${req.query.key}">refresh</a></div>
  <table><thead><tr><th>Order</th><th>Items</th><th>Customer</th><th>Total</th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:40px;color:#5b6b62">Abhi koi order nahi</td></tr>'}</tbody></table></body></html>`);
});

app.get('/', (req, res) => res.redirect('/qr'));

app.listen(PORT, () => {
  console.log(`\n🚀 ${STORE} — WhatsApp Bot chal raha hai`);
  console.log(`📲 QR login:      http://localhost:${PORT}/qr`);
  console.log(`📨 Orders POST:   http://localhost:${PORT}/order`);
  console.log(`🧾 Saved orders:  http://localhost:${PORT}/orders?key=${ADMIN_KEY}\n`);
  start().catch(e => console.log('start error:', e.message));
});
