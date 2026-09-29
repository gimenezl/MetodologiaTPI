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
import {
  DEPORTE_BENCH_1,
  ESPERADO,
  NORTE,
  REPORTES,
  analizarCsv,
  cuenta,
  limpiarVolumen,
  psql,
  sembrarVolumen,
} from './_reportes'

/**
 * Reportes oficiales de Dirección con sesiones reales (EPT-63, RF17).
 *
 * No hay mocks: cada petición atraviesa cookies SSR, `auth.getUser()`, el
 * control de Dirección del servidor, las funciones RPC y PostgreSQL con RLS.
 *
 * `psql` sobre el contenedor local se usa solo para SEMBRAR el volumen sintético
 * (`supabase/tests/reportes_benchmark_datos.sql`, más de 1000 filas en cada
 * dominio), para calcular los VALORES ESPERADOS con consultas escritas aparte —
 * joins y `count(DISTINCT …)` sobre las tablas base, nunca las funciones que se
 * están probando— y para retirar lo sembrado. Nunca participa de lo que se
 * verifica. Todo se retira antes y después de la corrida.
 *
 * El archivo se omite salvo que el operador habilite la base local descartable.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const BASE_URL = 'http://localhost:3000'
const CAPTURAR = process.env.EPT_CAPTURAS === '1'
const CARPETA_CAPTURAS = 'docs/evidence/EPT-63/capturas'

const SESION = {
  directora: 'tests/.auth/directora.json',
  estudiante: 'tests/.auth/estudiante.json',
  docente: 'tests/.auth/docente.json',
  padre: 'tests/.auth/padre.json',
  personal: 'tests/.auth/personal.json',
  sinPerfil: 'tests/.auth/sin-perfil.json',
  directoraBloqueada: 'tests/.auth/director-bloqueado.json',
}

/** Identidades de `tests/auth.setup.ts` para llamar a PostgREST directamente. */
const CUENTA = {
  estudiante: { email: 'estudiante.prueba@ept.local', password: 'prueba-ept-8-estudiante' },
  docente: { email: 'docente.prueba@ept.local', password: 'prueba-ept-9-docente' },
  padre: { email: 'padre.prueba@ept.local', password: 'prueba-ept-9-padre' },
  personal: { email: 'personal.prueba@ept.local', password: 'prueba-ept-9-personal' },
  sinPerfil: { email: 'sin.perfil.prueba@ept.local', password: 'prueba-ept-9-sin-perfil' },
  directoraBloqueada: { email: 'director.bloqueado.prueba@ept.local', password: 'prueba-ept-59-director-bloqueado' },
}


const FUNCIONES_RPC = [
  'reporte_alumnos_curso',
  'reporte_alumnos_materia',
  'reporte_alumnos_deporte',
  'reporte_alumnos_horario',
  'reporte_alumnos_recorrido',
  'reporte_docentes_nivel',
  'catalogos_reportes',
]


// ----------------------------------------------------------------
// Peticiones con sesión real
// ----------------------------------------------------------------

const contextosActivos: APIRequestContext[] = []

test.afterEach(async () => {
  await Promise.all(contextosActivos.splice(0).map((contexto) => contexto.dispose()))
})

async function pedir(archivoSesion: string | null, url: string, opciones?: Parameters<APIRequestContext['fetch']>[1]) {
  const limite = Date.now() + 20_000
  let ultimo: APIResponse | null = null
  do {
    if (archivoSesion === null || fs.existsSync(archivoSesion)) {
      const contexto = await crearContexto.newContext({
        baseURL: BASE_URL,
        ...(archivoSesion ? { storageState: archivoSesion } : {}),
      })
      contextosActivos.push(contexto)
      ultimo = await contexto.fetch(url, { timeout: 120_000, ...opciones })
      // Sin sesión la API responde 401 de verdad; con sesión, el 401 es que el setup aún no terminó.
      if (archivoSesion === null || ultimo.status() !== 401) return ultimo
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  } while (Date.now() < limite)
  if (ultimo) return ultimo
  throw new Error(`No se encontró la sesión local ${archivoSesion}. Ejecutá auth.setup.ts primero.`)
}


async function exportar(sesion: string, id: string, consulta = '') {
  const respuesta = await pedir(sesion, `/api/reportes/${id}/exportar${consulta}`)
  expect(respuesta.status(), `exportar ${id}${consulta}`).toBe(200)
  const texto = await respuesta.text()
  return { respuesta, texto, filas: analizarCsv(texto.replace(/^﻿/u, '')) }
}

async function pagina(sesion: string, id: string, consulta = '') {
  const respuesta = await pedir(sesion, `/api/reportes/${id}${consulta}`)
  expect(respuesta.status(), `página ${id}${consulta}`).toBe(200)
  return (await respuesta.json()) as { total: number; paginas: number; pagina: number; tamano: number; filas: any[] }
}

/** Ejecuta `cuerpo` con un privilegio retirado de `authenticated` y lo devuelve siempre. */
async function conPrivilegioRetirado(retirar: string, restituir: string, cuerpo: () => Promise<void>) {
  psql(retirar)
  try {
    await cuerpo()
  } finally {
    psql(restituir)
  }
}

/**
 * Elementos que sobresalen del ancho visible, o `[]` si no hay desplazamiento
 * horizontal. Se reintenta unos segundos: la fuente y el diseño terminan de
 * asentarse después de que el total es visible.
 */
async function sinScrollHorizontal(page: Page, contexto: string) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const ancho = document.documentElement.clientWidth
          if (document.documentElement.scrollWidth <= ancho + 1) return ''
          return Array.from(document.querySelectorAll('body *'))
            .filter((e) => e.getBoundingClientRect().right > ancho + 1)
            .slice(0, 5)
            .map((e) => e.tagName + '.' + (e.getAttribute('class') ?? '').slice(0, 40) + ' ' + Math.round(e.getBoundingClientRect().right))
            .join(' | ')
        }),
      { message: contexto + ' sin desplazamiento horizontal', timeout: 8_000 }
    )
    .toBe('')
}

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true })
  await capturarSinHerramientas(page, path.join(CARPETA_CAPTURAS, `${nombre}.png`))
}

// ----------------------------------------------------------------
// DIRECTOR
// ----------------------------------------------------------------

test.describe('DIRECTOR autenticado — reportes oficiales con volumen', () => {
  test.use({ storageState: SESION.directora })
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  test.beforeAll(() => {
    sembrarVolumen()
  })

  test.afterAll(() => {
    limpiarVolumen()
  })

  test('los seis reportes devuelven el total exacto de las relaciones, más de 1000 filas por dominio', async () => {
    const esperados: Record<(typeof REPORTES)[number], number> = {
      'alumnos-por-curso': ESPERADO.matriculasVigentes(),
      'alumnos-por-materia': ESPERADO.materias(),
      'alumnos-por-deporte': ESPERADO.deportivasActivas(),
      'alumnos-por-horario': ESPERADO.franjas(),
      'alumnos-por-recorrido': ESPERADO.transporteActivo(),
      'docentes-por-nivel': ESPERADO.docentes(),
    }
    for (const id of REPORTES) {
      expect(esperados[id], `el dominio ${id} debe superar las 1000 filas`).toBeGreaterThan(1000)
      const p = await pagina(SESION.directora, id, '?tamano=25')
      expect(p.total, id).toBe(esperados[id])
      expect(p.filas).toHaveLength(25)
      expect(p.paginas).toBe(Math.ceil(esperados[id] / 25))
    }
  })

  test('con historial, curso, deporte y recorrido suman las relaciones cerradas y canceladas', async () => {
    expect((await pagina(SESION.directora, 'alumnos-por-curso', '?historial=1')).total).toBe(ESPERADO.matriculasTodas())
    expect((await pagina(SESION.directora, 'alumnos-por-deporte', '?historial=1')).total).toBe(ESPERADO.deportivasTodas())
    expect((await pagina(SESION.directora, 'alumnos-por-recorrido', '?historial=1')).total).toBe(ESPERADO.transporteTodo())
  })

  test('el historial se rechaza donde el esquema no lo registra', async () => {
    for (const id of ['alumnos-por-materia', 'alumnos-por-horario', 'docentes-por-nivel']) {
      const r = await pedir(SESION.directora, `/api/reportes/${id}?historial=1`)
      expect(r.status(), id).toBe(400)
      const cuerpo = await r.json()
      expect(cuerpo.codigo).toBe('DATOS_INVALIDOS')
      expect(JSON.stringify(cuerpo.errores)).toContain('no aplica')
    }
  })

  test('un cruce de cuatro dimensiones cuenta a cada alumno una sola vez y coincide con el oráculo', async () => {
    const materia = ESPERADO.idMateria('Materia BENCH 05')
    const esperado = cuenta(`SELECT count(DISTINCT m.id)
      FROM public.matriculas m
      JOIN public.materias_cursos mc ON mc.curso_id = m.curso_id AND mc.activo AND mc.materia_id = ${materia}
      JOIN public.inscripciones_deportivas i ON i.alumno_id = m.alumno_id AND i.estado = 'ACTIVA'
                                             AND i.deporte_id = '${DEPORTE_BENCH_1}'
      JOIN public.inscripciones_servicios s ON s.alumno_id = m.alumno_id AND s.estado = 'ACTIVA'
                                            AND s.servicio_id = '${NORTE}'
      WHERE m.fecha_cierre IS NULL`)
    expect(esperado).toBeGreaterThan(0)
    const p = await pagina(
      SESION.directora,
      'alumnos-por-curso',
      `?materia=${materia}&deporte=${DEPORTE_BENCH_1}&recorrido=${NORTE}&tamano=100`
    )
    expect(p.total).toBe(esperado)
    expect(new Set(p.filas.map((f) => f.id)).size).toBe(p.filas.length)
  })

  test('alumno × materia se deriva del curso: cada fila es una materia asignada al curso de la matrícula', async () => {
    const materia = ESPERADO.idMateria('Materia BENCH 05')
    const esperado = cuenta(`SELECT count(*) FROM public.matriculas m
      JOIN public.materias_cursos mc ON mc.curso_id = m.curso_id AND mc.activo AND mc.materia_id = ${materia}
      WHERE m.fecha_cierre IS NULL`)
    const p = await pagina(SESION.directora, 'alumnos-por-materia', `?materia=${materia}&tamano=100`)
    expect(p.total).toBe(esperado)
    for (const fila of p.filas) expect(fila.materia_id).toBe(Number(materia))
  })

  test('docentes por nivel: un docente con asignación académica y deportiva aparece una vez por asignación', async () => {
    const dosOrigenes = psql(`SELECT p.apellido || '|' || p.nombre || '|' || mc.profesor_id
      FROM public.materias_cursos mc
      JOIN public.cursos c ON c.id = mc.curso_id
      JOIN public.grupos_deportivos g ON g.profesor_id = mc.profesor_id AND g.nivel_id = c.nivel_id AND g.activo
      JOIN public.perfiles p ON p.id = mc.profesor_id
      WHERE mc.activo AND mc.id::text LIKE 'b3000000%'
      ORDER BY mc.profesor_id LIMIT 1`).split('|')
    expect(dosOrigenes.length).toBe(3)
    const [apellido, nombre, profesor] = dosOrigenes
    const p = await pagina(SESION.directora, 'docentes-por-nivel', `?responsable=${profesor}&tamano=100`)
    const propias = p.filas.filter((f) => f.docente_apellido === apellido && f.docente_nombre === nombre)
    expect(propias.length).toBe(p.total)
    expect(new Set(propias.map((f) => f.origen))).toEqual(new Set(['ACADEMICO', 'DEPORTIVO']))
    expect(new Set(propias.map((f) => f.id)).size).toBe(propias.length)
    const esperado = cuenta(`SELECT
      (SELECT count(*) FROM public.materias_cursos mc JOIN public.actividades a ON a.id = mc.materia_id AND a.activo
        WHERE mc.activo AND mc.profesor_id = '${profesor}')
      + (SELECT count(*) FROM public.grupos_deportivos WHERE activo AND profesor_id = '${profesor}')`)
    expect(p.total).toBe(esperado)
  })

  test('el CSV trae el conjunto filtrado COMPLETO, no la primera página', async () => {
    for (const id of ['alumnos-por-materia', 'alumnos-por-horario'] as const) {
      const { respuesta, texto, filas } = await exportar(SESION.directora, id)
      const total = Number(respuesta.headers()['x-total-filas'])
      expect(total).toBeGreaterThan(10_000)
      expect(filas.length, `${id}: encabezado + una fila por relación`).toBe(total + 1)
      const ancho = filas[0].length
      expect(filas.every((f) => f.length === ancho), `${id}: todas las filas tienen ${ancho} columnas`).toBe(true)
      expect(respuesta.headers()['content-type']).toContain('text/csv')
      expect(respuesta.headers()['content-disposition']).toMatch(/^attachment; filename="reporte-.+-\d{4}-\d{2}-\d{2}\.csv"$/)
      expect(respuesta.headers()['cache-control']).toBe('no-store')
      expect(texto.startsWith('﻿')).toBe(true)
      expect(texto.endsWith('\r\n')).toBe(true)
    }
  })

  test('el CSV escapa, entrecomilla y neutraliza fórmulas con nombres reales de la base', async () => {
    const { texto, filas } = await exportar(SESION.directora, 'alumnos-por-curso', '?q=Fórmula')
    expect(filas).toHaveLength(2)
    expect(filas[1][0]).toBe("'=1+1 Fórmula")
    expect(texto).toContain("'=1+1 Fórmula")

    const comillas = await exportar(SESION.directora, 'alumnos-por-curso', `?q=${encodeURIComponent('Comillas')}`)
    expect(comillas.filas).toHaveLength(2)
    expect(comillas.filas[1][0]).toBe('Comillas "dobles"; y punto y coma')
    expect(comillas.texto).toContain('"Comillas ""dobles""; y punto y coma"')

    const salto = await exportar(SESION.directora, 'alumnos-por-curso', `?q=${encodeURIComponent('salto')}`)
    expect(salto.filas).toHaveLength(2)
    expect(salto.filas[1][0]).toBe('Con\nsalto')
    expect(salto.filas[1]).toHaveLength(salto.filas[0].length)
  })

  test('privacidad: con una confirmación real registrada, nada del confirmador sale por la API ni por el CSV', async () => {
    const confirmador = psql(`SELECT apellido FROM public.perfiles WHERE dni = '99900001'`)
    const legajo = psql(`SELECT p.legajo_nro FROM public.matriculas m JOIN public.perfiles p ON p.id = m.alumno_id
                         WHERE m.id::text LIKE 'ba000000%' AND m.fecha_cierre IS NULL ORDER BY m.id LIMIT 1`)
    psql(`INSERT INTO public.confirmaciones_inscripcion (dominio, matricula_id, confirmada_por)
          SELECT 'MATRICULA', m.id, (SELECT id FROM public.perfiles WHERE dni = '99900001')
          FROM public.matriculas m JOIN public.perfiles p ON p.id = m.alumno_id
          WHERE p.legajo_nro = '${legajo}' AND m.fecha_cierre IS NULL`, 'supabase_admin')
    try {
      expect(cuenta(`SELECT count(*) FROM public.confirmaciones_inscripcion c
                     JOIN public.matriculas m ON m.id = c.matricula_id JOIN public.perfiles p ON p.id = m.alumno_id
                     WHERE p.legajo_nro = '${legajo}'`)).toBe(1)
      const conHistorial = ['alumnos-por-curso', 'alumnos-por-deporte', 'alumnos-por-recorrido']
      for (const id of REPORTES) {
        const consulta = `?q=${encodeURIComponent(legajo)}${conHistorial.includes(id) ? '&historial=1' : ''}`
        const { texto } = await exportar(SESION.directora, id, consulta)
        expect(texto, id).not.toContain(confirmador)
        expect(texto.toLowerCase(), id).not.toMatch(/confirm/)
        const json = JSON.stringify(await pagina(SESION.directora, id, consulta.replace('?', '?tamano=100&')))
        expect(json.toLowerCase(), id).not.toMatch(/confirm/)
        expect(json, id).not.toContain(confirmador)
      }
      // El alumno confirmado sí figura: la comprobación no es vacía.
      const { filas } = await exportar(SESION.directora, 'alumnos-por-curso', `?q=${encodeURIComponent(legajo)}`)
      expect(filas.length).toBe(2)
      expect(filas[1][2]).toBe(legajo)
    } finally {
      psql(`ALTER TABLE public.confirmaciones_inscripcion DISABLE TRIGGER proteger_confirmacion_inscripcion_antes_de_escribir;
            DELETE FROM public.confirmaciones_inscripcion WHERE matricula_id IN (SELECT id FROM public.matriculas WHERE id::text LIKE 'ba000000%');
            ALTER TABLE public.confirmaciones_inscripcion ENABLE TRIGGER proteger_confirmacion_inscripcion_antes_de_escribir;`, 'supabase_admin')
    }
  })

  test('contrato de la API: filtros inválidos 400, reporte inexistente 404, método no permitido 405', async () => {
    const malo = await pedir(SESION.directora, '/api/reportes/alumnos-por-curso?nivel=abc&curso=x&pagina=0')
    expect(malo.status()).toBe(400)
    const cuerpo = await malo.json()
    expect(cuerpo.errores.map((e: any) => e.campo).sort()).toEqual(['curso', 'nivel', 'pagina'])
    exigirMensajeSinDetalleTecnico('error de filtros', cuerpo.error)

    const inexistente = await pedir(SESION.directora, '/api/reportes/inventado')
    expect(inexistente.status()).toBe(404)
    expect((await inexistente.json()).codigo).toBe('REPORTE_NO_ENCONTRADO')

    const post = await pedir(SESION.directora, '/api/reportes/alumnos-por-curso', { method: 'POST', data: {} })
    expect(post.status()).toBe(405)
    expect(post.headers()['allow']).toBe('GET, OPTIONS')
    const del = await pedir(SESION.directora, '/api/reportes/alumnos-por-curso/exportar', { method: 'DELETE' })
    expect(del.status()).toBe(405)

    const conPagina = await pedir(SESION.directora, '/api/reportes/alumnos-por-curso/exportar?pagina=2')
    expect(conPagina.status()).toBe(400)
    const inyeccion = await pedir(SESION.directora, `/api/reportes/alumnos-por-curso?q=${encodeURIComponent("x'; DROP TABLE perfiles; --")}`)
    expect(inyeccion.status()).toBe(200)
    expect((await inyeccion.json()).total).toBe(0)
  })

  test('un error real de lectura se explica en español, sin detalle técnico, en la API y en la pantalla', async ({ page }) => {
    await conPrivilegioRetirado(
      'REVOKE SELECT ON public.materias_cursos FROM authenticated',
      'GRANT SELECT ON public.materias_cursos TO authenticated',
      async () => {
        const api = await pedir(SESION.directora, '/api/reportes/docentes-por-nivel')
        expect(api.status()).toBe(500)
        const cuerpo = await api.json()
        expect(cuerpo.codigo).toBe('ERROR_INTERNO')
        // Una directora NO recibe «solo Dirección puede…»: no es un problema de su rol.
        expect(cuerpo.error).not.toContain('Solo Dirección')
        exigirMensajeSinDetalleTecnico('API de reportes', cuerpo.error)

        const csv = await pedir(SESION.directora, '/api/reportes/docentes-por-nivel/exportar')
        expect(csv.status()).toBe(500)
        expect(csv.headers()['content-type']).toContain('application/json')

        await page.goto('/dashboard/reportes/docentes-por-nivel')
        const alerta = page.getByRole('alert').filter({ hasText: 'No pudimos cargar el reporte' })
        await expect(alerta).toBeVisible({ timeout: 30_000 })
        await expect(alerta.getByRole('link', { name: 'Reintentar' })).toBeVisible()
        await exigirPantallaSinDetalleTecnico(page, 'pantalla de error de lectura')
        await capturar(page, 'escritorio-error-de-lectura')
      }
    )
    // Con el privilegio restituido, el mismo reporte vuelve a funcionar.
    await page.goto('/dashboard/reportes/docentes-por-nivel')
    await expect(page.getByRole('heading', { name: 'Docentes por nivel', level: 1 })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: /Mostrando/ })).toBeVisible()
  })

  test('sin sesión la Data API no expone ninguna de las siete funciones (anon)', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const cliente = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
    for (const funcion of FUNCIONES_RPC) {
      const { data, error } = await cliente.rpc(funcion)
      expect(data, funcion).toBeNull()
      expect(error?.code, funcion).toBe('42501')
    }
  })

  test('el índice ofrece los seis reportes y el menú lo enlaza (solo Dirección)', async ({ page }) => {
    await page.goto('/dashboard')
    const menu = page.getByRole('navigation', { name: 'Menú del dashboard' })
    await expect(menu.getByRole('link', { name: 'Reportes' })).toBeVisible()
    await menu.getByRole('link', { name: 'Reportes' }).click()
    await expect(page.getByRole('heading', { name: 'Reportes oficiales', level: 1 })).toBeVisible()
    const lista = page.getByRole('list', { name: 'Reportes disponibles' })
    await expect(lista.getByRole('listitem')).toHaveCount(6)
    for (const titulo of [
      'Alumnos por curso y nivel',
      'Alumnos por materia',
      'Alumnos por deporte',
      'Alumnos por horario',
      'Alumnos por recorrido',
      'Docentes por nivel',
    ]) {
      await expect(lista.getByRole('heading', { name: titulo })).toBeVisible()
    }
    await capturar(page, 'escritorio-indice')
  })

  test('pantalla: filtros combinables por el servidor, resultados, paginación por enlaces y teclado', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/dashboard/reportes/alumnos-por-curso')
    await expect(page.getByRole('heading', { name: 'Alumnos por curso y nivel', level: 1 })).toBeVisible()

    const esperado = ESPERADO.matriculasVigentes()
    const estado = page.getByRole('status').filter({ hasText: /Mostrando/ })
    await expect(estado).toContainText(`de ${esperado.toLocaleString('es-AR')} filas`)
    await expect(estado).toContainText('Mostrando 1 a 50')
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(50)
    await capturar(page, 'escritorio-alumnos-por-curso')

    // Filtros combinados (nivel + materia + deporte + recorrido), aplicados con el teclado.
    const materia = ESPERADO.idMateria('Materia BENCH 05')
    await page.getByLabel('Materia').selectOption(materia)
    await page.getByLabel('Deporte').selectOption(DEPORTE_BENCH_1)
    await page.getByLabel('Recorrido').selectOption(NORTE)
    await page.getByRole('button', { name: 'Aplicar filtros' }).focus()
    await expect(page.getByRole('button', { name: 'Aplicar filtros' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`materia=${materia}`))
    await expect(page).toHaveURL(/deporte=/)
    await expect(page).toHaveURL(/recorrido=/)

    const cruce = cuenta(`SELECT count(DISTINCT m.id)
      FROM public.matriculas m
      JOIN public.materias_cursos mc ON mc.curso_id = m.curso_id AND mc.activo AND mc.materia_id = ${materia}
      JOIN public.inscripciones_deportivas i ON i.alumno_id = m.alumno_id AND i.estado = 'ACTIVA' AND i.deporte_id = '${DEPORTE_BENCH_1}'
      JOIN public.inscripciones_servicios s ON s.alumno_id = m.alumno_id AND s.estado = 'ACTIVA' AND s.servicio_id = '${NORTE}'
      WHERE m.fecha_cierre IS NULL`)
    await expect(page.getByRole('status').filter({ hasText: /Mostrando|No hay/ })).toContainText(
      cruce === 0 ? 'No hay resultados' : `de ${cruce.toLocaleString('es-AR')} ${cruce === 1 ? 'fila' : 'filas'}`
    )
    // Los filtros elegidos siguen seleccionados y aparecen descriptos en palabras.
    await expect(page.getByLabel('Materia')).toHaveValue(materia)
    await expect(page.locator('p', { hasText: 'Filtros aplicados:' }).first()).toContainText('Materia: Materia BENCH 05')
    await capturar(page, 'escritorio-filtros-cruzados')

    // Paginación: cada página es un enlace que conserva los filtros.
    await page.getByRole('link', { name: 'Limpiar filtros' }).click()
    await page.getByRole('link', { name: 'Siguiente' }).click()
    await expect(page).toHaveURL(/pagina=2/)
    await expect(page.getByRole('status').filter({ hasText: /Mostrando/ })).toContainText('Mostrando 51 a 100')
    await expect(page.getByRole('link', { name: 'Página 2' })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('link', { name: 'Anterior' }).click()
    await expect(page.getByRole('status').filter({ hasText: /Mostrando/ })).toContainText('Mostrando 1 a 50')

    // Página fuera de rango: se explica, no se muestra un vacío engañoso.
    await page.goto('/dashboard/reportes/alumnos-por-curso?pagina=99999')
    await expect(page.getByRole('status').filter({ hasText: /no existe/ })).toContainText(`${esperado.toLocaleString('es-AR')} filas`)
    await expect(page.getByRole('link', { name: 'Volver a la primera página' })).toBeVisible()
  })

  test('pantalla: estado vacío, filtros inválidos y reportes sin historial se explican', async ({ page }) => {
    await page.goto('/dashboard/reportes/alumnos-por-curso?q=zzzzzz-no-existe')
    await expect(page.getByRole('status').filter({ hasText: /No hay/ })).toContainText('No hay resultados con estos filtros.')
    await expect(page.getByText('No encontramos filas para mostrar')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Exportar CSV' })).toBeDisabled()
    await capturar(page, 'escritorio-vacio')

    await page.goto('/dashboard/reportes/alumnos-por-curso?nivel=abc&curso=no-uuid')
    const alerta = page.getByRole('alert').filter({ hasText: 'Los filtros del enlace no son válidos' })
    await expect(alerta).toBeVisible()
    await expect(alerta.getByRole('listitem')).toHaveCount(2)
    await expect(page.getByRole('table')).toHaveCount(0)

    await page.goto('/dashboard/reportes/alumnos-por-materia')
    await expect(page.getByText('Historial no disponible.')).toBeVisible()
    await expect(page.getByText(/no registra desde cuándo rigen/)).toBeVisible()
    await expect(page.getByLabel('Incluir historial')).toHaveCount(0)

    await page.goto('/dashboard/reportes/alumnos-por-materia?historial=1')
    await expect(page.getByRole('alert').filter({ hasText: /no aplica a este reporte/ })).toBeVisible()

    await page.goto('/dashboard/reportes/alumnos-por-curso')
    await expect(page.getByLabel('Incluir historial')).toBeVisible()
  })

  test('exportación desde la pantalla: descarga real del CSV completo y avisa el resultado', async ({ page }) => {
    await page.goto('/dashboard/reportes/alumnos-por-recorrido')
    const esperado = ESPERADO.transporteActivo()
    const [descarga] = await Promise.all([
      page.waitForEvent('download', { timeout: 120_000 }),
      page.getByRole('button', { name: 'Exportar CSV' }).click(),
    ])
    expect(descarga.suggestedFilename()).toMatch(/^reporte-alumnos-por-recorrido-\d{4}-\d{2}-\d{2}\.csv$/)
    const ruta = await descarga.path()
    const contenido = fs.readFileSync(ruta, 'utf8')
    const filas = analizarCsv(contenido.replace(/^﻿/u, ''))
    expect(filas.length).toBe(esperado + 1)
    await expect(page.getByRole('status').filter({ hasText: /Exportación lista/ })).toContainText(
      `Exportación lista: ${esperado.toLocaleString('es-AR')} filas`
    )
    await capturar(page, 'escritorio-exportacion-lista')
  })

  test('exportación desde la pantalla: un error real se muestra sin guardar un archivo roto', async ({ page }) => {
    await page.goto('/dashboard/reportes/docentes-por-nivel')
    await expect(page.getByRole('button', { name: 'Exportar CSV' })).toBeEnabled()
    await conPrivilegioRetirado(
      'REVOKE SELECT ON public.grupos_deportivos FROM authenticated',
      'GRANT SELECT ON public.grupos_deportivos TO authenticated',
      async () => {
        let hubo = false
        page.on('download', () => {
          hubo = true
        })
        await page.getByRole('button', { name: 'Exportar CSV' }).click()
        const error = page.getByRole('alert').filter({ hasText: /No pudimos obtener el reporte/ })
        await expect(error).toBeVisible({ timeout: 60_000 })
        expect(hubo).toBe(false)
        await exigirPantallaSinDetalleTecnico(page, 'error de exportación')
        await capturar(page, 'escritorio-error-exportacion')
      }
    )
  })

  test('impresión: conjunto completo con título institucional, fecha y filtros; el panel no se imprime', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const q = 'García'
    await page.goto(`/dashboard/reportes/alumnos-por-curso/imprimir?q=${encodeURIComponent(q)}&nivel=1`)
    await expect(page.getByText('Educar para Transformar').first()).toBeVisible()
    const articulo = page.getByRole('article')
    await expect(articulo.getByRole('heading', { name: 'Alumnos por curso y nivel', level: 1 })).toBeVisible()
    await expect(articulo).toContainText(/Emitido el \d{2}\/\d{2}\/\d{4}/)
    await expect(articulo).toContainText('Búsqueda: García')
    await expect(articulo).toContainText(/Nivel: /)
    await expect(articulo).toContainText('Historial: No incluido')
    const total = await articulo.getByRole('table').locator('tbody tr').count()
    const esperado = cuenta(`SELECT count(*) FROM public.matriculas m
      JOIN public.perfiles p ON p.id = m.alumno_id
      JOIN public.cursos c ON c.id = m.curso_id
      WHERE m.fecha_cierre IS NULL AND c.nivel_id = 1
        AND (p.apellido ILIKE '%${q}%' OR p.nombre ILIKE '%${q}%' OR (p.apellido || ' ' || p.nombre) ILIKE '%${q}%'
             OR (p.nombre || ' ' || p.apellido) ILIKE '%${q}%' OR p.legajo_nro ILIKE '%${q}%')`)
    expect(total).toBe(esperado)

    await page.emulateMedia({ media: 'print' })
    await expect(page.getByRole('navigation', { name: 'Menú del dashboard' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Imprimir o guardar como PDF' })).toBeHidden()
    await expect(articulo.getByRole('table')).toBeVisible()
    const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true })
    expect(pdf.byteLength).toBeGreaterThan(5_000)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    await page.emulateMedia({ media: null })
    await capturar(page, 'escritorio-impresion')
  })

  test('impresión: un reporte con más filas que el máximo imprimible lo dice con el total y los filtros, y ofrece el CSV completo', async ({ page }) => {
    const total = ESPERADO.franjas()
    expect(total).toBeGreaterThan(10_000)
    await page.goto('/dashboard/reportes/alumnos-por-horario/imprimir?origen=ACADEMICO')
    const alerta = page.getByRole('alert').filter({ hasText: 'demasiado grande para imprimirlo' })
    await expect(alerta).toContainText('filas, más que las 10.000')
    await expect(alerta).toContainText('Origen: Académico')
    await expect(alerta).toContainText('Historial: No disponible')
    // No recorta en silencio ni finge un error de lectura: ofrece el CSV y acotar.
    await expect(alerta.getByRole('button', { name: 'Exportar CSV' })).toBeEnabled()
    await expect(alerta.getByRole('link', { name: 'Acotar con filtros' })).toHaveAttribute('href', /origen=ACADEMICO/)
    await expect(page.getByRole('alert').filter({ hasText: 'No pudimos cargar el reporte' })).toHaveCount(0)
    await expect(page.getByRole('table')).toHaveCount(0)
  })

  test('la vista imprimible conserva el historial elegido y muestra los filtros en palabras', async ({ page }) => {
    await page.goto('/dashboard/reportes/alumnos-por-deporte/imprimir?historial=1&q=Garc%C3%ADa')
    await expect(page.getByRole('article')).toContainText('Historial: Incluido')
    await expect(page.getByRole('article')).toContainText('Búsqueda: García')
    await expect(page.getByRole('link', { name: 'Volver al reporte' })).toHaveAttribute('href', /historial=1/)
  })

  test('375 px: sin desplazamiento horizontal y con una tarjeta por fila', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    for (const id of REPORTES) {
      await page.goto(`/dashboard/reportes/${id}?tamano=25`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: /Mostrando/ })).toBeVisible()
      await sinScrollHorizontal(page, `${id} a 375 px`)
      await expect(page.getByRole('table')).toHaveCount(0)
      await expect(page.getByRole('list').filter({ has: page.getByRole('listitem') }).last().getByRole('listitem').first()).toBeVisible()
    }
    await page.goto('/dashboard/reportes/alumnos-por-horario?tamano=25')
    await expect(page.getByRole('status').filter({ hasText: /Mostrando/ })).toBeVisible()
    await capturar(page, 'movil-alumnos-por-horario')
    await page.goto('/dashboard/reportes')
    await expect(page.getByRole('heading', { name: 'Reportes oficiales', level: 1 })).toBeVisible()
    await sinScrollHorizontal(page, 'pantalla')
    await capturar(page, 'movil-indice')
    await page.goto('/dashboard/reportes/alumnos-por-curso/imprimir?q=Garc%C3%ADa&nivel=1')
    await sinScrollHorizontal(page, 'pantalla')
  })

  test('1280 px: la tabla de cada reporte entra sin desplazamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    for (const id of REPORTES) {
      await page.goto(`/dashboard/reportes/${id}?tamano=25`)
      await expect(page.getByRole('table')).toBeVisible()
      await sinScrollHorizontal(page, `${id} a 1280 px`)
      const cabeceras = page.getByRole('table').getByRole('columnheader')
      expect(await cabeceras.count()).toBeGreaterThan(5)
    }
    // Se espera el contenido antes de capturar: sin esto la captura mostraba «Cargando…».
    await page.goto('/dashboard/reportes/alumnos-por-horario?origen=DEPORTIVO&tamano=25')
    await expect(page.getByRole('status').filter({ hasText: /Mostrando/ })).toBeVisible()
    await expect(page.getByRole('table')).toBeVisible()
    await capturar(page, 'escritorio-alumnos-por-horario')
    await page.goto('/dashboard/reportes/docentes-por-nivel?tamano=25')
    await expect(page.getByRole('status').filter({ hasText: /Mostrando/ })).toBeVisible()
    await expect(page.getByRole('table')).toBeVisible()
    await capturar(page, 'escritorio-docentes-por-nivel')
  })

  test('accesibilidad: cada filtro tiene etiqueta, el foco es visible y los controles no se anidan', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/dashboard/reportes/alumnos-por-horario?tamano=25')
    for (const etiqueta of ['Buscar por nombre, apellido o legajo', 'Nivel', 'Curso', 'Materia', 'Deporte', 'Recorrido', 'Horario', 'Profesor responsable', 'Origen', 'Filas por página']) {
      await expect(page.getByLabel(etiqueta, { exact: true })).toBeVisible()
    }
    await page.getByLabel('Buscar por nombre, apellido o legajo', { exact: true }).focus()
    const contorno = await page.evaluate(() => {
      const elemento = document.activeElement as HTMLElement
      const estilo = getComputedStyle(elemento)
      return { sombra: estilo.boxShadow, contorno: estilo.outlineStyle }
    })
    expect(contorno.sombra !== 'none' || contorno.contorno !== 'none').toBe(true)
    const anidados = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main a[href], main button')).filter((c) => c.querySelector('a[href], button, input, select')).length
    )
    expect(anidados).toBe(0)
    const tablaConNombre = await page.getByRole('table').evaluate((t) => t.querySelector('caption')?.textContent ?? '')
    expect(tablaConNombre).toBe('Alumnos por horario')
    await exigirPantallaSinDetalleTecnico(page, 'reporte de horarios')
    await page.goto('/dashboard/reportes/docentes-por-nivel?tamano=25')
    await expect(page.getByLabel('Buscar por nombre o apellido', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Buscar por nombre, apellido o legajo', { exact: true })).toHaveCount(0)
  })
})

// ----------------------------------------------------------------
// Denegación por actor: la misma batería para cada uno
// ----------------------------------------------------------------

type ActorDenegado = {
  etiqueta: string
  sesion: string
  cuenta: { email: string; password: string }
  /** Estado que responde la API. */
  estado: 403
  codigo: string
  bloqueado?: boolean
}

const ACTORES_DENEGADOS: ActorDenegado[] = [
  { etiqueta: 'ESTUDIANTE autenticado', sesion: SESION.estudiante, cuenta: CUENTA.estudiante, estado: 403, codigo: 'ACCESO_DENEGADO' },
  { etiqueta: 'DOCENTE autenticado', sesion: SESION.docente, cuenta: CUENTA.docente, estado: 403, codigo: 'ACCESO_DENEGADO' },
  { etiqueta: 'PADRE autenticado', sesion: SESION.padre, cuenta: CUENTA.padre, estado: 403, codigo: 'ACCESO_DENEGADO' },
  { etiqueta: 'PERSONAL autenticado', sesion: SESION.personal, cuenta: CUENTA.personal, estado: 403, codigo: 'ACCESO_DENEGADO' },
  { etiqueta: 'SIN PERFIL autenticado', sesion: SESION.sinPerfil, cuenta: CUENTA.sinPerfil, estado: 403, codigo: 'ACCESO_DENEGADO' },
  {
    etiqueta: 'DIRECTOR BLOQUEADO autenticado',
    sesion: SESION.directoraBloqueada,
    cuenta: CUENTA.directoraBloqueada,
    estado: 403,
    codigo: 'ACCESO_BLOQUEADO',
    bloqueado: true,
  },
]

for (const actor of ACTORES_DENEGADOS) {
  test.describe(`${actor.etiqueta} — sin acceso a los reportes`, () => {
    test.use({ storageState: actor.sesion })
    test.setTimeout(120_000)

    test.beforeAll(() => {
      sembrarVolumen()
    })

    test.afterAll(() => {
      limpiarVolumen()
    })

    test('la API y la exportación responden 403 sin un solo dato', async () => {
      const apellidos = psql(`SELECT string_agg(DISTINCT apellido, '|') FROM (SELECT apellido FROM public.perfiles WHERE legajo_nro LIKE 'BENCH-%' LIMIT 40) x`)
      const urls = [
        ...REPORTES.map((id) => `/api/reportes/${id}`),
        ...REPORTES.map((id) => `/api/reportes/${id}/exportar`),
        '/api/reportes/alumnos-por-curso?nivel=abc',
        '/api/reportes/inexistente',
      ]
      for (const url of urls) {
        const r = await pedir(actor.sesion, url)
        expect(r.status(), `${actor.etiqueta} ${url}`).toBe(actor.estado)
        const texto = await r.text()
        expect(r.headers()['content-type']).toContain('application/json')
        expect(JSON.parse(texto).codigo).toBe(actor.codigo)
        for (const apellido of apellidos.split('|').slice(0, 10)) expect(texto).not.toContain(apellido)
        exigirMensajeSinDetalleTecnico(`${actor.etiqueta} ${url}`, JSON.parse(texto).error)
      }
    })

    test('la pantalla y la impresión son «Acceso restringido» y no traen datos', async ({ page }) => {
      const apellido = psql(`SELECT apellido FROM public.perfiles WHERE legajo_nro = 'BENCH-000005'`)
      const rutas = [
        '/dashboard/reportes',
        '/dashboard/reportes/alumnos-por-curso',
        '/dashboard/reportes/alumnos-por-horario/imprimir',
        '/dashboard/reportes/docentes-por-nivel?q=sin-coincidencias',
      ]
      for (const ruta of rutas) {
        const pedidosApi: string[] = []
        page.on('request', (r) => {
          if (r.url().includes('/api/reportes')) pedidosApi.push(r.url())
        })
        await page.goto(ruta)
        if (actor.bloqueado) {
          await expect(page).toHaveURL(/acceso-bloqueado/)
          continue
        }
        await expect(page.getByRole('heading', { name: 'Acceso restringido', level: 1 })).toBeVisible({ timeout: 20_000 })
        await expect(page.getByRole('table')).toHaveCount(0)
        const html = await page.content()
        expect(await page.locator('main').innerText()).not.toContain(apellido)
        expect(html).not.toContain('BENCH-')
        expect(pedidosApi).toEqual([])
      }
    })

    test('el menú no ofrece «Reportes»', async ({ page }) => {
      test.skip(Boolean(actor.bloqueado), 'Un perfil bloqueado no llega al panel.')
      await page.goto('/dashboard')
      await expect(page.getByRole('navigation', { name: 'Menú del dashboard' })).toBeVisible({ timeout: 20_000 }).catch(() => undefined)
      await expect(page.getByRole('link', { name: 'Reportes' })).toHaveCount(0)
    })

    test('PostgreSQL rechaza el acceso directo a las siete funciones aunque la sesión sea válida', async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const cliente = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
      const { error: errorIngreso } = await cliente.auth.signInWithPassword(actor.cuenta)
      expect(errorIngreso, `ingreso de ${actor.etiqueta}`).toBeNull()

      for (const funcion of FUNCIONES_RPC) {
        const { data, error } = await cliente.rpc(funcion)
        expect(data, `${actor.etiqueta} ${funcion}`).toBeNull()
        expect(error?.code, `${actor.etiqueta} ${funcion}`).toBe('42501')
      }

      // Las vistas de EPT-62 (que sí exponen al confirmador) siguen sin dar filas.
      for (const vista of ['matriculas_administracion', 'inscripciones_deportivas_administracion', 'inscripciones_servicios_administracion']) {
        const { data, error } = await cliente.from(vista).select('*').limit(5)
        expect(error, `${actor.etiqueta} ${vista}`).toBeNull()
        expect(data, `${actor.etiqueta} ${vista}`).toEqual([])
      }
    })
  })
}
