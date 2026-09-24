import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { capturarSinHerramientas } from './_captura'
import { exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Horarios en la interfaz de deportes con datos deterministas y API
 * interceptada, sin base (EPT-12). PRUEBA DE PRESENTACIÓN.
 *
 * Corre en escritorio y en los dos perfiles móviles oficiales. Demuestra
 * estados difíciles de inducir contra la base (envío en curso, consulta de
 * compatibilidad fallida o lenta, respuesta del servidor con conflicto),
 * accesibilidad, idioma y comportamiento responsive. NO demuestra ninguna
 * regla: la decide PostgreSQL y la prueban `horarios-auth.spec.ts`,
 * `horarios_rls.sql` y `horarios_concurrencia.mjs`. Las capturas de este
 * archivo se nombran `fixture-*` para no confundirlas con las reales.
 */

const ESCRITORIO = { width: 1280, height: 900 }
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

function esMovil(page: Page) {
  return (page.viewportSize()?.width ?? ESCRITORIO.width) < 640
}

/** En WebKit táctil (iPhone 13) el navegador no recorre controles con Tab. */
function hayTeclado(page: Page) {
  return page.context().browser()?.browserType().name() !== 'webkit'
}

async function capturar(page: Page, nombre: string, opciones?: { paginaCompleta?: boolean }) {
  if (!CAPTURAR) return
  const perfil = esMovil(page) ? 'movil' : 'escritorio'
  await capturarSinHerramientas(
    page,
    path.join('docs/evidence/EPT-12', `fixture-${perfil}-${nombre}.png`),
    opciones
  )
}

function aplicacion(page: Page) {
  return page.getByRole('main')
}

function tarjeta(page: Page, texto: string) {
  return aplicacion(page).getByRole('listitem').filter({ has: page.getByText(texto, { exact: true }) })
}

async function sinScrollHorizontal(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  )
}

const CONFLICTO =
  'Conflicto de horario con Natación (Primario): lunes de 10:30 a 11:30.'
const SIN_HORARIO =
  'Este grupo todavía no tiene horarios cargados, así que no admite inscripciones.'

test.describe('horarios del alumno (fixture)', () => {
  test.beforeEach(async ({ page }) => {
    if (!esMovil(page)) await page.setViewportSize(ESCRITORIO)
  })

  test('muestra franjas, grupo sin horario y conflicto anticipado, sin controles de eliminación', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?estado=horarios')
    const futbol = tarjeta(page, 'Primario turno mañana')
    await expect(futbol).toContainText('Lunes · 10:00 a 11:00')
    await expect(futbol).toContainText('Miércoles · 10:00 a 11:00')
    await expect(futbol).toContainText('Horario superpuesto')
    const boton = futbol.getByRole('button', { name: /Inscribirme en Fútbol/ })
    await expect(boton).toHaveAttribute('aria-disabled', 'true')
    await expect(boton).toHaveAccessibleDescription(CONFLICTO)

    const sinHorario = tarjeta(page, 'Primario sin horario')
    await expect(sinHorario).toContainText('Sin horario')
    await expect(sinHorario.getByRole('button', { name: /Inscribirme en Básquet/ })).toHaveAccessibleDescription(
      SIN_HORARIO
    )

    // El horario de la inscripción activa también se ve.
    await expect(aplicacion(page).getByRole('region', { name: 'Mis deportes activos' })).toContainText(
      'Lunes · 10:30 a 11:30'
    )
    await expect(page.getByRole('button', { name: /Eliminar|Borrar/ })).toHaveCount(0)
    expect(await sinScrollHorizontal(page)).toBe(true)
    await exigirPantallaSinDetalleTecnico(page, 'horarios fixture')
    await capturar(page, 'alumno-horarios')
  })

  test('el conflicto que devuelve el servidor se anuncia como alerta y recibe el foco', async ({ page }) => {
    await page.route('**/api/deportes/inscripciones', (ruta) =>
      ruta.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Conflicto de horario con Natación (Primario): lunes de 10:30 a 11:30.',
          campo: 'grupo_id',
        }),
      })
    )
    await page.goto('/pruebas-ui/deportes?estado=disponible')
    await page.getByRole('button', { name: /Inscribirme en Atletismo/ }).click()
    await expect(aplicacion(page).getByRole('alert')).toHaveText(CONFLICTO)
    if (hayTeclado(page)) {
      await expect(page.getByLabel('Resultado de tu última operación')).toBeFocused()
    }
    await capturar(page, 'alumno-conflicto-servidor')
  })

  test('mientras se envía, el control anuncia el envío y no se duplica', async ({ page }) => {
    let liberar: () => void = () => {}
    const pendiente = new Promise<void>((resolver) => {
      liberar = resolver
    })
    let pedidos = 0
    await page.route('**/api/deportes/inscripciones', async (ruta) => {
      pedidos += 1
      await pendiente
      await ruta.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' })
    })
    await page.goto('/pruebas-ui/deportes?estado=disponible')
    const boton = page.getByRole('button', { name: /Inscribirme en Atletismo/ })
    await boton.click()
    await expect(boton).toHaveText('Inscribiendo…')
    await expect(boton).toHaveAttribute('aria-busy', 'true')
    await capturar(page, 'alumno-envio')
    await boton.click({ force: true })
    liberar()
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Te inscribiste en Atletismo' })).toBeVisible()
    expect(pedidos).toBe(1)
  })

  test('si la compatibilidad no se pudo consultar, lo explica sin bloquear', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?estado=sin-compatibilidad')
    await expect(aplicacion(page).getByText(/No pudimos consultar la compatibilidad horaria/)).toBeVisible()
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'alumno-sin-compatibilidad')
  })

  test('los estados de carga, vacío y error de lectura se conservan', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?estado=carga')
    await expect(page.getByRole('status')).toHaveText('Cargando los deportes…')
    await capturar(page, 'carga')

    await page.goto('/pruebas-ui/deportes?estado=vacio')
    await expect(page.getByText('No hay grupos deportivos disponibles para tu nivel')).toBeVisible()
    await capturar(page, 'alumno-vacio')

    await page.goto('/pruebas-ui/deportes?estado=error-lectura')
    await expect(page.getByText('No pudimos cargar los deportes')).toBeVisible()
    await capturar(page, 'error-lectura')
  })
})

test.describe('horarios de la dirección (fixture)', () => {
  test.beforeEach(async ({ page }) => {
    if (!esMovil(page)) await page.setViewportSize(ESCRITORIO)
  })

  test('el diálogo de franjas retiene el foco, anticipa la superposición y vuelve con Escape', async ({ page }) => {
    await page.goto('/pruebas-ui/deportes?vista=director')
    const futbol = tarjeta(page, 'Primario turno mañana')
    await expect(futbol).toContainText('Lunes · 10:00 a 11:00')
    const abrir = futbol.getByRole('button', { name: /Gestionar los horarios de Fútbol/ })
    await abrir.click()
    const dialogo = page.getByRole('dialog', { name: 'Horarios de Fútbol · Primario turno mañana' })
    await expect(dialogo).toBeVisible()
    expect(await sinScrollHorizontal(page)).toBe(true)

    await dialogo.getByLabel('Día').selectOption({ label: 'Lunes' })
    await dialogo.getByLabel('Hora de inicio').fill('10:30')
    await dialogo.getByLabel('Hora de fin').fill('11:30')
    await dialogo.getByRole('button', { name: 'Asignar franja' }).click()
    await expect(dialogo.getByLabel('Hora de inicio')).toHaveAccessibleDescription(
      'La franja se superpone con otra franja del grupo: lunes de 10:00 a 11:00.'
    )
    await dialogo.getByLabel('Hora de inicio').fill('12:00')
    await dialogo.getByLabel('Hora de fin').fill('11:00')
    await dialogo.getByRole('button', { name: 'Asignar franja' }).click()
    await expect(dialogo.getByLabel('Hora de fin')).toHaveAccessibleDescription(
      'La hora de inicio debe ser anterior a la hora de fin'
    )
    await expect(dialogo.getByRole('button', { name: /Eliminar|Borrar/ })).toHaveCount(0)
    await capturar(page, 'director-horarios', { paginaCompleta: false })

    if (hayTeclado(page)) {
      // Contención del foco: desde el último control, Tab vuelve al primero y
      // Shift+Tab desde el primero regresa al último.
      const ultimo = dialogo.getByRole('button', { name: 'Asignar franja' })
      await ultimo.focus()
      await page.keyboard.press('Tab')
      await expect(dialogo.getByRole('button').first()).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(ultimo).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialogo).toHaveCount(0)
      await expect(abrir).toBeFocused()
    }
  })

  test('la inscripción administrativa consulta la compatibilidad y muestra carga y conflicto', async ({ page }) => {
    let liberar: () => void = () => {}
    const pendiente = new Promise<void>((resolver) => {
      liberar = resolver
    })
    await page.route('**/api/deportes/compatibilidad**', async (ruta) => {
      await pendiente
      await ruta.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          grupos: [
            {
              grupo_id: '11111111-1111-4111-8111-111111111111',
              tiene_horario: true,
              conflicto: {
                deporte: 'Natación',
                grupo: 'Primario',
                dia_semana: 1,
                hora_inicio: '10:30:00',
                hora_fin: '11:30:00',
              },
            },
            { grupo_id: '44444444-4444-4444-8444-444444444444', tiene_horario: true, conflicto: null },
          ],
        }),
      })
    })
    await page.goto('/pruebas-ui/deportes?vista=director')
    const abrir = page.getByRole('button', { name: 'Inscribir alumno' })
    await abrir.click()
    const dialogo = page.getByRole('dialog', { name: 'Inscribir a un alumno' })
    if (hayTeclado(page)) await expect(dialogo.getByLabel('Alumno')).toBeFocused()

    await dialogo.getByLabel('Alumno').selectOption({ index: 1 })
    await expect(dialogo.getByRole('status')).toHaveText(
      'Consultando los grupos y la compatibilidad horaria del alumno…'
    )
    await capturar(page, 'director-inscripcion-carga', { paginaCompleta: false })
    liberar()

    await dialogo.getByLabel('Grupo deportivo').selectOption('11111111-1111-4111-8111-111111111111')
    await expect(dialogo).toContainText(CONFLICTO)
    await dialogo.getByLabel('Grupo deportivo').selectOption('44444444-4444-4444-8444-444444444444')
    await expect(dialogo).toContainText('Sin conflictos con las actividades deportivas activas del alumno.')
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'director-inscripcion', { paginaCompleta: false })

    if (hayTeclado(page)) {
      await page.keyboard.press('Escape')
      await expect(dialogo).toHaveCount(0)
      await expect(abrir).toBeFocused()
    }
  })
})
