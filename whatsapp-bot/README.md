# 🤖 WhatsApp Bot — Setup Guide (Roman Urdu)

Ye bot 3 kaam karta hai:

1. **📲 WhatsApp Login** — QR scan se aapka WhatsApp connect hota hai (ek dafa)
2. **📨 Auto Orders** — website pe order aate hi **khud-ba-khud aapke number pe message** (customer ko SEND dabana nahi parta)
3. **💰 Auto Rate Reply** — koi WhatsApp pe pooche "suit ka rate kya hai?" to bot **website ke data se rate dhoondh ke khud jawab deta hai**

---

## ⚙️ Zaroori cheezein

- **Node.js** (computer/server pe) — [nodejs.org](https://nodejs.org) se LTS version download karein
- Aapka WhatsApp **QR scan** karne ke liye phone

---

## 🧪 Pehle apne PC pe test karein (5 minute)

```bash
cd whatsapp-bot
npm install        # pehli dafa — 2-4 minute lega
node server.js     # ya: npm start
```

Phir:

1. Browser mein kholein: **http://localhost:3000/qr**
2. Phone pe WhatsApp → **⋮ Menu → Linked devices → Link a device** → QR scan karein
3. Terminal mein `✅ WhatsApp CONNECTED` aa jaye to bot live hai!

**Website se connect karna:**
- Admin Panel (admin.html) → ⚙️ Settings → **Bot URL** mein likhein: `http://localhost:3000` → Save
- Ab website pe test order karein — order **khud-ba-khud** aapke WhatsApp pe aayega!

> ⚠️ PC band ya bot band → auto-send nahi hoga (website khud wa.me pe wapas chali jayegi — orders kabhi miss nahi honge)

---

## 🌐 24/7 chalane ke liye — **100% FREE + SAVED** combo 🎯

Free hosting ka masla: **sleep** ho jati hai aur restart pe **WhatsApp login ur jata** (bar bar QR!). Ye 3 free cheezein mila ke dono masle khatam:

### 1️⃣ MongoDB Atlas (free) — session + orders SAVE
1. [mongodb.com/atlas](https://www.mongodb.com/atlas) pe free account banayein
2. **M0 FREE cluster** banayein → **Database Access** mein user banayein (username + password)
3. **Network Access** mein `0.0.0.0/0` allow karein
4. **Connect → Drivers → Node.js** se connection string copy karein — ye aapka `MONGO_URI` hai:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/utstore`
5. **Faida:** QR login session cloud mein save — server restart/redeploy ho to bhi **dobara scan karne ki zaroorat NAHI** 💾. Aur har order database mein permanently save.

### 2️⃣ Render.com (free) — bot host
1. [render.com](https://render.com) → account → **New → Web Service**
2. Ye folder GitHub pe daal kar connect karein
3. Build: `npm install` · Start: `node server.js`
4. **Environment Variables** add karein:
   | Key | Value |
   |---|---|
   | `MONGO_URI` | upar wala connection string |
   | `OWNER_WA` | aapka number e.g. `923245443606` |
   | `SITE_URL` | aapki website e.g. `https://yourdomain.com` |
   | `ADMIN_KEY` | saved orders page ka secret key (koi bhi strong) |
5. Deploy hone pe URL milega: `https://aapka-bot.onrender.com`
6. `/qr` kholein → **QR scan** (sirf ek dafa — ab session saved hai ✓)
7. Website ke **Admin → Settings → Bot URL** mein ye URL save karein

### 3️⃣ cron-job.org (free) — sleep se bachao
1. [cron-job.org](https://cron-job.org) pe free account banayein
2. New cron job → URL: `https://aapka-bot.onrender.com/health` → **har 5 minute**
3. Bot hamesha jagta rahega — kabhi sleep nahi ⏰

### 🧾 Saved orders dekhein
Browser mein: `https://aapka-bot.onrender.com/orders?key=YOUR_ADMIN_KEY`
— saare orders table mein, permanently save (free database mein).

---

## 📧 AUTO PDF → GMAIL + WHATSAPP (har order ki invoice khud banti hai!)

Koi bhi order kare → bot **khud professional PDF receipt banata hai** aur:
- 📧 **Aapki Gmail pe** bhejta hai (PDF attachment ke saath)
- 📄 **WhatsApp pe** bhi PDF document bhejta hai (text message ke saath)

### Gmail App Password banana (zaroori — 2 minute):
> ⚠️ Ye aapka **asli Gmail password NAHI** hai — Google ka special 16-digit code hai jo sirf apps ke liye hota hai.

1. Apni Gmail ke **2-Step Verification ON** karein: [myaccount.google.com/security](https://myaccount.google.com/security)
2. Phir kholein: **[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)**
3. App ka naam likhein `Order Bot` → **Create** → **16-digit code** milega (masalan `abcd efgh ijkl mnop`)
4. Wo code Render pe env var mein daalein:

| Key | Value |
|---|---|
| `EMAIL_USER` | `siyalsabe124@gmail.com` |
| `EMAIL_PASS` | 16-digit app password (spaces ke saath bhi chalega) |
| `EMAIL_TO` | (optional) kisi AUR Gmail pe bhejni ho to — warna khali chhoodein |

5. Bas! Ab har order pe **PDF aapki Gmail + WhatsApp dono pe** aayegi 🎉

> 💡 Invoice mein hota hai: store header, Order ID, customer details, items table, subtotal/delivery/**TOTAL (COD)** — sab professional format mein.

**Option B — Hostinger VPS (agar lein to):** fastest; same steps + `pm2 start server.js` — MongoDB Atlas wahi free use ho ga.

> 💡 Bina MongoDB ke bhi bot chalta hai (LocalAuth — local files), lekin free hosting restart pe session ur jata hai. Is liye upar wala free combo use karein.

---

## 🗂 ODOO se ATTACH — website ka order khud Odoo mein!

Har naya order automatically Odoo mein bhi ban jata hai:
- 👤 **Customer** (res.partner) — phone se match, na mile to naya
- 🧾 **Sale Order** (quotation) — items, prices, COD note ke saath (`Sales → Quotations` mein dikhega)
- 📦 Products **SKU (MZ-0001…)** se match hoti hain — pehle `odoo-products-import.csv` Odoo mein import kar lein to sab perfectly link honge (na mile to bot naya product bana deta hai)

### ⚠️ Zaroori sharat:
Odoo ka **External API sirf "Custom" plan / Odoo.sh / self-host** pe milta hai — **Standard plan pe nahi**. Free trial mein test karte waqt Custom wala option chunein, warna integration sirf tab chalega jab Custom ho.

### Setup (5 steps):
1. Odoo mein apni **API Key** banayein: profile avatar (upar right) → **My Profile → Account Security → New API Key**
2. Bot ke env vars mein add karein:
   | Key | Value | Example |
   |---|---|---|
   | `ODOO_URL` | aapki Odoo site | `https://myshop.odoo.com` |
   | `ODOO_DB` | database ka naam | `myshop` (URL ka pehla hissa) |
   | `ODOO_USER` | Odoo login email | `siyalsabe124@gmail.com` |
   | `ODOO_API_KEY` | step 1 wali key | `xxxxxxxx` |
   | `ODOO_CONFIRM` | `1` = sale order auto-confirm (stock khud kam) — khali = draft quotation | |
3. Bot redeploy karein
4. Website pe **test order** karein — WhatsApp message mein bhi line aayegi: `🗂 Odoo: S00023 (draft) ban gaya ✓`
5. Odoo→ **Sales** mein wahi order dikhega — ab invoice/stock/accounting sab Odoo sambhalega! 🎉

---

## ⚠️ Zaroori warnings — pehle parhein!

- Ye bot **unofficial library** (whatsapp-web.js) use karta hai. WhatsApp ki official API nahi hai — **number ban hone ka chhota sa risk** hota hai. Mehfooz tareeqa: **spare/secondary number** se chalayein, boss number nahi.
- **Rates website ke `data.js` se aate hain.** Admin panel se rates change karne ke baad nayi `data.js` bot ke folder mein bhi daal dein — bot har 5 minute mein khud fresh load karta hai.
- Official tareeqa chahiye (100% mehfooz, Meta-approved)? **WhatsApp Business Cloud API** lagti hai — bata dein to main wo version bhi bana doon.
- Apna number badalna ho to server start karte waqt `OWNER_WA` env variable set karein, ya server.js mein upar default edit karein.

---

## 🧪 Bot test karne ke tareeqe

| Test | Kya hoga |
|---|---|
| Kisi aur number se apne bot number pe **"salam"** bhejein | Welcome menu reply aayega |
| **"unstitched suit ka rate"** bhejein | Top 3 matching suits with PKR prices |
| Website pe order place karein | Aapke WhatsApp pe poora order aayega |
| `yourbot.com/health` kholein | `{"connected":true}` dikhna chahiye |
