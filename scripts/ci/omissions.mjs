// Aplicabilidad original, no permiso general para omitir fallos o fixtures ausentes.
const rules = [
  ['tarifas-ui.spec.ts', 'chromium', /^(?:en móvil los controles tienen alto táctil de 44 px|el formulario es usable a 375 px, sin desplazamiento horizontal)$/, 'Solo aplica a los perfiles móviles.'],
  ['inscripciones-administracion-ui.spec.ts', 'chromium', /^los objetivos táctiles miden al menos 44 px en móvil y no hay desborde$/, 'Solo aplica a los perfiles móviles.'],
  ...['comedor', 'transporte', 'inscripciones-administracion'].map(f => [`${f}-ui.spec.ts`, 'iphone-13-webkit', /^se opera completamente con el teclado$/, 'El perfil táctil de WebKit no expone teclado físico.']),
  ['tarifas-ui.spec.ts', 'iphone-13-webkit', /^Escape cierra sin enviar nada, devuelve el foco y el teclado no se escapa del diálogo$/, 'WebKit táctil no recorre con Tab.'],
  ['tarifas-ui.spec.ts', 'iphone-13-webkit', /^mientras guarda, Escape no cierra el diálogo$/, 'WebKit táctil no envía Escape como en escritorio.'],
  ['accesos-qr-ui.spec.ts', 'iphone-13-webkit', /^(?:la cámara activa se detiene con «Detener», al cambiar de modo y al ocultarse la pestaña|un clic duplicado en «Escanear con la cámara» no deja flujos huérfanos)$/, 'este navegador de pruebas no implementa MediaStream: la cámara activa se prueba en Chromium'],
  ['reportes-auth.spec.ts', /^chromium-(?:director|docente|estudiante|padre|personal)-bloqueado$/, /^el menú no ofrece «Reportes»$/, 'Un perfil bloqueado no llega al panel.'],
  ['usuarios-permisos-auth.spec.ts', 'chromium-directora', /^la regla del último Director efectivo responde 409 y no cambia nada$/, 'La base local tiene otro Director efectivo: la regla no es alcanzable con estos datos.'],
  ['credenciales-qr-auth.spec.ts', 'chromium-directora', /^sin clave de firma el servidor falla cerrado: no emite, no muestra QR, no verifica y no filtra la causa$/, 'requiere EPT_URL_SIN_CLAVE (servidor sin clave de firma)'],
  ['reportes-rendimiento-auth.spec.ts', 'chromium-directora', /^(?:alumnos-por-(?:curso|materia|deporte|horario|recorrido)|docentes-por-nivel): pantalla, cruce, CSV completo e impresión, cada uno por debajo de 60 s$/, 'Requiere EPT_BENCH=1: es una medición, no una prueba funcional.'],
]
export function declaredOmission(test) {
  const file = test.location.file.replaceAll('\\', '/').split('/').pop()
  const project = test.parent.project()?.name
  const reason = test.annotations?.find(a => a.type === 'skip')?.description
  return rules.some(([f, p, title, description]) => f === file && (p instanceof RegExp ? p.test(project) : p === project)
    && title.test(test.title) && reason === description) ? { file, project, title: test.title, reason } : undefined
}
