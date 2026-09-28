import {
  expect,
  request as crearContexto,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { capturarSinHerramientas } from './_captura'

/**
 * Administración de inscripciones desde la INTERFAZ, con sesiones reales
 * (EPT-62, RF16).
 *
 * No hay mocks: la pantalla de Dirección lee las vistas administrativas, cada
 * clic viaja por la API real y PostgreSQL decide. Las inscripciones se crean con
 * las mismas rutas que usa el propio alumno (sesión de ESTUDIANTE), de modo que
 * el estado de partida es el que la aplicación produce. `psql` sobre el
 * contenedor local se usa solo para PREPARAR (retirar restos de una corrida
 * anterior) y para VERIFICAR el estado final de las filas; nunca participa de la
 * operación que se prueba. Las confirmaciones son de solo agregado: únicamente
 * la limpieza local deshabilita la guarda, dentro de su transacción.
 *
 * Los bloques se enrutan por proyecto según el actor (ver `playwright.config.ts`).
 * El archivo se omite salvo que el operador habilite la base local descartable.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const SESION = {
  directora: 'tests/.auth/directora.json',
  estudiante: 'tests/.auth/estudiante.json',
}

const BASE_URL = 'http://localhost:3000'
const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

const SERVICIO_COMEDOR = 'e0000000-0000-4000-8000-000000000010'
const SERVICIO_TRANSPORTE = 'e0000000-0000-4000-8000-000000000020'
const DNI_DOCENTE = '99900004'
const PREFIJO = 'E2E UI62'

/** Identidades que siembra `tests/auth.setup.ts` (se repiten para no importarlo). */
const ESTUDIANTE = { dni: '99900002', nombre: 'Beto', apellido: 'Estudiante', legajo: 'LEG-PRUEBA-0002' }
const DIRECTORA = 'Ana Directora'
const ALUMNO = `${ESTUDIANTE.apellido}, ${ESTUDIANTE.nombre}`

type Dominio = 'comedor' | 'transporte' | 'deportes'

const contextosActivos: APIRequestContext[] = []

test.afterEach(async () => {
  await Promise.all(contextosActivos.splice(0).map((contexto) => contexto.dispose()))
})

// ----------------------------------------------------------------
// Base local: preparación y verificación
// ----------------------------------------------------------------

function sql(sentencia: string) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

const perfilEstudiante = () => `(SELECT id FROM public.perfiles WHERE dni = '${ESTUDIANTE.dni}')`

/** Retira las inscripciones del estudiante de prueba y sus confirmaciones. */
function limpiarInscripciones() {
  sql(`
    BEGIN;
    ALTER TABLE public.confirmaciones_inscripcion
      DISABLE TRIGGER proteger_confirmacion_inscripcion_antes_de_escribir;
    DELETE FROM public.confirmaciones_inscripcion
      WHERE inscripcion_servicio_id IN (SELECT id FROM public.inscripciones_servicios WHERE alumno_id = ${perfilEstudiante()})
         OR inscripcion_deportiva_id IN (SELECT id FROM public.inscripciones_deportivas WHERE alumno_id = ${perfilEstudiante()})
         OR matricula_id IN (SELECT id FROM public.matriculas WHERE alumno_id = ${perfilEstudiante()});
    ALTER TABLE public.confirmaciones_inscripcion
      ENABLE TRIGGER proteger_confirmacion_inscripcion_antes_de_escribir;
    DELETE FROM public.inscripciones_servicios WHERE alumno_id = ${perfilEstudiante()};
    DELETE FROM public.inscripciones_deportivas WHERE alumno_id = ${perfilEstudiante()};
    COMMIT;
  `)
}

/** Retira además el deporte y el grupo que crea esta suite. */
function limpiarTodo() {
  limpiarInscripciones()
  sql(`
    BEGIN;
    DELETE FROM public.grupos_deportivos_horarios
      WHERE grupo_id IN (SELECT g.id FROM public.grupos_deportivos g
                         JOIN public.deportes d ON d.id = g.deporte_id
                         WHERE d.nombre ILIKE '${PREFIJO}%');
    DELETE FROM public.grupos_deportivos
      WHERE deporte_id IN (SELECT id FROM public.deportes WHERE nombre ILIKE '${PREFIJO}%');
    DELETE FROM public.deportes WHERE nombre ILIKE '${PREFIJO}%';
    COMMIT;
  `)
}

const TABLA = {
  comedor: { tabla: 'inscripciones_servicios', columna: 'inscripcion_servicio_id', filtro: `servicio_id = '${SERVICIO_COMEDOR}'` },
  transporte: { tabla: 'inscripciones_servicios', columna: 'inscripcion_servicio_id', filtro: `servicio_id = '${SERVICIO_TRANSPORTE}'` },
  deportes: { tabla: 'inscripciones_deportivas', columna: 'inscripcion_deportiva_id', filtro: 'TRUE' },
} as const

/** Identificador de la inscripción más reciente del estudiante, o `''`. */
function ultimaInscripcion(dominio: Dominio): string {
  const { tabla, filtro } = TABLA[dominio]
  return sql(
    `SELECT id FROM public.${tabla} WHERE alumno_id = ${perfilEstudiante()} AND ${filtro} ` +
      `ORDER BY fecha_inscripcion DESC, id DESC LIMIT 1;`
  )
}

function estado(dominio: Dominio, id: string): string {
  return sql(`SELECT estado FROM public.${TABLA[dominio].tabla} WHERE id = '${id}';`)
}

function fechaCancelacion(dominio: Dominio, id: string): string {
  return sql(`SELECT coalesce(fecha_cancelacion::text, '') FROM public.${TABLA[dominio].tabla} WHERE id = '${id}';`)
}

function confirmaciones(dominio: Dominio, id: string): number {
  return Number(
    sql(`SELECT count(*) FROM public.confirmaciones_inscripcion WHERE ${TABLA[dominio].columna} = '${id}';`)
  )
}

function momentoConfirmacion(dominio: Dominio, id: string): string {
  return sql(
    `SELECT confirmada_en::text FROM public.confirmaciones_inscripcion WHERE ${TABLA[dominio].columna} = '${id}';`
  )
}

function matriculaVigente(): string {
  return sql(`SELECT id FROM public.matriculas WHERE alumno_id = ${perfilEstudiante()} AND fecha_cierre IS NULL;`)
}

function confirmacionesDeMatricula(id: string): number {
  return Number(sql(`SELECT count(*) FROM public.confirmaciones_inscripcion WHERE matricula_id = '${id}';`))
}

// ----------------------------------------------------------------
// Peticiones con sesión real
// ----------------------------------------------------------------

async function conSesion(archivo: string): Promise<APIRequestContext> {
  const limite = Date.now() + 20_000
  while (!fs.existsSync(archivo)) {
    if (Date.now() > limite) throw new Error(`La sesión ${archivo} no quedó disponible.`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const contexto = await crearContexto.newContext({ baseURL: BASE_URL, storageState: archivo })
  contextosActivos.push(contexto)
  return contexto
}

/** Inscribe al estudiante de prueba con sus propias rutas, como lo haría él. */
async function inscribirEstudiante(dominio: Dominio, grupoId?: string) {
  const contexto = await conSesion(SESION.estudiante)
  const [url, data] =
    dominio === 'comedor'
      ? ['/api/comedor/inscripciones', { servicio_id: SERVICIO_COMEDOR }]
      : dominio === 'transporte'
        ? ['/api/transporte/inscripciones', { servicio_id: SERVICIO_TRANSPORTE }]
        : ['/api/deportes/inscripciones', { grupo_id: grupoId }]
  const respuesta = await contexto.post(url, { data })
  expect(respuesta.status(), `inscribir en ${dominio}: ${await respuesta.text()}`).toBe(201)
}

/** Crea un deporte y un grupo del nivel del estudiante, con horario, por la API real. */
async function crearGrupoDeportivo(): Promise<string> {
  const directora = await conSesion(SESION.directora)
  const deporte = await directora.post('/api/deportes', { data: { nombre: `${PREFIJO} Deporte` } })
  expect(deporte.status(), await deporte.text()).toBe(201)
  const deporteId = (await deporte.json()).deporte.id as string

  const nivel = sql(`SELECT id FROM public.niveles WHERE nombre = 'INICIAL';`)
  const docente = sql(`SELECT id FROM public.perfiles WHERE dni = '${DNI_DOCENTE}';`)
  const grupo = await directora.post('/api/deportes/grupos', {
    data: { deporte_id: deporteId, nivel_id: Number(nivel), nombre: `${PREFIJO} Grupo`, cupo: 5, profesor_id: docente },
  })
  expect(grupo.status(), await grupo.text()).toBe(201)
  const grupoId = (await grupo.json()).grupo.id as string

  const franja = await directora.post(`/api/deportes/grupos/${grupoId}/horarios`, {
    data: { dia_semana: 7, hora_inicio: '18:00', hora_fin: '19:00' },
  })
  expect(franja.status(), await franja.text()).toBe(201)
  return grupoId
}

// ----------------------------------------------------------------
// Ayudas de interfaz
// ----------------------------------------------------------------

async function capturar(page: Page, perfil: 'escritorio' | 'movil', nombre: string) {
  if (!CAPTURAR) return
  await capturarSinHerramientas(
    page,
    path.join('docs/evidence/EPT-62/capturas', `e2e-${perfil}-${nombre}.png`)
  )
}

const RUTA: Record<Dominio, string> = {
  comedor: '/dashboard/comedor',
  transporte: '/dashboard/transporte',
  deportes: '/dashboard/deportes',
}

const FILTRO_BAJAS: Record<Dominio, string> = {
  comedor: 'Bajas',
  transporte: 'Canceladas',
  deportes: 'Canceladas',
}

/** Filas de inscripciones visibles (tabla en escritorio, tarjetas en móvil). */
function filas(page: Page) {
  return page
    .locator('tbody tr, li')
    .filter({ hasText: /Legajo|LEG-/ })
    .filter({ hasText: ALUMNO })
    .filter({ visible: true })
}

async function haySrollHorizontal(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
}

const CONFIRMAR = `Confirmar inscripción de ${ALUMNO}`
const CANCELAR = `Cancelar inscripción de ${ALUMNO}`

async function abrir(page: Page, dominio: Dominio) {
  await page.goto(RUTA[dominio])
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

// ================================================================
// DIRECTOR: la interfaz, punta a punta
// ================================================================
test.describe('DIRECTOR autenticado — administración de inscripciones (interfaz)', () => {
  test.describe.configure({ mode: 'serial' })

  let grupoId = ''

  test.beforeAll(async () => {
    limpiarTodo()
    grupoId = await crearGrupoDeportivo()
    await inscribirEstudiante('comedor')
    await inscribirEstudiante('transporte')
    await inscribirEstudiante('deportes', grupoId)
  })

  test.afterAll(() => {
    limpiarTodo()
  })

  test('consulta comedor, transporte y deportes con el estado vigente y la confirmación', async ({ page }) => {
    for (const dominio of ['comedor', 'transporte', 'deportes'] as const) {
      await abrir(page, dominio)

      const fila = filas(page).first()
      await expect(fila).toContainText(ESTUDIANTE.legajo)
      await expect(fila).toContainText('Activa')
      await expect(fila).toContainText('Sin confirmar')
      await expect(fila.getByRole('button', { name: CONFIRMAR })).toBeVisible()
      await expect(fila.getByRole('button', { name: CANCELAR })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Confirmación' })).toBeVisible()
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)

      const texto = await page.getByRole('main').innerText()
      expect(texto).not.toMatch(/pendiente de activaci[oó]n|no v[aá]lida/i)
      expect(texto).not.toContain('solo lectura')
      expect(await haySrollHorizontal(page)).toBe(false)
      await capturar(page, 'escritorio', `${dominio}-director`)
    }
  })

  test('comedor: confirmar persiste, confirmar de nuevo es idempotente y cancelar conserva la confirmación', async ({
    page,
  }) => {
    const id = ultimaInscripcion('comedor')
    await abrir(page, 'comedor')

    // 1. Confirmar: acción real, registrada, con quién y cuándo.
    await filas(page).first().getByRole('button', { name: CONFIRMAR }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Confirmaste' })).toContainText(
      `Confirmaste la inscripción de ${ALUMNO}.`
    )
    await expect(filas(page).first()).toContainText(new RegExp(`Confirmada por ${DIRECTORA} el \\d{2}/\\d{2}/\\d{4}`))
    await expect(filas(page).first()).toContainText('Activa')
    await expect(filas(page).first().getByRole('button', { name: CONFIRMAR })).toHaveCount(0)
    expect(confirmaciones('comedor', id)).toBe(1)
    expect(estado('comedor', id)).toBe('ACTIVA')
    const momento = momentoConfirmacion('comedor', id)

    // 2. La confirmación persiste tras recargar.
    await page.reload()
    await expect(filas(page).first()).toContainText(`Confirmada por ${DIRECTORA}`)
    await capturar(page, 'escritorio', 'comedor-confirmada')

    // 3. Confirmar otra vez es idempotente: 200, misma persona, misma fecha, una sola fila.
    const repetida = await page.request.post(`/api/inscripciones/comedor/${id}/confirmacion`)
    expect(repetida.status()).toBe(200)
    expect((await repetida.json()).confirmacion.ya_confirmada).toBe(true)
    expect(confirmaciones('comedor', id)).toBe(1)
    expect(momentoConfirmacion('comedor', id)).toBe(momento)

    // 4. Cancelar en nombre del alumno, con diálogo.
    await filas(page).first().getByRole('button', { name: CANCELAR }).click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toContainText(`Cancelar la inscripción de ${ALUMNO}`)
    await expect(dialogo).toContainText('Comedor escolar')
    await expect(dialogo).toContainText('La confirmación registrada también se conserva en el historial.')
    await capturar(page, 'escritorio', 'dialogo-cancelacion')
    await dialogo.getByRole('button', { name: 'Sí, cancelar inscripción' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'Cancelaste' })).toContainText(
      `Cancelaste la inscripción de ${ALUMNO} en Comedor escolar.`
    )

    // 5. La baja es lógica: la fila sigue, con su confirmación previa visible.
    await page.getByRole('button', { name: FILTRO_BAJAS.comedor, exact: true }).click()
    const baja = filas(page).first()
    await expect(baja).toContainText('Cancelada')
    await expect(baja).toContainText(`Confirmada por ${DIRECTORA}`)
    await expect(baja).toContainText('Sin acciones')
    await expect(baja.getByRole('button')).toHaveCount(0)
    expect(estado('comedor', id)).toBe('CANCELADA')
    expect(fechaCancelacion('comedor', id)).not.toBe('')
    expect(confirmaciones('comedor', id)).toBe(1)

    // 6. Persiste tras recargar.
    await page.reload()
    await page.getByRole('button', { name: FILTRO_BAJAS.comedor, exact: true }).click()
    await expect(filas(page).first()).toContainText('Cancelada')
    await expect(filas(page).first()).toContainText(`Confirmada por ${DIRECTORA}`)
    await capturar(page, 'escritorio', 'comedor-cancelada-con-confirmacion')
  })

  test('comedor: el alumno vuelve a inscribirse y una cancelada sin confirmar explica por qué no se confirma', async ({
    page,
  }) => {
    const anterior = ultimaInscripcion('comedor')
    await inscribirEstudiante('comedor')
    const nueva = ultimaInscripcion('comedor')
    expect(nueva).not.toBe(anterior)

    await abrir(page, 'comedor')
    await expect(filas(page)).toHaveCount(1)
    await expect(filas(page).first()).toContainText('Sin confirmar')

    await filas(page).first().getByRole('button', { name: CANCELAR }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Sí, cancelar inscripción' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Cancelaste' })).toBeVisible()

    await page.getByRole('button', { name: FILTRO_BAJAS.comedor, exact: true }).click()
    await expect(filas(page)).toHaveCount(2)
    await expect(page.getByText('No se puede confirmar: la inscripción está cancelada.').filter({ visible: true })).toHaveCount(1)
    await expect(page.getByText(`Confirmada por ${DIRECTORA}`).filter({ visible: true })).toHaveCount(1)
    expect(confirmaciones('comedor', nueva)).toBe(0)
    expect(estado('comedor', nueva)).toBe('CANCELADA')
    await capturar(page, 'escritorio', 'comedor-confirmada-y-no-confirmada')
  })

  test('transporte: confirmar con la pantalla desactualizada se informa como «ya estaba confirmada»', async ({
    page,
  }) => {
    const id = ultimaInscripcion('transporte')
    await abrir(page, 'transporte')
    await expect(filas(page).first()).toContainText('Sin confirmar')

    // Otra persona de Dirección confirma mientras esta pantalla sigue abierta.
    const otra = await page.request.post(`/api/inscripciones/transporte/${id}/confirmacion`)
    expect(otra.status()).toBe(200)
    expect((await otra.json()).confirmacion.ya_confirmada).toBe(false)
    const momento = momentoConfirmacion('transporte', id)

    await filas(page).first().getByRole('button', { name: CONFIRMAR }).click()

    const aviso = page.getByRole('status').filter({ hasText: 'Ya estaba confirmada' })
    await expect(aviso).toContainText(new RegExp(`Ya estaba confirmada por ${DIRECTORA} el`))
    await expect(aviso).toContainText('no se modificó')
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
    // La pantalla vuelve a leer y muestra la confirmación real.
    await expect(filas(page).first()).toContainText(`Confirmada por ${DIRECTORA}`)
    expect(confirmaciones('transporte', id)).toBe(1)
    expect(momentoConfirmacion('transporte', id)).toBe(momento)
    await capturar(page, 'escritorio', 'transporte-ya-confirmada')

    // Cancelar en nombre del alumno.
    await filas(page).first().getByRole('button', { name: CANCELAR }).click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toContainText('Recorrido')
    await dialogo.getByRole('button', { name: 'Sí, cancelar inscripción' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Cancelaste' })).toBeVisible()
    await page.getByRole('button', { name: FILTRO_BAJAS.transporte, exact: true }).click()
    await expect(filas(page).first()).toContainText('Cancelada')
    await expect(filas(page).first()).toContainText(`Confirmada por ${DIRECTORA}`)
    expect(estado('transporte', id)).toBe('CANCELADA')
    expect(confirmaciones('transporte', id)).toBe(1)
  })

  test('deportes: una inscripción cancelada mientras tanto produce un conflicto claro, sin dejar confirmaciones', async ({
    page,
  }) => {
    const id = ultimaInscripcion('deportes')
    await abrir(page, 'deportes')
    await expect(filas(page).first()).toContainText('Sin confirmar')

    // Otra persona de Dirección la cancela mientras esta pantalla sigue abierta.
    const cancelada = await page.request.post(`/api/inscripciones/deportes/${id}/cancelacion`)
    expect(cancelada.status()).toBe(200)

    await filas(page).first().getByRole('button', { name: CONFIRMAR }).click()

    const alerta = page.getByRole('main').getByRole('alert')
    await expect(alerta).toContainText('No pudimos confirmar la inscripción')
    await expect(alerta).toContainText('La inscripción está cancelada y no puede confirmarse.')
    await expect(alerta).not.toContainText(/P6\d{3}|SQLSTATE/)
    expect(confirmaciones('deportes', id)).toBe(0)
    expect(estado('deportes', id)).toBe('CANCELADA')
    await capturar(page, 'escritorio', 'deportes-conflicto')

    // Tras releer, la fila ya figura cancelada y sin acciones.
    await page.getByRole('button', { name: FILTRO_BAJAS.deportes, exact: true }).click()
    await expect(filas(page).first()).toContainText('Cancelada')
    await expect(filas(page).first().getByRole('button')).toHaveCount(0)
  })

  test('deportes: el alumno vuelve a inscribirse, Dirección confirma y la confirmación persiste', async ({ page }) => {
    await inscribirEstudiante('deportes', grupoId)
    const id = ultimaInscripcion('deportes')

    await abrir(page, 'deportes')
    await filas(page).first().getByRole('button', { name: CONFIRMAR }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Confirmaste' })).toBeVisible()
    await expect(filas(page).first()).toContainText(`Confirmada por ${DIRECTORA}`)
    expect(confirmaciones('deportes', id)).toBe(1)

    await page.reload()
    await expect(filas(page).first()).toContainText(`Confirmada por ${DIRECTORA}`)

    // El filtro de confirmación muestra solo lo confirmado.
    await page.getByLabel('Confirmación', { exact: true }).selectOption('SIN_CONFIRMAR')
    await expect(filas(page)).toHaveCount(0)
    await page.getByLabel('Confirmación', { exact: true }).selectOption('CONFIRMADAS')
    await expect(filas(page)).toHaveCount(1)
    await capturar(page, 'escritorio', 'deportes-confirmada')
  })

  test('matrícula: se confirma la vigente, persiste, y la ayuda explica cómo se cierra', async ({ page }) => {
    const id = matriculaVigente()
    const alumnoId = sql(`SELECT id FROM public.perfiles WHERE dni = '${ESTUDIANTE.dni}';`)
    await page.goto(`/dashboard/alumnos/${alumnoId}`)

    const seccion = page.getByRole('region', { name: 'Confirmación de la matrícula' })
    await expect(seccion).toBeVisible()
    const vigente = seccion.getByRole('listitem').first()
    await expect(vigente).toContainText('Vigente')
    await expect(vigente).toContainText('Sin confirmar')

    // No existe botón para cancelar una matrícula, y la ayuda dice cómo se cierra.
    await expect(page.getByRole('button', { name: /cancelar|eliminar|borrar/i })).toHaveCount(0)
    await expect(seccion).toContainText(
      'Para cerrar esta matrícula, inactivá al alumno (se cierra por inactivación) o cambiale el curso (se cierra por cambio de curso).'
    )
    await expect(seccion.getByRole('link', { name: 'Ir al listado de alumnos' })).toHaveAttribute(
      'href',
      '/dashboard/alumnos'
    )
    await capturar(page, 'escritorio', 'matricula')

    await vigente.getByRole('button', { name: /^Confirmar matrícula de/ }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Confirmaste la matrícula' })).toBeVisible()
    await expect(vigente).toContainText(`Confirmada por ${DIRECTORA}`)
    await expect(vigente.getByRole('button')).toHaveCount(0)
    expect(confirmacionesDeMatricula(id)).toBe(1)

    await page.reload()
    await expect(seccion.getByRole('listitem').first()).toContainText(`Confirmada por ${DIRECTORA}`)

    // El endpoint no admite cancelar una matrícula: responde 400 con el motivo.
    const cancelar = await page.request.post(`/api/inscripciones/matriculas/${id}/cancelacion`)
    expect(cancelar.status()).toBe(400)
    expect((await cancelar.json()).codigo).toBe('MATRICULA_NO_SE_CANCELA')
    await capturar(page, 'escritorio', 'matricula-confirmada')
  })

  test('recorrido móvil: tarjetas, objetivos táctiles de 44 px, sin desborde y confirmación con el dedo', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    // Una inscripción vigente y sin confirmar para recorrer.
    await inscribirEstudiante('comedor')

    await abrir(page, 'comedor')
    await expect(page.getByRole('table')).toBeHidden()
    const tarjeta = filas(page).first()
    await expect(tarjeta).toContainText(ESTUDIANTE.legajo)
    await expect(tarjeta).toContainText('Sin confirmar')
    expect(await haySrollHorizontal(page)).toBe(false)

    for (const boton of await tarjeta.getByRole('button').all()) {
      const caja = await boton.boundingBox()
      expect(caja?.height ?? 0).toBeGreaterThanOrEqual(44)
    }
    await capturar(page, 'movil', 'comedor-director')

    await tarjeta.getByRole('button', { name: CANCELAR }).click()
    await capturar(page, 'movil', 'dialogo-cancelacion')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await tarjeta.getByRole('button', { name: CONFIRMAR }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Confirmaste' })).toBeVisible()
    await expect(filas(page).first()).toContainText(`Confirmada por ${DIRECTORA}`)
    expect(await haySrollHorizontal(page)).toBe(false)
    await capturar(page, 'movil', 'comedor-confirmada')

    for (const dominio of ['transporte', 'deportes'] as const) {
      await abrir(page, dominio)
      expect(await haySrollHorizontal(page), dominio).toBe(false)
      await capturar(page, 'movil', `${dominio}-director`)
    }
  })
})

// ================================================================
// ESTUDIANTE: no ve nada nuevo y sigue pudiendo cancelar lo suyo
// ================================================================
const CANCELAR_PROPIA: Record<Dominio, RegExp> = {
  comedor: /^Cancelar mi inscripción$/,
  transporte: /^Cancelar este recorrido$/,
  deportes: /^Cancelar mi inscripción en/,
}

test.describe('ESTUDIANTE autenticado — administración de inscripciones (interfaz)', () => {
  test.describe.configure({ mode: 'serial' })

  let grupoId = ''

  test.beforeAll(async () => {
    limpiarTodo()
    grupoId = await crearGrupoDeportivo()
    await inscribirEstudiante('comedor')
    await inscribirEstudiante('transporte')
    await inscribirEstudiante('deportes', grupoId)

    // Dirección confirma las tres: el alumno no debe enterarse por la interfaz.
    const directora = await conSesion(SESION.directora)
    for (const dominio of ['comedor', 'transporte', 'deportes'] as const) {
      const respuesta = await directora.post(
        `/api/inscripciones/${dominio}/${ultimaInscripcion(dominio)}/confirmacion`
      )
      expect(respuesta.status(), await respuesta.text()).toBe(200)
    }
  })

  test.afterAll(() => {
    limpiarTodo()
  })

  for (const dominio of ['comedor', 'transporte', 'deportes'] as const) {
    test(`${dominio}: el alumno ve su inscripción sin ninguna mención de la confirmación ni del confirmador`, async ({
      page,
    }) => {
      await page.goto(RUTA[dominio])
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      // Sigue viendo lo suyo: su inscripción vigente y el control para cancelarla.
      await expect(page.getByRole('button', { name: CANCELAR_PROPIA[dominio] })).toBeVisible()

      const texto = (await page.getByRole('main').innerText()).toLowerCase()
      for (const prohibido of ['confirmad', 'confirmación', 'sin confirmar', 'directora', 'confirmar inscripción']) {
        expect(texto, `el alumno no debe ver «${prohibido}»`).not.toContain(prohibido)
      }
      await expect(page.getByRole('columnheader', { name: 'Confirmación' })).toHaveCount(0)
      await expect(page.getByLabel('Confirmación', { exact: true })).toHaveCount(0)

      // Tampoco viaja en la carga de la página (payload de servidor).
      const html = await page.content()
      expect(html).not.toMatch(/confirmada_en|confirmada_por|confirmadaPor/)
      await capturar(page, 'escritorio', `${dominio}-alumno`)
    })
  }

  test('el alumno puede cancelar su propia inscripción y la confirmación queda en el historial', async ({ page }) => {
    const id = ultimaInscripcion('comedor')
    await page.goto(RUTA.comedor)

    await page.getByRole('button', { name: 'Cancelar mi inscripción' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Sí, cancelar mi inscripción' }).click()

    await expect(page.getByText('Sin inscripción activa')).toBeVisible()
    expect(estado('comedor', id)).toBe('CANCELADA')
    // El registro de Dirección no se toca ni se le muestra al alumno.
    expect(confirmaciones('comedor', id)).toBe(1)
    const texto = (await page.getByRole('main').innerText()).toLowerCase()
    expect(texto).not.toContain('confirmad')
  })

  test('el alumno no puede operar la API de administración', async ({ page }) => {
    for (const dominio of ['comedor', 'transporte', 'deportes', 'matriculas']) {
      const id = '00000000-0000-4000-8000-000000000000'
      for (const operacion of ['confirmacion', 'cancelacion']) {
        const respuesta = await page.request.post(`/api/inscripciones/${dominio}/${id}/${operacion}`)
        expect(respuesta.status(), `${dominio}/${operacion}`).toBe(403)
      }
    }
  })
})

// ================================================================
// El resto de los actores: sin acciones, sin columna, sin rutas
// ================================================================
async function exigirSinAdministracion(page: Page) {
  await expect(page.getByRole('button', { name: /^(Confirmar|Cancelar) inscripción de/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Confirmar matrícula/ })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'Confirmación' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Confirmación de la matrícula' })).toHaveCount(0)
  const texto = await page.locator('body').innerText()
  expect(texto).not.toMatch(/Confirmada por|Sin confirmar/)
}

for (const actor of [
  { etiqueta: 'PADRE', tienePanel: true },
  { etiqueta: 'DOCENTE', tienePanel: true },
  { etiqueta: 'PERSONAL', tienePanel: true },
  { etiqueta: 'SIN PERFIL', tienePanel: false },
]) {
  test.describe(`${actor.etiqueta} autenticado — administración de inscripciones (interfaz)`, () => {
    for (const dominio of ['comedor', 'transporte', 'deportes'] as const) {
      test(`${dominio}: no ve acciones ni columna de confirmación`, async ({ page }) => {
        await page.goto(RUTA[dominio])
        if (actor.tienePanel) {
          await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
          await capturar(page, 'escritorio', `${dominio}-${actor.etiqueta.toLowerCase().replace(' ', '-')}-restringido`)
        }
        await exigirSinAdministracion(page)
      })
    }

    test('la ficha del alumno es de acceso restringido y las rutas responden 403', async ({ page }) => {
      const alumnoId = sql(`SELECT id FROM public.perfiles WHERE dni = '${ESTUDIANTE.dni}';`)
      await page.goto(`/dashboard/alumnos/${alumnoId}`)
      await exigirSinAdministracion(page)

      for (const dominio of ['comedor', 'transporte', 'deportes', 'matriculas']) {
        for (const operacion of ['confirmacion', 'cancelacion']) {
          const respuesta = await page.request.post(
            `/api/inscripciones/${dominio}/00000000-0000-4000-8000-000000000000/${operacion}`
          )
          expect(respuesta.status(), `${dominio}/${operacion}`).toBe(403)
        }
      }
    })
  })
}

test.describe('ESTUDIANTE AJENO autenticado — administración de inscripciones (interfaz)', () => {
  test('no ve la confirmación de otra persona', async ({ page }) => {
    await page.goto(RUTA.comedor)
    await exigirSinAdministracion(page)
  })
})

test.describe('DIRECTOR BLOQUEADO autenticado — administración de inscripciones (interfaz)', () => {
  test('el panel lo lleva a acceso bloqueado y la API responde 403 ACCESO_BLOQUEADO', async ({ page }) => {
    for (const dominio of ['comedor', 'transporte', 'deportes'] as const) {
      await page.goto(RUTA[dominio])
      await expect(page).toHaveURL(/\/acceso-bloqueado/)
      await exigirSinAdministracion(page)
    }

    for (const dominio of ['comedor', 'transporte', 'deportes', 'matriculas']) {
      for (const operacion of ['confirmacion', 'cancelacion']) {
        const respuesta = await page.request.post(
          `/api/inscripciones/${dominio}/00000000-0000-4000-8000-000000000000/${operacion}`
        )
        expect(respuesta.status(), `${dominio}/${operacion}`).toBe(403)
        expect((await respuesta.json()).codigo).toBe('ACCESO_BLOQUEADO')
      }
    }
  })
})
