/**
 * SUPERMERCADO CASA MOTA — Cupones (tienda pública)
 *
 * 524 · seguridad/101. Antes se descargaba la tabla `cupones` ENTERA y se
 * buscaba el código aquí: cualquiera podía ver todos los códigos, su
 * descuento y los usos que les quedaban. Ahora se pregunta a la base por UN
 * código (`cliente_comprobar_cupon`, pide sesión de cliente) y la base
 * responde solo lo necesario para mostrar el descuento.
 *
 * Quien decide de verdad es la base al crear el pedido (seguridad/94): allí
 * se vuelve a comprobar el cupón y se cuenta el uso.
 */

/* validateCupon(codigo, subtotal)
   Devuelve: { valid:true,  cupon:{id, codigo, tipo, valor}, descuento, msg }
          ó  { valid:false, msg } */
async function validateCupon(codigo, subtotal) {
  const code = (codigo || '').trim().toUpperCase();
  if (!code) return { valid: false, msg: 'Ingresa un código de cupón.' };

  let r;
  try {
    r = await DB.comprobarCupon(code, Math.round((Number(subtotal) || 0) * 100) / 100);
  } catch (e) {
    return { valid: false, msg: e.message || 'Error al verificar el cupón. Intenta de nuevo.' };
  }
  if (!r || !r.ok) return { valid: false, msg: (r && r.msg) || 'Cupón no encontrado.' };

  const descuento = Number(r.descuento) || 0;
  const valor     = Number(r.valor) || 0;
  const f = typeof fmt$ === 'function' ? fmt$ : n => Number(n).toFixed(2);
  return {
    valid:     true,
    cupon:     { id: r.id, codigo: r.codigo, tipo: r.tipo, valor },
    descuento,
    msg: r.tipo === 'monto_fijo'
      ? `Cupón aplicado: -RD$ ${f(descuento)}`
      : `Cupón aplicado: -${valor}% (RD$ ${f(descuento)})`,
  };
}

/* SEGURIDAD 94 · `incrementCuponUso` borrada: el uso del cupón lo cuenta la
 * base al crear el pedido (`cliente_crear_pedido`), en la misma operación. */
