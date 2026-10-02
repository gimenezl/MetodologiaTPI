import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Pantalla de cupos con las funciones de PostgreSQL de EPT-66, en el navegador.
 *
 * Renderiza las vistas reales por rol (`/pruebas-ui/cupos`) e intercepta las
 * peticiones de Supabase del navegador: así se comprueba qué le pide la
 * aplicación a la base —solo funciones, nunca la tabla `inscripciones`— y cómo
 * traduce cada rechazo. No prueba la base: eso lo hacen las suites SQL y de
 * concurrencia. Todos los datos son sintéticos.
 */

const PERFIL = 'eeeeeeee-6600-4000-8000-000000000001'
const HIJO = 'eeeeeeee-6600-4000-8000-000000000002'
const FILA_ID = 'eeeeeeee-6600-4000-8000-0000000000a1'

type Llamada = { metodo: string; ruta: string; cuerpo: Record<string, unknown> | null }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, apikey, content-type, x-client-info, prefer, accept, accept-profile, content-profile, range',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

function fila(actividadId: number, nombre: string) {
  return {
    id: FILA_ID, estudiante_id: PERFIL, actividad_id: actividadId, estado: 'ACTIVO',
    fecha_inscripcion: '2026-10-02T12:00:00Z', fecha_baja: null,
    actividad_nombre: nombre, actividad_tipo: 'TALLER', cupo_maximo: 10,
  }
}

/** Intercepta Supabase y devuelve el registro de llamadas. `rpc` puede sobrescribir cualquier función. */
async function simular(
  page: Page,
  rpc: Record<string, (cuerpo: Record<string, unknown> | null) => { estado?: number; cuerpo: unknown }> = {}
) {
  const llamadas: Llamada[] = []
  await page.route(/\/rest\/v1\//u, async (route: Route) => {
    const peticion = route.request()
    if (peticion.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS })
      return
    }
    const ruta = new URL(peticion.url()).pathname.replace(/^.*\/rest\/v1\//u, '')
    const texto = peticion.postData()
    const cuerpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : null
    llamadas.push({ metodo: peticion.method(), ruta, cuerpo })

    const nombre = ruta.replace(/^rpc\//u, '').split('?')[0]
    const base: Record<string, unknown> = {
      roles: [{ id: 4, nombre: 'ESTUDIANTE' }],
      perfiles: [{ id: HIJO, nombre: 'Lara', apellido: 'Vinculada', legajo_nro: 'LEG-66-1', rol: { nombre: 'ESTUDIANTE' } }],
      listar_estudiantes_para_gestion: [
        { id: PERFIL, nombre: 'Ana', apellido: 'Propia', legajo_nro: 'LEG-66-0' },
        { id: HIJO, nombre: 'Lara', apellido: 'Vinculada', legajo_nro: 'LEG-66-1' },
      ],
      listar_inscripciones_actividades_legadas: [],
      listar_inscriptos_actividad_legada: [],
    }
    const personalizada = rpc[nombre]?.(cuerpo)
    const respuesta = personalizada ?? { cuerpo: base[nombre] ?? null }
    await route.fulfill({
      status: respuesta.estado ?? 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify(respuesta.cuerpo),
    })
  })
  return llamadas
}

const error = (code: string) => ({ estado: 400, cuerpo: { code, message: 'mensaje técnico', details: null, hint: null } })

function tarjeta(page: Page, nombre: string) {
  return page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: nombre }) }).first()
}

/** Ninguna llamada toca la tabla: ni lectura, ni escritura, ni borrado. */
function sinAccesoDirecto(llamadas: Llamada[]) {
  return llamadas.filter((llamada) => /^inscripciones(\?|$)/u.test(llamada.ruta))
}

test.describe('cupos de talleres con funciones de PostgreSQL (EPT-66)', () => {
  test('el alumno se inscribe y se da de baja solo por funciones', async ({ page }) => {
    let inscripto = false
    const llamadas = await simular(page, {
      inscribir_actividad_legada: () => { inscripto = true; return { cuerpo: FILA_ID } },
      listar_inscripciones_actividades_legadas: () => ({
        cuerpo: inscripto ? [fila(701, 'Taller de teatro')] : [],
      }),
      dar_baja_inscripcion_legada: () => { inscripto = false; return { cuerpo: FILA_ID } },
    })

    await page.goto('/pruebas-ui/cupos?vista=estudiante')
    await tarjeta(page, 'Taller de teatro').getByRole('button', { name: 'Inscribirme' }).click()
    await expect(page.getByText('¡Te inscribiste a la actividad!')).toBeVisible()

    const alta = llamadas.find((llamada) => llamada.ruta === 'rpc/inscribir_actividad_legada')
    expect(alta?.metodo).toBe('POST')
    expect(alta?.cuerpo).toEqual({ p_estudiante_id: PERFIL, p_actividad_id: 701 })

    await tarjeta(page, 'Taller de teatro').getByRole('button', { name: 'Darme de baja' }).click()
    await expect(page.getByText('Te diste de baja de la actividad')).toBeVisible()
    const baja = llamadas.find((llamada) => llamada.ruta === 'rpc/dar_baja_inscripcion_legada')
    expect(baja?.cuerpo).toEqual({ p_inscripcion_id: FILA_ID })

    expect(sinAccesoDirecto(llamadas), 'la aplicación no debe leer ni escribir la tabla inscripciones').toEqual([])
  })

  test('los rechazos de la base se traducen a mensajes en español', async ({ page }) => {
    const casos: Array<[string, string]> = [
      ['23514', 'El cupo para esta actividad está completo.'],
      ['23505', 'Este alumno ya está inscripto en esta actividad.'],
      ['P6602', 'El alumno solicitado no está disponible.'],
      ['42501', 'Tu rol no puede gestionar inscripciones a actividades.'],
      ['P6604', 'La actividad no está disponible para inscribirse.'],
    ]
    let codigo = casos[0][0]
    await simular(page, { inscribir_actividad_legada: () => error(codigo) })
    await page.goto('/pruebas-ui/cupos?vista=estudiante')
    for (const [esperado, mensaje] of casos) {
      codigo = esperado
      await tarjeta(page, 'Taller de teatro').getByRole('button', { name: 'Inscribirme' }).click()
      await expect(page.getByText(mensaje).first()).toBeVisible()
      // Nunca se filtra el texto técnico de PostgREST.
      await expect(page.getByText('mensaje técnico')).toHaveCount(0)
    }
  })

  test('el padre inscribe a su hijo vinculado por la función, con el identificador del hijo', async ({ page }) => {
    const llamadas = await simular(page, { inscribir_actividad_legada: () => ({ cuerpo: FILA_ID }) })
    await page.goto('/pruebas-ui/cupos?vista=padre')
    await page.getByLabel('Hijo/a a inscribir').selectOption(HIJO)
    await tarjeta(page, 'Taller de teatro').getByRole('button', { name: 'Inscribir' }).click()
    await expect(page.getByText('Hijo inscripto a la actividad')).toBeVisible()
    const alta = llamadas.find((llamada) => llamada.ruta === 'rpc/inscribir_actividad_legada')
    expect(alta?.cuerpo).toEqual({ p_estudiante_id: HIJO, p_actividad_id: 701 })
    expect(sinAccesoDirecto(llamadas)).toEqual([])
  })

  test('Dirección lista los inscriptos y da de baja por funciones', async ({ page }) => {
    const llamadas = await simular(page, {
      listar_inscriptos_actividad_legada: () => ({
        cuerpo: [{ inscripcion_id: FILA_ID, estudiante_id: PERFIL, fecha_inscripcion: '2026-10-02T12:00:00Z' }],
      }),
      dar_baja_inscripcion_legada: () => ({ cuerpo: FILA_ID }),
    })
    await page.goto('/pruebas-ui/cupos?vista=director')
    await expect(page.getByText('Inscribir alumno a actividad')).toBeVisible()
    await tarjeta(page, 'Taller de teatro').getByRole('button', { name: /Ver inscriptos/ }).click()
    await expect(page.locator('li').getByText('Propia, Ana')).toBeVisible()
    expect(llamadas.find((llamada) => llamada.ruta === 'rpc/listar_inscriptos_actividad_legada')?.cuerpo)
      .toEqual({ p_actividad_id: 701 })

    await page.getByRole('button', { name: 'Dar de baja' }).click()
    await expect(page.getByText('Inscripción dada de baja')).toBeVisible()
    expect(llamadas.find((llamada) => llamada.ruta === 'rpc/dar_baja_inscripcion_legada')?.cuerpo)
      .toEqual({ p_inscripcion_id: FILA_ID })
    expect(sinAccesoDirecto(llamadas)).toEqual([])
  })

  test('el DOCENTE no ve el alta, la baja ni la lista de inscriptos, y no los pide', async ({ page }) => {
    const llamadas = await simular(page)
    await page.goto('/pruebas-ui/cupos?vista=docente')
    await expect(page.getByText('La inscripción de alumnos a los talleres la realiza Dirección.')).toBeVisible()
    await expect(page.getByText('Inscribir alumno a actividad')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Ver inscriptos/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Inscribir', exact: true })).toHaveCount(0)
    // La edición del cupo máximo no depende de ningún alumno y se conserva.
    await expect(page.getByRole('button', { name: /Cupo: 10/ })).toBeVisible()
    expect(llamadas.map((llamada) => llamada.ruta).filter((ruta) =>
      /listar_inscriptos|listar_estudiantes|inscribir_actividad|dar_baja/u.test(ruta))).toEqual([])
  })

  for (const vista of ['estudiante', 'padre', 'director', 'docente']) {
    for (const [nombre, ancho, alto] of [['móvil 375×812', 375, 812], ['escritorio 1280×800', 1280, 800]] as const) {
      test(`${vista} a ${nombre}: sin desborde horizontal y con un único h1`, async ({ page }) => {
        await simular(page)
        await page.setViewportSize({ width: ancho, height: alto })
        await page.goto(`/pruebas-ui/cupos?vista=${vista}`)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
        const { scroll, cliente } = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          cliente: document.documentElement.clientWidth,
        }))
        expect(scroll).toBeLessThanOrEqual(cliente + 1)
      })
    }
  }
})
