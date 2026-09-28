/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  expect,
  request as crearContexto,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { capturarSinHerramientas } from './_captura'
import { exigirMensajeSinDetalleTecnico, exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Administración de deportes y grupos con sesiones reales (EPT-61).
 *
 * No hay mocks: cada petición atraviesa cookies SSR, `auth.getUser()`, el control
 * de rol del servidor, los envoltorios RPC y PostgreSQL. Los rechazos por nombre
 * repetido, deporte con grupos activos, grupo con inscripciones, cupo por debajo
 * de la ocupación y profesor inactivo los produce la base, no una comprobación
 * previa de la aplicación.
 *
 * La clave de servicio local y `psql` se usan solo para PREPARAR y LIMPIAR datos
 * (docentes de prueba, inscripciones de las identidades de prueba, filas con el
 * prefijo «E2E Adm»); nunca participan de una operación que se esté verificando.
 * Todo lo que crean estas pruebas lleva ese prefijo y se retira antes y después.
 *
 * El archivo se omite salvo que el operador habilite la base local descartable.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const SESION = {
  directora: 'tests/.auth/directora.json',
  estudiante: 'tests/.auth/estudiante.json',
  docente: 'tests/.auth/docente.json',
  padre: 'tests/.auth/padre.json',
  personal: 'tests/.auth/personal.json',
  sinPerfil: 'tests/.auth/sin-perfil.json',
}

const BASE_URL = 'http://localhost:3000'
const CAPTURAR = process.env.EPT_CAPTURAS === '1'
const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

const DNI = {
  estudiante: '99900002',
  ajeno: '99900003',
  docente: '99900004',
}

/** Docentes propios de esta suite: no dependen del nombre del docente compartido. */
const DOC_ACTIVO = 'e6100000-0000-4000-8000-000000000001'
const DOC_INACTIVO = 'e6100000-0000-4000-8000-000000000002'
const DNI_DOC_ACTIVO = '95961001'
const DNI_DOC_INACTIVO = '95961002'
const INEXISTENTE = '00000000-0000-4000-8000-000000000000'

const MENSAJE = {
  soloDireccionCatalogo: 'Solo la dirección puede administrar el catálogo de deportes.',
  soloDireccionGrupos: 'Solo la dirección puede administrar los grupos deportivos.',
  deporteRepetido: 'Ya existe un deporte con ese nombre.',
  renombrarConGrupos:
    'Este deporte ya tiene grupos, así que solo podés cambiar las mayúsculas y minúsculas del nombre, por ejemplo «Fútbol» por «FÚTBOL». Para usar otro nombre, creá un deporte nuevo.',
  grupoRepetido: 'Ya existe un grupo con ese nombre para ese deporte y nivel.',
  noDocente: 'La persona seleccionada no tiene el rol DOCENTE.',
  profesorInexistente: 'El profesor seleccionado no existe.',
  profesorInactivoEdicion:
    'El profesor está inactivo y no puede quedar a cargo de un grupo deportivo. Elegí otro profesor o reactivá su ficha en Profesores.',
  profesorInactivoReactivar:
    'El profesor responsable está inactivo. Editá el grupo para asignar otro profesor, o reactivá su ficha en Profesores, antes de reactivar el grupo.',
  deporteInactivoReactivar:
    'El deporte de este grupo está inactivo. Reactivá el deporte antes de reactivar el grupo.',
  bloqueo: 'Tu acceso está bloqueado. Comunicate con Dirección.',
}

const contextosActivos: APIRequestContext[] = []

test.afterEach(async () => {
  await Promise.all(contextosActivos.splice(0).map((contexto) => contexto.dispose()))
})

// ----------------------------------------------------------------
// Preparación y limpieza (solo base local)
// ----------------------------------------------------------------

function sql(sentencia: string) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

function clienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const anfitrion = new URL(url).hostname.replace(/^\[|\]$/g, '')
  if (!['127.0.0.1', 'localhost', '::1'].includes(anfitrion)) {
    throw new Error(`Se esperaba una base local y se encontró ${anfitrion}.`)
  }
  return createClient(url, clave, { auth: { autoRefreshToken: false, persistSession: false } }) as any
}

async function perfilPorDni(dni: string): Promise<string> {
  const { data, error } = await clienteAdmin().from('perfiles').select('id').eq('dni', dni).single()
  if (error || !data) throw new Error(`No se encontró el perfil de prueba ${dni}`)
  return data.id as string
}

/** Retira todo lo que crea esta suite. El historial de profesores es de solo agregado: solo esta limpieza local lo deshabilita, dentro de la transacción. */
function limpiar() {
  sql(`
    BEGIN;
    DELETE FROM public.inscripciones_deportivas
      WHERE grupo_id IN (SELECT g.id FROM public.grupos_deportivos g
                         JOIN public.deportes d ON d.id = g.deporte_id
                         WHERE d.nombre ILIKE 'e2e adm%');
    DELETE FROM public.grupos_deportivos_horarios
      WHERE grupo_id IN (SELECT g.id FROM public.grupos_deportivos g
                         JOIN public.deportes d ON d.id = g.deporte_id
                         WHERE d.nombre ILIKE 'e2e adm%');
    DELETE FROM public.grupos_deportivos
      WHERE deporte_id IN (SELECT id FROM public.deportes WHERE nombre ILIKE 'e2e adm%');
    DELETE FROM public.deportes WHERE nombre ILIKE 'e2e adm%';
    ALTER TABLE public.profesores_estados_historial DISABLE TRIGGER impedir_modificar_historial_profesor;
    DELETE FROM public.profesores_estados_historial WHERE profesor_id IN ('${DOC_ACTIVO}', '${DOC_INACTIVO}');
    ALTER TABLE public.profesores_estados_historial ENABLE TRIGGER impedir_modificar_historial_profesor;
    DELETE FROM public.profesores WHERE perfil_id IN ('${DOC_ACTIVO}', '${DOC_INACTIVO}');
    DELETE FROM public.perfiles WHERE id IN ('${DOC_ACTIVO}', '${DOC_INACTIVO}');
    COMMIT;
  `)
}

function preparar() {
  limpiar()
  sql(`
    BEGIN;
    INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
    SELECT v.id, NULL, r.id, 'Prueba', v.apellido, v.dni, v.legajo
    FROM (VALUES
      ('${DOC_ACTIVO}'::uuid, 'Adm Activo', '${DNI_DOC_ACTIVO}', 'LEG-E2E-EPT61-1'),
      ('${DOC_INACTIVO}'::uuid, 'Adm Inactivo', '${DNI_DOC_INACTIVO}', 'LEG-E2E-EPT61-2')
    ) AS v(id, apellido, dni, legajo)
    JOIN public.roles r ON r.nombre = 'DOCENTE';
    UPDATE public.profesores SET estado = 'INACTIVO' WHERE perfil_id = '${DOC_INACTIVO}';
    COMMIT;
  `)
}

function estadoFicha(perfilId: string, estado: 'ACTIVO' | 'INACTIVO') {
  sql(`UPDATE public.profesores SET estado = '${estado}' WHERE perfil_id = '${perfilId}';`)
}

async function limpiarInscripciones(dni: string) {
  const alumno = await perfilPorDni(dni)
  const { error } = await clienteAdmin().from('inscripciones_deportivas').delete().eq('alumno_id', alumno)
  if (error) throw new Error(`No se pudieron limpiar las inscripciones de prueba: ${error.message}`)
}

type EjecutarPeticion = Parameters<APIRequestContext['fetch']>

/** Espera a que el setup autenticado deje disponible la sesión real. */
async function pedirConSesion(
  archivoSesion: string,
  url: EjecutarPeticion[0],
  opciones?: EjecutarPeticion[1]
): Promise<APIResponse> {
  const limite = Date.now() + 20_000
  let ultimoEstado: number | null = null
  do {
    if (fs.existsSync(archivoSesion)) {
      const contexto = await crearContexto.newContext({ baseURL: BASE_URL, storageState: archivoSesion })
      const respuesta = await contexto.fetch(url, opciones)
      ultimoEstado = respuesta.status()
      if (ultimoEstado !== 401) {
        contextosActivos.push(contexto)
        return respuesta
      }
      await contexto.dispose()
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  } while (Date.now() < limite)
  throw new Error(`La sesión ${archivoSesion} no quedó disponible (último estado ${ultimoEstado}).`)
}

async function esperar(respuesta: APIResponse, estado: number, mensaje?: string) {
  expect(respuesta.status(), await respuesta.text()).toBe(estado)
  const cuerpo = await respuesta.json()
  if (mensaje) expect(cuerpo.error).toBe(mensaje)
  if (cuerpo.error) exigirMensajeSinDetalleTecnico('respuesta de la API', String(cuerpo.error))
  return cuerpo
}

// ----------------------------------------------------------------
// Operaciones por la API real, con la sesión de la dirección
// ----------------------------------------------------------------

const directora = (url: string, opciones?: EjecutarPeticion[1]) =>
  pedirConSesion(SESION.directora, url, opciones)

const crearDeporte = (nombre: string) =>
  directora('/api/deportes', { method: 'POST', data: { nombre } })

const patchDeporte = (id: string, data: unknown) =>
  directora(`/api/deportes/${id}`, { method: 'PATCH', data })

const patchGrupo = (id: string, data: unknown) =>
  directora(`/api/deportes/grupos/${id}`, { method: 'PATCH', data })

async function nivelPorNombre(nombre: string): Promise<number> {
  const { data } = await clienteAdmin().from('niveles').select('id').eq('nombre', nombre).single()
  return data.id as number
}

async function deporteNuevo(nombre: string): Promise<string> {
  const cuerpo = await esperar(await crearDeporte(nombre), 201)
  return cuerpo.deporte.id as string
}

/** Crea un grupo de INICIAL (el nivel de los alumnos de prueba) en un deporte de la suite. */
async function grupoNuevo(
  deporteId: string,
  nombre: string,
  opciones: { cupo?: number; profesor?: string } = {}
): Promise<string> {
  const respuesta = await directora('/api/deportes/grupos', {
    method: 'POST',
    data: {
      deporte_id: deporteId,
      nivel_id: await nivelPorNombre('INICIAL'),
      nombre,
      cupo: opciones.cupo ?? 5,
      profesor_id: opciones.profesor ?? DOC_ACTIVO,
    },
  })
  const cuerpo = await esperar(respuesta, 201)
  return cuerpo.grupo.id as string
}

async function franjaDomingo(grupoId: string) {
  await esperar(
    await directora(`/api/deportes/grupos/${grupoId}/horarios`, {
      method: 'POST',
      data: { dia_semana: 7, hora_inicio: '18:00', hora_fin: '19:00' },
    }),
    201
  )
}

const inscribir = (sesion: string, grupoId: string) =>
  pedirConSesion(sesion, '/api/deportes/inscripciones', { method: 'POST', data: { grupo_id: grupoId } })

const cancelar = (sesion: string, inscripcionId: string) =>
  pedirConSesion(sesion, `/api/deportes/inscripciones/${inscripcionId}`, {
    method: 'PATCH',
    data: { accion: 'cancelar' },
  })

async function filaDeporte(id: string) {
  const { data } = await clienteAdmin().from('deportes').select('*').eq('id', id).single()
  return data as { nombre: string; activo: boolean }
}

async function filaGrupo(id: string) {
  const { data } = await clienteAdmin().from('grupos_deportivos').select('*').eq('id', id).single()
  return data as { nombre: string; cupo: number; profesor_id: string; activo: boolean }
}

// ----------------------------------------------------------------
// Utilidades de pantalla
// ----------------------------------------------------------------

async function capturar(page: Page, nombre: string, opciones: { paginaCompleta?: boolean } = {}) {
  if (!CAPTURAR) return
  const perfil = (page.viewportSize()?.width ?? 1280) < 640 ? 'movil' : 'escritorio'
  await capturarSinHerramientas(page, path.join('docs/evidence/EPT-61', `real-${perfil}-${nombre}.png`), opciones)
}

function aplicacion(page: Page) {
  return page.getByRole('main')
}

async function abrirDeportes(page: Page) {
  await page.goto('/dashboard/deportes')
  await expect(page.getByRole('heading', { name: 'Deportes', level: 1 })).toBeVisible()
}

function tarjetaDeporte(page: Page, nombre: string) {
  return page
    .getByRole('region', { name: 'Catálogo de deportes' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: nombre, exact: true }) })
}

function tarjetaGrupo(page: Page, nombre: string) {
  return page
    .getByRole('region', { name: 'Grupos deportivos' })
    .getByRole('listitem')
    .filter({ has: page.getByText(nombre, { exact: true }) })
}

async function sinScrollHorizontal(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  )
}

// ================================================================
// DIRECTOR: la API real, regla por regla
// ================================================================
test.describe.serial('DIRECTOR autenticado — administración de deportes (API)', () => {
  test.beforeAll(async () => {
    preparar()
    await limpiarInscripciones(DNI.estudiante)
    await limpiarInscripciones(DNI.ajeno)
  })

  test.afterAll(async () => {
    limpiar()
    await limpiarInscripciones(DNI.estudiante)
    await limpiarInscripciones(DNI.ajeno)
  })

  let deporteUno = ''
  let grupoA = ''
  let grupoB = ''

  test('el alta de un deporte persiste y valida nombre, cuerpo y campos ajenos', async () => {
    const cuerpo = await esperar(await crearDeporte('  E2E Adm Uno  '), 201)
    deporteUno = cuerpo.deporte.id
    expect(cuerpo.deporte).toMatchObject({ nombre: 'E2E Adm Uno', activo: true })
    expect(await filaDeporte(deporteUno)).toMatchObject({ nombre: 'E2E Adm Uno', activo: true })

    const repetido = await esperar(await crearDeporte('E2E ADM UNO'), 409, MENSAJE.deporteRepetido)
    expect(repetido.campo).toBe('nombre')

    await esperar(await crearDeporte('   '), 400, 'El nombre del deporte es requerido')
    await esperar(await crearDeporte('x'.repeat(101)), 400, 'El nombre del deporte no puede superar los 100 caracteres')
    await esperar(
      await directora('/api/deportes', { method: 'POST', data: { nombre: 5 } }),
      400
    )
    // El profesor es obligatorio por grupo, no por deporte: el catálogo no lo acepta.
    await esperar(
      await directora('/api/deportes', { method: 'POST', data: { nombre: 'E2E Adm Otro', profesor_id: DOC_ACTIVO } }),
      400,
      'La petición contiene campos no permitidos'
    )
    await esperar(
      await directora('/api/deportes', {
        method: 'POST',
        data: Buffer.from('{'),
        headers: { 'Content-Type': 'application/json' },
      }),
      400,
      'Cuerpo inválido'
    )
  })

  test('dos altas simultáneas del mismo nombre confirman exactamente una', async () => {
    const [a, b] = await Promise.all([crearDeporte('E2E Adm Carrera'), crearDeporte('e2e adm carrera')])
    expect([a.status(), b.status()].sort()).toEqual([201, 409])
    const { count } = await clienteAdmin()
      .from('deportes')
      .select('id', { count: 'exact', head: true })
      .ilike('nombre', 'e2e adm carrera')
    expect(count).toBe(1)
  })

  test('un deporte sin grupos se renombra libremente, sin duplicar y de forma idempotente', async () => {
    await esperar(await crearDeporte('E2E Adm Libre'), 201)
    const libre = (await esperar(await crearDeporte('E2E Adm Libre Dos'), 201)).deporte.id
    await esperar(await patchDeporte(libre, { accion: 'renombrar', nombre: 'E2E Adm Renombrado' }), 200)
    expect((await filaDeporte(libre)).nombre).toBe('E2E Adm Renombrado')
    // Repetir el mismo nombre no es un error.
    await esperar(await patchDeporte(libre, { accion: 'renombrar', nombre: 'E2E Adm Renombrado' }), 200)
    await esperar(
      await patchDeporte(libre, { accion: 'renombrar', nombre: 'e2e adm uno' }),
      409,
      MENSAJE.deporteRepetido
    )
    await esperar(await patchDeporte(libre, { accion: 'renombrar', nombre: '  ' }), 400, 'El nombre del deporte es requerido')
  })

  test('con grupos, el deporte solo admite cambios de mayúsculas y minúsculas', async () => {
    grupoA = await grupoNuevo(deporteUno, 'E2E Adm Grupo A', { cupo: 3 })
    const rechazo = await esperar(
      await patchDeporte(deporteUno, { accion: 'renombrar', nombre: 'E2E Adm Uno Bis' }),
      409,
      MENSAJE.renombrarConGrupos
    )
    expect(rechazo.campo).toBe('nombre')
    expect((await filaDeporte(deporteUno)).nombre).toBe('E2E Adm Uno')

    await esperar(await patchDeporte(deporteUno, { accion: 'renombrar', nombre: 'E2E ADM UNO' }), 200)
    expect((await filaDeporte(deporteUno)).nombre).toBe('E2E ADM UNO')
    await esperar(await patchDeporte(deporteUno, { accion: 'renombrar', nombre: 'E2E Adm Uno' }), 200)
  })

  test('no se inactiva un deporte con grupos activos y el rechazo nombra el grupo', async () => {
    const rechazo = await esperar(
      await patchDeporte(deporteUno, { accion: 'cambiar_estado', activo: false }),
      409,
      'No se puede inactivar el deporte porque tiene 1 grupo activo: «E2E Adm Grupo A» (Inicial). Inactivá esos grupos primero.'
    )
    expect(rechazo.campo).toBe('activo')
    expect((await filaDeporte(deporteUno)).activo).toBe(true)

    // Con varios grupos, cuenta y nombra.
    grupoB = await grupoNuevo(deporteUno, 'E2E Adm Grupo B')
    const dos = await esperar(await patchDeporte(deporteUno, { accion: 'cambiar_estado', activo: false }), 409)
    expect(dos.error).toContain('tiene 2 grupos activos')
    expect(dos.error).toContain('«E2E Adm Grupo A»')
    expect(dos.error).toContain('«E2E Adm Grupo B»')
    await esperar(await patchGrupo(grupoB, { accion: 'cambiar_estado', activo: false }), 200)
  })

  test('la edición valida nombre, cupo, profesor y no acepta deporte ni nivel', async () => {
    await esperar(
      await patchGrupo(grupoA, { accion: 'editar', nombre: 'E2E Adm Grupo A2', cupo: 4, profesor_id: DOC_ACTIVO }),
      200
    )
    expect(await filaGrupo(grupoA)).toMatchObject({ nombre: 'E2E Adm Grupo A2', cupo: 4, profesor_id: DOC_ACTIVO })
    // Repetir los mismos datos es idempotente.
    await esperar(
      await patchGrupo(grupoA, { accion: 'editar', nombre: 'E2E Adm Grupo A2', cupo: 4, profesor_id: DOC_ACTIVO }),
      200
    )
    // Nombre repetido en el mismo deporte y nivel: lo decide la base.
    const rep = await esperar(
      await patchGrupo(grupoB, { accion: 'editar', nombre: 'E2E ADM GRUPO A2', cupo: 4, profesor_id: DOC_ACTIVO }),
      409,
      MENSAJE.grupoRepetido
    )
    expect(rep.campo).toBe('nombre')

    const editar = (datos: Record<string, unknown>) =>
      patchGrupo(grupoA, { accion: 'editar', nombre: 'E2E Adm Grupo A2', cupo: 4, profesor_id: DOC_ACTIVO, ...datos })

    await esperar(await editar({ cupo: 0 }), 400, 'El cupo debe ser de al menos 1 plaza')
    await esperar(await editar({ cupo: 101 }), 400, 'El cupo no puede superar las 100 plazas')
    await esperar(await editar({ cupo: 2.5 }), 400, 'El cupo debe ser un número entero')
    await esperar(await editar({ nombre: '   ' }), 400, 'El nombre del grupo es requerido')
    await esperar(await editar({ profesor_id: 'no-es-un-uuid' }), 400)
    await esperar(await editar({ deporte_id: DOC_ACTIVO }), 400, 'La petición contiene campos no permitidos')
    await esperar(await editar({ nivel_id: 1 }), 400, 'La petición contiene campos no permitidos')

    // Profesor: sin rol DOCENTE, inexistente o con la ficha inactiva.
    await esperar(await editar({ profesor_id: await perfilPorDni(DNI.estudiante) }), 409, MENSAJE.noDocente)
    await esperar(await editar({ profesor_id: INEXISTENTE }), 404, MENSAJE.profesorInexistente)
    await esperar(await editar({ profesor_id: DOC_INACTIVO }), 409, MENSAJE.profesorInactivoEdicion)
    expect((await filaGrupo(grupoA)).profesor_id).toBe(DOC_ACTIVO)
  })

  test('el cupo no baja de la ocupación y un grupo con inscripciones no se inactiva', async () => {
    await franjaDomingo(grupoA)
    await limpiarInscripciones(DNI.estudiante)
    await limpiarInscripciones(DNI.ajeno)
    const primera = await esperar(await inscribir(SESION.estudiante, grupoA), 201)
    const segunda = await esperar(
      await pedirConSesion('tests/.auth/estudiante-ajeno.json', '/api/deportes/inscripciones', {
        method: 'POST',
        data: { grupo_id: grupoA },
      }),
      201
    )
    const editar = (cupo: number) =>
      patchGrupo(grupoA, { accion: 'editar', nombre: 'E2E Adm Grupo A2', cupo, profesor_id: DOC_ACTIVO })

    const rechazo = await esperar(
      await editar(1),
      409,
      'El cupo no puede ser menor que la cantidad de inscripciones activas: el grupo tiene 2 alumnos inscriptos.'
    )
    expect(rechazo.campo).toBe('cupo')
    expect((await filaGrupo(grupoA)).cupo).toBe(4)
    await esperar(await editar(2), 200)
    expect((await filaGrupo(grupoA)).cupo).toBe(2)

    const bloqueo = await esperar(
      await patchGrupo(grupoA, { accion: 'cambiar_estado', activo: false }),
      409,
      'No se puede inactivar el grupo porque tiene 2 alumnos con inscripción activa. Cada alumno debe cancelar la suya antes; Dirección no cancela por el alumno.'
    )
    expect(bloqueo.campo).toBe('activo')
    expect((await filaGrupo(grupoA)).activo).toBe(true)

    // La dirección no cancela por el alumno: solo su propia sesión puede.
    await esperar(await cancelar(SESION.directora, primera.inscripcion.id), 403)
    await esperar(await cancelar(SESION.estudiante, primera.inscripcion.id), 200)
    await esperar(
      await patchGrupo(grupoA, { accion: 'cambiar_estado', activo: false }),
      409,
      'No se puede inactivar el grupo porque tiene 1 alumno con inscripción activa. Cada alumno debe cancelar la suya antes; Dirección no cancela por el alumno.'
    )
    await esperar(
      await cancelar('tests/.auth/estudiante-ajeno.json', segunda.inscripcion.id),
      200
    )
  })

  test('inactivar y reactivar grupos y deportes respeta el orden de dependencias', async () => {
    // Sin inscripciones activas el grupo se inactiva, y repetir no es un error.
    await esperar(await patchGrupo(grupoA, { accion: 'cambiar_estado', activo: false }), 200)
    await esperar(await patchGrupo(grupoA, { accion: 'cambiar_estado', activo: false }), 200)
    expect((await filaGrupo(grupoA)).activo).toBe(false)

    // Ya sin grupos activos, el deporte se inactiva (repetir tampoco falla).
    await esperar(await patchDeporte(deporteUno, { accion: 'cambiar_estado', activo: false }), 200)
    await esperar(await patchDeporte(deporteUno, { accion: 'cambiar_estado', activo: false }), 200)
    expect((await filaDeporte(deporteUno)).activo).toBe(false)

    // Un deporte inactivo no admite grupos nuevos ni reactivar los suyos.
    await esperar(
      await directora('/api/deportes/grupos', {
        method: 'POST',
        data: {
          deporte_id: deporteUno,
          nivel_id: await nivelPorNombre('INICIAL'),
          nombre: 'E2E Adm Grupo C',
          cupo: 5,
          profesor_id: DOC_ACTIVO,
        },
      }),
      409,
      'El deporte está inactivo y no admite grupos ni inscripciones nuevas.'
    )
    await esperar(
      await patchGrupo(grupoA, { accion: 'cambiar_estado', activo: true }),
      409,
      MENSAJE.deporteInactivoReactivar
    )
    expect((await filaGrupo(grupoA)).activo).toBe(false)

    await esperar(await patchDeporte(deporteUno, { accion: 'cambiar_estado', activo: true }), 200)
    expect((await filaDeporte(deporteUno)).activo).toBe(true)

    // Profesor inactivo: no se reactiva hasta asignar otro docente activo. Un
    // grupo inactivo se puede editar justamente para eso.
    estadoFicha(DOC_ACTIVO, 'INACTIVO')
    try {
      await esperar(
        await patchGrupo(grupoA, { accion: 'cambiar_estado', activo: true }),
        409,
        MENSAJE.profesorInactivoReactivar
      )
      const otroDocente = await perfilPorDni(DNI.docente)
      await esperar(
        await patchGrupo(grupoA, { accion: 'editar', nombre: 'E2E Adm Grupo A2', cupo: 2, profesor_id: otroDocente }),
        200
      )
      await esperar(await patchGrupo(grupoA, { accion: 'cambiar_estado', activo: true }), 200)
      expect(await filaGrupo(grupoA)).toMatchObject({ activo: true, profesor_id: otroDocente })
    } finally {
      estadoFicha(DOC_ACTIVO, 'ACTIVO')
    }
  })

  test('los identificadores y las acciones inválidos se distinguen: 400 y 404', async () => {
    await esperar(await patchDeporte('no-es-un-id', { accion: 'cambiar_estado', activo: true }), 400, 'Identificador de deporte inválido')
    await esperar(await patchGrupo('no-es-un-id', { accion: 'cambiar_estado', activo: true }), 400, 'Identificador de grupo inválido')
    await esperar(await patchDeporte(INEXISTENTE, { accion: 'cambiar_estado', activo: true }), 404, 'El deporte seleccionado no existe.')
    await esperar(await patchDeporte(INEXISTENTE, { accion: 'renombrar', nombre: 'E2E Adm Nada' }), 404)
    await esperar(
      await patchGrupo(INEXISTENTE, { accion: 'cambiar_estado', activo: true }),
      404,
      'El grupo deportivo no existe o ya no está disponible.'
    )
    await esperar(
      await patchGrupo(INEXISTENTE, { accion: 'editar', nombre: 'x', cupo: 1, profesor_id: DOC_ACTIVO }),
      404
    )
    await esperar(await patchDeporte(deporteUno, { accion: 'borrar' }), 400, 'Seleccioná una acción válida')
    await esperar(await patchGrupo(grupoA, { accion: 'borrar' }), 400, 'Seleccioná una acción válida')
    await esperar(await patchDeporte(deporteUno, { accion: 'cambiar_estado' }), 400)
    await esperar(await patchDeporte(deporteUno, { accion: 'cambiar_estado', activo: 'si' }), 400)
    await esperar(await patchGrupo(grupoA, { accion: 'cambiar_estado', activo: null }), 400)
    await esperar(
      await patchDeporte(deporteUno, { accion: 'cambiar_estado', activo: true, nombre: 'x' }),
      400,
      'La petición contiene campos no permitidos'
    )
    await esperar(
      await directora(`/api/deportes/${deporteUno}`, {
        method: 'PATCH',
        data: Buffer.from('{'),
        headers: { 'Content-Type': 'application/json' },
      }),
      400,
      'Cuerpo inválido'
    )
  })

  test('no existe borrado físico: DELETE recibe 405 con Allow, también para la dirección', async () => {
    for (const [ruta, permitido] of [
      ['/api/deportes', 'POST'],
      [`/api/deportes/${deporteUno}`, 'PATCH'],
      [`/api/deportes/grupos/${grupoA}`, 'PATCH'],
    ] as const) {
      for (const metodo of ['DELETE', 'GET', 'PUT']) {
        const respuesta = await directora(ruta, { method: metodo })
        expect(respuesta.status(), `${metodo} ${ruta}`).toBe(405)
        expect(respuesta.headers()['allow']).toBe(`${permitido}, OPTIONS`)
      }
    }
    // Nada se borró: las filas siguen ahí.
    expect((await filaDeporte(deporteUno)).nombre).toBe('E2E Adm Uno')
    expect((await filaGrupo(grupoA)).nombre).toBe('E2E Adm Grupo A2')
  })
})

// ================================================================
// DIRECTOR: la pantalla real, con la base real
// ================================================================
test.describe.serial('DIRECTOR autenticado — administración de deportes (pantalla)', () => {
  test.beforeAll(async () => {
    preparar()
    await limpiarInscripciones(DNI.estudiante)
    await limpiarInscripciones(DNI.ajeno)
  })

  test.afterAll(async () => {
    limpiar()
    await limpiarInscripciones(DNI.estudiante)
    await limpiarInscripciones(DNI.ajeno)
  })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  test('crea un deporte con el teclado y persiste tras recargar; un nombre repetido lo rechaza la base', async ({ page }) => {
    await abrirDeportes(page)
    await expect(page.getByRole('region', { name: 'Catálogo de deportes' })).toBeVisible()
    await capturar(page, 'catalogo')

    const nuevo = page.getByRole('button', { name: 'Nuevo deporte' })
    await nuevo.focus()
    await page.keyboard.press('Enter')
    const dialogo = page.getByRole('dialog', { name: 'Nuevo deporte' })
    await expect(dialogo.getByLabel('Nombre del deporte')).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(dialogo.getByLabel('Nombre del deporte')).toHaveAccessibleDescription('El nombre del deporte es requerido')

    await dialogo.getByLabel('Nombre del deporte').fill('E2E Adm Pantalla')
    await page.keyboard.press('Enter')
    await expect(dialogo).toHaveCount(0)
    await expect(nuevo).toBeFocused()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Creaste el deporte «E2E Adm Pantalla».' })
    ).toBeVisible()
    const tarjeta = tarjetaDeporte(page, 'E2E Adm Pantalla')
    await expect(tarjeta).toContainText('Activo')
    await expect(tarjeta).toContainText('Todavía no tiene grupos.')
    await capturar(page, 'deporte-creado')

    await page.reload()
    await expect(tarjetaDeporte(page, 'E2E Adm Pantalla')).toBeVisible()

    // Repetido (otra mayúscula): la pantalla no lo anticipa, lo decide la base.
    await nuevo.click()
    await dialogo.getByLabel('Nombre del deporte').fill('e2e adm pantalla')
    await dialogo.getByRole('button', { name: 'Crear deporte' }).click()
    await expect(dialogo.getByLabel('Nombre del deporte')).toHaveAccessibleDescription(MENSAJE.deporteRepetido)
    await exigirPantallaSinDetalleTecnico(page, 'deporte repetido')
    await capturar(page, 'deporte-repetido', { paginaCompleta: false })
  })

  test('renombra: libre sin grupos y solo mayúsculas con grupos, con la regla explicada antes de enviar', async ({ page }) => {
    const deporte = await deporteNuevo('E2E Adm Renombrar')
    await abrirDeportes(page)

    await tarjetaDeporte(page, 'E2E Adm Renombrar').getByRole('button', { name: /^Renombrar/ }).click()
    let dialogo = page.getByRole('dialog', { name: 'Renombrar E2E Adm Renombrar' })
    await expect(dialogo).toContainText('podés cambiarle el nombre libremente')
    await dialogo.getByLabel('Nombre del deporte').fill('E2E Adm Renombrado Libre')
    await dialogo.getByRole('button', { name: 'Guardar nombre' }).click()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Renombraste el deporte «E2E Adm Renombrar» a «E2E Adm Renombrado Libre».' })
    ).toBeVisible()
    expect((await filaDeporte(deporte)).nombre).toBe('E2E Adm Renombrado Libre')

    // Con un grupo, la regla se explica y el cambio de otro tipo ni se envía.
    await grupoNuevo(deporte, 'E2E Adm Grupo R')
    await page.reload()
    await tarjetaDeporte(page, 'E2E Adm Renombrado Libre').getByRole('button', { name: /^Renombrar/ }).click()
    dialogo = page.getByRole('dialog', { name: 'Renombrar E2E Adm Renombrado Libre' })
    await expect(dialogo).toContainText('solo podés cambiar las mayúsculas y minúsculas')
    await capturar(page, 'renombrar-con-grupos', { paginaCompleta: false })
    await dialogo.getByLabel('Nombre del deporte').fill('E2E Adm Otro Nombre')
    await dialogo.getByRole('button', { name: 'Guardar nombre' }).click()
    await expect(dialogo.getByLabel('Nombre del deporte')).toHaveAccessibleDescription(MENSAJE.renombrarConGrupos)
    expect((await filaDeporte(deporte)).nombre).toBe('E2E Adm Renombrado Libre')

    await dialogo.getByLabel('Nombre del deporte').fill('E2E ADM RENOMBRADO LIBRE')
    await dialogo.getByRole('button', { name: 'Guardar nombre' }).click()
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Renombraste el deporte' })).toBeVisible()
    expect((await filaDeporte(deporte)).nombre).toBe('E2E ADM RENOMBRADO LIBRE')
  })

  test('inactivar un deporte exige inactivar antes sus grupos; todo persiste y se puede revertir', async ({ page }) => {
    const deporte = await deporteNuevo('E2E Adm Estados')
    const grupo = await grupoNuevo(deporte, 'E2E Adm Grupo E')
    await abrirDeportes(page)

    const botonDeporte = tarjetaDeporte(page, 'E2E Adm Estados').getByRole('button', { name: /^Inactivar el deporte/ })
    await expect(botonDeporte).toHaveAttribute('aria-disabled', 'true')
    await expect(botonDeporte).toHaveAccessibleDescription(
      'No se puede inactivar el deporte porque tiene 1 grupo activo. Inactivá esos grupos primero.'
    )
    await capturar(page, 'deporte-bloqueado')

    // Grupo: confirmación con teclado, foco seguro y Escape.
    const botonGrupo = tarjetaGrupo(page, 'E2E Adm Grupo E').getByRole('button', { name: /^Inactivar el grupo/ })
    await botonGrupo.focus()
    await page.keyboard.press('Enter')
    const dialogo = page.getByRole('dialog', { name: 'Inactivar el grupo E2E Adm Grupo E' })
    await expect(dialogo.getByRole('button', { name: 'Volver sin cambios' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    await expect(botonGrupo).toBeFocused()
    expect((await filaGrupo(grupo)).activo).toBe(true)

    await page.keyboard.press('Enter')
    await capturar(page, 'confirmar-inactivar-grupo', { paginaCompleta: false })
    await dialogo.getByRole('button', { name: 'Sí, inactivar el grupo' }).click()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Inactivaste el grupo «E2E Adm Grupo E».' })
    ).toBeVisible()
    expect((await filaGrupo(grupo)).activo).toBe(false)
    await expect(tarjetaGrupo(page, 'E2E Adm Grupo E')).toContainText('Inactivo')

    // Ya sin grupos activos, el deporte se puede inactivar.
    await expect(botonDeporte).not.toHaveAttribute('aria-disabled', 'true')
    await botonDeporte.click()
    await page.getByRole('button', { name: 'Sí, inactivar el deporte' }).click()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Inactivaste el deporte «E2E Adm Estados».' })
    ).toBeVisible()
    expect((await filaDeporte(deporte)).activo).toBe(false)

    // El grupo no se puede reactivar con el deporte inactivo: se explica en el control.
    await page.reload()
    const reactivarGrupo = tarjetaGrupo(page, 'E2E Adm Grupo E').getByRole('button', { name: /^Reactivar el grupo/ })
    await expect(reactivarGrupo).toHaveAttribute('aria-disabled', 'true')
    await expect(reactivarGrupo).toHaveAccessibleDescription(MENSAJE.deporteInactivoReactivar)
    await expect(tarjetaGrupo(page, 'E2E Adm Grupo E')).toContainText('Deporte inactivo')
    await capturar(page, 'grupo-con-deporte-inactivo')

    // Reversión: reactivar el deporte y después el grupo, con confirmación.
    await tarjetaDeporte(page, 'E2E Adm Estados').getByRole('button', { name: /^Reactivar el deporte/ }).click()
    await page.getByRole('button', { name: 'Sí, reactivar el deporte' }).click()
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Reactivaste el deporte' })).toBeVisible()
    await expect(reactivarGrupo).not.toHaveAttribute('aria-disabled', 'true')
    await reactivarGrupo.click()
    await page.getByRole('button', { name: 'Sí, reactivar el grupo' }).click()
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Reactivaste el grupo' })).toBeVisible()
    expect((await filaGrupo(grupo)).activo).toBe(true)
    expect((await filaDeporte(deporte)).activo).toBe(true)
  })

  test('edita un grupo: cupo con mínimo visible, profesores activos y persistencia', async ({ page }) => {
    const deporte = await deporteNuevo('E2E Adm Edicion')
    const grupo = await grupoNuevo(deporte, 'E2E Adm Grupo D', { cupo: 4 })
    await franjaDomingo(grupo)
    await limpiarInscripciones(DNI.estudiante)
    await esperar(await inscribir(SESION.estudiante, grupo), 201)
    await abrirDeportes(page)

    await tarjetaGrupo(page, 'E2E Adm Grupo D').getByRole('button', { name: /^Editar el grupo/ }).click()
    const dialogo = page.getByRole('dialog', { name: 'Editar E2E Adm Edicion · E2E Adm Grupo D' })
    await expect(dialogo).toContainText('El deporte y el nivel no se pueden cambiar')
    await expect(dialogo.getByLabel('Cupo (plazas)')).toHaveAttribute('min', '1')
    await expect(dialogo.getByLabel('Cupo (plazas)')).toHaveAccessibleDescription(
      /No puede ser menor que las inscripciones activas \(1\)/
    )

    // Solo docentes activos: el de ficha inactiva no se ofrece.
    const opciones = await dialogo.getByLabel('Profesor responsable').locator('option').allTextContents()
    expect(opciones).toContain('Adm Activo, Prueba')
    expect(opciones.join('|')).not.toContain('Adm Inactivo')
    await capturar(page, 'editar-grupo', { paginaCompleta: false })

    await dialogo.getByLabel('Cupo (plazas)').fill('0')
    await dialogo.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(dialogo.getByLabel('Cupo (plazas)')).toHaveAccessibleDescription(
      'El cupo debe ser un número entero entre 1 y 100'
    )
    await dialogo.getByLabel('Nombre del grupo').fill('E2E Adm Grupo D2')
    await dialogo.getByLabel('Cupo (plazas)').fill('6')
    await dialogo.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Guardaste los cambios del grupo «E2E Adm Grupo D2».' })
    ).toBeVisible()
    await expect(tarjetaGrupo(page, 'E2E Adm Grupo D2')).toContainText('1 de 6 plazas')
    expect(await filaGrupo(grupo)).toMatchObject({ nombre: 'E2E Adm Grupo D2', cupo: 6 })

    await page.reload()
    await expect(tarjetaGrupo(page, 'E2E Adm Grupo D2')).toContainText('1 de 6 plazas')

    // El grupo con un alumno inscripto no se puede inactivar: se explica y no abre el diálogo.
    const inactivar = tarjetaGrupo(page, 'E2E Adm Grupo D2').getByRole('button', { name: /^Inactivar el grupo/ })
    await expect(inactivar).toHaveAttribute('aria-disabled', 'true')
    await expect(inactivar).toHaveAccessibleDescription(
      'No se puede inactivar el grupo porque tiene 1 alumno con inscripción activa. Cada alumno debe cancelar la suya antes; Dirección no cancela por el alumno.'
    )
    await capturar(page, 'grupo-con-inscripciones')
    await limpiarInscripciones(DNI.estudiante)
  })

  test('una pantalla desactualizada muestra el rechazo real de la base y se reconcilia', async ({ page }) => {
    const deporte = await deporteNuevo('E2E Adm Carrera Pantalla')
    const grupo = await grupoNuevo(deporte, 'E2E Adm Grupo P')
    await franjaDomingo(grupo)
    await limpiarInscripciones(DNI.estudiante)
    await abrirDeportes(page)

    const inactivar = tarjetaGrupo(page, 'E2E Adm Grupo P').getByRole('button', { name: /^Inactivar el grupo/ })
    await expect(inactivar).not.toHaveAttribute('aria-disabled', 'true')
    await inactivar.click()

    // Otra pestaña inscribe a un alumno mientras esta muestra la confirmación.
    await esperar(await inscribir(SESION.estudiante, grupo), 201)
    await page.getByRole('button', { name: 'Sí, inactivar el grupo' }).click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo.getByRole('alert')).toContainText(
      'No se puede inactivar el grupo porque tiene 1 alumno con inscripción activa.'
    )
    expect((await filaGrupo(grupo)).activo).toBe(true)
    // Tras releer, el estado real explica el impedimento y la confirmación se cierra sola de la vista.
    await expect(dialogo.getByRole('button', { name: 'Sí, inactivar el grupo' })).toBeDisabled()
    await exigirPantallaSinDetalleTecnico(page, 'rechazo por carrera')
    await capturar(page, 'rechazo-carrera', { paginaCompleta: false })
    await dialogo.getByRole('button', { name: 'Volver sin cambios' }).click()
    await expect(inactivar).toHaveAttribute('aria-disabled', 'true')
    await limpiarInscripciones(DNI.estudiante)
  })

  test('con la sesión vencida el aviso ofrece iniciar sesión y no se pierde', async ({ page, context }) => {
    const deporte = await deporteNuevo('E2E Adm Sesion')
    await grupoNuevo(deporte, 'E2E Adm Grupo S')
    await abrirDeportes(page)
    await tarjetaGrupo(page, 'E2E Adm Grupo S').getByRole('button', { name: /^Inactivar el grupo/ }).click()
    await context.clearCookies()
    await page.getByRole('button', { name: 'Sí, inactivar el grupo' }).click()
    const alerta = page.getByRole('dialog').getByRole('alert')
    await expect(alerta).toContainText('Tu sesión venció. Iniciá sesión nuevamente para continuar.')
    await expect(alerta.getByRole('link', { name: 'Iniciar sesión' })).toBeVisible()
    await page.waitForTimeout(800)
    await expect(alerta).toBeVisible()
    await capturar(page, 'sesion-vencida', { paginaCompleta: false })
  })

  test('a 375 px la administración es usable, sin desplazamiento horizontal', async ({ page }) => {
    const deporte = await deporteNuevo('E2E Adm Movil')
    await grupoNuevo(deporte, 'E2E Adm Grupo M')
    await page.setViewportSize({ width: 375, height: 812 })
    await abrirDeportes(page)
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'administracion')

    await tarjetaGrupo(page, 'E2E Adm Grupo M').getByRole('button', { name: /^Editar el grupo/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'editar-grupo', { paginaCompleta: false })
    await page.keyboard.press('Escape')
  })
})

// ================================================================
// El estudiante conserva su vista, sin administración
// ================================================================
test.describe('ESTUDIANTE autenticado — sin administración de deportes', () => {
  test('ve su pantalla de siempre, sin controles de administración', async ({ page }) => {
    await abrirDeportes(page)
    await expect(page.getByRole('region', { name: 'Catálogo de deportes' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Grupos disponibles para tu nivel' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: /Nuevo deporte|Nuevo grupo|Renombrar|Inactivar|Reactivar|Editar/ })
    ).toHaveCount(0)
    await exigirPantallaSinDetalleTecnico(page, 'pantalla del alumno')
    await capturar(page, 'alumno-sin-administracion', { paginaCompleta: false })
  })

  test('recibe 403 en cada operación y 405 en el borrado', async () => {
    await esperar(
      await pedirConSesion(SESION.estudiante, '/api/deportes', { method: 'POST', data: { nombre: 'E2E Adm Alumno' } }),
      403,
      MENSAJE.soloDireccionCatalogo
    )
    await esperar(
      await pedirConSesion(SESION.estudiante, `/api/deportes/${INEXISTENTE}`, {
        method: 'PATCH',
        data: { accion: 'cambiar_estado', activo: false },
      }),
      403,
      MENSAJE.soloDireccionCatalogo
    )
    await esperar(
      await pedirConSesion(SESION.estudiante, `/api/deportes/grupos/${INEXISTENTE}`, {
        method: 'PATCH',
        data: { accion: 'editar', nombre: 'x', cupo: 1, profesor_id: INEXISTENTE },
      }),
      403,
      MENSAJE.soloDireccionGrupos
    )
    expect(
      (await pedirConSesion(SESION.estudiante, `/api/deportes/${INEXISTENTE}`, { method: 'DELETE' })).status()
    ).toBe(405)
  })
})

// ================================================================
// Actores sin poderes de administración
// ================================================================
for (const actor of [
  { etiqueta: 'DOCENTE', sesion: SESION.docente },
  { etiqueta: 'PADRE', sesion: SESION.padre },
  { etiqueta: 'PERSONAL', sesion: SESION.personal },
  { etiqueta: 'SIN PERFIL', sesion: SESION.sinPerfil },
]) {
  test.describe(`${actor.etiqueta} autenticado — administración de deportes`, () => {
    test('no accede a la pantalla y no ve controles', async ({ page }) => {
      await page.goto('/dashboard/deportes')
      await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
      await expect(page.getByRole('button', { name: /Nuevo deporte|Renombrar|Inactivar|Reactivar|Editar/ })).toHaveCount(0)
    })

    test('recibe 403 en cada operación de administración', async () => {
      const operaciones: [string, string, unknown, string][] = [
        ['POST', '/api/deportes', { nombre: 'E2E Adm Ajeno' }, MENSAJE.soloDireccionCatalogo],
        ['PATCH', `/api/deportes/${INEXISTENTE}`, { accion: 'renombrar', nombre: 'x' }, MENSAJE.soloDireccionCatalogo],
        ['PATCH', `/api/deportes/${INEXISTENTE}`, { accion: 'cambiar_estado', activo: false }, MENSAJE.soloDireccionCatalogo],
        [
          'PATCH',
          `/api/deportes/grupos/${INEXISTENTE}`,
          { accion: 'editar', nombre: 'x', cupo: 1, profesor_id: INEXISTENTE },
          MENSAJE.soloDireccionGrupos,
        ],
        ['PATCH', `/api/deportes/grupos/${INEXISTENTE}`, { accion: 'cambiar_estado', activo: false }, MENSAJE.soloDireccionGrupos],
      ]
      for (const [metodo, ruta, data, mensaje] of operaciones) {
        const respuesta = await pedirConSesion(actor.sesion, ruta, { method: metodo, data })
        // Sin perfil o sin rol, el rechazo es el mismo: nadie distingue al actor.
        await esperar(respuesta, 403, mensaje)
      }
    })
  })
}

// ================================================================
// Director bloqueado (EPT-59): el JWT sigue vivo, la base lo niega
// ================================================================
test.describe('DIRECTOR BLOQUEADO autenticado — administración de deportes', () => {
  test('la pantalla lleva a «Acceso bloqueado»', async ({ page }) => {
    await page.goto('/dashboard/deportes')
    await expect(page).toHaveURL(/\/acceso-bloqueado$/u)
    await expect(page.getByRole('heading', { level: 1, name: 'Acceso bloqueado' })).toBeVisible()
  })

  test('la API niega cada operación con el mensaje de acceso bloqueado', async ({ request }) => {
    const respuestas = await Promise.all([
      request.post('/api/deportes', { data: { nombre: 'E2E Adm Bloqueado' } }),
      request.patch(`/api/deportes/${INEXISTENTE}`, { data: { accion: 'cambiar_estado', activo: false } }),
      request.patch(`/api/deportes/grupos/${INEXISTENTE}`, { data: { accion: 'cambiar_estado', activo: false } }),
    ])
    for (const respuesta of respuestas) await esperar(respuesta, 403, MENSAJE.bloqueo)
  })
})

// ================================================================
// Sin sesión
// ================================================================
test.describe('DIRECTOR autenticado — sin sesión propia', () => {
  test('un contexto sin cookies recibe 401 en cada operación', async () => {
    // Sin `storageState` explícito, el contexto heredaría la sesión del proyecto.
    const anonimo = await crearContexto.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    })
    contextosActivos.push(anonimo)
    for (const respuesta of await Promise.all([
      anonimo.post('/api/deportes', { data: { nombre: 'E2E Adm Anonimo' } }),
      anonimo.patch(`/api/deportes/${INEXISTENTE}`, { data: { accion: 'cambiar_estado', activo: false } }),
      anonimo.patch(`/api/deportes/grupos/${INEXISTENTE}`, { data: { accion: 'cambiar_estado', activo: false } }),
    ])) {
      await esperar(respuesta, 401, 'Necesitás iniciar sesión para continuar.')
    }
  })
})
