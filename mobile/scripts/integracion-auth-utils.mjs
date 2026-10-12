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
} = {}) {
  for (let intento = 1; intento <= intentosMaximos; intento++) {
    const estado = await consultarEstado()
    if (estado === 401) return intento
    if (estado !== 200) throw new Error('El endpoint de identidad devolvió un estado inesperado al comprobar la expiración.')
    if (intento < intentosMaximos) await pausar(intervaloMs)
  }
  throw new Error('El endpoint de identidad no confirmó la expiración dentro del límite de comprobaciones.')
}
