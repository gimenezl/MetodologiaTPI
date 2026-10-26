// Identidades, identificadores y variables de Maestro del ciclo económico (EPT-119), derivadas de una clave del run.
//
// El backend de prueba (job Linux) y el simulador iOS (job macOS) corren en máquinas distintas y no comparten
// archivos: ambos derivan lo mismo a partir de `EPT_CICLO_CLAVE` (run + intento + SHA). Esa clave NO es un
// secreto: son datos públicos del run. Las cuentas son sintéticas, existen solo mientras vive el stack efímero y
// no dan acceso a nada real; por eso no se tratan como credenciales sensibles, aunque los logs las enmascaran.
import { createHmac } from 'node:crypto'

export const ESPERADO = Object.freeze({
  itemAprobado: { importe: '45250.75', centavos: 4_525_075 },
  itemRechazado: { importe: '38900.25', centavos: 3_890_025 },
  itemControl: { importe: '51000.00', centavos: 5_100_000 },
})
export const DEUDA_FINAL_CENTAVOS = ESPERADO.itemRechazado.centavos + ESPERADO.itemControl.centavos
export const MOTIVO_RECHAZO = 'Comprobante no corresponde al pago'

export function crearIdentidades(plataforma, clave = process.env.EPT_CICLO_CLAVE) {
  // Sin clave compartida cada proceso derivaría identidades distintas: se exige explícita.
  if (!clave) throw new Error('Falta EPT_CICLO_CLAVE: es la base común de los procesos del ciclo.')
  const hmac = etiqueta => createHmac('sha256', clave).update(etiqueta).digest('hex')
  const uuidDe = etiqueta => {
    const h = hmac(`id:${etiqueta}`)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
  }
  const credencialDe = rol => ({
    // El sufijo de la clave evita colisiones si se reutiliza un stack local entre corridas.
    email: `ciclo-${plataforma}-${rol}-${hmac(`mail:${plataforma}`).slice(0, 8)}@ept119.invalid`,
    password: `${createHmac('sha256', clave).update(`pw:${plataforma}:${rol}`).digest('base64url').slice(0, 40)}A1!`,
  })
  const ids = Object.fromEntries(['curso', 'mat', 'tarifa', 'fA', 'fB', 'fC', 'iA', 'iB', 'iC'].map(k => [k, uuidDe(k)]))
  return { hmac, uuidDe, credencialDe, ids }
}

/** 4525075 -> "45\.250,75": formato es-AR con el separador de miles escapado para usarlo como regex de Maestro. */
const formatoRegex = centavos => {
  const enteros = String(Math.floor(centavos / 100)).replace(/\B(?=(\d{3})+(?!\d))/gu, '\\.')
  return `${enteros},${String(centavos % 100).padStart(2, '0')}`
}

const ddmmaaaa = iso => iso.split('-').reverse().join('')

/** Variables que consumen los flujos Maestro del ciclo. */
export function entornoMaestro(plataforma, identidades, { desde, hasta }) {
  const { credencialDe, ids } = identidades
  const padre = credencialDe('padre')
  return {
    MAESTRO_CICLO_EMAIL: padre.email, MAESTRO_CICLO_PASSWORD: padre.password,
    MAESTRO_CICLO_ITEM_A: ids.iA, MAESTRO_CICLO_ITEM_B: ids.iB,
    MAESTRO_CICLO_DESDE: ddmmaaaa(desde), MAESTRO_CICLO_HASTA: ddmmaaaa(hasta),
    MAESTRO_CICLO_NUMERO_A: `OP-CICLO-${plataforma.toUpperCase()}-A`, MAESTRO_CICLO_NUMERO_B: `OP-CICLO-${plataforma.toUpperCase()}-B`,
    MAESTRO_CICLO_IMPORTE_A: ESPERADO.itemAprobado.importe.replace('.', ','), MAESTRO_CICLO_IMPORTE_B: ESPERADO.itemRechazado.importe.replace('.', ','),
    // Total que muestra la app (formato es-AR) como regex de Maestro.
    MAESTRO_CICLO_TOTAL_A: formatoRegex(ESPERADO.itemAprobado.centavos), MAESTRO_CICLO_TOTAL_B: formatoRegex(ESPERADO.itemRechazado.centavos),
  }
}
