// Archivos y dependencias explícitos: agregar un módulo exige registrar su prueba real.
export const families = {
  niveles: ['niveles-ui', 'niveles-auth', 'niveles'],
  cursos: ['cursos-ui', 'cursos-auth', 'cursos'],
  alumnos: ['alumnos-ui', 'alumnos-contraste', 'alumnos-correcciones', 'alumnos-auth', 'alumnos'],
  materias: ['materias-ui', 'materias-auth', 'materias', 'horarios-academicos-auth'],
  profesores: ['profesores-ui', 'profesores-auth', 'profesores', 'gestion-estudiantes-auth'],
  comedor: ['comedor-ui', 'comedor-auth', 'comedor'],
  deportes: ['deportes-ui', 'deportes-auth', 'deportes', 'administracion-deportes-ui', 'administracion-deportes-auth', 'administracion-deportes'],
  transporte: ['transporte-ui', 'transporte-auth'],
  horarios: ['horarios-ui', 'horarios-auth', 'horarios', 'horarios-academicos-auth'],
  inscripciones: ['inscripciones-administracion-ui', 'inscripciones-administracion-auth', 'inscripciones-administracion-e2e-auth', 'inscripciones-administracion-paginacion-auth', 'inscripciones-administracion', 'cupos-legadas-ui', 'cupos-legadas-auth'],
  hijos: ['hijos-ui', 'hijos-auth'],
  reportes: ['reportes-auth', 'reportes'],
  credenciales: ['credenciales-qr-ui', 'credenciales-qr-auth'],
  accesos: ['accesos-qr-ui', 'accesos-qr-auth', 'accesos-qr'],
  asistencias: ['asistencias-vinculos-ui', 'asistencias-vinculos-auth'],
  tarifas: ['tarifas-ui', 'tarifas-auth'],
  usuarios: ['usuarios-auth', 'usuarios-permisos-auth'],
}
export const aliases = { 'asignaciones-materias': 'materias', 'mis-asignaciones': 'profesores',
  'horarios-academicos': 'horarios', cupos: 'inscripciones', legajos: 'usuarios',
  'mi-legajo': 'alumnos', 'credenciales-hijos': 'credenciales', 'mi-credencial': 'credenciales',
  'credenciales-qr': 'credenciales', 'accesos-servicios': 'accesos' }
Object.assign(aliases, { 'accesos-qr': 'accesos', 'asistencias-vinculos': 'asistencias',
  'deportes-administracion': 'deportes', 'inscripciones-legadas': 'inscripciones',
  'inscripciones-administracion': 'inscripciones', 'gestion-usuarios': 'usuarios',
  'usuarios-admin': 'usuarios', 'usuarios-permisos': 'usuarios', 'vinculo-cuenta': 'usuarios',
  actividades: 'horarios' })
export const coreTitles = {
  chromium: 'muestra el catálogo ordenado con estados y protección institucional',
  'chromium-directora': 'sin sesión, cada endpoint nuevo responde 401',
  'chromium-personal': 'cada endpoint nuevo responde 403 y no cambia nada',
  'chromium-director-bloqueado': 'la API y la base le niegan todo aunque el JWT siga vigente',
}
export const fullProjects = ['chromium', 'pixel-5-chromium', 'iphone-13-webkit',
  'chromium-directora', 'chromium-estudiante', 'chromium-estudiante-inactivo',
  'chromium-estudiante-ajeno', 'chromium-docente', 'chromium-padre', 'chromium-padre-segundo',
  'chromium-personal', 'chromium-sin-perfil', ...['director', 'docente', 'estudiante', 'padre', 'personal'].map(r => `chromium-${r}-bloqueado`)]
export const uiFiles = names => [...new Set(names.flatMap(name => {
  if (name === 'core') return []
  if (!families[name]) throw new Error(`Familia UI sin contrato: ${name}`)
  return families[name].map(file => `${file}.spec.ts`)
}))]
export function validateUiRegistry(files, pure) {
  const registered = new Set([...uiFiles(Object.keys(families)), ...pure.map(f => `${f}.spec.ts`),
    'auth.setup.ts', 'redireccion-login.spec.ts', 'e2e.spec.ts', 'responsive-regresion.spec.ts',
    'niveles-responsive.spec.ts', 'captura.spec.ts', 'reportes-rendimiento-auth.spec.ts'])
  for (const file of files.filter(f => /(?:\.spec|\.setup)\.ts$/u.test(f))) {
    if (!registered.has(file)) throw new Error(`Prueba UI no registrada: ${file}`)
  }
}
