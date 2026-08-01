/* ================================================================
   SUPERMERCADO CASA MOTA — MÓDULOS EXTRAS
   Reportes · PDF de pedidos
   ================================================================ */

'use strict';

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
        <div class="pdf-report-title">📊 Reporte de Ventas</div>
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
      <div class="section-title"><div>🏆</div>Top 10 Productos Más Vendidos</div>
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

function printOrderPDF(orderId) {
  const order = (typeof orders !== 'undefined' ? orders : []).find(o => String(o.id) === String(orderId));
  if (!order) { alert('Pedido no encontrado'); return; }

  const statusLabels = { pendiente:'Pendiente', procesando:'En proceso', enviado:'Enviado', entregado:'Entregado', cancelado:'Cancelado' };
  const payLabels    = { efectivo:'Efectivo', tarjeta_credito:'Tarjeta', transferencia:'Transferencia' };

  const lines = (order.productLines || []).map((l, i) => {
    const hasSust   = 'sustitucion' in l;
    const sustCell  = hasSust
      ? (l.sustitucion
          ? `<span style="display:inline-block;background:#e8f5ee;color:#1a7c3e;border:1px solid #b2dfcc;border-radius:20px;padding:1px 8px;font-size:.75rem;font-weight:700">&#x21c4; Sí</span>`
          : `<span style="display:inline-block;background:#f5f5f5;color:#999;border:1px solid #ddd;border-radius:20px;padding:1px 8px;font-size:.75rem;font-weight:700">— No</span>`)
      : `<span style="color:#ccc;font-size:.75rem">—</span>`;
    return `
    <tr>
      <td>${i+1}</td>
      <td>${l.name || '-'}</td>
      <td>${l.unit || '-'}</td>
      <td style="text-align:center">${l.cantidad || 1}</td>
      <td style="text-align:right">RD$ ${Number(l.price||0).toLocaleString('es-DO',{minimumFractionDigits:2})}</td>
      <td style="text-align:right"><strong>RD$ ${Number(l.subtotal || (l.price*(l.cantidad||1))).toLocaleString('es-DO',{minimumFractionDigits:2})}</strong></td>
      <td style="text-align:center">${sustCell}</td>
    </tr>`;
  }).join('');

  const subtotal = (order.productLines || []).reduce((s, l) => s + (Number(l.subtotal) || Number(l.price)*(Number(l.cantidad)||1)), 0);
  const shipping = Number(order.shipping || 0);
  const total    = Number(order.total || subtotal + shipping);

  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html><html lang="es"><head>
    <meta charset="UTF-8">
    <title>Pedido #${order.id} — Casa Mota</title>
    <style>
      * { box-sizing:border-box; }
      body { font-family:Arial,sans-serif; color:#222; margin:0; padding:30px; font-size:13px; }
      .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #1a7c3e; padding-bottom:16px; margin-bottom:20px; }
      .logo-area h2 { color:#1a7c3e; margin:0; font-size:1.4rem; }
      .logo-area p  { margin:2px 0; color:#666; font-size:.85rem; }
      .order-num    { text-align:right; }
      .order-num h3 { margin:0; color:#1a7c3e; font-size:1.5rem; }
      .order-num p  { margin:2px 0; color:#666; font-size:.82rem; }
      .info-grid    { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px; }
      .info-box     { background:#f7f9f4; border-radius:8px; padding:14px; }
      .info-box h4  { margin:0 0 8px; color:#1a7c3e; font-size:.9rem; text-transform:uppercase; letter-spacing:.05em; }
      .info-box p   { margin:3px 0; color:#333; }
      table  { width:100%; border-collapse:collapse; margin-bottom:16px; }
      thead tr th { background:#1a7c3e; color:#fff; padding:9px 12px; text-align:left; font-size:.85rem; }
      tbody tr td  { padding:8px 12px; border-bottom:1px solid #e0e8de; font-size:.85rem; }
      tbody tr:nth-child(even) td { background:#f7f9f4; }
      .totals { margin-left:auto; width:280px; }
      .totals table { margin:0; }
      .totals td { border:none; padding:5px 10px; }
      .totals .grand-total td { font-size:1.1rem; font-weight:700; color:#1a7c3e; border-top:2px solid #1a7c3e; }
      .status-pill { display:inline-block; padding:4px 14px; border-radius:20px; font-weight:700; font-size:.85rem; background:#e8f5ee; color:#1a7c3e; }
      .footer { margin-top:40px; border-top:1px solid #e0e8de; padding-top:12px; color:#aaa; font-size:.75rem; text-align:center; }
      @media print { body { padding:15px; } }
    </style></head><body>
    <div class="header">
      <div class="logo-area">
        <h2>🛒 Supermercado Casa Mota</h2>
        <p>Ave. Melchor Contin Alfau No. 5, Hato Mayor del Rey</p>
        <p>Tel: 809-553-2226 · info@casamota.com.do</p>
      </div>
      <div class="order-num">
        <h3>PEDIDO #${order.id}</h3>
        <p>Fecha: ${order.date || '-'}</p>
        <p>Estado: <span class="status-pill">${statusLabels[order.status] || order.status}</span></p>
        <p>Pago: ${payLabels[order.payMethod] || order.payMethod || '-'}</p>
      </div>
    </div>
    <div class="info-grid">
      <div class="info-box">
        <h4>👤 Cliente</h4>
        <p><strong>${order.customer || '-'}</strong></p>
        <p>${order.email || ''}</p>
        <p>${order.phone || ''}</p>
      </div>
      <div class="info-box">
        <h4>📍 Dirección de entrega</h4>
        <p>${order.address || '-'}</p>
        ${order.driverName ? `<p>🚚 Repartidor: <strong>${order.driverName}</strong></p>` : ''}
        ${order.notes ? `<p>📝 ${order.notes}</p>` : ''}
      </div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Producto</th><th>Unidad</th><th style="text-align:center">Cant.</th><th style="text-align:right">Precio</th><th style="text-align:right">Subtotal</th><th style="text-align:center">Sust.</th></tr></thead>
      <tbody>${lines || '<tr><td colspan="7" style="text-align:center">Sin detalles</td></tr>'}</tbody>
    </table>
    <div class="totals">
      <table>
        <tr><td>Subtotal</td><td style="text-align:right">RD$ ${subtotal.toLocaleString('es-DO',{minimumFractionDigits:2})}</td></tr>
        <tr><td>Envío</td><td style="text-align:right">RD$ ${shipping.toLocaleString('es-DO',{minimumFractionDigits:2})}</td></tr>
        <tr class="grand-total"><td><strong>TOTAL</strong></td><td style="text-align:right"><strong>RD$ ${total.toLocaleString('es-DO',{minimumFractionDigits:2})}</strong></td></tr>
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

async function loadCupones() {
  try {
    const res  = await fetch('tables/cupones?limit=200');
    const json = await res.json();
    cupones = json.data || [];
  } catch(e) { cupones = []; }
  renderCupones();
  _renderCuponesLaterales();
}

function renderCupones() {
  const q      = (document.getElementById('cuponSearch')?.value || '').toLowerCase();
  const estado = document.getElementById('cuponFilterEstado')?.value || '';
  const now    = new Date();

  const filtered = cupones.filter(c => {
    const match = !q || (c.id||'').toLowerCase().includes(q) || (c.descripcion||'').toLowerCase().includes(q);
    if (!match) return false;
    const vencido = c.fecha_fin && new Date(c.fecha_fin) < now;
    if (estado === 'activo')   return c.activo && !vencido;
    if (estado === 'inactivo') return !c.activo || vencido;
    return true;
  });

  const tbody = document.getElementById('cuponesBody');
  const countEl = document.getElementById('cuponCount');
  if (countEl) countEl.textContent = filtered.length;
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-light);padding:24px">No hay cupones</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const vencido  = c.fecha_fin && new Date(c.fecha_fin) < now;
    const isActive = c.activo && !vencido;
    const badge = vencido
      ? `<span style="display:inline-block;padding:3px 10px;border-radius:50px;font-size:.72rem;font-weight:700;background:#ffebee;color:#c62828">Vencido</span>`
      : c.activo
        ? `<span style="display:inline-block;padding:3px 10px;border-radius:50px;font-size:.72rem;font-weight:700;background:#e8f5ee;color:#1a7c3e">Activo</span>`
        : `<span style="display:inline-block;padding:3px 10px;border-radius:50px;font-size:.72rem;font-weight:700;background:#f5f5f5;color:#777">Inactivo</span>`;
    const descuento = c.tipo === 'porcentaje'
      ? `${c.valor}%`
      : `RD$ ${_fmt(c.valor)}`;
    return `<tr>
      <td><strong style="font-family:monospace;letter-spacing:.5px">${c.id||'-'}</strong></td>
      <td style="color:var(--text-light);font-size:.84rem">${c.descripcion||'-'}</td>
      <td><span style="font-weight:600;color:#1a7c3e">${descuento}</span></td>
      <td style="text-align:center">${c.usos_actuales||0}${c.usos_max ? ' / '+c.usos_max : ''}</td>
      <td style="text-align:center">${badge}</td>
      <td style="text-align:center;white-space:nowrap">
        <button onclick="editCupon('${c.id}')" title="Editar" style="background:#e8f5ee;border:none;color:#1a7c3e;width:30px;height:30px;border-radius:6px;cursor:pointer;margin-right:4px"><i class="fas fa-pen" style="font-size:.75rem"></i></button>
        <button onclick="deleteCupon('${c.id}')" title="Eliminar" style="background:#ffebee;border:none;color:#c62828;width:30px;height:30px;border-radius:6px;cursor:pointer"><i class="fas fa-trash" style="font-size:.75rem"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function _renderCuponesLaterales() {
  const now     = new Date();
  const total   = cupones.length;
  const activos = cupones.filter(c => c.activo && !(c.fecha_fin && new Date(c.fecha_fin) < now)).length;
  const usados  = cupones.reduce((s, c) => s + (Number(c.usos_actuales) || 0), 0);
  const vencidos = cupones.filter(c => !c.activo || (c.fecha_fin && new Date(c.fecha_fin) < now)).length;

  _setEl('cpnKpiTotal',   total);
  _setEl('cpnKpiActivos', activos);
  _setEl('cpnKpiUsados',  usados);
  _setEl('cpnKpiVencidos',vencidos);

  // Top 5 más usados
  const top5 = [...cupones].sort((a,b) => (b.usos_actuales||0)-(a.usos_actuales||0)).slice(0,5);
  const maxU  = top5[0]?.usos_actuales || 1;
  const topEl = document.getElementById('cpnTopUsados');
  if (topEl) {
    if (!top5.length) { topEl.innerHTML = '<div style="color:#aab;font-size:.84rem">Sin datos</div>'; }
    else topEl.innerHTML = top5.map(c => {
      const pct = Math.round(((c.usos_actuales||0)/maxU)*100);
      return `<div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:4px">
          <span style="font-family:monospace;font-weight:600;color:#1a1a2e">${c.id}</span>
          <span style="color:#1a7c3e;font-weight:600">${c.usos_actuales||0} usos</span>
        </div>
        <div style="background:#e8f5ee;border-radius:6px;height:7px">
          <div style="background:#1a7c3e;height:7px;border-radius:6px;width:${pct}%"></div>
        </div>
      </div>`;
    }).join('');
  }

  // Gráfico donut tipos
  const porcentaje = cupones.filter(c => c.tipo === 'porcentaje').length;
  const montoFijo  = cupones.filter(c => c.tipo === 'monto_fijo').length;
  const ctxEl      = document.getElementById('cpnTipoChart');
  if (ctxEl) {
    if (_cpnChart) { _cpnChart.destroy(); _cpnChart = null; }
    _cpnChart = new Chart(ctxEl, {
      type: 'doughnut',
      data: {
        labels: ['Porcentaje', 'Monto fijo'],
        datasets: [{ data: [porcentaje, montoFijo], backgroundColor: ['#1a7c3e','#1565c0'], borderWidth: 0 }]
      },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ font:{size:11} } } } }
    });
  }

  // Próximos a vencer (15 días)
  const en15 = new Date(); en15.setDate(en15.getDate()+15);
  const prox = cupones.filter(c => c.activo && c.fecha_fin && new Date(c.fecha_fin) >= now && new Date(c.fecha_fin) <= en15);
  const proxEl = document.getElementById('cpnProximosVencer');
  if (proxEl) {
    if (!prox.length) { proxEl.innerHTML = '<div style="color:#aab;font-size:.84rem">Ninguno en los próximos 15 días</div>'; }
    else proxEl.innerHTML = prox.map(c => {
      const dias = Math.ceil((new Date(c.fecha_fin)-now)/(1000*60*60*24));
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#fff3e0;border-radius:8px;border-left:3px solid #f57c00">
        <span style="font-family:monospace;font-weight:600;font-size:.84rem">${c.id}</span>
        <span style="font-size:.78rem;color:#f57c00;font-weight:600">${dias}d</span>
      </div>`;
    }).join('');
  }
}

function openCuponModal(id = null) {
  _editingCuponId = id;
  const titleEl = document.getElementById('cuponModalTitle');
  if (titleEl) titleEl.innerHTML = id ? '<i class="fas fa-pen"></i> Editar Cupón' : '<i class="fas fa-ticket"></i> Nuevo Cupón';

  if (id) {
    const c = cupones.find(x => x.id === id);
    if (c) {
      document.getElementById('cuponCodigo').value  = c.id || '';
      document.getElementById('cuponDesc').value    = c.descripcion || '';
      document.getElementById('cuponTipo').value    = c.tipo || 'porcentaje';
      document.getElementById('cuponValor').value   = c.valor || '';
      document.getElementById('cuponMinimo').value  = c.minimo_compra || '';
      document.getElementById('cuponUsosMax').value = c.usos_max || '';
      document.getElementById('cuponInicio').value  = c.fecha_inicio ? c.fecha_inicio.substring(0,10) : '';
      document.getElementById('cuponFin').value     = c.fecha_fin ? c.fecha_fin.substring(0,10) : '';
      document.getElementById('cuponActivo').checked = !!c.activo;
    }
  } else {
    ['cuponCodigo','cuponDesc','cuponValor','cuponMinimo','cuponUsosMax','cuponInicio','cuponFin'].forEach(i => {
      const el = document.getElementById(i); if (el) el.value = '';
    });
    document.getElementById('cuponTipo').value     = 'porcentaje';
    document.getElementById('cuponActivo').checked = true;
  }
  updateCuponValLabel();
  document.getElementById('cuponModalBack').style.display = 'flex';
}

function editCupon(id) { openCuponModal(id); }

function closeCuponModal() {
  document.getElementById('cuponModalBack').style.display = 'none';
  _editingCuponId = null;
}

function updateCuponValLabel() {
  const tipo = document.getElementById('cuponTipo')?.value;
  const lbl  = document.getElementById('cuponValLabel');
  if (lbl) lbl.innerHTML = tipo === 'porcentaje' ? 'Valor (%) <span style="color:#e53935">*</span>' : 'Valor (RD$) <span style="color:#e53935">*</span>';
}

async function saveCupon() {
  const codigo = (document.getElementById('cuponCodigo')?.value || '').trim().toUpperCase();
  const valor  = parseFloat(document.getElementById('cuponValor')?.value || '0');
  if (!codigo) { showAdminToast('El código es obligatorio', 'error'); return; }
  if (!valor || valor <= 0) { showAdminToast('El valor debe ser mayor a 0', 'error'); return; }

  const payload = {
    id:              codigo,
    descripcion:     document.getElementById('cuponDesc')?.value.trim() || '',
    tipo:            document.getElementById('cuponTipo')?.value || 'porcentaje',
    valor:           valor,
    minimo_compra:   parseFloat(document.getElementById('cuponMinimo')?.value || '0') || 0,
    usos_max:        parseInt(document.getElementById('cuponUsosMax')?.value || '0') || null,
    fecha_inicio:    document.getElementById('cuponInicio')?.value || null,
    fecha_fin:       document.getElementById('cuponFin')?.value || null,
    activo:          document.getElementById('cuponActivo')?.checked ?? true,
    usos_actuales:   0
  };

  try {
    if (_editingCuponId) {
      const rec = cupones.find(c => c.id === _editingCuponId);
      if (rec) {
        payload.usos_actuales = rec.usos_actuales || 0;
        await fetch(`tables/cupones/${rec._rowId || rec.id}`, {
          method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
        });
      }
    } else {
      await fetch('tables/cupones', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
      });
    }
    showAdminToast(_editingCuponId ? 'Cupón actualizado' : 'Cupón creado', 'success');
    closeCuponModal();
    await loadCupones();
  } catch(e) { showAdminToast('Error al guardar', 'error'); }
}

async function deleteCupon(id) {
  if (!confirm(`¿Eliminar el cupón "${id}"?`)) return;
  try {
    const res  = await fetch(`tables/cupones?search=${encodeURIComponent(id)}&limit=5`);
    const json = await res.json();
    const rec  = (json.data||[]).find(c => c.id === id);
    if (!rec) { showAdminToast('Cupón no encontrado', 'error'); return; }
    await fetch(`tables/cupones/${rec._rowId || rec.gs_row_id || id}`, { method: 'DELETE' });
    cupones = cupones.filter(c => c.id !== id);
    renderCupones();
    _renderCuponesLaterales();
    showAdminToast('Cupón eliminado', 'success');
  } catch(e) { showAdminToast('Error al eliminar', 'error'); }
}

// Expuesta globalmente para la tienda (index.html)
async function validateCupon(codigo, subtotal = 0) {
  try {
    const res  = await fetch(`tables/cupones?search=${encodeURIComponent(codigo)}&limit=5`);
    const json = await res.json();
    const c    = (json.data||[]).find(x => x.id === codigo);
    if (!c) return { valido: false, mensaje: 'Cupón no encontrado' };
    if (!c.activo) return { valido: false, mensaje: 'Cupón inactivo' };
    const now = new Date();
    if (c.fecha_inicio && new Date(c.fecha_inicio) > now) return { valido: false, mensaje: 'Cupón aún no vigente' };
    if (c.fecha_fin    && new Date(c.fecha_fin)    < now) return { valido: false, mensaje: 'Cupón vencido' };
    if (c.usos_max && (c.usos_actuales||0) >= c.usos_max) return { valido: false, mensaje: 'Cupón sin usos disponibles' };
    if (c.minimo_compra && subtotal < c.minimo_compra) return { valido: false, mensaje: `Compra mínima: RD$ ${_fmt(c.minimo_compra)}` };
    const descuento = c.tipo === 'porcentaje' ? subtotal*(c.valor/100) : c.valor;
    return { valido: true, descuento, tipo: c.tipo, valor: c.valor, mensaje: 'Cupón aplicado', cupon: c };
  } catch(e) { return { valido: false, mensaje: 'Error al verificar' }; }
}

async function incrementCuponUso(codigo) {
  try {
    const res  = await fetch(`tables/cupones?search=${encodeURIComponent(codigo)}&limit=5`);
    const json = await res.json();
    const rec  = (json.data||[]).find(c => c.id === codigo);
    if (!rec) return;
    await fetch(`tables/cupones/${rec._rowId || rec.gs_row_id || codigo}`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ usos_actuales: (rec.usos_actuales||0)+1 })
    });
  } catch(e) { console.warn('[Cupón] Error incrementando uso', e); }
}


// ════════════════════════════════════════════════════════════════
// 4. NOTIFICACIONES A CLIENTES
// ════════════════════════════════════════════════════════════════

let notificaciones    = [];
let _allClientes      = [];
let _allOrders        = [];
let _notiAutoTimer    = null;

const _notiTipoCfg = {
  cambio_estado: { label:'Cambio de estado', icon:'fas fa-rotate',        color:'#1565c0', bg:'#e3f2fd' },
  nueva_oferta:  { label:'Nueva oferta',     icon:'fas fa-tag',           color:'#f57c00', bg:'#fff3e0' },
  sistema:       { label:'Sistema',          icon:'fas fa-circle-info',   color:'#7b1fa2', bg:'#f3e5f5' }
};

async function _loadAutocompleteSources() {
  if (!_allClientes.length) {
    try {
      const r = await fetch('tables/customers?limit=300');
      _allClientes = (await r.json()).data || [];
    } catch(e) { _allClientes = []; }
  }
  if (!_allOrders.length) {
    try {
      const r = await fetch('tables/pedidos?limit=300');
      _allOrders = (await r.json()).data || [];
    } catch(e) { _allOrders = []; }
  }
}

async function loadNotificaciones() {
  try {
    const res  = await fetch('tables/notificaciones?limit=200&sort=created_at');
    const json = await res.json();
    notificaciones = [...(json.data||[])].reverse();
  } catch(e) { notificaciones = []; }
  renderNotificaciones();
  _renderNotificacionesLaterales();
  updateNavBadge();
  _loadAutocompleteSources();
}

function renderNotificaciones() {
  const q    = (document.getElementById('notiSearch')?.value || '').toLowerCase();
  const tipo = document.getElementById('notiFilterTipo')?.value || '';

  const filtered = notificaciones.filter(n => {
    const matchTipo = !tipo || n.tipo === tipo;
    const matchQ    = !q    || (n.titulo||'').toLowerCase().includes(q) || (n.mensaje||'').toLowerCase().includes(q) || (n.cliente||'').toLowerCase().includes(q);
    return matchTipo && matchQ;
  });

  const listEl = document.getElementById('notiList');
  if (!listEl) return;

  if (!filtered.length) {
    listEl.innerHTML = `<div style="color:#aab;font-size:.84rem;text-align:center;padding:24px">No hay notificaciones</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(n => {
    const cfg  = _notiTipoCfg[n.tipo] || _notiTipoCfg.sistema;
    const date = n.created_at ? new Date(n.created_at).toLocaleDateString('es-DO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
    const unreadDot = !n.leida ? `<span style="width:8px;height:8px;background:#e53935;border-radius:50%;flex-shrink:0;margin-top:4px"></span>` : '';
    return `<div onclick="markNotiRead('${n._rowId||n.id}')" style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;background:${n.leida?'#fff':'#f7f9f4'};border-radius:10px;border:1px solid #eef2e8;cursor:pointer;transition:background .15s">
      ${unreadDot}
      <div style="width:34px;height:34px;border-radius:50%;background:${cfg.bg};color:${cfg.color};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="${cfg.icon}" style="font-size:.8rem"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
          <strong style="font-size:.85rem;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.titulo||'Sin título'}</strong>
          <span style="font-size:.72rem;color:#aab;white-space:nowrap">${date}</span>
        </div>
        <div style="font-size:.79rem;color:#556;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.mensaje||''}</div>
        ${n.cliente ? `<div style="font-size:.73rem;color:#1a7c3e;margin-top:3px"><i class="fas fa-user" style="font-size:.65rem"></i> ${n.cliente}</div>` : ''}
      </div>
      <button onclick="event.stopPropagation();deleteNoti('${n._rowId||n.id}')" style="background:none;border:none;color:#ccc;cursor:pointer;padding:2px 4px;font-size:.8rem" title="Eliminar"><i class="fas fa-xmark"></i></button>
    </div>`;
  }).join('');
}

function _renderNotificacionesLaterales() {
  const total    = notificaciones.length;
  const noLeidas = notificaciones.filter(n => !n.leida).length;
  const pedidos  = notificaciones.filter(n => n.tipo === 'cambio_estado').length;
  const ofertas  = notificaciones.filter(n => ['nueva_oferta','sistema'].includes(n.tipo)).length;

  _setEl('notiKpiTotal',    total);
  _setEl('notiKpiNoLeidas', noLeidas);
  _setEl('notiKpiPedidos',  pedidos);
  _setEl('notiKpiOfertas',  ofertas);

  // Distribución por tipo
  const distEl = document.getElementById('notiDistribucion');
  if (distEl) {
    const tipos = Object.entries(_notiTipoCfg);
    distEl.innerHTML = tipos.map(([key, cfg]) => {
      const cnt = notificaciones.filter(n => n.tipo === key).length;
      const pct = total ? Math.round((cnt/total)*100) : 0;
      return `<div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:4px">
          <span style="display:flex;align-items:center;gap:6px;color:#556"><i class="${cfg.icon}" style="color:${cfg.color}"></i>${cfg.label}</span>
          <span style="font-weight:600;color:#1a1a2e">${cnt} <span style="color:#aab;font-weight:400">(${pct}%)</span></span>
        </div>
        <div style="background:#eef2e8;border-radius:6px;height:6px">
          <div style="background:${cfg.color};height:6px;border-radius:6px;width:${pct}%;transition:width .4s"></div>
        </div>
      </div>`;
    }).join('');
  }

  // Últimas 5
  const recEl = document.getElementById('notiRecientes');
  if (recEl) {
    const recent = notificaciones.slice(0,5);
    if (!recent.length) { recEl.innerHTML = '<div style="color:#aab;font-size:.84rem">Sin notificaciones</div>'; return; }
    recEl.innerHTML = recent.map(n => {
      const cfg  = _notiTipoCfg[n.tipo] || _notiTipoCfg.sistema;
      const date = n.created_at ? new Date(n.created_at).toLocaleDateString('es-DO',{day:'2-digit',month:'short'}) : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f0f4ea">
        <div style="width:28px;height:28px;border-radius:50%;background:${cfg.bg};color:${cfg.color};display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i class="${cfg.icon}" style="font-size:.72rem"></i>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.81rem;font-weight:600;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.titulo||'Sin título'}</div>
          <div style="font-size:.73rem;color:#aab">${date}</div>
        </div>
      </div>`;
    }).join('');
  }
}

function updateNavBadge() {
  const noLeidas = notificaciones.filter(n => !n.leida).length;
  const badge = document.getElementById('navBadgeNoti');
  if (!badge) return;
  if (noLeidas > 0) { badge.style.display = 'inline-block'; badge.textContent = noLeidas; }
  else { badge.style.display = 'none'; }
}

async function markNotiRead(rowId) {
  const n = notificaciones.find(x => (x._rowId||x.id) === rowId);
  if (!n || n.leida) return;
  try {
    await fetch(`tables/notificaciones/${rowId}`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ leida: true })
    });
    n.leida = true;
    renderNotificaciones();
    _renderNotificacionesLaterales();
    updateNavBadge();
  } catch(e) {}
}

async function markAllNotiRead() {
  const unread = notificaciones.filter(n => !n.leida);
  await Promise.all(unread.map(n =>
    fetch(`tables/notificaciones/${n._rowId||n.id}`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ leida: true })
    }).catch(()=>{})
  ));
  notificaciones.forEach(n => { n.leida = true; });
  renderNotificaciones();
  _renderNotificacionesLaterales();
  updateNavBadge();
  showAdminToast('Todas marcadas como leídas', 'success');
}

async function deleteNoti(rowId) {
  if (!confirm('¿Eliminar esta notificación?')) return;
  try {
    await fetch(`tables/notificaciones/${rowId}`, { method: 'DELETE' });
    notificaciones = notificaciones.filter(n => (n._rowId||n.id) !== rowId);
    renderNotificaciones();
    _renderNotificacionesLaterales();
    updateNavBadge();
    showAdminToast('Notificación eliminada', 'success');
  } catch(e) { showAdminToast('Error al eliminar', 'error'); }
}

async function _loadClientesEnSelector() {
  const sel = document.getElementById('notiDestinatario');
  if (!sel) return;
  await _loadAutocompleteSources();
  sel.innerHTML = '<option value="all">Todos los clientes</option>';
  _allClientes.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = `${c.name||c.nombre||''} — ${c.email||c.phone||c.telefono||''}`;
    sel.appendChild(opt);
  });
}

function openNotiModal(clienteId = null) {
  _loadClientesEnSelector();
  if (clienteId) setTimeout(() => { const s = document.getElementById('notiDestinatario'); if (s) s.value = clienteId; }, 200);
  ['notiTitulo','notiMensaje'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('notiModalBack').style.display = 'flex';
}

function openNotiModalForClient(clienteId) { openNotiModal(clienteId); }

function closeNotiModal() {
  document.getElementById('notiModalBack').style.display = 'none';
}

async function sendNotificacion() {
  const titulo   = document.getElementById('notiTitulo')?.value.trim() || '';
  const mensaje  = document.getElementById('notiMensaje')?.value.trim() || '';
  const tipo     = document.getElementById('notiTipo')?.value || 'sistema';
  const destId   = document.getElementById('notiDestinatario')?.value || 'all';
  if (!titulo) { showAdminToast('El título es obligatorio', 'error'); return; }
  if (!mensaje) { showAdminToast('El mensaje es obligatorio', 'error'); return; }

  const cliente = destId === 'all' ? null : (_allClientes.find(c => c.id === destId)?.name || destId);

  const payload = { titulo, mensaje, tipo, leida: false, cliente_id: destId === 'all' ? null : destId, cliente: cliente || null };
  try {
    await fetch('tables/notificaciones', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    showAdminToast('Notificación enviada', 'success');
    closeNotiModal();
    await loadNotificaciones();
  } catch(e) { showAdminToast('Error al enviar', 'error'); }
}

// Envío automático al cambiar estado de pedido (llamado desde admin.js)
async function sendOrderStatusNotification(order) {
  const statusMsg = {
    pendiente:   'Tu pedido está pendiente de confirmación.',
    procesando:  'Tu pedido está siendo preparado.',
    enviado:     '¡Tu pedido está en camino! Un repartidor lo llevará pronto.',
    entregado:   '¡Tu pedido ha sido entregado! Gracias por comprar en Casa Mota.',
    cancelado:   'Tu pedido ha sido cancelado. Contáctanos si tienes preguntas.'
  };
  const msg = statusMsg[order.status];
  if (!msg) return;
  const payload = {
    titulo:     `Pedido #${order.id} — ${_capFirst(order.status)}`,
    mensaje:    msg,
    tipo:       'cambio_estado',
    leida:      false,
    cliente_id: order.customerId || null,
    cliente:    order.customer || null,
    pedido_id:  order.id
  };
  try {
    await fetch('tables/notificaciones', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    updateNavBadge();
  } catch(e) { console.warn('[Noti] Error enviando notificación', e); }
}

function onNotiClientSearch(val) {
  const dropdown = document.getElementById('notiClientDropdown');
  if (!dropdown) return;
  if (!val.trim()) { dropdown.style.display = 'none'; return; }
  const q = val.toLowerCase();
  const matches = _allClientes.filter(c =>
    (c.name||c.nombre||'').toLowerCase().includes(q) ||
    (c.email||'').toLowerCase().includes(q) ||
    (c.phone||c.telefono||'').includes(q)
  ).slice(0,8);
  if (!matches.length) { dropdown.style.display = 'none'; return; }
  dropdown.style.display = 'block';
  dropdown.innerHTML = matches.map(c => `
    <div onclick="selectNotiClient('${c.id}')" style="padding:9px 12px;cursor:pointer;font-size:.84rem;border-bottom:1px solid #f0f4ea"
         onmouseover="this.style.background='#f7f9f4'" onmouseout="this.style.background='#fff'">
      <strong>${c.name||c.nombre||'-'}</strong>
      <span style="color:#aab;margin-left:6px">${c.phone||c.telefono||c.email||''}</span>
    </div>`).join('');
}

async function selectNotiClient(clienteId) {
  document.getElementById('notiClientDropdown').style.display = 'none';
  document.getElementById('notiClientSearch').value = '';
  const resultEl = document.getElementById('notiClientResult');
  if (!resultEl) return;

  const cliente = _allClientes.find(c => c.id === clienteId);
  const notisCliente = notificaciones.filter(n => n.cliente_id === clienteId);

  if (!notisCliente.length) {
    resultEl.innerHTML = `<div style="color:#aab;font-size:.84rem;padding:8px 0">Sin notificaciones para ${cliente?.name||clienteId}</div>`;
    return;
  }

  resultEl.innerHTML = `
    <div style="font-size:.82rem;color:#1a7c3e;font-weight:600;margin-bottom:8px">
      <i class="fas fa-user"></i> ${cliente?.name||clienteId} — ${notisCliente.length} notificaciones
    </div>
    ${notisCliente.slice(0,5).map(n => {
      const cfg = _notiTipoCfg[n.tipo] || _notiTipoCfg.sistema;
      return `<div style="padding:7px 10px;background:#f7f9f4;border-radius:8px;margin-bottom:6px;border-left:3px solid ${cfg.color}">
        <div style="font-size:.81rem;font-weight:600">${n.titulo||'-'}</div>
        <div style="font-size:.73rem;color:#556">${n.mensaje||''}</div>
      </div>`;
    }).join('')}
  `;
}


// ════════════════════════════════════════════════════════════════
// 5. EXPONER FUNCIONES EN window (scope global garantizado)
// ════════════════════════════════════════════════════════════════
window.loadReportes    = loadReportes;
window.setReportPeriod = setReportPeriod;
window.exportReportPDF = exportReportPDF;
window.printOrderPDF   = printOrderPDF;

// Cupones
window.loadCupones            = loadCupones;
window.renderCupones          = renderCupones;
window.openCuponModal         = openCuponModal;
window.editCupon              = editCupon;
window.closeCuponModal        = closeCuponModal;
window.saveCupon              = saveCupon;
window.deleteCupon            = deleteCupon;
window.updateCuponValLabel    = updateCuponValLabel;
window.validateCupon          = validateCupon;
window.incrementCuponUso      = incrementCuponUso;

// Notificaciones
window.loadNotificaciones         = loadNotificaciones;
window.renderNotificaciones       = renderNotificaciones;
window.updateNavBadge             = updateNavBadge;
window.markNotiRead               = markNotiRead;
window.markAllNotiRead            = markAllNotiRead;
window.deleteNoti                 = deleteNoti;
window.openNotiModal              = openNotiModal;
window.openNotiModalForClient     = openNotiModalForClient;
window.closeNotiModal             = closeNotiModal;
window.sendNotificacion           = sendNotificacion;
window.sendOrderStatusNotification = sendOrderStatusNotification;
window.onNotiClientSearch         = onNotiClientSearch;
window.selectNotiClient           = selectNotiClient;
window._renderNotificacionesLaterales = _renderNotificacionesLaterales;


// ════════════════════════════════════════════════════════════════
// 6. HOOK: showSection — cargar datos al cambiar sección
// ════════════════════════════════════════════════════════════════

// Badge de notificaciones: actualizar cada 60 s automáticamente
document.addEventListener('DOMContentLoaded', () => {
  setInterval(async () => {
    try {
      const r = await fetch('tables/notificaciones?limit=200');
      const j = await r.json();
      notificaciones = [...(j.data||[])].reverse();
      updateNavBadge();
    } catch(e) {}
  }, 60000);
});
