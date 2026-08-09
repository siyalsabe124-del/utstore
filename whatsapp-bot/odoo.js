/**
 * Odoo Integration — website ke orders ka khud-ba-khud Odoo mein entry
 * ---------------------------------------------------------------------
 * Kya karta hai (har naye order pe):
 *   1. Customer (res.partner) dhoondhta hai ya naya banata hai
 *   2. Products ko SKU (MZ-0001…) se match karta hai — same SKU jo humari
 *      odoo-products-import.csv mein hain (na mile to naya product bana deta hai)
 *   3. sale.order (quotation) banata hai + customer/OID reference ke saath
 *   4. (Optional) ODOO_CONFIRM=1 ho to sale order confirm bhi kar deta hai
 *
 * Zaroori: External API sirf Odoo "Custom" plan / Odoo.sh / self-host pe hota hai.
 */
const ODOO_URL = (process.env.ODOO_URL || '').replace(/\/+$/, ''); // e.g. https://myshop.odoo.com
const ODOO_DB  = process.env.ODOO_DB  || '';   // myshop.odoo.com → "myshop"
const ODOO_USER= process.env.ODOO_USER|| '';   // Odoo login email
const ODOO_KEY = process.env.ODOO_API_KEY || ''; // Profile → Account Security → API Key
const AUTO_CONFIRM = (process.env.ODOO_CONFIRM || '') === '1';

let _uid = null;

async function rpc(service, method, args) {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params: { service, method, args } })
  });
  if (!res.ok) throw new Error('Odoo HTTP ' + res.status);
  const j = await res.json();
  if (j.error) throw new Error('Odoo: ' + ((j.error.data && (j.error.data.message || j.error.data.debug)) || j.error.message || 'unknown'));
  return j.result;
}

async function uid() {
  if (_uid) return _uid;
  _uid = await rpc('common', 'authenticate', [ODOO_DB, ODOO_USER, ODOO_KEY, {}]);
  if (!_uid) throw new Error('Odoo login failed — DB / USER / API_KEY check karein');
  return _uid;
}

/* re-login once on auth errors */
async function kw(model, method, args, kwargs = {}) {
  try {
    return await rpc('object', 'execute_kw', [ODOO_DB, await uid(), ODOO_KEY, model, method, args, kwargs]);
  } catch (e) {
    if (/access|session|denied|uid/i.test(e.message) && _uid) { _uid = null; return rpc('object', 'execute_kw', [ODOO_DB, await uid(), ODOO_KEY, model, method, args, kwargs]); }
    throw e;
  }
}

async function findOrCreatePartner(o) {
  if (o.phone) {
    const tail = String(o.phone).replace(/\D/g, '').slice(-9);
    const found = await kw('res.partner', 'search_read', [[['phone', 'ilike', tail]]], { fields: ['id'], limit: 1 });
    if (found && found.length) return found[0].id;
  }
  return kw('res.partner', 'create', [[{
    name: o.name, phone: o.phone || '', street: o.addr || '',
    comment: 'Website customer — first order ' + o.oid
  }]]);
}

async function productId(it) {
  const sku = (it.id !== undefined && it.id !== null) ? 'MZ-' + String(it.id).padStart(4, '0') : null;
  if (sku) {
    const f = await kw('product.product', 'search_read', [[['default_code', '=', sku]]], { fields: ['id'], limit: 1 });
    if (f && f.length) return f[0].id;
  }
  const byName = await kw('product.product', 'search_read', [[['name', '=', it.name]]], { fields: ['id'], limit: 1 });
  if (byName && byName.length) return byName[0].id;
  // na mile to naya product bana do
  const pdata = { name: it.name, list_price: it.price, sale_ok: true, type: 'consu' };
  if (sku) pdata.default_code = sku;
  const tmpl = await kw('product.template', 'create', [[pdata]]);
  const v = await kw('product.product', 'search_read', [[['product_tmpl_id', '=', tmpl]]], { fields: ['id'], limit: 1 });
  return v[0].id;
}

async function deliveryProductId() {
  const f = await kw('product.product', 'search_read', [[['default_code', '=', 'DELIVERY-FEE']]], { fields: ['id'], limit: 1 });
  if (f && f.length) return f[0].id;
  const tmpl = await kw('product.template', 'create', [[{ name: 'Delivery Fee (COD)', list_price: 0, type: 'service', sale_ok: true, default_code: 'DELIVERY-FEE' }]]);
  const v = await kw('product.product', 'search_read', [[['product_tmpl_id', '=', tmpl]]], { fields: ['id'], limit: 1 });
  return v[0].id;
}

async function createSaleOrder(o) {
  const partner_id = await findOrCreatePartner(o);
  const order_line = [];
  for (const it of (o.items || [])) {
    const product_id = await productId(it);
    order_line.push([0, 0, { product_id, name: it.name, product_uom_qty: it.qty, price_unit: it.price }]);
  }
  if (o.fee > 0) {
    order_line.push([0, 0, { product_id: await deliveryProductId(), name: 'Delivery Fee', product_uom_qty: 1, price_unit: o.fee }]);
  }
  const soId = await kw('sale.order', 'create', [[{
    partner_id,
    client_order_ref: o.oid,
    origin: 'Website (WhatsApp Bot)',
    note: `COD ORDER\n👤 ${o.name}\n📱 ${o.phone}\n📍 ${o.addr}`,
    order_line
  }]]);
  if (AUTO_CONFIRM) { try { await kw('sale.order', 'action_confirm', [[soId]]); } catch (e) { console.log('confirm error:', e.message); } }
  const so = await kw('sale.order', 'read', [[soId]], { fields: ['name', 'state', 'amount_total'] });
  return so[0];
}

module.exports = {
  configured: () => !!(ODOO_URL && ODOO_DB && ODOO_USER && ODOO_KEY),
  createSaleOrder
};
