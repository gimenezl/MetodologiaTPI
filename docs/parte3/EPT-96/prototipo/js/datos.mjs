// EPT-96 · Datos ficticios del prototipo. Reutilizan los fixtures aprobados de EPT-95 (estados-y-roles.md).
// Referencia explícita: 2026-10-09. Nada aquí es información real de personas, pagos o instituciones.
export const REFERENCIA = '2026-10-09'

export const TARIFAS = { cuota: 4875035, deporte: 1248020, transporte: 1892545, comedor: 2234060 }
export const CONCEPTOS = { cuota: 'Cuota', deporte: 'Deporte · Fútbol', transporte: 'Transporte', comedor: 'Comedor' }
export const ORDEN_CONCEPTOS = ['cuota', 'deporte', 'transporte', 'comedor']

export const HIJOS = {
  mateo: { id: 'mateo', nombre: 'Mateo Ejemplo' },
  sofia: { id: 'sofia', nombre: 'Sofía Ejemplo' },
}

// Cuentas de ejemplo. El prototipo no solicita ni recibe contraseñas.
export const CUENTAS = [
  { correo: 'laura.ejemplo@ejemplo.test', nombre: 'Laura Ejemplo', rol: 'PADRE', hijos: ['mateo', 'sofia'], detalle: 'Madre de Mateo y de Sofía' },
  { correo: 'diego.ejemplo@ejemplo.test', nombre: 'Diego Ejemplo', rol: 'PADRE', hijos: ['mateo'], detalle: 'Padre de Mateo (otro padre vinculado)' },
  { correo: 'mateo.ejemplo@ejemplo.test', nombre: 'Mateo Ejemplo', rol: 'ESTUDIANTE', hijo: 'mateo', detalle: 'Estudiante' },
  { correo: 'sofia.ejemplo@ejemplo.test', nombre: 'Sofía Ejemplo', rol: 'ESTUDIANTE', hijo: 'sofia', detalle: 'Estudiante' },
  { correo: 'ana.sinvinculos@ejemplo.test', nombre: 'Ana Ejemplo', rol: 'PADRE', hijos: [], detalle: 'Madre sin estudiantes vinculados' },
  { correo: 'bloqueada@ejemplo.test', nombre: 'Cuenta Bloqueada', rol: 'PADRE', hijos: ['mateo'], bloqueada: true, detalle: 'Cuenta bloqueada' },
  { correo: 'direccion@ejemplo.test', nombre: 'Dirección Ejemplo', rol: 'DIRECTOR', detalle: 'Dirección (canal web)' },
  { correo: 'docente@ejemplo.test', nombre: 'Docente Ejemplo', rol: 'DOCENTE', detalle: 'Docente (canal web)' },
  { correo: 'personal@ejemplo.test', nombre: 'Personal Ejemplo', rol: 'PERSONAL', detalle: 'Personal (canal web)' },
]

const factura = (id, hijo, periodo, vence, estados) => ({
  id, hijo, periodo, vence,
  items: Object.entries(estados).map(([concepto, estado]) => ({ id: `${id}-${concepto}`, concepto, estado, importe: TARIFAS[concepto] })),
})
const todos = estado => ({ cuota: estado, deporte: estado, transporte: estado, comedor: estado })

// Estado de ítem: 'pagado' | 'verificacion' | 'pendiente'. Los estados de factura se derivan en reglas.mjs.
export function crearBase() {
  return {
    facturas: [
      factura('mateo-sep', 'mateo', 'Septiembre 2026', '2026-09-10', { cuota: 'pagado', deporte: 'pagado', transporte: 'verificacion', comedor: 'pendiente' }),
      factura('mateo-oct', 'mateo', 'Octubre 2026', '2026-10-10', { cuota: 'pagado', deporte: 'pagado', transporte: 'pendiente', comedor: 'pendiente' }),
      factura('mateo-ago', 'mateo', 'Agosto 2026', '2026-08-10', todos('pagado')),
      factura('sofia-oct', 'sofia', 'Octubre 2026', '2026-10-10', { cuota: 'pendiente', comedor: 'pendiente' }),
    ],
    // estado de pago: 'aprobado' | 'pendiente' (pendiente de verificación) | 'rechazado'
    pagos: [
      { id: 'p0', hijo: 'mateo', cargador: 'laura.ejemplo@ejemplo.test', fecha: '2026-08-06', estado: 'aprobado', operacion: '00004101', importeInformado: 10249660,
        items: ORDEN_CONCEPTOS.map(c => `mateo-ago-${c}`), comprobantes: [{ id: 'c0', nombre: 'transferencia-ago.pdf', bytes: 310000 }] },
      { id: 'p1', hijo: 'mateo', cargador: 'laura.ejemplo@ejemplo.test', fecha: '2026-09-05', estado: 'aprobado', operacion: '00004388', importeInformado: 6123055,
        items: ['mateo-sep-cuota', 'mateo-sep-deporte'], comprobantes: [{ id: 'c1', nombre: 'transferencia-sep.jpg', bytes: 1100000 }] },
      { id: 'p2', hijo: 'mateo', cargador: 'laura.ejemplo@ejemplo.test', fecha: '2026-10-03', estado: 'aprobado', operacion: '00004512', importeInformado: 6123055,
        items: ['mateo-oct-cuota', 'mateo-oct-deporte'], comprobantes: [{ id: 'c2', nombre: 'transferencia-oct.jpg', bytes: 1300000 }] },
      { id: 'p3', hijo: 'mateo', cargador: 'laura.ejemplo@ejemplo.test', fecha: '2026-10-07', estado: 'pendiente', operacion: '00012345', importeInformado: 1892545,
        items: ['mateo-sep-transporte'], comprobantes: [{ id: 'c3', nombre: 'transferencia-transporte.jpg', bytes: 950000 }] },
    ],
    inscripciones: {
      mateo: { deporte: 'Fútbol · Grupo A (ejemplo)', horario: 'Martes y jueves, 17:00 a 18:30', profesor: 'A. Ejemplo', transporte: 'Recorrido Norte (ejemplo)', comedor: 'Inscripto' },
      sofia: { deporte: null, horario: null, profesor: null, transporte: null, comedor: 'Inscripta' },
    },
    // Datos bancarios: no configurados. No existen CBU, alias ni titular utilizables.
    banco: { configurado: false },
    siguientePago: 4,
    siguienteComprobante: 4,
  }
}

// Ejemplos inocuos de archivos: solo metadatos; nunca se leen, envían ni persisten binarios.
export const ARCHIVOS_EJEMPLO = [
  { id: 'jpg', nombre: 'transferencia-1.jpg', tipo: 'image/jpeg', bytes: 1258291 },
  { id: 'pdf', nombre: 'comprobante-banco.pdf', tipo: 'application/pdf', bytes: 420000 },
  { id: 'heic', nombre: 'foto-recibo.heic', tipo: 'image/heic', bytes: 2202009 },
  { id: 'grande', nombre: 'resumen-banco.pdf', tipo: 'application/pdf', bytes: 7759462 },
]

export const LIMITE_ARCHIVO_BYTES = 5 * 1024 * 1024
export const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'application/pdf']
