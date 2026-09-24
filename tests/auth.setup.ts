/* eslint-disable @typescript-eslint/no-explicit-any */
import { test as setup, expect, request as crearContexto } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Identidades de prueba para los flujos autenticados de EPT-8, EPT-55 y EPT-9.
 *
 * Corre únicamente contra el stack local descartable de Supabase:
 * `playwright.config.ts` incluye este proyecto solo cuando `EPT_SUPABASE_LOCAL=1`.
 * Usa la clave de servicio local de `.env.local`, que está en `.gitignore`, y
 * nunca toca un proyecto remoto.
 *
 * Todo lo que crea es sintético: correos en un dominio reservado y DNI ficticios
 * del rango 99.9xx.xxx, por encima de cualquier documento emitido. Ninguno de
 * estos datos corresponde a una persona real. Se borra y se recrea en cada
 * corrida para que la suite sea determinista.
 */

export const DIRECTORA = {
  email: 'directora.prueba@ept.local',
  password: 'prueba-ept-8-directora',
  rol: 'DIRECTOR',
  etiqueta: 'DIRECTOR',
  dni: '99900001',
  nombre: 'Ana',
  apellido: 'Directora',
  legajo: null as string | null,
  archivoSesion: 'tests/.auth/directora.json',
}

export const ESTUDIANTE = {
  email: 'estudiante.prueba@ept.local',
  password: 'prueba-ept-8-estudiante',
  rol: 'ESTUDIANTE',
  etiqueta: 'ESTUDIANTE',
  dni: '99900002',
  nombre: 'Beto',
  apellido: 'Estudiante',
  legajo: 'LEG-PRUEBA-0002',
  archivoSesion: 'tests/.auth/estudiante.json',
}

export const ESTUDIANTE_AJENO = {
  email: 'estudiante.ajeno.prueba@ept.local',
  password: 'prueba-ept-9-ajeno',
  rol: 'ESTUDIANTE',
  etiqueta: 'ESTUDIANTE AJENO',
  dni: '99900003',
  nombre: 'Celeste',
  apellido: 'Ajena',
  legajo: 'LEG-PRUEBA-0003',
  archivoSesion: 'tests/.auth/estudiante-ajeno.json',
}

export const DOCENTE = {
  email: 'docente.prueba@ept.local',
  password: 'prueba-ept-9-docente',
  rol: 'DOCENTE',
  etiqueta: 'DOCENTE',
  dni: '99900004',
  nombre: 'Darío',
  apellido: 'Docente',
  legajo: null as string | null,
  archivoSesion: 'tests/.auth/docente.json',
}

export const PADRE = {
  email: 'padre.prueba@ept.local',
  password: 'prueba-ept-9-padre',
  rol: 'PADRE',
  etiqueta: 'PADRE',
  dni: '99900005',
  nombre: 'Pablo',
  apellido: 'Padre',
  legajo: null as string | null,
  archivoSesion: 'tests/.auth/padre.json',
}

export const PADRE_SEGUNDO = {
  email: 'padre.segundo.prueba@ept.local',
  password: 'prueba-ept-13-padre-segundo',
  rol: 'PADRE',
  etiqueta: 'PADRE SEGUNDO',
  dni: '99900010',
  nombre: 'Marcos',
  apellido: 'Segundo',
  legajo: null as string | null,
  archivoSesion: 'tests/.auth/padre-segundo.json',
}

export const HIJO_APTO = {
  email: 'hijo.apto.prueba@ept.local',
  password: 'prueba-ept-13-hijo-apto',
  rol: 'ESTUDIANTE',
  etiqueta: 'HIJO APTO',
  dni: '99900011',
  nombre: 'Lara',
  apellido: 'Vinculada',
  legajo: 'LEG-PRUEBA-0011',
  archivoSesion: 'tests/.auth/hijo-apto.json',
}

export const HIJO_CONCURRENTE = {
  email: 'hijo.concurrente.prueba@ept.local',
  password: 'prueba-ept-13-concurrencia',
  rol: 'ESTUDIANTE',
  etiqueta: 'HIJO CONCURRENTE',
  dni: '99900012',
  nombre: 'Nicolás',
  apellido: 'Vinculado',
  legajo: 'LEG-PRUEBA-0012',
  archivoSesion: 'tests/.auth/hijo-concurrente.json',
}

export const PERSONAL = {
  email: 'personal.prueba@ept.local',
  password: 'prueba-ept-9-personal',
  rol: 'PERSONAL',
  etiqueta: 'PERSONAL',
  dni: '99900006',
  nombre: 'Paula',
  apellido: 'Personal',
  legajo: null as string | null,
  archivoSesion: 'tests/.auth/personal.json',
}

/**
 * Identidad exclusiva de las pruebas de cierre de sesión (EPT-56).
 *
 * `signOut()` revoca las sesiones del usuario en Supabase, así que probar el
 * cierre con la directora compartida dejaría sin sesión a las pruebas de
 * Cursos, Niveles, Alumnos y Materias que corren después. Esta cuenta tiene el
 * mismo rol y no la usa ninguna otra prueba.
 */
export const DIRECTORA_CIERRE = {
  email: 'directora.cierre.prueba@ept.local',
  password: 'prueba-ept-56-cierre',
  rol: 'DIRECTOR',
  etiqueta: 'DIRECTOR CIERRE',
  dni: '99900007',
  nombre: 'Ana',
  apellido: 'Cierre',
  legajo: null as string | null,
  archivoSesion: 'tests/.auth/directora-cierre.json',
}

/**
 * Estudiante que nunca se activa académicamente (EPT-10).
 *
 * El trigger de la migración 008 le da un legajo académico INACTIVO al crear el
 * perfil, y la siembra de más abajo NO lo activa. Es el actor con el que se
 * prueba que un alumno inactivo no puede inscribirse al comedor.
 */
export const ESTUDIANTE_INACTIVO = {
  email: 'estudiante.inactivo.prueba@ept.local',
  password: 'prueba-ept-10-inactivo',
  rol: 'ESTUDIANTE',
  etiqueta: 'ESTUDIANTE INACTIVO',
  dni: '99900008',
  nombre: 'Ines',
  apellido: 'Inactiva',
  legajo: null as string | null,
  archivoSesion: 'tests/.auth/estudiante-inactivo.json',
}

/**
 * Identidad exclusiva de las pruebas de cierre de sesión del comedor (EPT-10).
 *
 * Misma razón que `DIRECTORA_CIERRE`: `signOut()` revoca las sesiones del
 * usuario en Supabase, así que probar el cierre con el estudiante compartido
 * dejaría sin sesión a las pruebas de Alumnos y de Comedor que corren después.
 */
export const ESTUDIANTE_CIERRE = {
  email: 'estudiante.cierre.prueba@ept.local',
  password: 'prueba-ept-10-cierre',
  rol: 'ESTUDIANTE',
  etiqueta: 'ESTUDIANTE CIERRE',
  dni: '99900009',
  nombre: 'Ema',
  apellido: 'Cierre',
  legajo: 'LEG-PRUEBA-0009',
  archivoSesion: 'tests/.auth/estudiante-cierre.json',
}

/** Cuenta autenticada sin perfil: prueba el actor "usuario sin perfil". */
export const SIN_PERFIL = {
  etiqueta: 'SIN PERFIL',
  email: 'sin.perfil.prueba@ept.local',
  password: 'prueba-ept-9-sin-perfil',
  archivoSesion: 'tests/.auth/sin-perfil.json',
}

const IDENTIDADES = [
  DIRECTORA,
  DIRECTORA_CIERRE,
  ESTUDIANTE,
  ESTUDIANTE_AJENO,
  DOCENTE,
  PADRE,
  PADRE_SEGUNDO,
  HIJO_APTO,
  HIJO_CONCURRENTE,
  PERSONAL,
  ESTUDIANTE_INACTIVO,
  ESTUDIANTE_CIERRE,
]
const CORREOS_DE_PRUEBA = [...IDENTIDADES.map((i) => i.email), SIN_PERFIL.email]

/** Cursos de partida deterministas, para que las aserciones no dependan del orden. */
export const CURSOS_SEMILLA = [
  { denominacion: '1er Grado', division: 'A', nivel: 'PRIMARIO', activo: true },
  { denominacion: '1er Grado', division: 'B', nivel: 'PRIMARIO', activo: false },
  { denominacion: 'Sala de 5', division: 'A', nivel: 'INICIAL', activo: true },
]

/**
 * Curso al que se matricula a los estudiantes de prueba durante la siembra.
 *
 * Deliberadamente NO es «1er Grado A»: la suite de Cursos inactiva ese curso
 * por nombre, y desde EPT-9 un curso con estudiantes matriculados no se puede
 * inactivar. Dejarlo libre evita que una siembra de esta historia rompa una
 * garantía de la anterior.
 */
export const CURSO_INICIAL_ALUMNOS = { denominacion: 'Sala de 5', division: 'A' }

/** Se completa en la primera etapa y lo consumen las etapas siguientes. */
export const perfilesCreados = new Map<string, string>()

const BASE_URL = 'http://localhost:3000'

function clienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. ' +
        'Levantá el stack local con `supabase start` y generá .env.local.'
    )
  }
  let hostname: string
  try {
    hostname = new URL(url).hostname.replace(/^\[|\]$/g, '')
  } catch {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL no es una URL válida para el stack local.')
  }
  if (!new Set(['localhost', '127.0.0.1', '::1']).has(hostname)) {
    throw new Error(
      `Se esperaba una base local y se encontró ${url}. Este setup nunca debe correr contra un proyecto remoto.`
    )
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

/**
 * Vacía el modelo académico en una única transacción.
 *
 * Borrar matrículas y legajos en dos peticiones separadas es imposible: cada una
 * confirma por su cuenta y el trigger diferido rechaza el estado intermedio
 * (un alumno activo sin matrícula, o uno inactivo con una). Eso es exactamente
 * lo que la invariante debe impedir, así que la limpieza usa una transacción
 * real contra el contenedor local descartable.
 *
 * Desde EPT-10 empieza por `inscripciones_servicios`: sus claves foráneas hacia
 * `alumnos` son ON DELETE RESTRICT, así que sin ese borrado previo no se podría
 * vaciar el modelo académico. El catálogo `servicios_escolares` no se toca: el
 * comedor lo siembra la migración 013 y es parte del esquema, no de la siembra
 * de pruebas.
 *
 * Desde EPT-56 también limpia las asignaciones Curso–Materia y las materias que
 * crean las pruebas. Sus claves foráneas son ON DELETE RESTRICT, de modo que sin
 * esta limpieza la siembra siguiente no podría borrar los cursos ni los perfiles
 * docentes de prueba. Las dos materias sembradas por la migración 001 se
 * conservan, igual que los deportes y los talleres.
 *
 * Desde EPT-11 empieza además por `inscripciones_deportivas` y
 * `grupos_deportivos`: sus claves foráneas hacia `alumnos` y hacia el perfil
 * del profesor son ON DELETE RESTRICT. El catálogo `deportes` no se toca: lo
 * siembra la migración 014.
 */
function vaciarModeloAcademico() {
  const contenedor =
    process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

  execFileSync(
    'docker',
    ['exec', '-i', contenedor, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres',
     '-v', 'ON_ERROR_STOP=1'],
    {
      input: `
        BEGIN;
        DELETE FROM public.grupos_deportivos_horarios;
        DELETE FROM public.inscripciones_deportivas;
        DELETE FROM public.grupos_deportivos;
        DELETE FROM public.inscripciones_servicios;
        DELETE FROM public.matriculas;
        DELETE FROM public.alumnos;
        DELETE FROM public.materias_cursos;
        DELETE FROM public.actividades a
        WHERE a.tipo = 'CURRICULAR'
          AND a.nombre NOT IN ('Laboratorio de Ciencias', 'Inglés Avanzado')
          AND NOT EXISTS (
            SELECT 1 FROM public.inscripciones i WHERE i.actividad_id = a.id
          );
        UPDATE public.actividades SET activo = TRUE WHERE NOT activo;
        COMMIT;
      `,
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  )
}

setup('crear identidades y datos de prueba', async () => {
  const admin = clienteAdmin() as any

  // 1. Limpiar la corrida anterior. El orden respeta las claves foráneas
  // restrictivas: primero el historial y el legajo académico, después la
  // persona. Esta limpieza usa exclusivamente el stack local descartable; no
  // representa ninguna operación disponible en la aplicación.
  vaciarModeloAcademico()

  // Los legajos que crean las pruebas del DIRECTOR no tienen cuenta de acceso,
  // así que el recorrido por usuarios de Auth no los alcanza.
  const { error: errorHuerfanos } = await admin
    .from('perfiles')
    .delete()
    .is('user_id', null)
  if (errorHuerfanos) {
    throw new Error(`No se pudieron limpiar los legajos sin cuenta: ${errorHuerfanos.message}`)
  }

  const { data: existentes } = await admin.auth.admin.listUsers()
  for (const usuario of existentes?.users ?? []) {
    if (CORREOS_DE_PRUEBA.includes(usuario.email ?? '')) {
      const { error } = await admin.from('perfiles').delete().eq('user_id', usuario.id)
      if (error) {
        throw new Error(
          `No se pudo limpiar el perfil de ${usuario.email}: ${error.message}`
        )
      }
      await admin.auth.admin.deleteUser(usuario.id)
    }
  }

  // 2. Crear cada identidad con su perfil y su rol. El trigger de la migración
  // 008 le da a cada perfil ESTUDIANTE un legajo académico INACTIVO.
  perfilesCreados.clear()
  for (const identidad of IDENTIDADES) {
    const { data: creado, error: errorAlta } = await admin.auth.admin.createUser({
      email: identidad.email,
      password: identidad.password,
      email_confirm: true,
    })
    if (errorAlta || !creado?.user) {
      throw new Error(`No se pudo crear ${identidad.email}: ${errorAlta?.message}`)
    }

    const { data: rol } = await admin
      .from('roles')
      .select('id')
      .eq('nombre', identidad.rol)
      .single()
    if (!rol) throw new Error(`No existe el rol ${identidad.rol}`)

    const { data: perfil, error: errorPerfil } = await admin
      .from('perfiles')
      .insert({
        user_id: creado.user.id,
        rol_id: rol.id,
        nombre: identidad.nombre,
        apellido: identidad.apellido,
        dni: identidad.dni,
        legajo_nro: identidad.legajo,
      })
      .select('id')
      .single()
    if (errorPerfil || !perfil) {
      throw new Error(
        `No se pudo crear el perfil de ${identidad.email}: ${errorPerfil?.message}`
      )
    }
    perfilesCreados.set(identidad.email, perfil.id as string)
  }

  const padreId = perfilesCreados.get(PADRE.email)
  const hijoId = perfilesCreados.get(HIJO_APTO.email)
  const concurrenteId = perfilesCreados.get(HIJO_CONCURRENTE.email)
  if (!padreId || !hijoId || !concurrenteId) throw new Error('Faltan perfiles para el vínculo familiar de prueba.')
  const { error: errorVinculo } = await admin.from('padres_hijos').insert([
    { padre_id: padreId, hijo_id: hijoId },
    { padre_id: padreId, hijo_id: concurrenteId },
  ])
  if (errorVinculo) throw new Error(`No se pudo crear el vínculo familiar local: ${errorVinculo.message}`)

  // Cuenta sin perfil: existe en Auth y no tiene fila en `perfiles`.
  const { data: sinPerfil, error: errorSinPerfil } = await admin.auth.admin.createUser({
    email: SIN_PERFIL.email,
    password: SIN_PERFIL.password,
    email_confirm: true,
  })
  if (errorSinPerfil || !sinPerfil?.user) {
    throw new Error(`No se pudo crear ${SIN_PERFIL.email}: ${errorSinPerfil?.message}`)
  }

  // 3. Dejar el catálogo y los cursos en un estado conocido.
  await admin.from('cursos').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  const { error: errorLimpiarNiveles } = await admin
    .from('niveles')
    .delete()
    .eq('es_institucional', false)
  if (errorLimpiarNiveles) {
    throw new Error(`No se pudieron limpiar los niveles de prueba: ${errorLimpiarNiveles.message}`)
  }
  const { error: errorRestaurarNiveles } = await admin
    .from('niveles')
    .update({ activo: true })
    .eq('es_institucional', true)
  if (errorRestaurarNiveles) {
    throw new Error(
      `No se pudieron restaurar los niveles institucionales: ${errorRestaurarNiveles.message}`
    )
  }
  const { data: niveles } = await admin.from('niveles').select('id, nombre')
  const porNombre = new Map<string, number>(
    (niveles ?? []).map((n: any) => [String(n.nombre).trim().toUpperCase(), n.id as number])
  )
  for (const curso of CURSOS_SEMILLA) {
    const nivelId = porNombre.get(curso.nivel)
    if (!nivelId) throw new Error(`No existe el nivel ${curso.nivel}`)
    const { error } = await admin.from('cursos').insert({
      nivel_id: nivelId,
      denominacion: curso.denominacion,
      division: curso.division,
      activo: curso.activo,
    })
    if (error) throw new Error(`No se pudo sembrar ${curso.denominacion} ${curso.division}: ${error.message}`)
  }
})

// La etiqueta distingue a los dos estudiantes, que comparten rol.
for (const identidad of [...IDENTIDADES, SIN_PERFIL]) {
  setup(`iniciar sesión como ${identidad.etiqueta}`, async ({ page }) => {
    // Se inicia sesión por el formulario real, no por atajo, para que las
    // cookies queden escritas exactamente como en producción.
    await page.goto('/login')
    await page.getByLabel('Email institucional').fill(identidad.email)
    await page.getByLabel('Contraseña').fill(identidad.password)
    await page.getByRole('button', { name: /ingresar|iniciar/i }).click()

    await page.waitForURL(/\/dashboard/, { timeout: 20000 })

    fs.mkdirSync(path.dirname(identidad.archivoSesion), { recursive: true })
    await page.context().storageState({ path: identidad.archivoSesion })

    expect(fs.existsSync(identidad.archivoSesion)).toBe(true)
  })
}

/**
 * Deja ACTIVOS y con matrícula vigente a los estudiantes que lo necesitan.
 *
 * `ESTUDIANTE_INACTIVO` queda deliberadamente fuera: su legajo académico se
 * conserva INACTIVO para probar la denegación del comedor (EPT-10).
 *
 * Usa la API real con la sesión de la directora, no la clave de servicio: la
 * activación es una operación atómica de PostgreSQL y sembrarla a mano
 * escribiendo en las tablas dejaría un estado que la aplicación nunca produce.
 */
setup('sembrar la situación académica de los estudiantes', async () => {
  const admin = clienteAdmin() as any

  const { data: curso } = await admin
    .from('cursos')
    .select('id')
    .eq('denominacion', CURSO_INICIAL_ALUMNOS.denominacion)
    .eq('division', CURSO_INICIAL_ALUMNOS.division)
    .single()
  if (!curso) {
    throw new Error('No se encontró el curso de partida para la siembra académica.')
  }

  const contexto = await crearContexto.newContext({
    baseURL: BASE_URL,
    storageState: DIRECTORA.archivoSesion,
  })

  try {
    for (const identidad of [ESTUDIANTE, ESTUDIANTE_AJENO, ESTUDIANTE_CIERRE]) {
      const perfilId = perfilesCreados.get(identidad.email)
      if (!perfilId) {
        throw new Error(`No se registró el perfil de ${identidad.email} en la primera etapa.`)
      }

      const respuesta = await contexto.fetch(`/api/alumnos/${perfilId}`, {
        method: 'PATCH',
        data: { accion: 'reactivar', curso_id: curso.id },
      })

      if (respuesta.status() !== 200) {
        throw new Error(
          `No se pudo activar el legajo de ${identidad.email}: ` +
            `${respuesta.status()} ${await respuesta.text()}`
        )
      }
    }
  } finally {
    await contexto.dispose()
  }
})
