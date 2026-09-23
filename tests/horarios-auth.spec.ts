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
import fs from 'node:fs'
import path from 'node:path'
import { capturarSinHerramientas } from './_captura'
import { exigirMensajeSinDetalleTecnico, exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Compatibilidad horaria con sesiones reales (EPT-12).
 *
 * Sin mocks: cada petición atraviesa cookies SSR, `auth.getUser()`, el control
 * de rol del servidor, los envoltorios RPC y PostgreSQL. Los conflictos, la
 * falta de horario y todas las reglas de EPT-11 los decide la base.
 *
 * La clave de servicio local se usa solo para PREPARAR datos (leer
 * identificadores, limpiar inscripciones y franjas de las identidades de
 * prueba); nunca participa de una operación que se esté verificando.
 *
 * El archivo se omite salvo que el operador habilite la base local descartable.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

/** Identidades que siembra `tests/auth.setup.ts` (se repiten para no importarlo). */
const ESTUDIANTE = { dni: '99900002' }
const ESTUDIANTE_AJENO = { dni: '99900003' }
const DOCENTE = { dni: '99900004', email: 'docente.prueba@ept.local', password: 'prueba-ept-9-docente' }

const SESION = {
  directora: 'tests/.auth/directora.json',
  estudiante: 'tests/.auth/estudiante.json',
  ajeno: 'tests/.auth/estudiante-ajeno.json',
  docente: 'tests/.auth/docente.json',
  padre: 'tests/.auth/padre.json',
  personal: 'tests/.auth/personal.json',
  sinPerfil: 'tests/.auth/sin-perfil.json',
}

const BASE_URL = 'http://localhost:3000'
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

const DEPORTE = {
  futbol: 'e0000000-0000-4000-8000-000000000101',
  natacion: 'e0000000-0000-4000-8000-000000000102',
  atletismo: 'e0000000-0000-4000-8000-000000000103',
  marciales: 'e0000000-0000-4000-8000-000000000104',
  voley: 'e0000000-0000-4000-8000-000000000105',
  basquet: 'e0000000-0000-4000-8000-000000000106',
}

type FranjaPrueba = [dia: number, inicio: string, fin: string]

/**
 * Grupos de la matriz, todos del nivel INICIAL de los alumnos de prueba. El
 * nombre dice cómo se relaciona cada uno con «E2E H Fútbol» (lunes y miércoles
 * de 10:00 a 11:00). Las horas no tocan las franjas 18:00–19:00 de la suite de
 * EPT-11, así que las dos matrices no interfieren.
 */
const GRUPOS = {
  futbol: { deporte: DEPORTE.futbol, nombre: 'E2E H Fútbol', franjas: [[1, '10:00', '11:00'], [3, '10:00', '11:00']] },
  igual: { deporte: DEPORTE.natacion, nombre: 'E2E H Natación igual', franjas: [[1, '10:00', '11:00']] },
  izquierda: { deporte: DEPORTE.atletismo, nombre: 'E2E H Atletismo izquierda', franjas: [[1, '09:30', '10:30']] },
  derecha: { deporte: DEPORTE.voley, nombre: 'E2E H Vóley derecha', franjas: [[1, '10:30', '11:30']] },
  contenido: { deporte: DEPORTE.basquet, nombre: 'E2E H Básquet contenido', franjas: [[1, '10:15', '10:45']] },
  contiene: { deporte: DEPORTE.marciales, nombre: 'E2E H Marciales contiene', franjas: [[1, '09:00', '12:00']] },
  contiguo: { deporte: DEPORTE.natacion, nombre: 'E2E H Natación contigua', franjas: [[1, '11:00', '12:00']] },
  otroDia: { deporte: DEPORTE.atletismo, nombre: 'E2E H Atletismo martes', franjas: [[2, '10:00', '11:00']] },
  sinHorario: { deporte: DEPORTE.basquet, nombre: 'E2E H Básquet sin horario', franjas: [] },
  gestion: { deporte: DEPORTE.voley, nombre: 'E2E H Vóley gestión', franjas: [] },
} as const satisfies Record<string, { deporte: string; nombre: string; franjas: readonly FranjaPrueba[] }>

type ClaveGrupo = keyof typeof GRUPOS

const CONFLICTO_FUTBOL_LUNES = {
  mensaje: 'Conflicto de horario con Fútbol (E2E H Fútbol): lunes de 10:00 a 11:00.',
  conflicto: { deporte: 'Fútbol', grupo: 'E2E H Fútbol', dia_semana: 1, hora_inicio: '10:00', hora_fin: '11:00' },
}
const SIN_HORARIO = 'Este grupo todavía no tiene horarios cargados, así que no admite inscripciones.'

const contextosActivos: APIRequestContext[] = []

test.afterEach(async () => {
  await Promise.all(contextosActivos.splice(0).map((contexto) => contexto.dispose()))
})

// ----------------------------------------------------------------
// Preparación (solo base local)
// ----------------------------------------------------------------

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

async function nivelPorNombre(nombre: string): Promise<number> {
  const { data } = await clienteAdmin().from('niveles').select('id').eq('nombre', nombre).single()
  return data.id as number
}

async function idGrupo(clave: ClaveGrupo): Promise<string | null> {
  const { data } = await clienteAdmin()
    .from('grupos_deportivos')
    .select('id')
    .eq('nombre', GRUPOS[clave].nombre)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/**
 * Crea por la API REAL de la dirección los grupos y las franjas que falten. Es
 * idempotente: 201 la primera vez y 409 (ya existe) las siguientes.
 */
async function asegurarGrupos(): Promise<Record<ClaveGrupo, string>> {
  const profesor = await perfilPorDni(DOCENTE.dni)
  const inicial = await nivelPorNombre('INICIAL')
  const ids = {} as Record<ClaveGrupo, string>
  for (const clave of Object.keys(GRUPOS) as ClaveGrupo[]) {
    const grupo = GRUPOS[clave]
    let id = await idGrupo(clave)
    if (!id) {
      const respuesta = await pedirConSesion(SESION.directora, '/api/deportes/grupos', {
        method: 'POST',
        data: { deporte_id: grupo.deporte, nivel_id: inicial, nombre: grupo.nombre, cupo: 10, profesor_id: profesor },
      })
      expect([201, 409]).toContain(respuesta.status())
      id = await idGrupo(clave)
    }
    if (!id) throw new Error(`No se pudo preparar el grupo ${clave}`)
    for (const [dia, inicio, fin] of grupo.franjas) {
      const franja = await agregarFranja(SESION.directora, id, { dia_semana: dia, hora_inicio: inicio, hora_fin: fin })
      expect([201, 409]).toContain(franja.status())
    }
    ids[clave] = id
  }
  return ids
}

async function limpiarInscripciones(dni: string) {
  const alumno = await perfilPorDni(dni)
  const { error } = await clienteAdmin().from('inscripciones_deportivas').delete().eq('alumno_id', alumno)
  if (error) throw new Error(`No se pudieron limpiar las inscripciones de prueba: ${error.message}`)
}

/** Deja el grupo de gestión sin franjas activas (baja lógica, como propietario). */
async function vaciarFranjas(grupoId: string) {
  const { error } = await clienteAdmin()
    .from('grupos_deportivos_horarios')
    .update({ activo: false })
    .eq('grupo_id', grupoId)
    .eq('activo', true)
  if (error) throw new Error(`No se pudieron dar de baja las franjas de prueba: ${error.message}`)
}

async function activasDe(dni: string): Promise<string[]> {
  const { data } = await clienteAdmin()
    .from('inscripciones_deportivas')
    .select('grupo_id')
    .eq('alumno_id', await perfilPorDni(dni))
    .eq('estado', 'ACTIVA')
  return ((data ?? []) as { grupo_id: string }[]).map((fila) => fila.grupo_id)
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

const inscribir = (sesion: string, grupoId: string) =>
  pedirConSesion(sesion, '/api/deportes/inscripciones', { method: 'POST', data: { grupo_id: grupoId } })

const inscribirComoDireccion = (sesion: string, datos: Record<string, unknown>) =>
  pedirConSesion(sesion, '/api/deportes/inscripciones-administrativas', { method: 'POST', data: datos })

const cancelar = (sesion: string, inscripcionId: string) =>
  pedirConSesion(sesion, `/api/deportes/inscripciones/${inscripcionId}`, {
    method: 'PATCH',
    data: { accion: 'cancelar' },
  })

const agregarFranja = (sesion: string, grupoId: string, datos: Record<string, unknown>) =>
  pedirConSesion(sesion, `/api/deportes/grupos/${grupoId}/horarios`, { method: 'POST', data: datos })

const darDeBajaFranja = (sesion: string, grupoId: string, franjaId: string) =>
  pedirConSesion(sesion, `/api/deportes/grupos/${grupoId}/horarios/${franjaId}`, {
    method: 'PATCH',
    data: { accion: 'dar_de_baja' },
  })

async function esperarRechazo(respuesta: APIResponse, estado: number, mensaje?: string) {
  expect(respuesta.status()).toBe(estado)
  const cuerpo = await respuesta.json()
  if (mensaje) expect(cuerpo.error).toBe(mensaje)
  exigirMensajeSinDetalleTecnico('respuesta de la API', String(cuerpo.error ?? ''))
  return cuerpo
}

// ----------------------------------------------------------------
// Utilidades de pantalla
// ----------------------------------------------------------------

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  await capturarSinHerramientas(page, path.join('docs/evidence/EPT-12', `real-${nombre}.png`))
}

function aplicacion(page: Page) {
  return page.getByRole('main')
}

function tarjetaGrupo(page: Page, clave: ClaveGrupo) {
  return aplicacion(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(GRUPOS[clave].nombre, { exact: true }) })
}

async function abrirDeportes(page: Page) {
  await page.goto('/dashboard/deportes')
  await expect(page.getByRole('heading', { name: 'Deportes', level: 1 })).toBeVisible()
}

async function sinScrollHorizontal(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  )
}

// ================================================================
// ESTUDIANTE: la matriz completa por la pantalla y por la API
// ================================================================
test.describe.serial('ESTUDIANTE autenticado — horarios', () => {
  let grupos: Record<ClaveGrupo, string>

  test.beforeAll(async () => {
    grupos = await asegurarGrupos()
    await limpiarInscripciones(ESTUDIANTE.dni)
  })

  test('sin actividades previas ve los horarios de cada grupo y se inscribe', async ({ page }) => {
    await abrirDeportes(page)
    const futbol = tarjetaGrupo(page, 'futbol')
    await expect(futbol).toContainText('Lunes · 10:00 a 11:00')
    await expect(futbol).toContainText('Miércoles · 10:00 a 11:00')
    await expect(tarjetaGrupo(page, 'sinHorario')).toContainText('Sin horario')
    await expect(page.getByRole('button', { name: /Eliminar|Borrar/ })).toHaveCount(0)
    await exigirPantallaSinDetalleTecnico(page, 'listado con horarios')
    await capturar(page, 'escritorio-alumno-horarios')

    await futbol.getByRole('button', { name: /Inscribirme en Fútbol/ }).click()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Te inscribiste en Fútbol (E2E H Fútbol).' })
    ).toBeVisible()
    await expect(page.getByText('1 de 2', { exact: true })).toBeVisible()
    await capturar(page, 'escritorio-inscripcion-compatible')

    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Cancelar mi inscripción en Fútbol, E2E H Fútbol' })
    ).toBeVisible()
    expect(await activasDe(ESTUDIANTE.dni)).toEqual([grupos.futbol])
  })

  test('la pantalla anticipa el conflicto con deporte, día y rango', async ({ page }) => {
    await abrirDeportes(page)
    const tarjeta = tarjetaGrupo(page, 'igual')
    await expect(tarjeta).toContainText('Horario superpuesto')
    const boton = tarjeta.getByRole('button', { name: /Inscribirme en Natación/ })
    await expect(boton).toHaveAttribute('aria-disabled', 'true')
    await expect(boton).toHaveAccessibleDescription(CONFLICTO_FUTBOL_LUNES.mensaje)
    // Un grupo de otro día no se marca.
    await expect(tarjetaGrupo(page, 'otroDia').getByRole('button', { name: /Inscribirme/ })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
    await capturar(page, 'escritorio-conflicto-anticipado')
  })

  test('la API rechaza la igualdad, los solapamientos parciales y la contención con 409', async () => {
    for (const clave of ['igual', 'izquierda', 'derecha', 'contenido', 'contiene'] as const) {
      const cuerpo = await esperarRechazo(await inscribir(SESION.estudiante, grupos[clave]), 409, CONFLICTO_FUTBOL_LUNES.mensaje)
      expect(cuerpo.conflicto).toEqual(CONFLICTO_FUTBOL_LUNES.conflicto)
      expect(cuerpo.campo).toBe('grupo_id')
    }
    expect(await activasDe(ESTUDIANTE.dni)).toEqual([grupos.futbol])
  })

  test('un intervalo contiguo se acepta desde la pantalla', async ({ page }) => {
    await abrirDeportes(page)
    await tarjetaGrupo(page, 'contiguo').getByRole('button', { name: /Inscribirme en Natación/ }).click()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Te inscribiste en Natación (E2E H Natación contigua).' })
    ).toBeVisible()
    await expect(page.getByText('2 de 2', { exact: true })).toBeVisible()
    await capturar(page, 'escritorio-contiguo-permitido')
  })

  test('días distintos se aceptan y el grupo sin horario se rechaza con un mensaje claro', async ({ page }) => {
    // Se libera un lugar para que el máximo de dos no decida antes que el horario.
    const { data } = await clienteAdmin()
      .from('inscripciones_deportivas')
      .select('id')
      .eq('grupo_id', grupos.contiguo)
      .eq('alumno_id', await perfilPorDni(ESTUDIANTE.dni))
      .eq('estado', 'ACTIVA')
      .single()
    expect((await cancelar(SESION.estudiante, data.id)).status()).toBe(200)

    await esperarRechazo(await inscribir(SESION.estudiante, grupos.sinHorario), 409, SIN_HORARIO)

    await abrirDeportes(page)
    const boton = tarjetaGrupo(page, 'sinHorario').getByRole('button', { name: /Inscribirme en Básquet/ })
    await expect(boton).toHaveAttribute('aria-disabled', 'true')
    await expect(boton).toHaveAccessibleDescription(SIN_HORARIO)
    await capturar(page, 'escritorio-sin-horario')

    const alta = await inscribir(SESION.estudiante, grupos.otroDia)
    expect(alta.status()).toBe(201)
    const { inscripcion } = await alta.json()
    expect((await cancelar(SESION.estudiante, inscripcion.id)).status()).toBe(200)
  })

  test('cancelar con el teclado libera el horario y el grupo antes superpuesto queda disponible', async ({ page }) => {
    await abrirDeportes(page)
    const baja = page.getByRole('button', { name: 'Cancelar mi inscripción en Fútbol, E2E H Fútbol' })
    await baja.focus()
    await page.keyboard.press('Enter')
    const dialogo = page.getByRole('dialog', { name: 'Cancelar tu inscripción en Fútbol' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByRole('button', { name: 'Volver sin cancelar' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialogo.getByRole('button', { name: 'Sí, cancelar mi inscripción' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialogo).toHaveCount(0)
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Cancelaste tu inscripción en Fútbol.' })
    ).toBeVisible()

    const boton = tarjetaGrupo(page, 'igual').getByRole('button', { name: /Inscribirme en Natación/ })
    await expect(boton).not.toHaveAttribute('aria-disabled', 'true')
    await expect(tarjetaGrupo(page, 'igual')).not.toContainText('Horario superpuesto')
    await capturar(page, 'escritorio-cancelacion-libera')

    await boton.click()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Te inscribiste en Natación (E2E H Natación igual).' })
    ).toBeVisible()
    expect(await activasDe(ESTUDIANTE.dni)).toEqual([grupos.igual])
  })

  test('una pantalla desactualizada muestra el rechazo real del conflicto y se reconcilia', async ({ page }) => {
    // Estado de partida: Natación igual (lunes 10:00–11:00) activa. Se cancela
    // por la API, se abre la pantalla y "otra pestaña" vuelve a inscribirse.
    const { data } = await clienteAdmin()
      .from('inscripciones_deportivas')
      .select('id')
      .eq('grupo_id', grupos.igual)
      .eq('estado', 'ACTIVA')
      .eq('alumno_id', await perfilPorDni(ESTUDIANTE.dni))
      .single()
    expect((await cancelar(SESION.estudiante, data.id)).status()).toBe(200)

    await abrirDeportes(page)
    const boton = tarjetaGrupo(page, 'derecha').getByRole('button', { name: /Inscribirme en Vóley/ })
    await expect(boton).not.toHaveAttribute('aria-disabled', 'true')

    expect((await inscribir(SESION.estudiante, grupos.igual)).status()).toBe(201)

    await boton.click()
    const alerta = aplicacion(page).getByRole('alert')
    await expect(alerta).toContainText(
      'Conflicto de horario con Natación (E2E H Natación igual): lunes de 10:00 a 11:00.'
    )
    await exigirPantallaSinDetalleTecnico(page, 'conflicto real')
    // La pantalla vuelve a leer el estado real y ahora anticipa el conflicto.
    await expect(boton).toHaveAttribute('aria-disabled', 'true')
    await capturar(page, 'escritorio-conflicto-servidor')
    expect(await activasDe(ESTUDIANTE.dni)).toEqual([grupos.igual])
  })

  test('la consulta de compatibilidad es solo propia', async () => {
    const propia = await pedirConSesion(SESION.estudiante, '/api/deportes/compatibilidad')
    expect(propia.status()).toBe(200)
    const { grupos: filas } = await propia.json()
    const derecha = filas.find((fila: any) => fila.grupo_id === grupos.derecha)
    expect(derecha.conflicto).toMatchObject({ deporte: 'Natación', dia_semana: 1 })
    expect(filas.find((fila: any) => fila.grupo_id === grupos.sinHorario).tiene_horario).toBe(false)

    const ajena = await pedirConSesion(
      SESION.estudiante,
      `/api/deportes/compatibilidad?alumno_id=${await perfilPorDni(ESTUDIANTE_AJENO.dni)}`
    )
    await esperarRechazo(ajena, 403, 'Solo podés consultar tu propia compatibilidad horaria.')
  })

  test('las operaciones de la dirección le responden 403', async () => {
    await esperarRechazo(
      await agregarFranja(SESION.estudiante, grupos.gestion, { dia_semana: 1, hora_inicio: '08:00', hora_fin: '09:00' }),
      403,
      'Solo la dirección puede configurar los horarios de los grupos deportivos.'
    )
    await esperarRechazo(
      await inscribirComoDireccion(SESION.estudiante, {
        alumno_id: await perfilPorDni(ESTUDIANTE.dni),
        grupo_id: grupos.otroDia,
      }),
      403,
      'Solo la dirección puede inscribir a un alumno en un deporte.'
    )
  })

  test('a 375 px los horarios se leen sin desplazamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await abrirDeportes(page)
    await expect(tarjetaGrupo(page, 'futbol')).toContainText('Lunes · 10:00 a 11:00')
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'movil-alumno-horarios')
  })
})

// ================================================================
// ESTUDIANTE AJENO: carrera por HTTP y aislamiento
// ================================================================
test.describe('ESTUDIANTE AJENO autenticado — horarios', () => {
  let grupos: Record<ClaveGrupo, string>

  test.beforeAll(async () => {
    grupos = await asegurarGrupos()
    await limpiarInscripciones(ESTUDIANTE_AJENO.dni)
  })

  test('dos altas incompatibles simultáneas por HTTP: confirma exactamente una', async () => {
    const [a, b] = await Promise.all([
      inscribir(SESION.ajeno, grupos.futbol),
      inscribir(SESION.ajeno, grupos.contiene),
    ])
    const estados = [a.status(), b.status()].sort()
    expect(estados).toEqual([201, 409])
    const rechazada = a.status() === 409 ? a : b
    const cuerpo = await rechazada.json()
    expect(cuerpo.error).toMatch(/^Conflicto de horario con /)
    expect(await activasDe(ESTUDIANTE_AJENO.dni)).toHaveLength(1)
  })

  test('su compatibilidad no refleja las inscripciones de otro alumno', async () => {
    await limpiarInscripciones(ESTUDIANTE_AJENO.dni)
    const respuesta = await pedirConSesion(SESION.ajeno, '/api/deportes/compatibilidad')
    const { grupos: filas } = await respuesta.json()
    expect(filas.every((fila: any) => fila.conflicto === null)).toBe(true)
    const texto = JSON.stringify(filas)
    expect(texto).not.toContain('Beto')
    expect(texto).not.toContain('LEG-PRUEBA-0002')
  })
})

// ================================================================
// DIRECTOR: franjas e inscripción administrativa
// ================================================================
test.describe.serial('DIRECTOR autenticado — horarios', () => {
  let grupos: Record<ClaveGrupo, string>
  let beto: string

  test.beforeAll(async () => {
    grupos = await asegurarGrupos()
    await vaciarFranjas(grupos.gestion)
    await limpiarInscripciones(ESTUDIANTE.dni)
    await limpiarInscripciones(ESTUDIANTE_AJENO.dni)
    beto = await perfilPorDni(ESTUDIANTE.dni)
  })

  test('gestiona las franjas con el teclado: foco, validación, anticipación, baja y Escape', async ({ page }) => {
    await abrirDeportes(page)
    const tarjeta = tarjetaGrupo(page, 'gestion')
    await expect(tarjeta).toContainText('Sin horarios cargados todavía.')
    const abrir = tarjeta.getByRole('button', { name: 'Gestionar los horarios de Vóley, E2E H Vóley gestión' })
    await abrir.focus()
    await page.keyboard.press('Enter')

    const dialogo = page.getByRole('dialog', { name: 'Horarios de Vóley · E2E H Vóley gestión' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByLabel('Día')).toBeFocused()
    await expect(dialogo).toContainText('Este grupo todavía no tiene horarios.')

    // Envío vacío: errores asociados a cada control, sin llamar a la API.
    await dialogo.getByRole('button', { name: 'Asignar franja' }).click()
    await expect(dialogo.getByLabel('Día')).toHaveAccessibleDescription('Seleccioná un día de la semana')
    await expect(dialogo.getByLabel('Hora de inicio')).toHaveAttribute('aria-invalid', 'true')

    await dialogo.getByLabel('Día').selectOption({ label: 'Lunes' })
    await dialogo.getByLabel('Hora de inicio').fill('10:00')
    await dialogo.getByLabel('Hora de fin').fill('11:00')
    await dialogo.getByRole('button', { name: 'Asignar franja' }).click()
    await expect(dialogo.getByRole('status')).toHaveText('Asignaste la franja del lunes de 10:00 a 11:00.')
    await expect(dialogo.getByRole('listitem')).toHaveText([/Lunes · 10:00 a 11:00/])

    // Superpuesta con la propia: la pantalla la anticipa con la misma regla.
    await dialogo.getByLabel('Día').selectOption({ label: 'Lunes' })
    await dialogo.getByLabel('Hora de inicio').fill('10:30')
    await dialogo.getByLabel('Hora de fin').fill('11:30')
    await dialogo.getByRole('button', { name: 'Asignar franja' }).click()
    await expect(dialogo.getByLabel('Hora de inicio')).toHaveAccessibleDescription(
      'La franja se superpone con otra franja del grupo: lunes de 10:00 a 11:00.'
    )

    // Contigua: se acepta.
    await dialogo.getByLabel('Hora de inicio').fill('11:00')
    await dialogo.getByLabel('Hora de fin').fill('12:00')
    await dialogo.getByRole('button', { name: 'Asignar franja' }).click()
    await expect(dialogo.getByRole('listitem')).toHaveText([/Lunes · 10:00 a 11:00/, /Lunes · 11:00 a 12:00/])
    await capturar(page, 'escritorio-director-horarios')

    await dialogo.getByRole('button', { name: 'Dar de baja la franja del lunes de 11:00 a 12:00' }).click()
    await expect(dialogo.getByRole('status')).toContainText('Diste de baja la franja del lunes de 11:00 a 12:00.')
    await expect(dialogo.getByRole('listitem')).toHaveText([/Lunes · 10:00 a 11:00/])

    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    await expect(abrir).toBeFocused()
    await expect(tarjeta).toContainText('Lunes · 10:00 a 11:00')

    // Persistencia real: después de recargar, la franja sigue ahí.
    await page.reload()
    await expect(tarjetaGrupo(page, 'gestion')).toContainText('Lunes · 10:00 a 11:00')
  })

  test('la API de franjas distingue 400, 404, 405, 409 y 422', async () => {
    const crear = (datos: Record<string, unknown>, grupo = grupos.gestion) =>
      agregarFranja(SESION.directora, grupo, datos)

    await esperarRechazo(await crear({ dia_semana: 8, hora_inicio: '08:00', hora_fin: '09:00' }), 422, 'Seleccioná un día de la semana')
    await esperarRechazo(await crear({ dia_semana: 2, hora_inicio: '09:00', hora_fin: '09:00' }), 422, 'La hora de inicio debe ser anterior a la hora de fin')
    await esperarRechazo(await crear({ dia_semana: 2, hora_inicio: '25:00', hora_fin: '26:00' }), 422)
    await esperarRechazo(
      await crear({ dia_semana: 2, hora_inicio: '08:00', hora_fin: '09:00', alumno_id: beto }),
      422,
      'La petición contiene campos no permitidos'
    )
    await esperarRechazo(
      await crear({ dia_semana: 2, hora_inicio: '08:00', hora_fin: '09:00' }, '00000000-0000-4000-8000-000000000000'),
      404,
      'El grupo deportivo no existe o ya no está disponible.'
    )
    await esperarRechazo(await crear({ dia_semana: 1, hora_inicio: '10:00', hora_fin: '11:00' }), 409, 'Esa franja ya está asignada a este grupo.')
    // La base rechaza la superposición aunque se saltee la pantalla.
    await esperarRechazo(
      await crear({ dia_semana: 1, hora_inicio: '10:30', hora_fin: '11:30' }),
      409,
      'La franja se superpone con otra franja del grupo: lunes de 10:00 a 11:00.'
    )

    const malformada = await pedirConSesion(SESION.directora, `/api/deportes/grupos/${grupos.gestion}/horarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Bytes crudos: un string se enviaría serializado como JSON válido.
      data: Buffer.from('{no es json'),
    })
    await esperarRechazo(malformada, 400, 'Cuerpo inválido')

    const { data } = await clienteAdmin()
      .from('grupos_deportivos_horarios')
      .select('id')
      .eq('grupo_id', grupos.gestion)
      .eq('activo', true)
      .single()
    const borrar = await pedirConSesion(SESION.directora, `/api/deportes/grupos/${grupos.gestion}/horarios/${data.id}`, {
      method: 'DELETE',
    })
    expect(borrar.status()).toBe(405)

    expect((await darDeBajaFranja(SESION.directora, grupos.gestion, data.id)).status()).toBe(200)
    await esperarRechazo(await darDeBajaFranja(SESION.directora, grupos.gestion, data.id), 409, 'Esa franja ya estaba dada de baja.')
    await esperarRechazo(
      await darDeBajaFranja(SESION.directora, grupos.futbol, data.id),
      404,
      'Esa franja no existe en este grupo.'
    )
    // La baja es lógica: la fila sigue existiendo con su fecha.
    const { data: fila } = await clienteAdmin()
      .from('grupos_deportivos_horarios')
      .select('activo, fecha_baja')
      .eq('id', data.id)
      .single()
    expect(fila.activo).toBe(false)
    expect(fila.fecha_baja).not.toBeNull()
  })

  test('inscribe a un alumno desde el diálogo y ve el conflicto que decide la base', async ({ page }) => {
    await abrirDeportes(page)
    const abrir = page.getByRole('button', { name: 'Inscribir alumno' })
    await abrir.click()
    const dialogo = page.getByRole('dialog', { name: 'Inscribir a un alumno' })
    await expect(dialogo.getByLabel('Alumno')).toBeFocused()

    await dialogo.getByLabel('Alumno').selectOption(beto)
    await dialogo.getByLabel('Grupo deportivo').selectOption(grupos.futbol)
    await expect(dialogo).toContainText('Sin conflictos con las actividades deportivas activas del alumno.')
    await dialogo.getByRole('button', { name: 'Inscribir' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(abrir).toBeFocused()
    await expect(
      aplicacion(page)
        .getByRole('status')
        .filter({ hasText: 'Inscribiste a Estudiante, Beto en Fútbol (E2E H Fútbol).' })
    ).toBeVisible()
    await capturar(page, 'escritorio-director-inscribe')

    // Mismo alumno, grupo superpuesto: la pantalla lo anticipa y, si se
    // insiste, la base lo rechaza con el mismo mensaje que al alumno.
    await abrir.click()
    await dialogo.getByLabel('Alumno').selectOption(beto)
    await dialogo.getByLabel('Grupo deportivo').selectOption(grupos.igual)
    await expect(dialogo).toContainText(CONFLICTO_FUTBOL_LUNES.mensaje)
    await dialogo.getByRole('button', { name: 'Inscribir' }).click()
    await expect(dialogo.getByRole('alert')).toHaveText(CONFLICTO_FUTBOL_LUNES.mensaje)
    await exigirPantallaSinDetalleTecnico(page, 'conflicto administrativo')
    await capturar(page, 'escritorio-director-conflicto')
    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    expect(await activasDe(ESTUDIANTE.dni)).toEqual([grupos.futbol])
  })

  test('alumno y dirección reciben la misma decisión, y la dirección no elude ninguna regla', async () => {
    // Mismo conflicto por las dos vías: mismo estado, mensaje y detalle.
    const direccion = await esperarRechazo(
      await inscribirComoDireccion(SESION.directora, { alumno_id: beto, grupo_id: grupos.contiene }),
      409
    )
    const alumno = await esperarRechazo(await inscribir(SESION.estudiante, grupos.contiene), 409)
    expect(direccion).toEqual(alumno)
    expect(direccion.conflicto).toEqual(CONFLICTO_FUTBOL_LUNES.conflicto)

    await esperarRechazo(
      await inscribirComoDireccion(SESION.directora, { alumno_id: beto, grupo_id: grupos.sinHorario }),
      409,
      SIN_HORARIO
    )
    const contiguo = await inscribirComoDireccion(SESION.directora, { alumno_id: beto, grupo_id: grupos.contiguo })
    expect(contiguo.status()).toBe(201)
    await esperarRechazo(
      await inscribirComoDireccion(SESION.directora, { alumno_id: beto, grupo_id: grupos.otroDia }),
      409,
      'El alumno ya tiene dos deportes activos, que es el máximo permitido.'
    )
    await esperarRechazo(
      await inscribirComoDireccion(SESION.directora, { alumno_id: beto, grupo_id: grupos.futbol }),
      409,
      'El alumno ya está inscripto en este grupo.'
    )

    const { data: primario } = await clienteAdmin()
      .from('grupos_deportivos')
      .select('id')
      .eq('nombre', 'E2E Vóley Primario')
      .maybeSingle()
    if (primario) {
      await limpiarInscripciones(ESTUDIANTE_AJENO.dni)
      await esperarRechazo(
        await inscribirComoDireccion(SESION.directora, {
          alumno_id: await perfilPorDni(ESTUDIANTE_AJENO.dni),
          grupo_id: primario.id,
        }),
        409,
        'Ese grupo no corresponde al nivel educativo del alumno.'
      )
    }

    await esperarRechazo(
      await inscribirComoDireccion(SESION.directora, { alumno_id: await perfilPorDni(DOCENTE.dni), grupo_id: grupos.otroDia }),
      404,
      'La persona seleccionada no tiene legajo académico de alumno.'
    )
    await esperarRechazo(
      await inscribirComoDireccion(SESION.directora, { alumno_id: 'no-es-uuid', grupo_id: grupos.otroDia }),
      422,
      'Seleccioná un alumno'
    )
    await esperarRechazo(
      await inscribirComoDireccion(SESION.directora, { alumno_id: beto, grupo_id: grupos.otroDia, cupo: 99 }),
      422,
      'La petición contiene campos no permitidos'
    )
    expect((await activasDe(ESTUDIANTE.dni)).sort()).toEqual([grupos.futbol, grupos.contiguo].sort())
  })

  test('una franja que chocaría con otra actividad de un inscripto se rechaza sin identificarlo', async () => {
    // Beto está en Fútbol (lunes y miércoles 10–11) y en Natación contigua.
    await esperarRechazo(
      await agregarFranja(SESION.directora, grupos.contiguo, { dia_semana: 3, hora_inicio: '10:30', hora_fin: '11:30' }),
      409,
      'La franja se superpone con Fútbol (E2E H Fútbol): miércoles de 10:00 a 11:00, donde participa 1 alumno de este grupo.'
    )
  })

  test('la consulta administrativa exige un alumno válido', async () => {
    const ok = await pedirConSesion(SESION.directora, `/api/deportes/compatibilidad?alumno_id=${beto}`)
    expect(ok.status()).toBe(200)
    const { grupos: filas } = await ok.json()
    expect(filas.find((fila: any) => fila.grupo_id === grupos.igual).conflicto).toMatchObject({
      deporte: 'Fútbol',
      dia_semana: 1,
    })
    await esperarRechazo(await pedirConSesion(SESION.directora, '/api/deportes/compatibilidad'), 422, 'Seleccioná un alumno')
    await esperarRechazo(
      await pedirConSesion(SESION.directora, `/api/deportes/compatibilidad?alumno_id=${await perfilPorDni(DOCENTE.dni)}`),
      404,
      'La persona seleccionada no tiene legajo académico de alumno.'
    )
  })

  test('a 375 px el diálogo de horarios se usa sin desplazamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await abrirDeportes(page)
    expect(await sinScrollHorizontal(page)).toBe(true)
    await tarjetaGrupo(page, 'futbol').getByRole('button', { name: /Gestionar los horarios/ }).click()
    await expect(page.getByRole('dialog', { name: 'Horarios de Fútbol · E2E H Fútbol' })).toBeVisible()
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'movil-director-horarios')
  })
})

// ================================================================
// Actores sin poderes sobre horarios
// ================================================================
for (const actor of [
  { etiqueta: 'DOCENTE', sesion: SESION.docente },
  { etiqueta: 'PADRE', sesion: SESION.padre },
  { etiqueta: 'PERSONAL', sesion: SESION.personal },
  { etiqueta: 'SIN PERFIL', sesion: SESION.sinPerfil },
]) {
  test.describe(`${actor.etiqueta} autenticado — horarios`, () => {
    let grupos: Record<ClaveGrupo, string>

    test.beforeAll(async () => {
      grupos = await asegurarGrupos()
    })

    test('recibe 403 al configurar franjas, inscribir a terceros y consultar compatibilidad', async () => {
      const { data } = await clienteAdmin()
        .from('grupos_deportivos_horarios')
        .select('id')
        .eq('grupo_id', grupos.futbol)
        .eq('activo', true)
        .limit(1)
        .single()
      await esperarRechazo(
        await agregarFranja(actor.sesion, grupos.gestion, { dia_semana: 5, hora_inicio: '08:00', hora_fin: '09:00' }),
        403,
        'Solo la dirección puede configurar los horarios de los grupos deportivos.'
      )
      await esperarRechazo(
        await darDeBajaFranja(actor.sesion, grupos.futbol, data.id),
        403,
        'Solo la dirección puede configurar los horarios de los grupos deportivos.'
      )
      await esperarRechazo(
        await inscribirComoDireccion(actor.sesion, { alumno_id: await perfilPorDni(ESTUDIANTE.dni), grupo_id: grupos.otroDia }),
        403,
        'Solo la dirección puede inscribir a un alumno en un deporte.'
      )
      await esperarRechazo(
        await pedirConSesion(actor.sesion, '/api/deportes/compatibilidad'),
        403,
        'No tenés permisos para consultar la compatibilidad horaria.'
      )
      // La franja sigue activa: ninguna denegación tuvo efecto.
      const { data: fila } = await clienteAdmin()
        .from('grupos_deportivos_horarios')
        .select('activo')
        .eq('id', data.id)
        .single()
      expect(fila.activo).toBe(true)
    })
  })
}

// ================================================================
// Data API directa: ni el DOCENTE ni una sesión anónima escriben
// ================================================================
test.describe('DOCENTE autenticado — Data API de horarios', () => {
  test('no lee franjas ajenas ni escribe horarios por fuera de las RPC', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const anonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
    const anfitrion = new URL(url).hostname
    expect(['127.0.0.1', 'localhost']).toContain(anfitrion)

    const anonimo = createClient(url, anonima, { auth: { persistSession: false } }) as any
    const lecturaAnonima = await anonimo.from('horarios').select('id')
    expect(lecturaAnonima.error?.code).toBe('42501')
    const rpcAnonima = await anonimo.rpc('consultar_compatibilidad_horaria')
    expect(rpcAnonima.error).not.toBeNull()

    const docente = createClient(url, anonima, { auth: { persistSession: false } }) as any
    const { error: errorIngreso } = await docente.auth.signInWithPassword({
      email: DOCENTE.email,
      password: DOCENTE.password,
    })
    expect(errorIngreso).toBeNull()

    const franjas = await docente.from('grupos_deportivos_horarios').select('id')
    expect(franjas.error).toBeNull()
    expect(franjas.data).toEqual([])

    const alta = await docente.from('horarios').insert({ dia_semana: 1, hora_inicio: '06:00', hora_fin: '07:00' })
    expect(alta.error?.code).toBe('42501')
    const cambio = await docente.from('grupos_deportivos_horarios').update({ activo: false }).neq('id', '00000000-0000-4000-8000-000000000000')
    expect(cambio.error?.code).toBe('42501')
    const borrado = await docente.from('horarios').delete().neq('id', '00000000-0000-4000-8000-000000000000')
    expect(borrado.error?.code).toBe('42501')
    const rpc = await docente.rpc('agregar_horario_grupo_deportivo', {
      p_grupo_id: '00000000-0000-4000-8000-000000000000',
      p_dia_semana: 1,
      p_hora_inicio: '06:00',
      p_hora_fin: '07:00',
    })
    expect(rpc.error?.code).toBe('42501')
    // Sin `signOut`: revocaría todas las sesiones del docente compartido.
  })
})
