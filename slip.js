/* ============================================================
   UTStore — Professional Order Slip / Invoice (shared)
   Website checkout success + Admin Panel Orders dono use karte hain
   ============================================================ */
function slipMoney(n){ return 'PKR ' + Number(n||0).toLocaleString('en-PK'); }
function slipDate(ts){ try{ return new Date(ts||Date.now()).toLocaleString('en-PK',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''+ts; } }

function buildSlipHTML(o){
  const items = (o.items||[]).map((it,i)=>`
    <tr>
      <td class="c">${i+1}</td>
      <td>${it.name}</td>
      <td class="c">${it.qty}</td>
      <td class="r">${slipMoney(it.price)}</td>
      <td class="r b">${slipMoney(it.price*it.qty)}</td>
    </tr>`).join('');
  const feeTxt = o.fee ? slipMoney(o.fee) : 'FREE';
  const status = (o.status||'confirmed').toUpperCase();

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>UTStore Invoice — ${o.oid}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#eef2f0;color:#17211c;padding:24px 12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .paper{max-width:760px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 10px 40px rgba(8,68,51,.15)}
  .head{background:#084433;color:#fff;display:flex;justify-content:space-between;align-items:center;padding:26px 30px;flex-wrap:wrap;gap:14px}
  .brand{display:flex;align-items:center;gap:13px}
  .mark{width:48px;height:48px;border-radius:13px;background:#fff;color:#084433;display:grid;place-items:center;font-size:26px;font-weight:800}
  .brand h1{font-size:24px;letter-spacing:-.5px}
  .brand small{display:block;font-size:11.5px;color:#bfdfc9;margin-top:3px}
  .inv{text-align:right}
  .inv .t{font-size:19px;font-weight:800;letter-spacing:1.5px}
  .inv .id{font-size:12.5px;color:#bfdfc9;margin-top:4px}
  .badge{display:inline-block;background:#ffb800;color:#3a2b00;font-size:10.5px;font-weight:800;border-radius:99px;padding:4px 12px;margin-top:7px;letter-spacing:.5px}
  .strip{background:#0b5d43;color:#d9f2e6;font-size:11.5px;padding:10px 30px;display:flex;gap:18px;flex-wrap:wrap}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid #e4ece7}
  .col{padding:20px 30px}
  .col+.col{border-left:1px solid #e4ece7;background:#fbfdfc}
  .lbl{font-size:10.5px;font-weight:800;letter-spacing:1.4px;color:#0b5d43;text-transform:uppercase;margin-bottom:9px}
  .col .nm{font-size:15.5px;font-weight:700;margin-bottom:4px}
  .col p{font-size:12.5px;color:#5b6b62;line-height:1.75}
  table{width:100%;border-collapse:collapse}
  thead th{background:#e7f4ee;color:#084433;font-size:10.5px;letter-spacing:1.1px;text-transform:uppercase;padding:11px 12px;text-align:left;border-bottom:2px solid #0b5d43}
  tbody td{padding:11px 12px;font-size:12.8px;border-bottom:1px solid #eef3f0;vertical-align:top}
  tbody tr:nth-child(even){background:#fbfdfc}
  .c{text-align:center}.r{text-align:right;white-space:nowrap}.b{font-weight:700}
  .tot{display:flex;justify-content:flex-end;padding:16px 30px 8px}
  .tot table{width:270px}
  .tot td{padding:7px 12px;font-size:13px;border:none;color:#5b6b62}
  .tot .grand td{background:#084433;color:#fff;font-size:15.5px;font-weight:800}
  .tot .grand td:first-child{border-radius:9px 0 0 9px}.tot .grand td:last-child{border-radius:0 9px 9px 0}
  .notes{margin:14px 30px 0;background:#f4f9f6;border:1px dashed #bcd8c9;border-radius:11px;padding:13px 17px;font-size:11.8px;color:#3f5449;line-height:1.9}
  .foot{margin-top:22px;background:#084433;color:#bfdfc9;text-align:center;padding:16px;font-size:12px;line-height:1.8}
  .foot b{color:#fff}
  .acts{text-align:center;margin:18px 0}
  .btn{background:#0b5d43;color:#fff;border:none;border-radius:99px;padding:12px 34px;font-size:14px;font-weight:700;cursor:pointer;margin:0 5px}
  .btn.ghost{background:#fff;color:#0b5d43;border:1.5px solid #0b5d43}
  @media(max-width:640px){.cols{grid-template-columns:1fr}.col+.col{border-left:none;border-top:1px solid #e4ece7}.head{padding:20px}}
  @media print{
    body{background:#fff;padding:0}.paper{box-shadow:none;border-radius:0;max-width:none}.acts{display:none}
  }
</style></head><body>
<div class="paper">
  <div class="head">
    <div class="brand"><div class="mark">U</div>
      <div><h1>UTStore</h1><small>Online Shopping — Cash on Delivery · Pakistan</small></div>
    </div>
    <div class="inv">
      <div class="t">ORDER SLIP</div>
      <div class="id">${o.oid}</div>
      <span class="badge">COD · ${status}</span>
    </div>
  </div>
  <div class="strip">
    <span>📱 WhatsApp: <b style="color:#fff">0324 5443606</b></span>
    <span>📧 <b style="color:#fff">siyalsabe124@gmail.com</b></span>
    <span style="margin-left:auto">📅 ${slipDate(o.ts)}</span>
  </div>
  <div class="cols">
    <div class="col">
      <div class="lbl">Bill To — Customer</div>
      <div class="nm">${o.name||'-'}</div>
      <p>📱 ${o.phone||'-'}${o.email?'<br>📧 '+o.email:''}<br>📍 ${o.addr||'-'}</p>
    </div>
    <div class="col">
      <div class="lbl">Order Details</div>
      <p>Order No: <b style="color:#17211c">${o.oid}</b><br>
      Date: ${slipDate(o.ts)}<br>
      Payment: <b style="color:#17211c">💵 Cash on Delivery</b><br>
      Delivery: 🚚 3–5 working days</p>
    </div>
  </div>
  <div style="padding:8px 30px 0">
  <table>
    <thead><tr><th class="c" style="width:38px">#</th><th>Product</th><th class="c" style="width:56px">Qty</th><th class="r" style="width:110px">Rate</th><th class="r" style="width:120px">Amount</th></tr></thead>
    <tbody>${items}</tbody>
  </table>
  </div>
  <div class="tot"><table>
    <tr><td>Subtotal:</td><td class="r">${slipMoney(o.sub)}</td></tr>
    <tr><td>Delivery Fee:</td><td class="r">${feeTxt}</td></tr>
    <tr class="grand"><td>TOTAL (COD)</td><td class="r">${slipMoney(o.total)}</td></tr>
  </table></div>
  <div class="notes">
    💵 <b>Payment:</b> Cash pay karein jab parcel aapke darwaze pe pahunche — koi advance nahi.<br>
    ↩️ <b>Returns:</b> 7-din easy returns. &nbsp;·&nbsp; 🚚 <b>Delivery:</b> 3–5 working days, all over Pakistan.<br>
    📞 Order ke hawale se rabta: WhatsApp <b>0324 5443606</b>
  </div>
  <div class="foot">
    Shukriya aap ne <b>UTStore</b> se shopping ki! 🛍️<br>
    <b>Made by Umair ❤️</b> · siyalsabe124.github.io/utstore
  </div>
</div>
<div class="acts">
  <button class="btn" onclick="window.print()">🖨️ Print / Save PDF</button>
  <button class="btn ghost" onclick="window.close()">✕ Close</button>
</div>
</body></html>`;
}

function openSlipPrint(o){
  const w = window.open('','_blank','width=840,height=980');
  if(!w){ alert('Popup block hai — is site ke liye popups allow karein, phir dobara dabayein'); return; }
  w.document.write(buildSlipHTML(o));
  w.document.close();
  w.focus();
}
