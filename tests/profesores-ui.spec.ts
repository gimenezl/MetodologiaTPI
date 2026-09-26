import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Interfaz de Profesores y de «Mis asignaciones» con datos sintéticos y API
 * interceptada (EPT-58). Corre en escritorio a 1280 px y en los dos perfiles
 * móviles forzados a 375 px, sin base de datos.
 */

const ESCRITORIO = { width: 1280, height: 900 }
const MOVIL = { width: 375, height: 812 }
const CAPTURAR = process.env.EPT_CAPTURAS === '1'
const QUINTEROS = 'dddddddd-1111-4111-8111-111111111111'
const BENITEZ = 'dddddddd-2222-4222-8222-222222222222'

function esMovil(page: Page) {
  return (page.viewportSize()?.width ?? ESCRITORIO.width) < 640
}

/** Una sola captura por ancho: escritorio (chromium) y móvil (Pixel 5 a 375 px). */
async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  const proyecto = test.info().project.name
  if (proyecto === 'iphone-13-webkit') return
  const ancho = esMovil(page) ? 'movil-375' : 'escritorio-1280'
  await page.screenshot({
    path: path.join('docs/evidence/EPT-58/etapa-2', `fixture-${ancho}-${nombre}.png`),
    fullPage: true,
  })
}

async function sinScrollHorizontal(page: Page) {
  const hay = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  )
  expect(hay, 'la página no debe desplazarse horizontalmente').toBe(false)
}

/** Auditoría de idioma: ninguna palabra de interfaz en inglés a la vista. */
async function soloEspanol(page: Page, contexto: string) {
  const texto = await page.evaluate(() => {
    const atributos = Array.from(document.querySelectorAll('[aria-label], [title], [placeholder]'))
      .flatMap((el) => ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''))
    return [document.body.innerText, ...atributos].join('\n')
  })
  const ingles = texto.match(
    /\b(Loading|Error|Submit|Cancel|Save|Delete|Close|Edit|Search|Status|Active|Inactive|Retry|Details?)\b/gu
  )
  expect(ingles, `${contexto}: texto en inglés visible`).toBeNull()
}

const DETALLE_QUINTEROS = {
  detalle: {
    ficha: {
      perfil_id: QUINTEROS,
      nombre: 'Laura',
      apellido: 'Quinteros',
      legajo_nro: 'LEG-DOC-4471',
      especialidad: 'Ciencias Naturales',
      estado: 'ACTIVO',
      ficha_completa: true,
      rol_docente_vigente: true,
      asignaciones_activas: 2,
      grupos_activos: 1,
      dni: '40111222',
      telefono: '362 4000000',
      direccion: 'Calle Sintética 123',
      fecha_nacimiento: '1985-04-12',
    },
    asignaciones: [
      { tipo: 'MATERIA', relacion_id: 'eeeeeeee-1111-4111-8111-111111111111', vigente: true, actividad_nombre: 'Biología', grupo_nombre: null, curso_denominacion: '3er Año', curso_division: 'A', nivel_nombre: 'SECUNDARIO', actividad_activa: true, curso_activo: true },
      { tipo: 'GRUPO_DEPORTIVO', relacion_id: 'eeeeeeee-3333-4333-8333-333333333333', vigente: true, actividad_nombre: 'Vóley', grupo_nombre: 'Grupo A', curso_denominacion: null, curso_division: null, nivel_nombre: 'SECUNDARIO', actividad_activa: true, curso_activo: null },
      { tipo: 'MATERIA', relacion_id: 'eeeeeeee-4444-4444-8444-444444444444', vigente: false, actividad_nombre: 'Física', grupo_nombre: null, curso_denominacion: '2do Año', curso_division: 'A', nivel_nombre: 'SECUNDARIO', actividad_activa: true, curso_activo: false },
    ],
    horarios: [
      { tipo: 'MATERIA', relacion_id: 'eeeeeeee-1111-4111-8111-111111111111', franja_id: 'ffffffff-1111-4111-8111-111111111111', dia_semana: 1, hora_inicio: '08:00:00', hora_fin: '09:20:00' },
      { tipo: 'GRUPO_DEPORTIVO', relacion_id: 'eeeeeeee-3333-4333-8333-333333333333', franja_id: 'ffffffff-4444-4444-8444-444444444444', dia_semana: 4, hora_inicio: '16:00:00', hora_fin: '17:30:00' },
    ],
    historial: [
      { id: 2, estado_anterior: 'INACTIVO', estado_nuevo: 'ACTIVO', motivo: null, fecha: '2026-09-20T13:00:00Z', actor: 'Ana Directora' },
      { id: 1, estado_anterior: 'ACTIVO', estado_nuevo: 'INACTIVO', motivo: 'Licencia por estudio', fecha: '2026-08-01T12:30:00Z', actor: 'Ana Directora' },
    ],
  },
}

test.describe('interfaz de profesores (dirección)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(esMovil(page) ? MOVIL : ESCRITORIO)
  })

  test('lista las fichas con estado, ficha incompleta y sin controles de borrado', async ({ page }) => {
    await page.goto('/pruebas-ui/profesores')

    const fichas = page.getByRole('list', { name: 'Fichas de profesores' })
    await expect(fichas.locator('> li')).toHaveCount(4)
    await expect(fichas.locator('> li').nth(0)).toContainText('Benítez, Tomás')
    await expect(fichas.locator('> li').nth(0)).toContainText('Ficha incompleta')
    await expect(fichas.locator('> li').nth(0)).toContainText('Legajo sin cargar')
    await expect(fichas.locator('> li').nth(2)).toContainText('Sin rol DOCENTE')
    await expect(fichas.locator('> li').nth(3)).toContainText('A cargo de 2 materias y 1 grupo deportivo')
    await expect(page.getByRole('button', { name: /eliminar|borrar/i })).toHaveCount(0)

    await sinScrollHorizontal(page)
    await soloEspanol(page, 'listado')
    await exigirPantallaSinDetalleTecnico(page, 'listado')
    await capturar(page, 'listado')
  })

  test('filtra por estado y por ficha incompleta', async ({ page }) => {
    await page.goto('/pruebas-ui/profesores')
    const filtros = page.getByRole('group', { name: 'Filtrar profesores' })
    const fichas = page.getByRole('list', { name: 'Fichas de profesores' })

    await filtros.getByRole('button', { name: 'Fichas incompletas', exact: true }).click()
    await expect(fichas.locator('> li')).toHaveCount(2)
    await expect(filtros.getByRole('button', { name: 'Fichas incompletas' })).toHaveAttribute('aria-pressed', 'true')
    await filtros.getByRole('button', { name: 'Inactivos', exact: true }).click()
    await expect(fichas.locator('> li')).toHaveCount(2)
    await expect(fichas).toContainText('Castro, Irene')
    await filtros.getByRole('button', { name: 'Activos', exact: true }).click()
    await expect(fichas.locator('> li')).toHaveCount(2)
    await capturar(page, 'filtro-incompletas')
  })

  test('muestra el detalle con carga, datos, relaciones separadas e historial', async ({ page }) => {
    let liberar!: () => void
    const pendiente = new Promise<void>((resolve) => {
      liberar = resolve
    })
    await page.route(`**/api/profesores/${QUINTEROS}`, async (route) => {
      await pendiente
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DETALLE_QUINTEROS) })
    })
    await page.goto('/pruebas-ui/profesores')

    const boton = page.getByRole('button', { name: 'Ver el detalle de Quinteros, Laura' })
    await boton.click()
    await expect(boton).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('status').filter({ hasText: 'Cargando el detalle de Quinteros, Laura' })).toBeAttached()
    await capturar(page, 'detalle-carga')
    liberar()

    const vigentes = page.getByRole('list', { name: 'Materias y grupos vigentes de Quinteros, Laura' })
    await expect(vigentes).toContainText('Biología · 3er Año A')
    await expect(vigentes).toContainText('Lunes · 08:00 a 09:20')
    await expect(vigentes).toContainText('Grupo A · Vóley')
    const historicas = page.getByRole('list', { name: 'Materias y grupos inactivos de Quinteros, Laura' })
    await expect(historicas).toContainText('Física · 2do Año A')
    await expect(historicas).toContainText('Curso inactivo')
    await expect(vigentes).not.toContainText('Física')
    const historial = page.getByRole('list', { name: 'Cambios de estado de Quinteros, Laura' })
    await expect(historial).toContainText('Activo → Inactivo')
    await expect(historial).toContainText('Motivo: Licencia por estudio')
    await expect(historial).toContainText('Por Ana Directora')
    await expect(page.getByText('12/04/1985')).toBeVisible()
    await expect(page.getByRole('button', { name: /editar el historial|borrar/i })).toHaveCount(0)

    await sinScrollHorizontal(page)
    await soloEspanol(page, 'detalle')
    await exigirPantallaSinDetalleTecnico(page, 'detalle')
    await capturar(page, 'detalle')
  })

  test('informa un error de carga del detalle y permite reintentar', async ({ page }) => {
    let intentos = 0
    await page.route(`**/api/profesores/${QUINTEROS}`, async (route) => {
      intentos += 1
      if (intentos === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'El servicio no está disponible en este momento. Volvé a intentarlo en unos minutos.' }),
        })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DETALLE_QUINTEROS) })
    })
    await page.goto('/pruebas-ui/profesores')
    await page.getByRole('button', { name: 'Ver el detalle de Quinteros, Laura' }).click()

    const alerta = page.getByRole('alert').filter({ hasText: 'El servicio no está disponible' })
    await expect(alerta).toBeVisible()
    await capturar(page, 'detalle-error')
    await alerta.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByRole('list', { name: 'Materias y grupos vigentes de Quinteros, Laura' })).toBeVisible()
  })

  test('edita la ficha: foco, Escape, validación local y especialidad normalizada', async ({ page }) => {
    let cuerpo: unknown
    let llamadas = 0
    await page.route(`**/api/profesores/${BENITEZ}`, async (route) => {
      llamadas += 1
      cuerpo = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.goto('/pruebas-ui/profesores')

    const disparador = page.getByRole('button', { name: 'Editar la ficha de Benítez, Tomás' })
    // Se abre con el teclado: WebKit no enfoca un botón al hacer clic, y el
    // foco vuelve al elemento que lo tenía al abrir.
    await disparador.focus()
    await page.keyboard.press('Enter')
    const dialogo = page.getByRole('dialog', { name: 'Ficha de Benítez, Tomás' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByLabel('Número de legajo')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialogo).toBeHidden()
    await expect(disparador).toBeFocused()

    await disparador.click()
    await dialogo.getByRole('button', { name: 'Guardar ficha' }).click()
    await expect(dialogo.getByText('El número de legajo es requerido')).toBeVisible()
    await expect(dialogo.getByText('La especialidad es obligatoria')).toBeVisible()
    await dialogo.getByLabel('Número de legajo').fill('LEG-DOC-4474')
    await dialogo.getByLabel('Especialidad').fill('X')
    await dialogo.getByRole('button', { name: 'Guardar ficha' }).click()
    await expect(dialogo.getByText('La especialidad debe tener entre 2 y 100 caracteres')).toBeVisible()
    expect(llamadas).toBe(0)
    await capturar(page, 'ficha-validacion')

    // U+0085 y U+00A0 se escriben por código: el contrato los trata como espacios.
    const nel = String.fromCodePoint(0x85)
    const nbsp = String.fromCodePoint(0xa0)
    await dialogo.getByLabel('Especialidad').fill(`  Ciencias${nel}${nbsp} Sociales `)
    await dialogo.getByRole('button', { name: 'Guardar ficha' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Ficha de Benítez, Tomás guardada.' })).toBeVisible()
    expect(cuerpo).toEqual({ accion: 'actualizar_ficha', legajo_nro: 'LEG-DOC-4474', especialidad: 'Ciencias Sociales' })
    await expect(dialogo).toBeHidden()
    await capturar(page, 'ficha-exito')
  })

  test('muestra en el campo el legajo duplicado que informa el servidor', async ({ page }) => {
    await page.route(`**/api/profesores/${BENITEZ}`, (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Ya existe un legajo con ese número.', campo: 'legajo_nro' }),
      })
    )
    await page.goto('/pruebas-ui/profesores')
    await page.getByRole('button', { name: 'Editar la ficha de Benítez, Tomás' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Ficha de Benítez, Tomás' })
    await dialogo.getByLabel('Número de legajo').fill('LEG-DOC-4471')
    await dialogo.getByLabel('Especialidad').fill('Historia')
    await dialogo.getByRole('button', { name: 'Guardar ficha' }).click()
    await expect(dialogo.getByLabel('Número de legajo')).toHaveAttribute('aria-invalid', 'true')
    await expect(dialogo.getByText('Ya existe un legajo con ese número.')).toBeVisible()
    // Un solo anuncio, en el campo: ni la página ni un aviso flotante lo repiten.
    await expect(page.getByRole('alert').filter({ hasText: 'Ya existe un legajo con ese número.' })).toHaveCount(1)
    await exigirPantallaSinDetalleTecnico(page, 'legajo duplicado')
  })

  test('un rechazo sin campo se anuncia una vez dentro del diálogo, que sigue abierto', async ({ page }) => {
    await page.route(`**/api/profesores/${BENITEZ}`, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Hay otra operación en curso sobre este profesor. Volvé a intentarlo en unos segundos.',
        }),
      })
    )
    await page.goto('/pruebas-ui/profesores')
    await page.getByRole('button', { name: 'Editar la ficha de Benítez, Tomás' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Ficha de Benítez, Tomás' })
    await dialogo.getByLabel('Número de legajo').fill('LEG-DOC-4474')
    await dialogo.getByLabel('Especialidad').fill('Historia')
    await dialogo.getByRole('button', { name: 'Guardar ficha' }).click()

    const alerta = page.getByRole('alert').filter({ hasText: 'Hay otra operación en curso sobre este profesor.' })
    await expect(alerta).toHaveCount(1)
    await expect(dialogo.getByRole('alert')).toContainText('Hay otra operación en curso')
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByLabel('Número de legajo')).toHaveValue('LEG-DOC-4474')
    await exigirPantallaSinDetalleTecnico(page, 'rechazo sin campo')
  })

  test('explica qué impide inactivar y no cierra el diálogo', async ({ page }) => {
    await page.route(`**/api/profesores/${QUINTEROS}`, (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error:
            'No se puede inactivar al profesor: sigue a cargo de la materia Biología en 3er Año A, el grupo Grupo A de Vóley. Reasigná o inactivá esas relaciones y volvé a intentarlo. No se guardó ningún cambio.',
          bloqueos: {
            asignaciones: [{ materia: 'Biología', curso: '3er Año A', nivel: 'SECUNDARIO' }],
            grupos: [{ deporte: 'Vóley', grupo: 'Grupo A', nivel: 'SECUNDARIO' }],
          },
        }),
      })
    )
    await page.goto('/pruebas-ui/profesores')
    await page.getByRole('button', { name: 'Inactivar a Quinteros, Laura' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Inactivar a Quinteros, Laura' })
    await expect(dialogo.getByLabel('Motivo (opcional)')).toBeFocused()
    await dialogo.getByRole('button', { name: 'Confirmar inactivación' }).click()

    const bloqueos = dialogo.getByRole('list', { name: 'Relaciones que impiden inactivar' })
    await expect(bloqueos).toContainText('Materia Biología en 3er Año A')
    await expect(bloqueos).toContainText('Grupo Grupo A de Vóley')
    await expect(dialogo).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'No se puede inactivar al profesor' })).toHaveCount(1)
    await exigirPantallaSinDetalleTecnico(page, 'inactivación bloqueada')
    await capturar(page, 'inactivacion-bloqueada')
  })

  test('inactiva con motivo recortado y rechaza un motivo de más de 500 caracteres', async ({ page }) => {
    let cuerpo: unknown
    let llamadas = 0
    await page.route(`**/api/profesores/${BENITEZ}`, async (route) => {
      llamadas += 1
      cuerpo = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.goto('/pruebas-ui/profesores')
    await page.getByRole('button', { name: 'Inactivar a Benítez, Tomás' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Inactivar a Benítez, Tomás' })

    await dialogo.getByLabel('Motivo (opcional)').fill('x'.repeat(501))
    await dialogo.getByRole('button', { name: 'Confirmar inactivación' }).click()
    await expect(dialogo.getByText('El motivo no puede superar los 500 caracteres')).toBeVisible()
    expect(llamadas).toBe(0)

    await dialogo.getByLabel('Motivo (opcional)').fill('   Licencia  ')
    await capturar(page, 'dialogo-estado')
    await dialogo.getByRole('button', { name: 'Confirmar inactivación' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Benítez, Tomás quedó inactivo.' })).toBeVisible()
    expect(cuerpo).toEqual({ accion: 'cambiar_estado', estado: 'INACTIVO', motivo: 'Licencia' })
  })

  test('anuncia qué exige la reactivación', async ({ page }) => {
    await page.goto('/pruebas-ui/profesores')
    await page.getByRole('button', { name: 'Reactivar a Castro, Irene' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Reactivar a Castro, Irene' })
    await expect(dialogo).toContainText('tiene que estar completa (legajo y especialidad)')
    await expect(dialogo.getByRole('button', { name: 'Confirmar reactivación' })).toBeVisible()
  })

  test('estados de página: vacío, carga, error y éxito', async ({ page }) => {
    await page.goto('/pruebas-ui/profesores?vacio=1')
    await expect(page.getByText('Todavía no hay profesores')).toBeVisible()
    await capturar(page, 'vacio')

    await page.goto('/pruebas-ui/profesores?estado=carga')
    await expect(page.getByRole('status').filter({ hasText: 'Cargando las fichas de profesores' })).toBeAttached()
    await capturar(page, 'carga')

    await page.goto('/pruebas-ui/profesores?estado=error')
    await expect(page.getByRole('alert').filter({ hasText: 'No pudimos cargar los profesores' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Reintentar' })).toHaveAttribute('href', '/dashboard/profesores')
    await capturar(page, 'error')

    await page.goto('/pruebas-ui/profesores?estado=exito')
    await expect(page.getByRole('status').filter({ hasText: 'Ficha de Quinteros, Laura guardada.' })).toBeVisible()
    await sinScrollHorizontal(page)
    await capturar(page, 'exito')
  })
})

test.describe('interfaz de mis asignaciones (docente)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(esMovil(page) ? MOVIL : ESCRITORIO)
  })

  test('separa lo vigente, el horario semanal y lo histórico', async ({ page }) => {
    await page.goto('/pruebas-ui/mis-asignaciones')

    await expect(page.getByRole('heading', { level: 1, name: 'Mis asignaciones' })).toBeVisible()
    const vigentes = page.getByRole('list', { name: 'Materias y grupos que tengo a cargo' })
    await expect(vigentes.locator('> li')).toHaveCount(3)
    await expect(vigentes).toContainText('Biología · 3er Año A')
    await expect(vigentes).toContainText('Nivel Secundario')
    await expect(vigentes).not.toContainText('Física')
    const historicas = page.getByRole('list', { name: 'Materias y grupos inactivos a mi nombre' })
    await expect(historicas).toContainText('Física · 2do Año A')
    const horario = page.getByRole('region', { name: 'Horario semanal' })
    await expect(horario).toContainText('Lunes')
    await expect(horario).toContainText('16:00 a 17:30')
    await expect(page.getByRole('button', { name: /editar|borrar|inscribir/i })).toHaveCount(0)

    await sinScrollHorizontal(page)
    await soloEspanol(page, 'mis asignaciones')
    await exigirPantallaSinDetalleTecnico(page, 'mis asignaciones')
    await capturar(page, 'mis-asignaciones')
  })

  test('explica la ficha inactiva e incompleta sin ocultar la información', async ({ page }) => {
    await page.goto('/pruebas-ui/mis-asignaciones?inactivo=1')
    await expect(page.getByText('Tu ficha está inactiva.')).toBeVisible()
    await expect(page.getByText('Tu ficha está incompleta: falta la especialidad.')).toBeVisible()
    await expect(page.getByRole('list', { name: 'Materias y grupos que tengo a cargo' })).toBeVisible()
    await capturar(page, 'mis-asignaciones-inactiva')
  })

  test('estados vacío y de carga', async ({ page }) => {
    await page.goto('/pruebas-ui/mis-asignaciones?vacio=1')
    await expect(page.getByText('Todavía no tenés materias ni grupos activos a cargo.')).toBeVisible()
    await expect(page.getByText('No hay horarios cargados para lo que tenés a cargo.')).toBeVisible()
    await capturar(page, 'mis-asignaciones-vacio')

    await page.goto('/pruebas-ui/mis-asignaciones?estado=carga')
    await expect(page.getByRole('status').filter({ hasText: 'Cargando tus asignaciones' })).toBeAttached()
    await capturar(page, 'mis-asignaciones-carga')
  })
})
