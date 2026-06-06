/**
 * SUPERMERCADO CASA MOTA — Cupones (tienda pública)
 * Funciones mínimas para validar y contabilizar cupones desde el checkout.
 * NO depende de extras.v32.js ni de ningún módulo de admin.
 */

/* ─────────────────────────────────────────────────────────────
   validateCupon(codigo, subtotal)
   Retorna: { valid:true,  cupon:{...}, descuento:XX.XX }
         ó  { valid:false, msg:'...' }
──────────────────────────────────────────────────────────────── */
async function validateCupon(codigo, subtotal) {
  let cupones = [];
  try {
    // Usar Supabase PostgREST igual que el resto de la app
    const res  = await fetch(`${_SB_URL}/cupones?select=*&limit=200&order=created_at.asc`, { headers: _SB_HEADERS });
    const json = await res.json();
    cupones = (Array.isArray(json) ? json : []).filter(c => !c.deleted);
  } catch(e) {
    return { valid: false, msg: 'Error al verificar el cupón. Intenta de nuevo.' };
  }

  const now  = new Date();
  const code = (codigo || '').trim().toUpperCase();
  const c    = cupones.find(x => (x.codigo || '').toUpperCase() === code);

  if (!c)                                          return { valid: false, msg: 'Cupón no encontrado.' };
  if (c.activo === false || c.activo === 'false')  return { valid: false, msg: 'Este cupón está inactivo.' };

  if (c.fecha_inicio) {
    const fi = new Date(c.fecha_inicio);
    if (!isNaN(fi) && fi > now) return { valid: false, msg: 'Este cupón aún no está vigente.' };
  }
  if (c.fecha_fin) {
    const ff = new Date(c.fecha_fin);
    if (!isNaN(ff) && ff < now) return { valid: false, msg: 'Este cupón está vencido.' };
  }

  const usosMax = Number(c.usos_maximos)  || 0;
  const usosAct = Number(c.usos_actuales) || 0;
  if (usosMax > 0 && usosAct >= usosMax)   return { valid: false, msg: 'Este cupón ya fue agotado.' };

  const minCompra = Number(c.compra_minima) || 0;
  if (minCompra > 0 && subtotal < minCompra) {
    return { valid: false, msg: `Compra mínima requerida: RD$ ${minCompra.toLocaleString('es-DO')}.` };
  }

  // Calcular descuento
  const valor = Number(c.valor) || 0;
  const descuento = c.tipo === 'monto_fijo'
    ? Math.min(valor, subtotal)
    : subtotal * (valor / 100);

  return {
    valid:    true,
    cupon:    c,
    descuento: Math.round(descuento * 100) / 100,
    msg:      c.tipo === 'monto_fijo'
      ? `Cupón aplicado: -RD$ ${(typeof fmt$==='function'?fmt$:n=>n.toFixed(2))(descuento)}`
      : `Cupón aplicado: -${valor}% (RD$ ${(typeof fmt$==='function'?fmt$:n=>n.toFixed(2))(descuento)})`
  };
}

/* ─────────────────────────────────────────────────────────────
   incrementCuponUso(id)
   Suma +1 al contador de usos del cupón en la BD.
──────────────────────────────────────────────────────────────── */
async function incrementCuponUso(id) {
  if (!id) return;
  try {
    // Obtener usos actuales frescos para evitar race conditions
    const res  = await fetch(`${_SB_URL}/cupones?id=eq.${id}&select=usos_actuales`, { headers: _SB_HEADERS });
    const json = await res.json();
    const actual = Number((Array.isArray(json) ? json[0] : json)?.usos_actuales) || 0;
    await fetch(`${_SB_URL}/cupones?id=eq.${id}`, {
      method:  'PATCH',
      headers: { ..._SB_HEADERS, 'Prefer': 'return=representation' },
      body:    JSON.stringify({ usos_actuales: actual + 1 })
    });
  } catch(e) { /* fallo silencioso — no bloquear el pedido */ }
}
