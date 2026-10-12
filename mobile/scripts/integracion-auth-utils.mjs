export const ETAPAS_INTEGRACION_AUTH = Object.freeze({
  estadoStack: 'validación del stack local',
  fixtures: 'preparación de fixtures sintéticos',
  roles: 'verificación de roles y metadatos',
  rlsPadres: 'aislamiento RLS de familias',
  rlsEstudiante: 'aislamiento RLS de estudiante',
  estadosAcceso: 'estados de acceso y autorización',
  refresh: 'renovación de sesión',
  expiracion: 'expiración y renovación de access token',
  identidadInicial: 'identidad inicial del access token',
  esperaExp: 'espera hasta la expiración declarada',
  sondeoExp: 'comprobación de identidad tras expirar',
  refreshExpirado: 'renovación y rol tras expirar',
  logoutExpirado: 'cierre global de sesión efímera',
  refreshRevocado: 'rechazo de renovación revocada',
  exportacion: 'exportación de credenciales efímeras',
})

export function mensajeFalloEtapaAuth(etapa) {
  const nombre = Object.hasOwn(ETAPAS_INTEGRACION_AUTH, etapa)
    ? ETAPAS_INTEGRACION_AUTH[etapa]
    : 'etapa no identificada'
  return `Falló la etapa «${nombre}» de la integración Auth/RLS local.`
}

export function validarLineaBaseExpiracion(expiracionEpoch, estadoIdentidad, ahoraMs = Date.now()) {
  if (!Number.isFinite(expiracionEpoch) || expiracionEpoch * 1_000 <= ahoraMs) {
    throw new Error('Auth no emitió un access token con expiración futura verificable.')
  }
  if (estadoIdentidad !== 200) {
    throw new Error('Auth no aceptó el access token recién emitido antes de esperar su expiración.')
  }
}

export async function esperarBearerExpirado(consultarEstado, {
  intentosMaximos = 20,
  intervaloMs = 1_000,
  pausar = ms => new Promise(resolve => setTimeout(resolve, ms)),
  registrarIntento,
} = {}) {
  const limiteIntentos = Math.min(20, Math.max(0, Math.floor(intentosMaximos)))
  for (let intento = 1; intento <= limiteIntentos; intento++) {
    const estado = await consultarEstado()
    if (typeof registrarIntento === 'function') {
      const telemetry = Object.freeze({ intento, estado: Number.isInteger(estado) ? estado : null })
      try {
        registrarIntento(telemetry)
      } catch {
        // Diagnostics must not alter the authorization check or expose callback failures.
      }
    }
    if (estado === 401 || estado === 403) return intento
    if (estado !== 200) throw new Error('El endpoint de identidad devolvió un estado inesperado al comprobar la expiración.')
    if (intento < limiteIntentos) await pausar(intervaloMs)
  }
  throw new Error('El endpoint de identidad no confirmó la expiración dentro del límite de comprobaciones.')
}
