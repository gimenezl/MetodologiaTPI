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
 * Identidades sintéticas que siembra `tests/auth.setup.ts`. Se repiten acá y no
 * se importan: importar ese archivo registraría sus pasos de setup dentro de
 * esta suite.
 */
const ESTUDIANTE = { dni: '99900002' }
const ESTUDIANTE_AJENO = { dni: '99900003' }
const DOCENTE = {
  dni: '99900004',
  email: 'docente.prueba@ept.local',
  password: 'prueba-ept-9-docente',
}

/**
 * Deportes con sesiones reales creadas por `tests/auth.setup.ts` (EPT-11,
 * EPT-34, EPT-36).
 *
 * No hay mocks: cada petición atraviesa cookies SSR, `auth.getUser()`, el
 * control de rol del servidor, los envoltorios RPC y PostgreSQL. Los rechazos
 * por duplicado, mismo deporte, tercer deporte, nivel ajeno y cupo agotado los
 * produce la base, no una comprobación previa de la aplicación.
 *
 * La clave de servicio local se usa solo para PREPARAR datos (leer
 * identificadores y limpiar las inscripciones de las identidades de prueba);
 * nunca participa de una operación que se esté verificando.
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
  ajeno: 'tests/.auth/estudiante-ajeno.json',
  inactivo: 'tests/.auth/estudiante-inactivo.json',
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
  voley: 'e0000000-0000-4000-8000-000000000105',
  basquet: 'e0000000-0000-4000-8000-000000000106',
}

/** Grupos de la matriz. Los alumnos de prueba están en «Sala de 5 A» (INICIAL). */
const GRUPOS = {
  futbolA: { deporte: DEPORTE.futbol, nivel: 'INICIAL', nombre: 'E2E Fútbol Inicial A', cupo: 5 },
  futbolB: { deporte: DEPORTE.futbol, nivel: 'INICIAL', nombre: 'E2E Fútbol Inicial B', cupo: 5 },
  natacion: { deporte: DEPORTE.natacion, nivel: 'INICIAL', nombre: 'E2E Natación Inicial', cupo: 5 },
  atletismo: { deporte: DEPORTE.atletismo, nivel: 'INICIAL', nombre: 'E2E Atletismo Inicial', cupo: 5 },
  basquet: { deporte: DEPORTE.basquet, nivel: 'INICIAL', nombre: 'E2E Básquet última plaza', cupo: 1 },
  voleyPrimario: { deporte: DEPORTE.voley, nivel: 'PRIMARIO', nombre: 'E2E Vóley Primario', cupo: 5 },
} as const

type ClaveGrupo = keyof typeof GRUPOS

const MENSAJE = {
  mismoGrupo: 'Ya estás inscripto en este grupo.',
  mismoDeporte:
    'Ya estás inscripto en otro grupo de este deporte. Si querés cambiar de grupo, primero cancelá esa inscripción.',
  limiteDos:
    'Ya tenés dos deportes activos, que es el máximo permitido. Cancelá uno para inscribirte en otro.',
  nivelAjeno: 'Ese grupo no corresponde a tu nivel educativo.',
  sinPlazas: 'El grupo ya no tiene plazas disponibles.',
  legajoInactivo:
    'Tu legajo académico no está activo, así que no podés inscribirte a deportes. Comunicate con la administración del centro educativo.',
}

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

/**
 * Nombre vigente del docente de prueba. Otra suite (usuarios) corrige sus datos
 * personales, así que no se supone: se lee de la base.
 */
async function nombreDocente(): Promise<{ nombre: string; apellido: string }> {
  const { data } = await clienteAdmin()
    .from('perfiles')
    .select('nombre, apellido')
    .eq('dni', DOCENTE.dni)
    .single()
  return { nombre: data.nombre as string, apellido: data.apellido as string }
}

async function nivelPorNombre(nombre: string): Promise<number> {
  const { data } = await clienteAdmin().from('niveles').select('id').eq('nombre', nombre).single()
  return data.id as number
}

/** Identificador de un grupo de la matriz, o `null` si todavía no existe. */
async function idGrupo(clave: ClaveGrupo): Promise<string | null> {
  const { data } = await clienteAdmin()
    .from('grupos_deportivos')
    .select('id')
    .eq('nombre', GRUPOS[clave].nombre)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/**
 * Crea por la API REAL de la dirección los grupos que falten. Es idempotente:
 * cada bloque de actor puede correr en cualquier orden.
 */
async function asegurarGrupos(): Promise<Record<ClaveGrupo, string>> {
  const profesor = await perfilPorDni(DOCENTE.dni)
  const ids = {} as Record<ClaveGrupo, string>
  for (const clave of Object.keys(GRUPOS) as ClaveGrupo[]) {
    let id = await idGrupo(clave)
    if (!id) {
      const grupo = GRUPOS[clave]
      const respuesta = await pedirConSesion(SESION.directora, '/api/deportes/grupos', {
        method: 'POST',
        data: {
          deporte_id: grupo.deporte,
          nivel_id: await nivelPorNombre(grupo.nivel),
          nombre: grupo.nombre,
          cupo: grupo.cupo,
          profesor_id: profesor,
        },
      })
      expect([201, 409]).toContain(respuesta.status())
      id = await idGrupo(clave)
    }
    if (!id) throw new Error(`No se pudo preparar el grupo ${clave}`)
    ids[clave] = id
  }
  return ids
}

/** Deja a un alumno de prueba sin inscripciones deportivas (preparación local). */
async function limpiarInscripciones(dni: string) {
  const alumno = await perfilPorDni(dni)
  const { error } = await clienteAdmin()
    .from('inscripciones_deportivas')
    .delete()
    .eq('alumno_id', alumno)
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

const inscribir = (sesion: string, grupoId: string) =>
  pedirConSesion(sesion, '/api/deportes/inscripciones', { method: 'POST', data: { grupo_id: grupoId } })

const cancelar = (sesion: string, inscripcionId: string) =>
  pedirConSesion(sesion, `/api/deportes/inscripciones/${inscripcionId}`, {
    method: 'PATCH',
    data: { accion: 'cancelar' },
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
  await capturarSinHerramientas(page, path.join('docs/evidence/EPT-11', `real-${nombre}.png`))
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
// ESTUDIANTE: recorrido completo de la historia
// ================================================================
test.describe.serial('ESTUDIANTE autenticado — deportes', () => {
  let grupos: Record<ClaveGrupo, string>

  test.beforeAll(async () => {
    grupos = await asegurarGrupos()
    await limpiarInscripciones(ESTUDIANTE.dni)
  })

  test('ve solo los grupos de su nivel derivado, con plazas y profesor', async ({ page }) => {
    await abrirDeportes(page)
    await expect(page.getByText('Inicial', { exact: true })).toBeVisible()
    await expect(page.getByText('0 de 2', { exact: true })).toBeVisible()
    for (const clave of ['futbolA', 'futbolB', 'natacion', 'atletismo', 'basquet'] as const) {
      await expect(tarjetaGrupo(page, clave)).toBeVisible()
    }
    await expect(page.getByText(GRUPOS.voleyPrimario.nombre)).toHaveCount(0)
    const docente = await nombreDocente()
    await expect(tarjetaGrupo(page, 'futbolA')).toContainText(
      `Profesor responsable: ${docente.nombre} ${docente.apellido}`
    )
    await expect(tarjetaGrupo(page, 'futbolA')).toContainText('Plazas disponibles: 5 de 5')
    await exigirPantallaSinDetalleTecnico(page, 'listado del alumno')
    await capturar(page, 'escritorio-alumno-listado')
  })

  test('se inscribe en un primer deporte y la inscripción persiste tras recargar', async ({ page }) => {
    await abrirDeportes(page)
    await tarjetaGrupo(page, 'futbolA').getByRole('button', { name: /Inscribirme en Fútbol/ }).click()

    const estado = aplicacion(page).getByRole('status').filter({ hasText: 'Te inscribiste en Fútbol' })
    await expect(estado).toBeVisible()
    await expect(page.getByText('1 de 2', { exact: true })).toBeVisible()
    await expect(tarjetaGrupo(page, 'futbolA')).toContainText('Plazas disponibles: 4 de 5')
    await capturar(page, 'escritorio-primer-deporte')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Mis deportes activos' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: `Cancelar mi inscripción en Fútbol, ${GRUPOS.futbolA.nombre}` })
    ).toBeVisible()
    await expect(page.getByText('1 de 2', { exact: true })).toBeVisible()
  })

  test('no puede duplicar el grupo ni sumar otro grupo del mismo deporte', async ({ page }) => {
    await esperarRechazo(await inscribir(SESION.estudiante, grupos.futbolA), 409, MENSAJE.mismoGrupo)
    await esperarRechazo(await inscribir(SESION.estudiante, grupos.futbolB), 409, MENSAJE.mismoDeporte)

    await abrirDeportes(page)
    const boton = tarjetaGrupo(page, 'futbolB').getByRole('button', { name: /Inscribirme en Fútbol/ })
    await expect(boton).toHaveAttribute('aria-disabled', 'true')
    await expect(boton).toHaveAccessibleDescription(MENSAJE.mismoDeporte)
    await boton.click({ force: true })
    await expect(page.getByText('1 de 2', { exact: true })).toBeVisible()
  })

  test('se inscribe en un segundo deporte distinto', async ({ page }) => {
    await abrirDeportes(page)
    await tarjetaGrupo(page, 'natacion').getByRole('button', { name: /Inscribirme en Natación/ }).click()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Te inscribiste en Natación' })
    ).toBeVisible()
    await expect(page.getByText('2 de 2', { exact: true })).toBeVisible()

    // El límite se explica antes del intento y en el control mismo.
    const tercero = tarjetaGrupo(page, 'atletismo').getByRole('button', { name: /Inscribirme en Atletismo/ })
    await expect(tercero).toHaveAttribute('aria-disabled', 'true')
    await expect(tercero).toHaveAccessibleDescription(MENSAJE.limiteDos)
    await capturar(page, 'escritorio-limite-dos')
  })

  test('el tercer deporte lo rechaza la API con un mensaje claro', async () => {
    const cuerpo = await esperarRechazo(
      await inscribir(SESION.estudiante, grupos.atletismo),
      409,
      MENSAJE.limiteDos
    )
    expect(cuerpo.campo).toBe('grupo_id')
  })

  test('una pantalla desactualizada muestra el rechazo real del tercer deporte y se reconcilia', async ({
    page,
  }) => {
    // Con un solo deporte activo la pantalla ofrece Atletismo.
    const { data } = await clienteAdmin()
      .from('inscripciones_deportivas')
      .select('id')
      .eq('grupo_id', grupos.natacion)
      .eq('estado', 'ACTIVA')
      .eq('alumno_id', await perfilPorDni(ESTUDIANTE.dni))
      .single()
    expect((await cancelar(SESION.estudiante, data.id)).status()).toBe(200)

    await abrirDeportes(page)
    const tercero = tarjetaGrupo(page, 'atletismo').getByRole('button', { name: /Inscribirme en Atletismo/ })
    await expect(tercero).not.toHaveAttribute('aria-disabled', 'true')

    // Otra pestaña ocupa el segundo lugar mientras esta sigue abierta.
    expect((await inscribir(SESION.estudiante, grupos.natacion)).status()).toBe(201)

    await tercero.click()
    const alerta = aplicacion(page).getByRole('alert').filter({ hasText: MENSAJE.limiteDos })
    await expect(alerta).toBeVisible()
    await expect(page.getByText('2 de 2', { exact: true })).toBeVisible()
    await exigirPantallaSinDetalleTecnico(page, 'rechazo del tercer deporte')
    await capturar(page, 'escritorio-error-tercer-deporte')
  })

  test('cancela con el teclado: el diálogo retiene el foco, Escape no cancela y la baja libera la plaza', async ({
    page,
  }) => {
    await abrirDeportes(page)
    await expect(tarjetaGrupo(page, 'natacion')).toContainText('Plazas disponibles: 4 de 5')

    const disparador = page.getByRole('button', {
      name: `Cancelar mi inscripción en Natación, ${GRUPOS.natacion.nombre}`,
    })
    await disparador.focus()
    await page.keyboard.press('Enter')
    const dialogo = page.getByRole('dialog', { name: 'Cancelar tu inscripción en Natación' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByRole('button', { name: 'Volver sin cancelar' })).toBeFocused()
    await capturar(page, 'escritorio-confirmar-baja')

    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    await expect(disparador).toBeFocused()
    await expect(page.getByText('2 de 2', { exact: true })).toBeVisible()

    await page.keyboard.press('Enter')
    await expect(dialogo).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(dialogo.getByRole('button', { name: 'Sí, cancelar mi inscripción' })).toBeFocused()
    await page.keyboard.press('Enter')

    const estado = aplicacion(page)
      .getByRole('status')
      .filter({ hasText: 'Cancelaste tu inscripción en Natación. La plaza quedó libre.' })
    await expect(estado).toBeVisible()
    await expect(page.getByLabel('Resultado de tu última operación')).toBeFocused()
    await expect(page.getByText('1 de 2', { exact: true })).toBeVisible()
    await expect(tarjetaGrupo(page, 'natacion')).toContainText('Plazas disponibles: 5 de 5')
    await expect(page.getByRole('heading', { name: 'Inscripciones anteriores' })).toBeVisible()
    await capturar(page, 'escritorio-baja-exitosa')
  })

  test('con la plaza liberada se inscribe en otro deporte usando solo el teclado', async ({ page }) => {
    await abrirDeportes(page)
    const boton = tarjetaGrupo(page, 'atletismo').getByRole('button', { name: /Inscribirme en Atletismo/ })
    await boton.focus()
    await expect(boton).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Te inscribiste en Atletismo' })
    ).toBeVisible()
    await expect(page.getByText('2 de 2', { exact: true })).toBeVisible()
  })

  test('un grupo de otro nivel, un grupo inexistente y un cuerpo manipulado se rechazan', async () => {
    const primero = await limpiarYDejarUno()
    await esperarRechazo(await inscribir(SESION.estudiante, grupos.voleyPrimario), 409, MENSAJE.nivelAjeno)
    await esperarRechazo(
      await inscribir(SESION.estudiante, '00000000-0000-4000-8000-000000000000'),
      404
    )
    const manipulado = await pedirConSesion(SESION.estudiante, '/api/deportes/inscripciones', {
      method: 'POST',
      data: { grupo_id: grupos.atletismo, alumno_id: primero, nivel_id: 1, cupo: 99 },
    })
    await esperarRechazo(manipulado, 400, 'La petición contiene campos no permitidos')
    await esperarRechazo(
      await pedirConSesion(SESION.estudiante, '/api/deportes/inscripciones', {
        method: 'POST',
        data: { grupo_id: 'no-es-un-uuid' },
      }),
      400
    )
    const borrar = await pedirConSesion(SESION.estudiante, '/api/deportes/inscripciones', {
      method: 'DELETE',
    })
    expect(borrar.status()).toBe(405)
  })

  test('una baja repetida no libera la plaza dos veces', async () => {
    const alumno = await perfilPorDni(ESTUDIANTE.dni)
    const { data } = await clienteAdmin()
      .from('inscripciones_deportivas')
      .select('id')
      .eq('alumno_id', alumno)
      .eq('estado', 'ACTIVA')
      .limit(1)
      .single()
    expect((await cancelar(SESION.estudiante, data.id)).status()).toBe(200)
    await esperarRechazo(await cancelar(SESION.estudiante, data.id), 409, 'Esa inscripción ya estaba cancelada.')
  })

  test('a 375 px la pantalla es usable, sin desplazamiento horizontal', async ({ page }) => {
    await limpiarYDejarUno()
    await page.setViewportSize({ width: 375, height: 812 })
    await abrirDeportes(page)
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'movil-alumno')

    const boton = page.getByRole('button', {
      name: /Cancelar mi inscripción en/,
    }).first()
    await boton.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'movil-confirmar-baja')
    await page.getByRole('button', { name: 'Volver sin cancelar' }).click()
  })

  test('con la sesión vencida el alta informa que hay que volver a iniciar sesión', async ({
    page,
    context,
  }) => {
    await limpiarInscripciones(ESTUDIANTE.dni)
    await abrirDeportes(page)
    await context.clearCookies()
    await tarjetaGrupo(page, 'futbolA').getByRole('button', { name: /Inscribirme en Fútbol/ }).click()
    const alerta = aplicacion(page).getByRole('alert').filter({
      hasText: 'Tu sesión venció. Iniciá sesión nuevamente para continuar.',
    })
    await expect(alerta).toBeVisible()
    await expect(alerta.getByRole('link', { name: 'Iniciar sesión' })).toBeVisible()
    await capturar(page, 'escritorio-sesion-vencida')
  })

  /** Deja al alumno con un único deporte activo y devuelve su perfil. */
  async function limpiarYDejarUno() {
    await limpiarInscripciones(ESTUDIANTE.dni)
    expect((await inscribir(SESION.estudiante, grupos.futbolA)).status()).toBe(201)
    return perfilPorDni(ESTUDIANTE.dni)
  }
})

// ================================================================
// Dos alumnos por la última plaza, y aislamiento entre alumnos
// ================================================================
test.describe('ESTUDIANTE AJENO autenticado — deportes', () => {
  let grupos: Record<ClaveGrupo, string>

  test.beforeAll(async () => {
    grupos = await asegurarGrupos()
  })

  test('dos alumnos piden la última plaza a la vez: confirma exactamente uno', async () => {
    await limpiarInscripciones(ESTUDIANTE.dni)
    await limpiarInscripciones(ESTUDIANTE_AJENO.dni)

    const [a, b] = await Promise.all([
      inscribir(SESION.estudiante, grupos.basquet),
      inscribir(SESION.ajeno, grupos.basquet),
    ])
    const estados = [a.status(), b.status()].sort()
    expect(estados).toEqual([201, 409])
    const rechazo = a.status() === 409 ? a : b
    await esperarRechazo(rechazo, 409, MENSAJE.sinPlazas)

    const { count } = await clienteAdmin()
      .from('inscripciones_deportivas')
      .select('id', { count: 'exact', head: true })
      .eq('grupo_id', grupos.basquet)
      .eq('estado', 'ACTIVA')
    expect(count).toBe(1)
  })

  test('no ve inscripciones de otro alumno y no puede cancelarlas', async ({ page }) => {
    await limpiarInscripciones(ESTUDIANTE.dni)
    await limpiarInscripciones(ESTUDIANTE_AJENO.dni)
    const alta = await inscribir(SESION.estudiante, grupos.natacion)
    expect(alta.status()).toBe(201)
    const { inscripcion } = await alta.json()

    await esperarRechazo(
      await cancelar(SESION.ajeno, inscripcion.id),
      404,
      'No encontramos una inscripción deportiva activa tuya para cancelar.'
    )

    await abrirDeportes(page)
    await expect(page.getByText('0 de 2', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Cancelar mi inscripción/ })).toHaveCount(0)
    await expect(tarjetaGrupo(page, 'natacion')).toContainText('Plazas disponibles: 4 de 5')
  })
})

// ================================================================
// Alumno sin legajo activo
// ================================================================
test.describe('ESTUDIANTE INACTIVO autenticado — deportes', () => {
  let grupos: Record<ClaveGrupo, string>

  test.beforeAll(async () => {
    grupos = await asegurarGrupos()
  })

  test('la pantalla explica por qué no puede inscribirse', async ({ page }) => {
    await abrirDeportes(page)
    await expect(aplicacion(page).getByText(MENSAJE.legajoInactivo)).toBeVisible()
    await expect(page.getByText('No hay grupos deportivos disponibles para tu nivel')).toBeVisible()
    await capturar(page, 'escritorio-alumno-inactivo')
  })

  test('la API tampoco lo deja inscribirse', async () => {
    await esperarRechazo(await inscribir(SESION.inactivo, grupos.futbolA), 409, MENSAJE.legajoInactivo)
  })
})

// ================================================================
// DIRECTOR: consulta y alta mínima de grupos
// ================================================================
test.describe('DIRECTOR autenticado — deportes', () => {
  let grupos: Record<ClaveGrupo, string>

  test.beforeAll(async () => {
    grupos = await asegurarGrupos()
  })

  test('crea un grupo válido desde el diálogo usando el teclado y lo ve en el listado', async ({ page }) => {
    const { error } = await clienteAdmin()
      .from('grupos_deportivos')
      .delete()
      .eq('nombre', 'E2E Vóley Inicial')
    expect(error).toBeNull()

    await abrirDeportes(page)
    await expect(
      page.getByRole('navigation', { name: 'Menú del dashboard' }).getByRole('link', { name: 'Deportes' })
    ).toBeVisible()
    await capturar(page, 'escritorio-director-listado')

    const nuevo = page.getByRole('button', { name: 'Nuevo grupo' })
    await nuevo.focus()
    await page.keyboard.press('Enter')
    const dialogo = page.getByRole('dialog', { name: 'Nuevo grupo deportivo' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByLabel('Deporte')).toBeFocused()

    // Envío vacío: errores de campo en español, sin llamar a la API.
    await dialogo.getByRole('button', { name: 'Crear grupo' }).click()
    // El error queda asociado al control: lo anuncia el lector de pantalla.
    await expect(dialogo.getByLabel('Deporte')).toHaveAttribute('aria-invalid', 'true')
    await expect(dialogo.getByLabel('Deporte')).toHaveAccessibleDescription('Seleccioná un deporte')
    await expect(dialogo.getByLabel('Cupo (plazas)')).toHaveAccessibleDescription(
      'El cupo debe ser un número entero entre 1 y 100'
    )
    await capturar(page, 'escritorio-director-validacion')

    await dialogo.getByLabel('Deporte').selectOption({ label: 'Vóley' })
    await dialogo.getByLabel('Nivel educativo').selectOption({ label: 'Inicial' })
    await dialogo.getByLabel('Nombre del grupo').fill('E2E Vóley Inicial')
    await dialogo.getByLabel('Cupo (plazas)').fill('12')
    await dialogo.getByLabel('Profesor responsable').selectOption(await perfilPorDni(DOCENTE.dni))
    await dialogo.getByLabel('Profesor responsable').press('Tab')
    await page.keyboard.press('Tab')
    await expect(dialogo.getByRole('button', { name: 'Crear grupo' })).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(dialogo).toHaveCount(0)
    await expect(nuevo).toBeFocused()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: 'Creaste el grupo «E2E Vóley Inicial».' })
    ).toBeVisible()
    const tarjeta = aplicacion(page).getByRole('listitem').filter({ hasText: 'E2E Vóley Inicial' })
    await expect(tarjeta).toContainText('0 de 12 plazas')
    const docente = await nombreDocente()
    await expect(tarjeta).toContainText(`${docente.apellido}, ${docente.nombre}`)
    await capturar(page, 'escritorio-director-grupo-creado')
  })

  test('un nombre repetido lo rechaza la base y el diálogo lo muestra en el campo', async ({ page }) => {
    await abrirDeportes(page)
    await page.getByRole('button', { name: 'Nuevo grupo' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Nuevo grupo deportivo' })
    await dialogo.getByLabel('Deporte').selectOption({ label: 'Fútbol' })
    await dialogo.getByLabel('Nivel educativo').selectOption({ label: 'Inicial' })
    await dialogo.getByLabel('Nombre del grupo').fill(`  ${GRUPOS.futbolA.nombre.toUpperCase()} `)
    await dialogo.getByLabel('Cupo (plazas)').fill('5')
    await dialogo.getByLabel('Profesor responsable').selectOption(await perfilPorDni(DOCENTE.dni))
    await dialogo.getByRole('button', { name: 'Crear grupo' }).click()
    await expect(
      dialogo.getByText('Ya existe un grupo con ese nombre para ese deporte y nivel.')
    ).toBeVisible()
    await exigirPantallaSinDetalleTecnico(page, 'grupo duplicado')
    await capturar(page, 'escritorio-director-duplicado')
  })

  test('la API rechaza profesor sin rol DOCENTE, inexistente, cupo inválido y campos extra', async () => {
    const base = {
      deporte_id: DEPORTE.atletismo,
      nivel_id: await nivelPorNombre('INICIAL'),
      nombre: 'E2E Rechazo',
      cupo: 5,
      profesor_id: await perfilPorDni(DOCENTE.dni),
    }
    const crear = (datos: Record<string, unknown>) =>
      pedirConSesion(SESION.directora, '/api/deportes/grupos', { method: 'POST', data: datos })

    await esperarRechazo(
      await crear({ ...base, profesor_id: await perfilPorDni(ESTUDIANTE.dni) }),
      409,
      'La persona seleccionada no tiene el rol DOCENTE.'
    )
    await esperarRechazo(
      await crear({ ...base, profesor_id: '00000000-0000-4000-8000-000000000000' }),
      404,
      'El profesor seleccionado no existe.'
    )
    await esperarRechazo(await crear({ ...base, cupo: 0 }), 400, 'El cupo debe ser de al menos 1 plaza')
    await esperarRechazo(await crear({ ...base, cupo: 101 }), 400, 'El cupo no puede superar las 100 plazas')
    await esperarRechazo(await crear({ ...base, cupo: 2.5 }), 400, 'El cupo debe ser un número entero')
    await esperarRechazo(await crear({ ...base, nombre: '   ' }), 400, 'El nombre del grupo es requerido')
    await esperarRechazo(await crear({ ...base, activo: false }), 400, 'La petición contiene campos no permitidos')
    await esperarRechazo(
      await crear({ ...base, deporte_id: '00000000-0000-4000-8000-000000000000' }),
      404,
      'El deporte seleccionado no existe.'
    )
  })

  test('consulta las inscripciones, pero no inscribe ni cancela en nombre de un alumno', async ({ page }) => {
    await limpiarInscripciones(ESTUDIANTE.dni)
    const alta = await inscribir(SESION.estudiante, grupos.atletismo)
    expect(alta.status()).toBe(201)
    const { inscripcion } = await alta.json()

    await esperarRechazo(
      await inscribir(SESION.directora, grupos.futbolA),
      403,
      'Solo un estudiante puede inscribirse a un deporte.'
    )
    await esperarRechazo(
      await cancelar(SESION.directora, inscripcion.id),
      403,
      'Solo un estudiante puede cancelar su inscripción a un deporte.'
    )

    await abrirDeportes(page)
    const fila = aplicacion(page).getByRole('listitem').filter({ hasText: 'Estudiante, Beto' })
    await expect(fila).toContainText('Atletismo')
    await expect(fila).toContainText('Legajo LEG-PRUEBA-0002')
    await expect(page.getByRole('button', { name: /Cancelar|Inscribir/ })).toHaveCount(0)
    await capturar(page, 'escritorio-director-inscripciones')

    await page.setViewportSize({ width: 375, height: 812 })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Deportes', level: 1 })).toBeVisible()
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'movil-director')
  })
})

// ================================================================
// Actores sin poderes deportivos
// ================================================================
for (const actor of [
  { etiqueta: 'DOCENTE', sesion: SESION.docente },
  { etiqueta: 'PADRE', sesion: SESION.padre },
  { etiqueta: 'PERSONAL', sesion: SESION.personal },
  { etiqueta: 'SIN PERFIL', sesion: SESION.sinPerfil },
]) {
  test.describe(`${actor.etiqueta} autenticado — deportes`, () => {
    let grupos: Record<ClaveGrupo, string>

    test.beforeAll(async () => {
      grupos = await asegurarGrupos()
    })

    test('no ve Deportes en la navegación ni accede a la pantalla', async ({ page }) => {
      await page.goto('/dashboard/deportes')
      await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
      await expect(
        page.getByRole('navigation', { name: 'Menú del dashboard' }).getByRole('link', { name: 'Deportes' })
      ).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Inscribirme/ })).toHaveCount(0)
      if (actor.etiqueta === 'DOCENTE') await capturar(page, 'escritorio-docente-restringido')
    })

    test('recibe 403 en el alta, la baja y la creación de grupos', async () => {
      await esperarRechazo(await inscribir(actor.sesion, grupos.futbolA), 403)
      await esperarRechazo(await cancelar(actor.sesion, '00000000-0000-4000-8000-000000000000'), 403)
      await esperarRechazo(
        await pedirConSesion(actor.sesion, '/api/deportes/grupos', {
          method: 'POST',
          data: {
            deporte_id: DEPORTE.voley,
            nivel_id: 1,
            nombre: `E2E ${actor.etiqueta}`,
            cupo: 5,
            profesor_id: '00000000-0000-4000-8000-000000000000',
          },
        }),
        403
      )
    })
  })
}

// ================================================================
// PostgreSQL detrás de la Data API: escritura directa y vía legada
// ================================================================
test.describe('DOCENTE autenticado — Data API y vía legada', () => {
  test('la Data API rechaza escrituras directas y deja el deporte legado en solo lectura', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const anonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
    const cliente = createClient(url, anonima, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as any
    const { error: errorSesion } = await cliente.auth.signInWithPassword({
      email: DOCENTE.email,
      password: DOCENTE.password,
    })
    expect(errorSesion).toBeNull()

    const alumno = await perfilPorDni(ESTUDIANTE.dni)
    const grupo = await idGrupo('futbolA')

    // Tablas deportivas: sin privilegio de escritura, sin RPC de alumno.
    const directa = await cliente
      .from('inscripciones_deportivas')
      .insert({ alumno_id: alumno, grupo_id: grupo, deporte_id: DEPORTE.futbol })
    expect(directa.error?.code).toBe('42501')
    const rpc = await cliente.rpc('inscribir_en_grupo_deportivo', { p_grupo_id: grupo })
    expect(rpc.error?.code).toBe('42501')
    const listado = await cliente.rpc('listar_grupos_deportivos')
    expect(listado.error?.code).toBe('42501')

    // Vía legada: DEPORTE rechazado por la base; TALLER sigue operativo.
    const { data: futbolLegado } = await cliente
      .from('actividades').select('id').eq('tipo', 'DEPORTE').eq('nombre', 'Fútbol').limit(1).single()
    const { data: danza } = await cliente
      .from('actividades').select('id').eq('tipo', 'TALLER').eq('nombre', 'Danza').limit(1).single()

    const deporte = await cliente
      .from('inscripciones')
      .insert({ estudiante_id: alumno, actividad_id: futbolLegado.id, estado: 'ACTIVO' })
    expect(deporte.error?.code).toBe('P5582')

    await clienteAdmin().from('inscripciones').delete().eq('estudiante_id', alumno).eq('actividad_id', danza.id)
    const taller = await cliente
      .from('inscripciones')
      .insert({ estudiante_id: alumno, actividad_id: danza.id, estado: 'ACTIVO' })
      .select('id')
      .single()
    expect(taller.error).toBeNull()
    const baja = await cliente.from('inscripciones').update({ estado: 'BAJA' }).eq('id', taller.data.id)
    expect(baja.error).toBeNull()
    const borrado = await cliente.from('inscripciones').delete().eq('id', taller.data.id)
    expect(borrado.error).toBeNull()
  })
})

// ================================================================
// Pantalla legada de Actividades
// ================================================================
test.describe('ESTUDIANTE autenticado — actividades legadas', () => {
  test('los deportes figuran como histórico sin acciones y el taller sigue operativo', async ({ page }) => {
    const alumno = await perfilPorDni(ESTUDIANTE.dni)
    const { data: danza } = await clienteAdmin()
      .from('actividades').select('id').eq('tipo', 'TALLER').eq('nombre', 'Danza').limit(1).single()
    await clienteAdmin().from('inscripciones').delete().eq('estudiante_id', alumno).eq('actividad_id', danza.id)

    await page.goto('/dashboard/cupos')
    await expect(page.getByRole('heading', { name: 'Actividades y talleres' })).toBeVisible()
    const futbol = aplicacion(page).locator('div.bg-white').filter({
      has: page.getByRole('heading', { name: 'Fútbol', exact: true }),
    })
    await expect(futbol.getByText('Histórico', { exact: true })).toBeVisible()
    await expect(futbol.getByRole('button')).toHaveCount(0)
    await expect(aplicacion(page).getByRole('link', { name: 'Deportes' })).toBeVisible()
    await capturar(page, 'escritorio-actividades-legado')

    const taller = aplicacion(page).locator('div.bg-white').filter({
      has: page.getByRole('heading', { name: 'Danza', exact: true }),
    })
    await taller.getByRole('button', { name: /Inscribirme/ }).click()
    await expect(taller.getByRole('button', { name: 'Darme de baja' })).toBeVisible()
    await taller.getByRole('button', { name: 'Darme de baja' }).click()
    await expect(taller.getByRole('button', { name: /Inscribirme/ })).toBeVisible()
  })
})
