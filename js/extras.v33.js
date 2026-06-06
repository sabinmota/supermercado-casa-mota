/* ================================================================
   SUPERMERCADO CASA MOTA — MÓDULOS EXTRAS
   Reportes · PDF de pedidos
   ================================================================ */

'use strict';

// ─── _supaFetch: helper para llamadas directas a Supabase PostgREST ──────────
// Usa _SB_URL y _SB_HEADERS definidos en api.js
async function _supaFetch(endpoint, options = {}) {
  const method  = (options.method || 'GET').toUpperCase();
  const url     = `${_SB_URL}/${endpoint}`;
  const headers = { ..._SB_HEADERS, ...(options.headers || {}) };
  if (['POST', 'PATCH', 'PUT'].includes(method)) {
    headers['Prefer'] = 'return=representation';
  }
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(url, { method, headers, body: options.body || undefined, signal: ctrl.signal });
  } catch(e) { clearTimeout(timer); throw e; }
  clearTimeout(timer);
  if (res.status === 204) return null;
  if (!res.ok) { const txt = await res.text(); throw new Error(`_supaFetch error ${res.status}: ${txt}`); }
  const text = await res.text();
  if (!text) return null;
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed) && method === 'POST') return parsed[0] ?? null;
  return parsed;
}

// ─── Helper de formato de precio ─────────────────────────────────────────────
if (typeof fmt$ === 'undefined') {
  window.fmt$ = function(n) {
    const num = Math.abs(parseFloat(n) || 0);
    const sign = (parseFloat(n) || 0) < 0 ? '-' : '';
    const fixed = num.toFixed(2);
    const [intPart, decPart] = fixed.split('.');
    const intWithCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}${intWithCommas}.${decPart}`;
  };
}

// ════════════════════════════════════════════════════════════════
// 1. REPORTES DE VENTAS
// ════════════════════════════════════════════════════════════════

let reportPeriod = 'day';
let chartVentas    = null;
let chartCategorias = null;

function setReportPeriod(period) {
  reportPeriod = period;
  document.querySelectorAll('.btn-period').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('btnPeriod' + period.charAt(0).toUpperCase() + period.slice(1));
  if (btn) btn.classList.add('active');
  loadReportes();
}

async function loadReportes() {
  let allOrders = [];
  try { allOrders = await DB.getOrders(); } catch(e) { allOrders = []; }

  const now   = new Date();
  const start = _periodStart(now, reportPeriod);

  const filtered = allOrders.filter(o => {
    if (o.status === 'cancelado') return false;
    const d = _parseOrderDate(o.date || o.created_at);
    return d && d >= start && d <= now;
  });

  // ── KPIs ──────────────────────────────────────────────────────
  const totalVentas   = filtered.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const totalPedidos  = filtered.length;
  const ticketProm    = totalPedidos ? totalVentas / totalPedidos : 0;
  const totalProductos = filtered.reduce((s, o) => {
    const lines = o.productLines || [];
    return s + lines.reduce((a, l) => a + (Number(l.cantidad) || 1), 0);
  }, 0);

  _setEl('rptTotal',    'RD$ ' + _fmt(totalVentas));
  _setEl('rptOrders',   totalPedidos);
  _setEl('rptAvg',      'RD$ ' + _fmt(ticketProm));
  _setEl('rptProducts', totalProductos);

  // ── Label período activo ──────────────────────────────────────
  const periodNames = { day:'Hoy', week:'Esta semana', month:'Este mes', year:'Este año' };
  _setEl('rptPeriodLabel', periodNames[reportPeriod] || '');

  // ── Resumen rápido ─────────────────────────────────────────────
  const filteredAll = allOrders.filter(o => {
    const d = _parseOrderDate(o.date || o.created_at);
    return d && d >= start && d <= now;
  });
  const completed = filteredAll.filter(o => o.status === 'entregado').length;
  const pending   = filteredAll.filter(o => ['pendiente','procesando','enviado'].includes(o.status)).length;
  const cancelled = filteredAll.filter(o => o.status === 'cancelado').length;
  const shipping  = filtered.reduce((s, o) => s + (Number(o.shipping) || 0), 0);
  _setEl('rptCompleted', completed);
  _setEl('rptPending',   pending);
  _setEl('rptCancelled', cancelled);
  _setEl('rptShipping',  'RD$ ' + _fmt(shipping));

  // ── Métodos de pago ────────────────────────────────────────────
  const payMap = {};
  filtered.forEach(o => {
    const k = o.payMethodLabel || o.payMethod || 'Otro';
    payMap[k] = (payMap[k] || 0) + 1;
  });
  const payEl = document.getElementById('rptPayMethods');
  if (payEl) {
    const entries = Object.entries(payMap).sort((a, b) => b[1] - a[1]);
    const maxVal  = entries[0]?.[1] || 1;
    const iconMap = { efectivo:'fa-money-bill-wave', tarjeta_credito:'fa-credit-card', transferencia:'fa-building-columns', Efectivo:'fa-money-bill-wave', Tarjeta:'fa-credit-card', Transferencia:'fa-building-columns', 'Efectivo contra entrega':'fa-money-bill-wave' };
    payEl.innerHTML = entries.length ? entries.map(([label, count]) => {
      const pct  = Math.round((count / maxVal) * 100);
      const icon = iconMap[label] || 'fa-wallet';
      return `<div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-size:.82rem;color:#556;display:flex;align-items:center;gap:6px">
            <i class="fas ${icon}" style="color:#f57c00;width:14px;text-align:center"></i> ${label}
          </span>
          <span style="font-size:.82rem;font-weight:700;color:#1a1a2e">${count} pedido${count!==1?'s':''}</span>
        </div>
        <div style="height:6px;background:#f0f3f0;border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#1a7c3e,#27a35a);border-radius:4px"></div>
        </div>
      </div>`;
    }).join('') : '<div style="color:#aab;font-size:.84rem">Sin datos para este período</div>';
  }

  // ── Gráfica de barras — ventas por período ────────────────────
  const { labels, data: ventaData } = _buildTimeLabels(filtered, reportPeriod, now, start);

  if (chartVentas) chartVentas.destroy();
  const ctxV = document.getElementById('chartVentas');
  if (ctxV) {
    chartVentas = new Chart(ctxV, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Ventas (RD$)',
          data: ventaData,
          backgroundColor: 'rgba(26,124,62,0.75)',
          borderColor: '#1a7c3e',
          borderWidth: 2,
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => 'RD$' + _fmt(v) } }
        }
      }
    });
  }

  // ── Gráfica de pastel — ventas por categoría ──────────────────
  const catMap = {};
  filtered.forEach(o => {
    (o.productLines || []).forEach(l => {
      const cat = l.category || 'Otros';
      catMap[cat] = (catMap[cat] || 0) + (Number(l.subtotal) || Number(l.price) * Number(l.cantidad) || 0);
    });
  });
  const catLabels = Object.keys(catMap);
  const catData   = catLabels.map(k => catMap[k]);
  const colors    = ['#1a7c3e','#27a35a','#1565c0','#f57c00','#f9a825','#7b1fa2','#e53935','#00897b','#0288d1','#6d4c41'];

  if (chartCategorias) chartCategorias.destroy();
  const ctxC = document.getElementById('chartCategorias');
  if (ctxC) {
    chartCategorias = new Chart(ctxC, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{
          data: catData,
          backgroundColor: colors.slice(0, catLabels.length),
          borderWidth: 2, borderColor: '#fff'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } }
      }
    });
  }

  // ── Top 10 productos ──────────────────────────────────────────
  const prodMap = {};
  filtered.forEach(o => {
    (o.productLines || []).forEach(l => {
      const k = l.name || l.productId || 'Desconocido';
      if (!prodMap[k]) prodMap[k] = { name: k, category: l.category || '-', units: 0, total: 0 };
      prodMap[k].units += Number(l.cantidad) || 1;
      prodMap[k].total += Number(l.subtotal) || (Number(l.price) * (Number(l.cantidad) || 1));
    });
  });
  const topProds = Object.values(prodMap).sort((a, b) => b.total - a.total).slice(0, 10);
  const tbody = document.getElementById('topProductsBody');
  if (tbody) {
    if (!topProds.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-light)">Sin datos para este período</td></tr>';
    } else {
      tbody.innerHTML = topProds.map((p, i) => `
        <tr>
          <td><strong>${i + 1}</strong></td>
          <td>${p.name}</td>
          <td><span style="background:#e8f5ee;color:#1a7c3e;padding:2px 8px;border-radius:10px;font-size:.78rem">${_capFirst(p.category)}</span></td>
          <td>${p.units}</td>
          <td><strong>RD$ ${_fmt(p.total)}</strong></td>
        </tr>`).join('');
    }
  }
}

// Exportar PDF de reportes usando print
async function exportReportPDF() {
  const period = { day: 'Hoy', week: 'Esta semana', month: 'Este mes', year: 'Este año' }[reportPeriod] || '';
  const rptTotal    = document.getElementById('rptTotal')?.textContent    || '-';
  const rptOrders   = document.getElementById('rptOrders')?.textContent   || '-';
  const rptAvg      = document.getElementById('rptAvg')?.textContent      || '-';
  const rptProducts = document.getElementById('rptProducts')?.textContent || '-';

  const topRows = document.getElementById('topProductsBody')?.innerHTML || '';

  let logoBase64 = '';
  try {
    const resp = await fetch('images/logo-casamota.png');
    const blob = await resp.blob();
    logoBase64 = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch(e) { logoBase64 = ''; }

  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html><html lang="es"><head>
    <meta charset="UTF-8">
    <title>Reporte de Ventas — Casa Mota</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Arial', sans-serif; color: #222; background: #fff; }
      .pdf-header {
        background: linear-gradient(135deg, #1a7c3e 0%, #27a35a 100%);
        padding: 24px 40px;
        display: flex; align-items: center; justify-content: space-between; color: #fff;
      }
      .pdf-header-left { display: flex; align-items: center; gap: 20px; }
      .pdf-logo { width: 80px; height: 80px; border-radius: 16px; background: #fff; padding: 6px; object-fit: contain; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
      .pdf-logo-placeholder { width: 80px; height: 80px; border-radius: 16px; background: rgba(255,255,255,.2); display: flex; align-items: center; justify-content: center; font-size: 2rem; }
      .pdf-store-name { font-size: 1.5rem; font-weight: 800; letter-spacing: -.02em; }
      .pdf-store-sub  { font-size: .82rem; opacity: .85; margin-top: 3px; }
      .pdf-header-right { text-align: right; }
      .pdf-report-title { font-size: 1.1rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
      .pdf-report-period { font-size: .88rem; opacity: .85; margin-top: 4px; }
      .pdf-report-date   { font-size: .78rem; opacity: .7; margin-top: 2px; }
      .pdf-body { padding: 32px 40px; }
      .pdf-stripe { height: 4px; background: linear-gradient(90deg,#1a7c3e,#27a35a,#f9a825); margin-bottom: 28px; }
      .kpis { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; margin-bottom: 32px; }
      .kpi { background: #f7f9f4; border-radius: 12px; padding: 18px 16px; text-align: center; border-top: 4px solid #1a7c3e; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
      .kpi:nth-child(2) { border-top-color: #1565c0; }
      .kpi:nth-child(3) { border-top-color: #f57c00; }
      .kpi:nth-child(4) { border-top-color: #7b1fa2; }
      .kpi-val { font-size: 1.4rem; font-weight: 800; color: #1a7c3e; }
      .kpi:nth-child(2) .kpi-val { color: #1565c0; }
      .kpi:nth-child(3) .kpi-val { color: #f57c00; }
      .kpi:nth-child(4) .kpi-val { color: #7b1fa2; }
      .kpi-lbl { font-size: .78rem; color: #777; margin-top: 5px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
      .section-title { display: flex; align-items: center; gap: 10px; font-size: 1rem; font-weight: 700; color: #1a7c3e; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid #e8f5ee; }
      table { width: 100%; border-collapse: collapse; font-size: .85rem; }
      thead tr { background: #1a7c3e; }
      thead th { color: #fff; padding: 11px 14px; text-align: left; font-weight: 600; letter-spacing: .03em; font-size: .78rem; text-transform: uppercase; }
      tbody td { padding: 10px 14px; border-bottom: 1px solid #eef2ec; color: #333; }
      tbody tr:nth-child(even) td { background: #f7f9f4; }
      tbody tr:last-child td { border-bottom: none; }
      .pdf-footer { margin-top: 40px; padding: 16px 40px; background: #f7f9f4; border-top: 3px solid #1a7c3e; display: flex; justify-content: space-between; align-items: center; font-size: .75rem; color: #888; }
      .pdf-footer-brand { font-weight: 700; color: #1a7c3e; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style></head><body>
    <div class="pdf-header">
      <div class="pdf-header-left">
        ${logoBase64
          ? `<img src="${logoBase64}" class="pdf-logo" alt="Logo Casa Mota" />`
          : `<div class="pdf-logo-placeholder">🛒</div>`}
        <div>
          <div class="pdf-store-name">Supermercado Casa Mota</div>
          <div class="pdf-store-sub">Ave. Melchor Contin Alfau No. 5, Hato Mayor del Rey</div>
          <div class="pdf-store-sub">Tel: 809-553-2226 · info@casamota.com.do</div>
        </div>
      </div>
      <div class="pdf-header-right">
        <div class="pdf-report-title">Reporte de Ventas</div>
        <div class="pdf-report-period">Período: <strong>${period}</strong></div>
        <div class="pdf-report-date">Generado: ${new Date().toLocaleString('es-DO')}</div>
      </div>
    </div>
    <div class="pdf-stripe"></div>
    <div class="pdf-body">
      <div class="kpis">
        <div class="kpi"><div class="kpi-val">${rptTotal}</div><div class="kpi-lbl">Ventas Totales</div></div>
        <div class="kpi"><div class="kpi-val">${rptOrders}</div><div class="kpi-lbl">Pedidos</div></div>
        <div class="kpi"><div class="kpi-val">${rptAvg}</div><div class="kpi-lbl">Ticket Promedio</div></div>
        <div class="kpi"><div class="kpi-val">${rptProducts}</div><div class="kpi-lbl">Productos Vendidos</div></div>
      </div>
      <div class="section-title"><div>Top 10 Productos Más Vendidos</div></div>
      <table>
        <thead><tr><th>#</th><th>Producto</th><th>Categoría</th><th>Unidades</th><th>Total (RD$)</th></tr></thead>
        <tbody>${topRows || '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:20px">Sin datos para este período</td></tr>'}</tbody>
      </table>
    </div>
    <div class="pdf-footer">
      <div><span class="pdf-footer-brand">Supermercado Casa Mota</span> &nbsp;·&nbsp; Documento generado automáticamente</div>
      <div>RNC: 000-00000-0 &nbsp;·&nbsp; ${new Date().toLocaleDateString('es-DO')}</div>
    </div>
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 800);
}

// Helpers de reportes
function _periodStart(now, period) {
  const d = new Date(now);
  if (period === 'day')        { d.setHours(0,0,0,0); }
  else if (period === 'week')  { d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); }
  else if (period === 'month') { d.setDate(1); d.setHours(0,0,0,0); }
  else if (period === 'year')  { d.setMonth(0,1); d.setHours(0,0,0,0); }
  return d;
}

function _parseOrderDate(str) {
  if (!str) return null;
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(str);
  if (m) return new Date(+m[3], +m[2]-1, +m[1]);
  const n = Number(str);
  if (!isNaN(n) && n > 1e10) return new Date(n);
  return new Date(str);
}

function _buildTimeLabels(orders, period, now, start) {
  const labels = [], data = [];
  if (period === 'day') {
    for (let h = 0; h < 24; h++) {
      labels.push(h + ':00');
      data.push(orders.filter(o => {
        const d = _parseOrderDate(o.date || o.created_at);
        return d && d.getHours() === h;
      }).reduce((s, o) => s + (Number(o.total) || 0), 0));
    }
  } else if (period === 'week') {
    const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    for (let i = 0; i < 7; i++) {
      const day = new Date(start); day.setDate(start.getDate() + i);
      labels.push(days[day.getDay()]);
      data.push(orders.filter(o => {
        const d = _parseOrderDate(o.date || o.created_at);
        return d && d.toDateString() === day.toDateString();
      }).reduce((s, o) => s + (Number(o.total) || 0), 0));
    }
  } else if (period === 'month') {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      labels.push(d.toString());
      data.push(orders.filter(o => {
        const dt = _parseOrderDate(o.date || o.created_at);
        return dt && dt.getDate() === d && dt.getMonth() === now.getMonth();
      }).reduce((s, o) => s + (Number(o.total) || 0), 0));
    }
  } else { // year
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    for (let m = 0; m < 12; m++) {
      labels.push(months[m]);
      data.push(orders.filter(o => {
        const dt = _parseOrderDate(o.date || o.created_at);
        return dt && dt.getMonth() === m && dt.getFullYear() === now.getFullYear();
      }).reduce((s, o) => s + (Number(o.total) || 0), 0));
    }
  }
  return { labels, data };
}

function _fmt(n) { return Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function _setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function _capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }


// ════════════════════════════════════════════════════════════════
// 2. PDF DE PEDIDO INDIVIDUAL
// ════════════════════════════════════════════════════════════════

async function printOrderPDF(orderId) {
  const order = (typeof orders !== 'undefined' ? orders : []).find(o => String(o.id) === String(orderId));
  if (!order) { alert('Pedido no encontrado'); return; }

  // Buscar ciudad del cliente si el pedido no la tiene guardada
  const allCustomers = (typeof customers !== 'undefined' ? customers : []);
  const orderClient  = allCustomers.find(c => c.id === order.clientId || c.email === order.email);
  const orderCity    = order.city || orderClient?.city || '';

  let logoBase64 = '';
  try {
    const resp = await fetch('images/logo-casamota.png');
    const blob = await resp.blob();
    logoBase64 = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch(e) { logoBase64 = ''; }

  const statusLabels = { pendiente:'Pendiente', procesando:'En proceso', enviado:'Enviado', entregado:'Entregado', cancelado:'Cancelado' };
  const payLabels    = { efectivo:'Efectivo', tarjeta_credito:'Tarjeta', transferencia:'Transferencia' };

  const lines = (order.productLines || []).map((l, i) => {
    const hasSust  = 'sustitucion' in l;
    const sustCell = hasSust
      ? (l.sustitucion
          ? `<span style="background:#e8f5ee;color:#1a7c3e;border:1px solid #b2dfcc;border-radius:20px;padding:1px 7px;font-size:.72rem;font-weight:700">Si</span>`
          : `<span style="background:#f5f5f5;color:#999;border:1px solid #ddd;border-radius:20px;padding:1px 7px;font-size:.72rem;font-weight:700">No</span>`)
      : `<span style="color:#ccc;font-size:.72rem">-</span>`;
    return `
    <tr>
      <td>${i+1}</td>
      <td>${l.name || '-'}</td>
      <td>${l.unit || '-'}</td>
      <td style="text-align:center">${l.cantidad || 1}</td>
      <td style="text-align:right">RD$ ${fmt$(l.price||0)}</td>
      <td style="text-align:right"><strong>RD$ ${fmt$(l.subtotal || (l.price*(l.cantidad||1)))}</strong></td>
      <td style="text-align:center">${sustCell}</td>
    </tr>`;
  }).join('');

  const subtotal   = (order.productLines || []).reduce((s, l) => s + (Number(l.subtotal) || Number(l.price)*(Number(l.cantidad)||1)), 0);
  const shipping   = Number(order.shipping  || 0);
  const descuento  = Number(order.descuento || 0);
  const cuponUsado = order.cuponUsado || '';
  const total      = Number(order.total || Math.max(0, subtotal + shipping - descuento));

  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html><html lang="es"><head>
    <meta charset="UTF-8">
    <title>Pedido #${order.id} — Casa Mota</title>
    <style>
      * { box-sizing:border-box; }
      body { font-family:Arial,sans-serif; color:#222; margin:0; padding:30px; font-size:13px; }
      .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #1a7c3e; padding-bottom:16px; margin-bottom:20px; }
      .logo-area { display:flex; align-items:center; gap:14px; }
      .logo-area img { width:64px; height:64px; object-fit:contain; border-radius:12px; border:2px solid #e0f0e9; }
      .logo-area h2 { color:#1a7c3e; margin:0 0 4px; font-size:1.3rem; }
      .logo-area p  { margin:2px 0; color:#666; font-size:.82rem; }
      .order-num    { text-align:right; }
      .order-num h3 { margin:0; color:#1a7c3e; font-size:1.5rem; font-weight:800; }
      .order-num p  { margin:2px 0; color:#666; font-size:.82rem; }
      .info-grid    { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px; }
      .info-box     { background:#f7f9f4; border-radius:8px; padding:14px; }
      .info-box h4  { margin:0 0 8px; color:#1a7c3e; font-size:.9rem; text-transform:uppercase; letter-spacing:.05em; }
      .info-box p   { margin:3px 0; color:#333; }
      table  { width:100%; border-collapse:collapse; margin-bottom:16px; }
      thead tr th { background:#1a7c3e; color:#fff; padding:9px 12px; text-align:left; font-size:.85rem; }
      tbody tr td  { padding:8px 12px; border-bottom:1px solid #e0e8de; font-size:.85rem; }
      tbody tr:nth-child(even) td { background:#f7f9f4; }
      .totals { margin-left:auto; width:300px; }
      .totals table { margin:0; }
      .totals td { border:none; padding:5px 10px; font-size:.88rem; }
      .totals .grand-total td { font-size:1.1rem; font-weight:700; color:#1a7c3e; border-top:2px solid #1a7c3e; padding-top:8px; }
      .status-pill { display:inline-block; padding:4px 14px; border-radius:20px; font-weight:700; font-size:.85rem; background:#e8f5ee; color:#1a7c3e; }
      .footer { margin-top:40px; border-top:1px solid #e0e8de; padding-top:12px; color:#aaa; font-size:.75rem; text-align:center; }
      @media print { body { padding:15px; } }
    </style></head><body>
    <div class="header">
      <div class="logo-area">
        ${logoBase64
          ? `<img src="${logoBase64}" alt="Logo Casa Mota" />`
          : `<div style="width:64px;height:64px;border-radius:12px;background:#e8f5ee;display:flex;align-items:center;justify-content:center;font-size:2rem">🛒</div>`
        }
        <div>
          <h2>Supermercado Casa Mota</h2>
          <p>Ave. Melchor Contin Alfau No. 5, Hato Mayor del Rey</p>
          <p>Tel: 809-553-2226 · info@casamota.com.do</p>
        </div>
      </div>
      <div class="order-num">
        <h3>PEDIDO #${order.order_number || order.id}</h3>
        <p>Fecha: ${order.date || '-'}</p>
        <p>Estado: <span class="status-pill">${statusLabels[order.status] || order.status}</span></p>
        <p>Pago: ${payLabels[order.payMethod] || order.payMethod || '-'}</p>
      </div>
    </div>
    <div class="info-grid">
      <div class="info-box">
        <h4>Cliente</h4>
        <p><strong>${order.customer || '-'}</strong></p>
        <p>${order.email || ''}</p>
        <p>${order.phone || ''}</p>
      </div>
      <div class="info-box">
        <h4>Direccion de entrega</h4>
        <p>${[order.address, orderCity].filter(Boolean).join(', ') || '-'}</p>
        ${order.driverName ? `<p>Repartidor: <strong>${order.driverName}</strong></p>` : ''}
        ${order.notes ? `<p>Nota: ${order.notes}</p>` : ''}
      </div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Producto</th><th>Unidad</th><th style="text-align:center">Cant.</th><th style="text-align:right">Precio</th><th style="text-align:right">Subtotal</th><th style="text-align:center">Sust.</th></tr></thead>
      <tbody>${lines || '<tr><td colspan="7" style="text-align:center">Sin detalles</td></tr>'}</tbody>
    </table>
    <div class="totals">
      <table>
        <tr><td>Subtotal</td><td style="text-align:right">RD$ ${fmt$(subtotal)}</td></tr>
        <tr><td>Envio</td><td style="text-align:right;color:${shipping===0?'#1a7c3e':'inherit'}">${shipping===0?'<strong>Gratis!</strong>':'RD$ '+fmt$(shipping)}</td></tr>
        ${descuento > 0 ? (() => {
          const cupon       = order.cuponUsado || '';
          const pct         = order.descuentoPct  || 0;
          const montoFijo   = order.descuentoMonto || 0;
          const tipDesc     = pct > 0
            ? `${pct}% de descuento`
            : montoFijo > 0
              ? `Descuento fijo`
              : `Descuento`;
          const label = cupon ? `Cupón <strong>${cupon}</strong> — ${tipDesc}` : tipDesc;
          return `<tr style="color:#1a7c3e;font-weight:600"><td>${label}</td><td style="text-align:right">- RD$ ${fmt$(descuento)}</td></tr>`;
        })() : ''}
        <tr class="grand-total"><td><strong>TOTAL</strong></td><td style="text-align:right"><strong>RD$ ${fmt$(total)}</strong></td></tr>
      </table>
    </div>
    <div class="footer">
      Gracias por su compra · Supermercado Casa Mota · ${new Date().toLocaleDateString('es-DO')}
    </div>
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}


// ════════════════════════════════════════════════════════════════
// 3. CUPONES DE DESCUENTO
// ════════════════════════════════════════════════════════════════

let cupones = [];
let _cpnChart = null;
let _editingCuponId = null;

/* ── Carga desde la API ────────────────────────────────────────── */
async function loadCupones() {
  try {
    const json = await _supaFetch('cupones?select=*&limit=200&order=created_at.asc', {});
    cupones = (Array.isArray(json) ? json : []).filter(c => !c.deleted);
  } catch(e) { cupones = []; }
  // Solo llamar funciones de render si existen (en admin); en tienda no existen
  if (typeof renderCupones          === 'function') renderCupones();
  if (typeof _renderCuponesLaterales === 'function') _renderCuponesLaterales();
}

/* ── Tabla principal ───────────────────────────────────────────── */
function renderCupones() {
  const q      = (document.getElementById('cuponSearch')?.value || '').toLowerCase().trim();
  const filtro = document.getElementById('cuponFilterEstado')?.value || '';
  const now    = new Date();

  const lista = cupones.filter(c => {
    const match = !q || c.codigo?.toLowerCase().includes(q) || c.descripcion?.toLowerCase().includes(q);
    if (!match) return false;
    const vencido  = c.fecha_fin  && new Date(c.fecha_fin)  < now;
    const noInicia = c.fecha_inicio && new Date(c.fecha_inicio) > now;
    const esActivo = c.activo !== false && !vencido && !noInicia;
    if (filtro === 'activo')   return esActivo;
    if (filtro === 'inactivo') return !esActivo;
    return true;
  });

  const tbody = document.getElementById('cuponesBody');
  if (!tbody) return;

  document.getElementById('cuponCount').textContent = lista.length;

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-light);padding:28px">
      <i class="fas fa-ticket" style="font-size:1.6rem;opacity:.3;display:block;margin-bottom:8px"></i>
      No se encontraron cupones
    </td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(c => {
    const vencido  = c.fecha_fin   && new Date(c.fecha_fin)  < now;
    const noInicia = c.fecha_inicio && new Date(c.fecha_inicio) > now;
    const activo   = c.activo !== false && !vencido && !noInicia;

    const estadoBadge = activo
      ? `<span style="background:#e8f5ee;color:#1a7c3e;padding:3px 10px;border-radius:20px;font-size:.74rem;font-weight:700">Activo</span>`
      : `<span style="background:#ffebee;color:#e53935;padding:3px 10px;border-radius:20px;font-size:.74rem;font-weight:700">${vencido ? 'Vencido' : 'Inactivo'}</span>`;

    const descuento = c.tipo === 'monto_fijo'
      ? `RD$ ${_fmt(c.valor || 0)}`
      : `${c.valor || 0}%`;

    const usosMax = c.usos_maximos ? `/ ${c.usos_maximos}` : '/ inf';

    return `<tr>
      <td><strong style="color:var(--text-dark);letter-spacing:.03em">${c.codigo || '-'}</strong></td>
      <td style="color:var(--text-mid);font-size:.84rem">${c.descripcion || '-'}</td>
      <td><span style="background:#f3e5f5;color:#7b1fa2;padding:2px 8px;border-radius:8px;font-size:.82rem;font-weight:700">${descuento}</span></td>
      <td style="text-align:center;font-size:.88rem">${c.usos_actuales || 0} ${usosMax}</td>
      <td style="text-align:center">${estadoBadge}</td>
      <td style="text-align:center">
        <button onclick="editCupon('${c.id}')" title="Editar"
          style="background:#e8f5ee;color:#1a7c3e;border:none;border-radius:6px;padding:5px 9px;cursor:pointer;margin-right:4px;font-size:.82rem">
          <i class="fas fa-pen"></i>
        </button>
        <button onclick="deleteCupon('${c.id}')" title="Eliminar"
          style="background:#ffebee;color:#e53935;border:none;border-radius:6px;padding:5px 9px;cursor:pointer;font-size:.82rem">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>`;
  }).join('');
}

/* ── Panel lateral: top 5, gráfica, próximos a vencer ─────────── */
function _renderCuponesLaterales() {
  const now = new Date();

  const total    = cupones.length;
  const activos  = cupones.filter(c => {
    const v = c.fecha_fin && new Date(c.fecha_fin) < now;
    const n = c.fecha_inicio && new Date(c.fecha_inicio) > now;
    return c.activo !== false && !v && !n;
  }).length;
  const usos     = cupones.reduce((s, c) => s + (Number(c.usos_actuales) || 0), 0);
  const vencidos = cupones.filter(c => c.fecha_fin && new Date(c.fecha_fin) < now).length;
  const inactivos= cupones.filter(c => c.activo === false).length;

  _setEl('cpnKpiTotal',    total);
  _setEl('cpnKpiActivos',  activos);
  _setEl('cpnKpiUsados',   usos);
  _setEl('cpnKpiVencidos', vencidos + inactivos);

  const top5El = document.getElementById('cpnTopUsados');
  if (top5El) {
    const sorted = [...cupones].sort((a, b) => (b.usos_actuales || 0) - (a.usos_actuales || 0)).slice(0, 5);
    if (!sorted.length) {
      top5El.innerHTML = `<div style="color:#aab;font-size:.84rem;text-align:center;padding:16px 0">Sin datos aún</div>`;
    } else {
      const maxUsos = sorted[0]?.usos_actuales || 1;
      top5El.innerHTML = sorted.map(c => {
        const pct = Math.round(((c.usos_actuales || 0) / Math.max(maxUsos, 1)) * 100);
        return `<div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
            <span style="font-size:.82rem;font-weight:700;color:var(--text-dark)">${c.codigo}</span>
            <span style="font-size:.78rem;color:var(--text-mid)">${c.usos_actuales || 0} usos</span>
          </div>
          <div style="height:5px;background:#f0f3f0;border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#1a7c3e,#27a35a);border-radius:4px"></div>
          </div>
        </div>`;
      }).join('');
    }
  }

  const porcentaje = cupones.filter(c => c.tipo !== 'monto_fijo').length;
  const montoFijo  = cupones.filter(c => c.tipo === 'monto_fijo').length;
  const ctxC = document.getElementById('cpnTipoChart');
  if (ctxC) {
    if (_cpnChart) _cpnChart.destroy();
    if (porcentaje + montoFijo > 0) {
      _cpnChart = new Chart(ctxC, {
        type: 'doughnut',
        data: {
          labels: ['Porcentaje (%)', 'Monto fijo (RD$)'],
          datasets: [{ data: [porcentaje, montoFijo], backgroundColor: ['#1a7c3e', '#7b1fa2'], borderWidth: 2, borderColor: '#fff' }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } }
        }
      });
    }
  }

  const en15 = new Date(now); en15.setDate(en15.getDate() + 15);
  const proximos = cupones.filter(c => c.fecha_fin && new Date(c.fecha_fin) >= now && new Date(c.fecha_fin) <= en15)
    .sort((a, b) => new Date(a.fecha_fin) - new Date(b.fecha_fin));
  const proxEl = document.getElementById('cpnProximosVencer');
  if (proxEl) {
    if (!proximos.length) {
      proxEl.innerHTML = `<div style="color:#aab;font-size:.84rem;text-align:center;padding:16px 0">Sin cupones próximos a vencer</div>`;
    } else {
      proxEl.innerHTML = proximos.map(c => {
        const diasRestantes = Math.ceil((new Date(c.fecha_fin) - now) / 86400000);
        const color = diasRestantes <= 3 ? '#e53935' : diasRestantes <= 7 ? '#f57c00' : '#1a7c3e';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:.83rem;font-weight:700;color:var(--text-dark)">${c.codigo}</span>
          <span style="font-size:.78rem;font-weight:700;color:${color}">${diasRestantes}d</span>
        </div>`;
      }).join('');
    }
  }
}

/* ── Modal abrir / cerrar ──────────────────────────────────────── */
function openCuponModal(id) {
  _editingCuponId = id || null;
  const modal = document.getElementById('cuponModalBack');
  const title = document.getElementById('cuponModalTitle');
  if (!modal) return;

  ['cuponId','cuponCodigo','cuponDesc','cuponValor','cuponMinimo','cuponUsosMax','cuponInicio','cuponFin']
    .forEach(f => { const el = document.getElementById(f); if (el) el.value = ''; });
  const activo = document.getElementById('cuponActivo');
  if (activo) activo.checked = true;
  const tipo = document.getElementById('cuponTipo');
  if (tipo) tipo.value = 'porcentaje';
  updateCuponValLabel();

  if (id) {
    const c = cupones.find(x => x.id === id);
    if (!c) return;
    title.innerHTML = '<i class="fas fa-pen"></i> Editar Cupon';
    document.getElementById('cuponId').value       = c.id;
    document.getElementById('cuponCodigo').value   = c.codigo || '';
    document.getElementById('cuponDesc').value     = c.descripcion || '';
    if (tipo) tipo.value                           = c.tipo || 'porcentaje';
    document.getElementById('cuponValor').value    = c.valor || '';
    document.getElementById('cuponMinimo').value   = c.compra_minima || '';
    document.getElementById('cuponUsosMax').value  = c.usos_maximos || '';
    document.getElementById('cuponInicio').value   = c.fecha_inicio || '';
    document.getElementById('cuponFin').value      = c.fecha_fin || '';
    if (activo) activo.checked                     = c.activo !== false;
    updateCuponValLabel();
  } else {
    title.innerHTML = '<i class="fas fa-ticket"></i> Nuevo Cupon';
  }

  modal.style.display = 'flex';
}

function editCupon(id) { openCuponModal(id); }

function closeCuponModal() {
  const modal = document.getElementById('cuponModalBack');
  if (modal) modal.style.display = 'none';
  _editingCuponId = null;
}

function updateCuponValLabel() {
  const tipo  = document.getElementById('cuponTipo')?.value;
  const label = document.getElementById('cuponValLabel');
  if (label) label.innerHTML = tipo === 'monto_fijo'
    ? 'Valor (RD$) <span style="color:#e53935">*</span>'
    : 'Valor (%)  <span style="color:#e53935">*</span>';
}

/* ── Guardar (crear o editar) ──────────────────────────────────── */
async function saveCupon() {
  const codigo  = (document.getElementById('cuponCodigo')?.value || '').trim().toUpperCase();
  const valor   = parseFloat(document.getElementById('cuponValor')?.value || '0');

  if (!codigo) { alert('El codigo del cupon es obligatorio.'); return; }
  if (!valor || valor <= 0) { alert('El valor del descuento debe ser mayor a 0.'); return; }

  const payload = {
    codigo,
    descripcion   : (document.getElementById('cuponDesc')?.value     || '').trim(),
    tipo          : document.getElementById('cuponTipo')?.value        || 'porcentaje',
    valor,
    compra_minima : parseFloat(document.getElementById('cuponMinimo')?.value  || '0') || 0,
    usos_maximos  : parseInt(document.getElementById('cuponUsosMax')?.value   || '0') || null,
    fecha_inicio  : document.getElementById('cuponInicio')?.value || null,
    fecha_fin     : document.getElementById('cuponFin')?.value    || null,
    activo        : document.getElementById('cuponActivo')?.checked !== false,
    usos_actuales : 0,
  };

  const id = document.getElementById('cuponId')?.value;
  try {
    if (id) {
      const existing = cupones.find(c => c.id === id);
      payload.usos_actuales = existing?.usos_actuales || 0;
      await _supaFetch(`cupones?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
    } else {
      const dup = cupones.find(c => c.codigo === codigo);
      if (dup) { alert(`Ya existe un cupon con el codigo "${codigo}".`); return; }
      await _supaFetch('cupones', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    closeCuponModal();
    await loadCupones();
    _showAdminToast(id ? 'Cupon actualizado' : 'Cupon creado', 'success');
  } catch(e) {
    alert('Error al guardar el cupon. Intenta de nuevo.');
  }
}

/* ── Eliminar ──────────────────────────────────────────────────── */
async function deleteCupon(id) {
  const c = cupones.find(x => x.id === id);
  if (!confirm(`Eliminar el cupon "${c?.codigo || id}"? Esta accion no se puede deshacer.`)) return;
  try {
    await _supaFetch(`cupones?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ deleted: true }) });
    await loadCupones();
    _showAdminToast('Cupon eliminado', 'success');
  } catch(e) {
    alert('Error al eliminar el cupon.');
  }
}

/* ── Validar cupón (usado desde el checkout) ───────────────────── */
async function validateCupon(codigo, subtotal) {
  await loadCupones();
  const now = new Date();
  const c = cupones.find(x => x.codigo === (codigo || '').toUpperCase());
  if (!c)                              return { valid: false, msg: 'Cupon no encontrado.' };
  if (c.activo === false)              return { valid: false, msg: 'Cupon inactivo.' };
  if (c.fecha_inicio && new Date(c.fecha_inicio) > now) return { valid: false, msg: 'Cupon aun no valido.' };
  if (c.fecha_fin    && new Date(c.fecha_fin)    < now) return { valid: false, msg: 'Cupon vencido.' };
  if (c.usos_maximos && (c.usos_actuales || 0) >= c.usos_maximos) return { valid: false, msg: 'Cupon agotado.' };
  if (c.compra_minima && subtotal < c.compra_minima) return { valid: false, msg: `Compra minima: RD$ ${_fmt(c.compra_minima)}.` };
  const descuento = c.tipo === 'monto_fijo'
    ? Math.min(Number(c.valor), subtotal)
    : subtotal * (Number(c.valor) / 100);
  return { valid: true, cupon: c, descuento: Math.round(descuento * 100) / 100 };
}

async function incrementCuponUso(id) {
  const c = cupones.find(x => x.id === id);
  if (!c) return;
  try {
    await _supaFetch(`cupones?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ usos_actuales: (c.usos_actuales || 0) + 1 })
    });
  } catch(e) {}
}

/* ── Toast helper (reutiliza el de admin si existe) ────────────── */
function _showAdminToast(msg, type = 'success') {
  if (typeof showAdminToast === 'function') { showAdminToast(msg, type); return; }
  const container = document.getElementById('adminToasts');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `admin-toast ${type} show`;
  t.innerHTML = `<i class="fas fa-${type === 'success' ? 'check' : 'xmark'}-circle"></i> ${msg}`;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}


// ════════════════════════════════════════════════════════════════
// 4. NOTIFICACIONES A CLIENTES
// ════════════════════════════════════════════════════════════════

let notificaciones  = [];
let _notiClientes   = [];
let _notiTimer      = null;

/* ── Carga desde la API ────────────────────────────────────────── */
async function loadNotificaciones() {
  try {
    const json = await _supaFetch('notificaciones?select=*&limit=300&order=created_at.asc', {});
    notificaciones = [...(Array.isArray(json) ? json : [])].filter(n => !n.deleted).reverse();
  } catch(e) { notificaciones = []; }

  try {
    const jc = await _supaFetch('customers?select=*&limit=500&order=created_at.asc', {});
    _notiClientes = Array.isArray(jc) ? jc : [];
  } catch(e) { _notiClientes = []; }

  _poblarDestinatarios();
  renderNotificaciones();
  _renderNotificacionesLaterales();
  updateNavBadge();
}

/* ── Poblar select de clientes en el modal ─────────────────────── */
function _poblarDestinatarios() {
  const sel = document.getElementById('notiDestinatario');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="all">Todos los clientes</option>';
  _notiClientes.forEach(c => {
    const opt = document.createElement('option');
    opt.value       = c.id;
    opt.textContent = `${c.nombre || c.name || 'Sin nombre'} — ${c.telefono || c.phone || ''}`;
    sel.appendChild(opt);
  });
  if (prev) sel.value = prev;
}

/* ── Lista principal ───────────────────────────────────────────── */
function renderNotificaciones() {
  const q     = (document.getElementById('notiSearch')?.value || '').toLowerCase().trim();
  const tipo  = document.getElementById('notiFilterTipo')?.value || '';

  const lista = notificaciones.filter(n => {
    const matchQ   = !q || (n.titulo||'').toLowerCase().includes(q) || (n.mensaje||'').toLowerCase().includes(q) || (n.destinatario_nombre||'').toLowerCase().includes(q);
    const matchT   = !tipo || n.tipo === tipo;
    return matchQ && matchT;
  });

  const el = document.getElementById('notiList');
  if (!el) return;

  const countEl = document.getElementById('notiCount');
  if (countEl) countEl.textContent = lista.length;

  if (!lista.length) {
    el.innerHTML = `<div style="text-align:center;color:var(--text-light);padding:28px">
      <i class="fas fa-bell-slash" style="font-size:1.6rem;opacity:.3;display:block;margin-bottom:8px"></i>
      No hay notificaciones
    </div>`;
    return;
  }

  const tipoIcon  = { cambio_estado:'fa-rotate', nueva_oferta:'fa-tag', sistema:'fa-gear' };
  const tipoColor = { cambio_estado:'#1565c0',   nueva_oferta:'#f57c00', sistema:'#7b1fa2' };
  const tipoBg    = { cambio_estado:'#e3f2fd',   nueva_oferta:'#fff3e0', sistema:'#f3e5f5' };
  const tipoLabel = { cambio_estado:'Cambio de estado', nueva_oferta:'Nueva oferta', sistema:'Sistema' };

  el.innerHTML = lista.map(n => {
    const leido  = n.leido !== false;
    const icon   = tipoIcon[n.tipo]  || 'fa-bell';
    const color  = tipoColor[n.tipo] || '#1a7c3e';
    const bg     = tipoBg[n.tipo]    || '#e8f5ee';
    const label  = tipoLabel[n.tipo] || n.tipo || '-';
    const fecha  = n.created_at ? new Date(Number(n.created_at)).toLocaleString('es-DO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '-';

    return `<div style="display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:${leido ? '#fafafa' : '#f0f7ff'};border:1px solid ${leido ? 'var(--border)' : '#bdd7f5'};cursor:pointer" onclick="markNotiRead('${n.id}')">
      <div style="width:36px;height:36px;border-radius:50%;background:${bg};color:${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:.9rem">
        <i class="fas ${icon}"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:.84rem;font-weight:${leido ? '600' : '800'};color:var(--text-dark)">${n.titulo || '-'}</span>
          <span style="font-size:.72rem;color:var(--text-light);white-space:nowrap">${fecha}</span>
        </div>
        <div style="font-size:.78rem;color:var(--text-mid);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.mensaje || ''}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:5px;flex-wrap:wrap">
          <span style="font-size:.72rem;background:${bg};color:${color};padding:2px 8px;border-radius:20px;font-weight:700">${label}</span>
          ${n.destinatario_nombre ? `<span style="font-size:.72rem;color:var(--text-light)"><i class="fas fa-user" style="margin-right:3px"></i>${n.destinatario_nombre}</span>` : ''}
          ${!leido ? `<span style="font-size:.72rem;background:#e53935;color:#fff;padding:2px 8px;border-radius:20px;font-weight:700">Sin leer</span>` : ''}
        </div>
      </div>
      <button onclick="event.stopPropagation();deleteNoti('${n.id}')" title="Eliminar"
        style="background:#ffebee;color:#e53935;border:none;border-radius:6px;padding:5px 7px;cursor:pointer;font-size:.75rem;flex-shrink:0">
        <i class="fas fa-trash"></i>
      </button>
    </div>`;
  }).join('');
}

/* ── Panel lateral: KPIs, distribución, recientes ─────────────── */
function _renderNotificacionesLaterales() {
  const total     = notificaciones.length;
  const noLeidas  = notificaciones.filter(n => n.leido === false).length;
  const cambios   = notificaciones.filter(n => n.tipo === 'cambio_estado').length;
  const ofertas   = notificaciones.filter(n => ['nueva_oferta','sistema'].includes(n.tipo)).length;

  _setEl('notiKpiTotal',    total);
  _setEl('notiKpiNoLeidas', noLeidas);
  _setEl('notiKpiPedidos',  cambios);
  _setEl('notiKpiOfertas',  ofertas);

  const distEl = document.getElementById('notiDistribucion');
  if (distEl) {
    const tipos = [
      { key:'cambio_estado', label:'Cambio de estado', color:'#1565c0', bg:'#e3f2fd', icon:'fa-rotate' },
      { key:'nueva_oferta',  label:'Nueva oferta',     color:'#f57c00', bg:'#fff3e0', icon:'fa-tag' },
      { key:'sistema',       label:'Sistema',          color:'#7b1fa2', bg:'#f3e5f5', icon:'fa-gear' },
    ];
    const max = Math.max(...tipos.map(t => notificaciones.filter(n => n.tipo === t.key).length), 1);
    distEl.innerHTML = tipos.map(t => {
      const count = notificaciones.filter(n => n.tipo === t.key).length;
      const pct   = Math.round((count / max) * 100);
      const pctTotal = total ? Math.round((count / total) * 100) : 0;
      return `<div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-size:.82rem;color:var(--text-dark);display:flex;align-items:center;gap:6px">
            <i class="fas ${t.icon}" style="color:${t.color};width:14px;text-align:center"></i> ${t.label}
          </span>
          <span style="font-size:.78rem;font-weight:700;color:${t.color}">${count} (${pctTotal}%)</span>
        </div>
        <div style="height:6px;background:#f0f3f0;border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${t.color};border-radius:4px;transition:width .4s"></div>
        </div>
      </div>`;
    }).join('');
  }

  const recEl = document.getElementById('notiRecientes');
  if (recEl) {
    const ult5 = notificaciones.slice(0, 5);
    if (!ult5.length) {
      recEl.innerHTML = `<div style="color:#aab;font-size:.84rem;text-align:center;padding:16px 0">Sin notificaciones</div>`;
    } else {
      const tipoColor = { cambio_estado:'#1565c0', nueva_oferta:'#f57c00', sistema:'#7b1fa2' };
      const tipoIcon  = { cambio_estado:'fa-rotate', nueva_oferta:'fa-tag', sistema:'fa-gear' };
      recEl.innerHTML = ult5.map(n => {
        const color = tipoColor[n.tipo] || '#1a7c3e';
        const icon  = tipoIcon[n.tipo]  || 'fa-bell';
        return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
          <i class="fas ${icon}" style="color:${color};width:14px;text-align:center;font-size:.85rem"></i>
          <div style="flex:1;min-width:0">
            <div style="font-size:.82rem;font-weight:600;color:var(--text-dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.titulo || '-'}</div>
            <div style="font-size:.72rem;color:var(--text-light)">${n.destinatario_nombre || 'Todos'}</div>
          </div>
          ${n.leido === false ? `<span style="width:8px;height:8px;border-radius:50%;background:#e53935;flex-shrink:0"></span>` : ''}
        </div>`;
      }).join('');
    }
  }
}

/* ── Badge en sidebar ──────────────────────────────────────────── */
function updateNavBadge() {
  // Badge del sidebar desactivado
}

/* ── Marcar como leída ─────────────────────────────────────────── */
async function markNotiRead(id) {
  const n = notificaciones.find(x => x.id === id);
  if (!n || n.leido !== false) return;
  try {
    await _supaFetch(`notificaciones?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ leido: true })
    });
    n.leido = true;
    renderNotificaciones();
    _renderNotificacionesLaterales();
    updateNavBadge();
  } catch(e) {}
}

async function markAllNotiRead() {
  const sinLeer = notificaciones.filter(n => n.leido === false);
  if (!sinLeer.length) return;
  try {
    await Promise.all(sinLeer.map(n =>
      _supaFetch(`notificaciones?id=eq.${n.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ leido: true })
      })
    ));
    notificaciones.forEach(n => { n.leido = true; });
    renderNotificaciones();
    _renderNotificacionesLaterales();
    updateNavBadge();
    _showAdminToast('Todas marcadas como leidas', 'success');
  } catch(e) {}
}

/* ── Eliminar notificación ─────────────────────────────────────── */
async function deleteNoti(id) {
  if (!confirm('Eliminar esta notificacion?')) return;
  try {
    await _supaFetch(`notificaciones?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ deleted: true }) });
    notificaciones = notificaciones.filter(n => n.id !== id);
    renderNotificaciones();
    _renderNotificacionesLaterales();
    updateNavBadge();
    _showAdminToast('Notificacion eliminada', 'success');
  } catch(e) {}
}

/* ── Modal abrir / cerrar ──────────────────────────────────────── */
function openNotiModal(clienteId) {
  const modal = document.getElementById('notiModalBack');
  if (!modal) return;
  document.getElementById('notiTitulo').value  = '';
  document.getElementById('notiMensaje').value = '';
  document.getElementById('notiTipo').value    = 'nueva_oferta';
  _poblarDestinatarios();
  if (clienteId) {
    const sel = document.getElementById('notiDestinatario');
    if (sel) sel.value = clienteId;
  }
  modal.style.display = 'flex';
}

function closeNotiModal() {
  const modal = document.getElementById('notiModalBack');
  if (modal) modal.style.display = 'none';
}

/* ── Enviar notificación ───────────────────────────────────────── */
async function sendNotificacion() {
  const titulo  = (document.getElementById('notiTitulo')?.value  || '').trim();
  const mensaje = (document.getElementById('notiMensaje')?.value || '').trim();
  const tipo    = document.getElementById('notiTipo')?.value     || 'sistema';
  const destId  = document.getElementById('notiDestinatario')?.value || 'all';

  if (!titulo)  { alert('El titulo es obligatorio.'); return; }
  if (!mensaje) { alert('El mensaje es obligatorio.'); return; }

  let destinatarioNombre = 'Todos los clientes';
  if (destId !== 'all') {
    const c = _notiClientes.find(x => x.id === destId);
    destinatarioNombre = c ? (c.nombre || c.name || 'Cliente') : 'Cliente';
  }

  const payload = {
    titulo,
    mensaje,
    tipo,
    destinatario_id     : destId === 'all' ? null : destId,
    destinatario_nombre : destinatarioNombre,
    leido               : false,
  };

  try {
    await _supaFetch('notificaciones', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    closeNotiModal();
    await loadNotificaciones();
    _showAdminToast('Notificacion enviada', 'success');
  } catch(e) {
    alert('Error al enviar la notificacion.');
  }
}

/* ── Envío automático al cambiar estado de pedido ──────────────── */
async function sendOrderStatusNotification(order, nuevoEstado) {
  if (!order?.id) return;
  const labels = { pendiente:'Pendiente', procesando:'En proceso', enviado:'Enviado', entregado:'Entregado', cancelado:'Cancelado' };
  const titulo  = `Tu pedido #${order.id} fue actualizado`;
  const mensaje = `El estado de tu pedido es ahora: ${labels[nuevoEstado] || nuevoEstado}`;
  try {
    await _supaFetch('notificaciones', {
      method: 'POST',
      body: JSON.stringify({
        titulo,
        mensaje,
        tipo                : 'cambio_estado',
        destinatario_id     : order.customerId || null,
        destinatario_nombre : order.customer   || 'Cliente',
        leido               : false,
        pedido_id           : order.id,
      })
    });
    const badge = document.getElementById('navBadgeNoti');
    if (badge) {
      const j = await _supaFetch('notificaciones?select=*&limit=300&order=created_at.asc', {});
      notificaciones = [...(Array.isArray(j) ? j : [])].filter(n => !n.deleted).reverse();
      updateNavBadge();
    }
  } catch(e) {}
}

/* ── Búsqueda de cliente en el panel lateral ───────────────────── */
function onNotiClientSearch(val) {
  const drop = document.getElementById('notiClientDropdown');
  if (!drop) return;
  if (!val || val.length < 2) { drop.style.display = 'none'; return; }
  const q = val.toLowerCase();
  const matches = _notiClientes.filter(c =>
    (c.nombre||c.name||'').toLowerCase().includes(q) ||
    (c.telefono||c.phone||'').includes(q)
  ).slice(0, 8);

  if (!matches.length) { drop.style.display = 'none'; return; }
  drop.style.display = 'block';
  drop.innerHTML = matches.map(c => `
    <div onclick="selectNotiClient('${c.id}')"
      style="padding:10px 14px;cursor:pointer;font-size:.84rem;border-bottom:1px solid var(--border)"
      onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background=''">
      <strong>${c.nombre || c.name || 'Sin nombre'}</strong>
      <span style="color:var(--text-light);margin-left:6px">${c.telefono || c.phone || ''}</span>
    </div>`).join('');
}

function selectNotiClient(clienteId) {
  const drop = document.getElementById('notiClientDropdown');
  if (drop) drop.style.display = 'none';
  const input = document.getElementById('notiClientSearch');
  const c = _notiClientes.find(x => x.id === clienteId);
  if (input && c) input.value = c.nombre || c.name || '';

  const resultEl = document.getElementById('notiClientResult');
  if (!resultEl) return;
  const sus = notificaciones.filter(n => n.destinatario_id === clienteId);
  if (!sus.length) {
    resultEl.innerHTML = `<div style="color:#aab;font-size:.84rem;text-align:center;padding:12px 0">Sin notificaciones para este cliente</div>`;
    return;
  }
  resultEl.innerHTML = sus.slice(0, 5).map(n => `
    <div style="padding:7px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:.82rem;font-weight:600;color:var(--text-dark)">${n.titulo || '-'}</div>
      <div style="font-size:.74rem;color:var(--text-light)">${n.mensaje || ''}</div>
    </div>`).join('');
}

/* ── Fetch rápido del badge ────────────────────────────────────── */
async function _fetchBadge() {
  try {
    const j = await _supaFetch('notificaciones?select=*&limit=300&order=created_at.asc', {});
    notificaciones = [...(Array.isArray(j) ? j : [])].filter(n => !n.deleted).reverse();
    updateNavBadge();
    if (typeof renderDashboardKpis === 'function') renderDashboardKpis();
  } catch(e) {}
}

/* ── Cargar badge al arrancar y refrescar cada 60 s ─────────────── */
document.addEventListener('DOMContentLoaded', () => {
  _fetchBadge();
  _notiTimer = setInterval(_fetchBadge, 60000);
});


// ════════════════════════════════════════════════════════════════
// 5. EXPONER FUNCIONES EN window (scope global garantizado)
// ════════════════════════════════════════════════════════════════
window.loadReportes    = loadReportes;
window.setReportPeriod = setReportPeriod;
window.exportReportPDF = exportReportPDF;
window.printOrderPDF   = printOrderPDF;

// ════════════════════════════════════════════════════════════════
// 6. DROPDOWN DE NOTIFICACIONES (campanita topbar)
// ════════════════════════════════════════════════════════════════

let _notifDdOpen = false;

function toggleNotifDropdown() {
  _notifDdOpen ? closeNotifDropdown() : openNotifDropdown();
}

async function openNotifDropdown() {
  _notifDdOpen = true;
  const dd = document.getElementById('notifDropdown');
  if (dd) dd.style.display = 'block';

  _renderNotifDd();

  try {
    const j = await _supaFetch('notificaciones?select=*&limit=100&order=created_at.asc', {});
    notificaciones = [...(Array.isArray(j) ? j : [])].filter(n => !n.deleted).reverse();
    _renderNotifDd();
    updateNavBadge();
    _updateNotifDot();
  } catch(_) {}

  setTimeout(() => {
    document.addEventListener('click', _notifOutsideClick, { once: true });
  }, 0);
}

function closeNotifDropdown() {
  _notifDdOpen = false;
  const dd = document.getElementById('notifDropdown');
  if (dd) dd.style.display = 'none';
}

function _notifOutsideClick(e) {
  const wrap = document.getElementById('notifWrap');
  if (wrap && !wrap.contains(e.target)) {
    closeNotifDropdown();
  } else if (_notifDdOpen) {
    setTimeout(() => {
      document.addEventListener('click', _notifOutsideClick, { once: true });
    }, 0);
  }
}

function _renderNotifDd() {
  const list = document.getElementById('notifDdList');
  if (!list) return;

  const items = notificaciones.slice(0, 8);

  if (!items.length) {
    list.innerHTML = '<div class="notif-dd-empty"><i class="fas fa-bell-slash"></i><br>Sin notificaciones</div>';
    return;
  }

  const tipoIcon  = { cambio_estado: 'fa-rotate', nueva_oferta: 'fa-tag', sistema: 'fa-gear' };
  const tipoColor = { cambio_estado: '#1565c0',   nueva_oferta: '#f57c00', sistema: '#7b1fa2' };
  const tipoBg    = { cambio_estado: '#e3f2fd',   nueva_oferta: '#fff3e0', sistema: '#f3e5f5' };

  list.innerHTML = items.map(n => {
    const leido = n.leido !== false;
    const icon  = tipoIcon[n.tipo]  || 'fa-bell';
    const color = tipoColor[n.tipo] || '#1a7c3e';
    const bg    = tipoBg[n.tipo]    || '#e8f5ee';
    const fecha = n.created_at
      ? new Date(Number(n.created_at)).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '';
    return `
      <div class="notif-dd-item ${leido ? '' : 'notif-dd-unread'}" onclick="notifDdMarkRead('${n.id}', this)">
        <div class="notif-dd-icon" style="background:${bg};color:${color}">
          <i class="fas ${icon}"></i>
        </div>
        <div class="notif-dd-body">
          <div class="notif-dd-item-title">${n.titulo || 'Sin titulo'}</div>
          <div class="notif-dd-item-msg">${(n.mensaje || '').substring(0, 70)}${(n.mensaje||'').length > 70 ? '...' : ''}</div>
          <div class="notif-dd-item-meta">${n.destinatario_nombre || 'Todos'} · ${fecha}</div>
        </div>
        ${!leido ? '<span class="notif-dd-unread-dot"></span>' : ''}
      </div>`;
  }).join('');
}

async function notifDdMarkRead(id, el) {
  if (el) el.classList.remove('notif-dd-unread');
  const dot = el?.querySelector('.notif-dd-unread-dot');
  if (dot) dot.remove();

  const n = notificaciones.find(x => x.id === id);
  if (n && n.leido === false) {
    n.leido = true;
    _updateNotifDot();
    updateNavBadge();
    try { await _supaFetch(`notificaciones?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ leido: true }) }); } catch(_) {}
  }
}

async function notifMarkAllRead() {
  const unread = notificaciones.filter(n => n.leido === false);
  unread.forEach(n => { n.leido = true; });
  _renderNotifDd();
  _updateNotifDot();
  updateNavBadge();
  await Promise.allSettled(
    unread.map(n => _supaFetch(`notificaciones?id=eq.${n.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ leido: true })
    }))
  );
  _showAdminToast('Todas las notificaciones marcadas como leidas', 'success');
}

function _updateNotifDot() {
  const dot     = document.getElementById('notifDot');
  const noLeidas = notificaciones.filter(n => n.leido === false).length;
  if (!dot) return;
  if (noLeidas > 0) {
    dot.style.display = 'flex';
    dot.textContent   = noLeidas > 9 ? '9+' : noLeidas;
  } else {
    dot.style.display = 'none';
    dot.textContent   = '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setInterval(_updateNotifDot, 5000);
  setTimeout(_updateNotifDot, 2000);
});

// Cupones
window.loadCupones         = loadCupones;
window.renderCupones       = renderCupones;
window.openCuponModal      = openCuponModal;
window.editCupon           = editCupon;
window.closeCuponModal     = closeCuponModal;
window.saveCupon           = saveCupon;
window.deleteCupon         = deleteCupon;
window.updateCuponValLabel = updateCuponValLabel;
window.validateCupon       = validateCupon;
window.incrementCuponUso   = incrementCuponUso;

// Notificaciones
window.loadNotificaciones            = loadNotificaciones;
window.renderNotificaciones          = renderNotificaciones;
window.updateNavBadge                = updateNavBadge;
window.markNotiRead                  = markNotiRead;
window.markAllNotiRead               = markAllNotiRead;
window.deleteNoti                    = deleteNoti;
window.openNotiModal                 = openNotiModal;
window.closeNotiModal                = closeNotiModal;
window.sendNotificacion              = sendNotificacion;
window.sendOrderStatusNotification   = sendOrderStatusNotification;
window.onNotiClientSearch            = onNotiClientSearch;
window.selectNotiClient              = selectNotiClient;

// Dropdown campanita
window.toggleNotifDropdown  = toggleNotifDropdown;
window.openNotifDropdown    = openNotifDropdown;
window.closeNotifDropdown   = closeNotifDropdown;
window.notifMarkAllRead     = notifMarkAllRead;
window.notifDdMarkRead      = notifDdMarkRead;
