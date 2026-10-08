// Registro compartido: ninguna suite nueva obtiene aprobación sin declarar cómo ejecutarla.
export const sqlSuites = [
  'accesos_servicios_rls.sql', 'alumnos_academicos_rls.sql',
  'asistencias_actores_bloqueo_rls.sql', 'asistencias_identidad_escritura_rls.sql',
  'asistencias_superficie_seguridad_rls.sql', 'asistencias_vinculo_academico_rls.sql',
  'asistencias_vinculo_deportivo_rls.sql', 'asistencias_vinculos_combinados_rls.sql',
  'comedor_rls.sql', 'credenciales_qr_rls.sql', 'cursos_rls.sql',
  'deportes_administracion_rls.sql', 'deportes_rls.sql', 'economico_esquema.sql',
  'economico_rls.sql', 'horarios_academicos_rls.sql', 'horarios_rls.sql',
  'inscripcion_hijos_rls.sql', 'inscripciones_administracion_rls.sql',
  'inscripciones_legadas_contraccion_rls.sql', 'materias_rls.sql', 'niveles_rls.sql',
  'perfiles_privacidad_rls.sql', 'profesores_rls.sql', 'reportes_oficiales_rls.sql',
  'tarifas_administracion_rls.sql', 'transporte_rls.sql',
  'usuarios_alta_atomica.sql', 'usuarios_permisos_rls.sql',
]
export const dbScripts = [
  'accesos_servicios_concurrencia.mjs', 'alumnos_academicos_concurrencia.mjs',
  'asistencias_revocaciones_concurrencia.mjs', 'comedor_concurrencia.mjs',
  'credenciales_qr_concurrencia.mjs', 'deportes_administracion_concurrencia.mjs',
  'deportes_concurrencia.mjs', 'economico_concurrencia.mjs', 'economico_storage.mjs',
  'facturacion.mjs', 'facturacion-concurrencia.mjs', 'facturacion-api.mjs', 'facturacion-progreso.mjs',
  'horarios_academicos_concurrencia.mjs', 'horarios_concurrencia.mjs', 'horarios_paridad.mjs',
  'inscripciones_administracion_concurrencia.mjs', 'inscripciones_legadas_concurrencia.mjs',
  'niveles_concurrencia.mjs', 'profesores_concurrencia.mjs', 'profesores_paridad.mjs',
  'profesores_postgrest.mjs', 'tarifas_administracion_concurrencia.mjs',
  'tarifas_autorizacion_concurrencia.mjs', 'tarifas_postgrest.mjs',
  'transporte_concurrencia.mjs', 'usuarios_bloqueo_auth.mjs',
  'usuarios_permisos_concurrencia.mjs', 'usuarios_reconciliacion.mjs', 'usuarios_vinculo_cuenta.mjs',
]
export const fullScripts = ['facturacion-mutaciones.mjs', 'correr-autenticadas.mjs']
export const supportFiles = ['_arnes-ept59.mjs', '_arnes-produccion.mjs',
  '_facturacion-fixture.mjs', '_sesion-psql.mjs']
// Procedimientos históricos, de carga, setup o producción: requieren una ejecución específica revisada.
export const excludedFiles = [
  'inscripciones_legadas_expansion_rls.sql', 'preflight_ept59.sql', 'preflight_ept66.sql',
  'reconciliacion_esquema_remoto.sql', 'reportes_benchmark_datos.sql', 'reportes_benchmark_limpieza.sql',
  'accesos_servicios_migracion_sobre_datos.mjs', 'asistencias_migracion_sobre_datos.mjs',
  'carga_limites_accesos.mjs', 'entorno-telefonos.mjs', 'harness_produccion_negativas.mjs',
  'harness_produccion.mjs', 'inscripciones_legadas_migracion_sobre_datos.mjs',
  'migracion_009_colisiones.mjs', 'preparar-facturacion-local.mjs',
  'profesores_migracion_a.mjs', 'profesores_reversion_a.mjs',
]
export function suiteProfile(file) {
  if (sqlSuites.includes(file) || dbScripts.includes(file) || file === 'tipos-generados.mjs') return 'db'
  if (fullScripts.includes(file) || supportFiles.includes(file)) return 'full'
  throw new Error(`Suite no ejecutable en CI general: ${file}; registrar ejecución segura antes de integrar`)
}
export function validateRegistry(files) {
  for (const file of files.filter(file => /\.(?:sql|mjs)$/u.test(file))) {
    if (!excludedFiles.includes(file)) suiteProfile(file)
  }
}
