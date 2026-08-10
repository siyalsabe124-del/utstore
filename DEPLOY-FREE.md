# 🚀 FREE Deployment Guide (Roman Urdu) — bina ek rupaya ke

## Ye project 3 hisson ka hai:

| Part | Free host | URL |
|---|---|---|
| 🛍️ Website | **GitHub Pages** (ya Netlify) | `username.github.io/utstore-store` |
| 🤖 WhatsApp Bot | **Render** (free) + **MongoDB Atlas** (free) | `aapka-bot.onrender.com` |
| ⏰ Keep-awake | **cron-job.org** (free) | har 5 min ping |

---

## 🔐 Admin Panel — Default Login
- **Email:** siyalsabe124@gmail.com
- **Password:** Umair@786 *(pehla U bara — login ke baad zaroor change karein!)*
- Login page pe **"Login reset"** link hai agar kabhi phas jayein

---

## 1️⃣ WEBSITE live karna (GitHub Pages — free forever)

Repo GitHub pe aa jane ke baad:
1. Repo kholo → **Settings → Pages**
2. **Source: Deploy from a branch** → Branch: `main` / folder: `/ (root)` → **Save**
3. 2–5 minute mein site live: `https://siyalsabe124-del.github.io/utstore/`
4. Admin panel: `https://siyalsabe124-del.github.io/utstore/admin.html`

**Alternative (aur bhi asaan):** [app.netlify.com/drop](https://app.netlify.com/drop) — `utstore-website.zip` drag karo, free account banao, instant URL mil jayega.

---

## 2️⃣ BOT live karna (Render — free, EK-CLICK)

**Asaan tareeqa (blueprint):** repo mein `render.yaml` pehle se hai — Render khud sab set kar dega.

1. [render.com](https://render.com) → sign up (**GitHub se login** — sab se easy)
2. **New → Web Service** → apna repo select karo
3. Settings:
   - **Root Directory:** `whatsapp-bot`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
4. **Environment Variables** (Environment tab mein):
   ```
   OWNER_WA      = 92XXXXXXXXXX        ← aapka WhatsApp number
   SITE_URL      = https://siyalsabe124-del.github.io/utstore
   MONGO_URI     = (step 3 wala — optional lekin recommended)
   EMAIL_USER    = siyalsabe124@gmail.com
   EMAIL_PASS    = (Gmail App Password — orders ki PDF email ke liye)
   ADMIN_KEY     = koi-bhi-strong-key  (live orders + products API ka key)
   ```
5. Deploy → URL milega `https://aapka-bot.onrender.com`
6. **`/qr`** kholo → WhatsApp se **scan** karo (Linked devices) → bot live ✅
7. Website ke **Admin → Settings → Bot URL** mein ye URL save karo (aur **Admin Key** mein wohi `ADMIN_KEY`)

> 🆕 **Ab Admin panel se sab kuch LIVE hota hai:**
> - **Orders tab → "Fetch live orders"** → saare real customers ke orders (kisi bhi device/mobile se) + har order ka 🖨 Invoice
> - **Products tab** mein rate/pic edit karo → **Publish → "Upload to bot"** → website pe turant naya rate/pic
>   (website bot se products khud fetch karti hai — data.js upload ki zaroorat nahi)

## 3️⃣ MongoDB Atlas (free — session + orders SAVE)
1. [mongodb.com/atlas](https://www.mongodb.com/atlas) → free account → **M0 FREE cluster**
2. Database Access → user banao · Network Access → `0.0.0.0/0`
3. Connect → Node.js → string copy → `MONGO_URI` mein daal do (step 2 mein)

## 4️⃣ Sleep se bachao — cron-job.org (free)
- New cron job → `https://aapka-bot.onrender.com/health` → **every 5 minutes**

## 5️⃣ Odoo (optional — jab Custom plan ho)
`ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_API_KEY` env vars → orders khud Odoo mein. Detail: `whatsapp-bot/README.md`

---

✅ **Test checklist:**
- [ ] Website khulti hai + products dikhte hain
- [ ] Admin login hota hai (`/admin.html`)
- [ ] Test order → WhatsApp pe message + PDF aaya
- [ ] Gmail mein order email + PDF aayi
- [ ] Kisi aur number se "suit ka rate" likho → bot ne jawab diya
- [ ] Admin → Orders → **Fetch live orders** → order dikha + 🖨 Invoice print hua
- [ ] Admin → product rate edit → **Upload to bot** → website pe naya rate aaya
