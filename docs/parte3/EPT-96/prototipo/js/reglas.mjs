// EPT-96 · Reglas del prototipo (sin DOM). Ilustran el contrato aprobado; NO son autorización productiva ni RLS.
import { LIMITE_ARCHIVO_BYTES, REFERENCIA, TIPOS_PERMITIDOS } from './datos.mjs'
import { parsearImporte, parsearFecha, sumar } from './dinero.mjs'

// ---------- facturas e ítems ----------
export const importeFactura = f => sumar(f.items.map(i => i.importe))
export const saldoFactura = f => sumar(f.items.filter(i => i.estado !== 'pagado').map(i => i.importe))

// Vencida prevalece sobre Pago parcial pasado el vencimiento; Pagada solo con saldo cero.
export function estadoFactura(f, referencia = REFERENCIA) {
  const saldo = saldoFactura(f)
  if (saldo === 0) return 'pagada'
  if (f.vence < referencia) return 'vencida'
  return saldo < importeFactura(f) ? 'parcial' : 'pendiente'
}

const ORDEN_ESTADO = { vencida: 0, parcial: 1, pendiente: 2, pagada: 3 }
export const facturasDe = (db, hijo) => db.facturas.filter(f => f.hijo === hijo)
export function facturasPorPestana(db, hijo, pestana) {
  const lista = facturasDe(db, hijo).filter(f => (pestana === 'pagadas') === (saldoFactura(f) === 0))
  return lista.sort((a, b) => ORDEN_ESTADO[estadoFactura(a)] - ORDEN_ESTADO[estadoFactura(b)] || a.vence.localeCompare(b.vence))
}
export const deudaTotal = (db, hijo) => sumar(facturasDe(db, hijo).map(saldoFactura))
export const buscarFactura = (db, id) => db.facturas.find(f => f.id === id) ?? null
export const buscarPago = (db, id) => db.pagos.find(p => p.id === id) ?? null
export const buscarItem = (db, id) => db.facturas.flatMap(f => f.items).find(i => i.id === id) ?? null
export const totalPago = (db, pago) => sumar(pago.items.map(id => buscarItem(db, id)?.importe ?? 0))

// ---------- selección ----------
// Solo ítems pendientes, completos y del mismo hijo. El total lo calcula siempre el sistema.
export function totalSeleccion(db, hijo, ids) {
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length) return { error: 'Seleccioná al menos un ítem para continuar.' }
  const items = ids.map(id => buscarItem(db, id))
  if (items.some(i => i === null)) return { error: 'La selección contiene ítems inexistentes.' }
  const propios = new Set(facturasDe(db, hijo).flatMap(f => f.items.map(i => i.id)))
  if (ids.some(id => !propios.has(id))) return { error: 'No se pueden mezclar ítems de distintos hijos.' }
  if (items.some(i => i.estado !== 'pendiente')) return { error: 'Los ítems pagados o en verificación no se pueden seleccionar.' }
  return { total: sumar(items.map(i => i.importe)), cantidad: items.length }
}

// ---------- permisos por rol, vínculo y cargador ----------
export const canalDe = rol => (rol === 'PADRE' || rol === 'ESTUDIANTE' ? 'movil' : 'web')
export function hijosVisibles(cuenta) {
  if (cuenta.rol === 'PADRE') return [...cuenta.hijos]
  if (cuenta.rol === 'ESTUDIANTE') return [cuenta.hijo]
  return []
}
export const puedeVerHijo = (cuenta, hijo) => !cuenta.bloqueada && hijosVisibles(cuenta).includes(hijo)
export const puedeOperar = (cuenta, hijo) => cuenta.rol === 'PADRE' && puedeVerHijo(cuenta, hijo)
// Decisión EPT-80: el original solo lo ve quien lo cargó (y Dirección en la web).
export const puedeVerOriginal = (cuenta, pago) => cuenta.rol === 'PADRE' && !cuenta.bloqueada && pago.cargador === cuenta.correo

// ---------- registro de pago ----------
export function registrarPago(db, cuenta, hijo, ids) {
  if (!puedeOperar(cuenta, hijo)) return { error: 'No tenés permiso para registrar pagos de este estudiante.' }
  if (!db.banco.configurado && !db.banco.simulado) return { error: 'Los datos bancarios no están configurados: la acción está bloqueada.' }
  const seleccion = totalSeleccion(db, hijo, ids)
  if (seleccion.error) return { error: seleccion.error }
  for (const id of ids) buscarItem(db, id).estado = 'verificacion'
  const pago = { id: `p${db.siguientePago++}`, hijo, cargador: cuenta.correo, fecha: null, estado: 'pendiente', operacion: null, importeInformado: null, items: [...ids], comprobantes: [] }
  db.pagos.push(pago)
  return { pago }
}

// ---------- comprobantes ----------
export function validarArchivo(archivo) {
  if (!TIPOS_PERMITIDOS.includes(archivo.tipo)) return 'Tipo no permitido. Usá un archivo JPG, PNG o PDF.'
  if (archivo.bytes > LIMITE_ARCHIVO_BYTES) return 'Supera el máximo de 5 MB por archivo.'
  return null
}

export function formatoTamano(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

// Valida el formulario sin escribir. `datos` ya informados (pago con operación) no se piden de nuevo.
export function validarComprobante(db, pago, { archivos, fecha, importe, operacion }) {
  const errores = {}
  if (archivos.length === 0) errores.archivos = 'Agregá al menos un archivo.'
  else if (archivos.some(a => validarArchivo(a) !== null)) errores.archivos = 'Quitá los archivos con errores para continuar.'
  if (pago.operacion === null) {
    if (parsearFecha(fecha) === null) errores.fecha = 'Ingresá la fecha de transferencia con el formato dd/mm/aaaa.'
    if (parsearImporte(importe) === null) errores.importe = 'Ingresá un importe válido, por ejemplo 63.606,65.'
    const numero = String(operacion).trim()
    if (!/^[A-Za-z0-9]{1,30}$/u.test(numero)) errores.operacion = 'Ingresá el número de operación (solo letras y números).'
    else if (db.pagos.some(p => p.id !== pago.id && p.estado !== 'rechazado' && p.operacion === numero)) {
      errores.operacion = 'Ese número de operación ya está registrado en otro pago. Revisalo.'
    }
  }
  return errores
}

// El comprobante queda pendiente de verificación: no aprueba el pago ni reduce saldos.
export function guardarComprobante(db, cuenta, pagoId, datos) {
  const pago = buscarPago(db, pagoId)
  if (!pago || !puedeOperar(cuenta, pago.hijo) || pago.cargador !== cuenta.correo) return { error: 'No tenés permiso para cargar este comprobante.' }
  const errores = validarComprobante(db, pago, datos)
  if (Object.keys(errores).length) return { errores }
  if (pago.operacion === null) {
    pago.fecha = parsearFecha(datos.fecha)
    pago.importeInformado = parsearImporte(datos.importe)
    pago.operacion = String(datos.operacion).trim()
  }
  for (const archivo of datos.archivos) pago.comprobantes.push({ id: `c${db.siguienteComprobante++}`, nombre: archivo.nombre, bytes: archivo.bytes })
  return { pago }
}

// ---------- consulta por período y deuda ----------
export const enRango = (fecha, desde, hasta) => fecha >= desde && fecha <= hasta // extremos inclusive
export const pagosDe = (db, hijo) => db.pagos.filter(p => p.hijo === hijo)
export const pagosEnRango = (db, hijo, desde, hasta) =>
  pagosDe(db, hijo).filter(p => p.fecha !== null && enRango(p.fecha, desde, hasta)).sort((a, b) => a.fecha.localeCompare(b.fecha))
export function facturasSinPagosEnRango(db, hijo, desde, hasta) {
  // Un pago sin fecha de transferencia (registrado, sin comprobante) todavía no se ubica en el tiempo.
  const imputadas = new Set(pagosDe(db, hijo).filter(p => p.estado !== 'rechazado' && p.fecha !== null).flatMap(p => p.items))
  return facturasDe(db, hijo).filter(f => !f.items.some(i => imputadas.has(i.id)) && enRango(f.vence, desde, hasta))
}
export function totalesPeriodo(db, hijo, desde, hasta) {
  const pagos = pagosEnRango(db, hijo, desde, hasta)
  const por = estado => sumar(pagos.filter(p => p.estado === estado).map(p => totalPago(db, p)))
  return { aprobados: por('aprobado'), verificacion: por('pendiente') }
}

export const ORDEN_DEUDA = ['transporte', 'comedor', 'cuota', 'deporte']
export function deudaPorItem(db, hijo, desde, hasta) {
  const facturas = facturasDe(db, hijo).filter(f => enRango(f.vence, desde, hasta)).sort((a, b) => a.vence.localeCompare(b.vence))
  const grupos = ORDEN_DEUDA.map(concepto => {
    const filas = facturas.flatMap(f => f.items.filter(i => i.concepto === concepto).map(i => ({
      factura: f, item: i, importe: i.importe, pagado: i.estado === 'pagado' ? i.importe : 0, saldo: i.estado === 'pagado' ? 0 : i.importe,
    })))
    return { concepto, filas, saldo: sumar(filas.map(r => r.saldo)) }
  }).filter(g => g.filas.length > 0)
  return { grupos, total: sumar(grupos.map(g => g.saldo)) }
}
