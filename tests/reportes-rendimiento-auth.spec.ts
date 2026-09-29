import { expect, request as crearContexto, test, type APIRequestContext } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEPORTE_BENCH_1, ESPERADO, NORTE, REPORTES, analizarCsv, limpiarVolumen, psql, sembrarVolumen } from './_reportes'

/**
 * Medición de extremo a extremo del límite de un minuto por reporte (EPT-63, RF17).
 *
 * Solo corre con `EPT_BENCH=1`, contra la base local descartable y con una sesión
 * real de Dirección. Siembra el volumen sintético de
 * `supabase/tests/reportes_benchmark_datos.sql` (3000 matrículas, 3400 inscripciones
 * deportivas, 2500 de transporte, 1200 asignaciones y más de 78 000 franjas),
 * mide cada camino que una persona recorre y retira el volumen al terminar.
 *
 * Qué se mide, por reporte y en cada repetición:
 *   - `pantalla`: la página completa con 100 filas, desde que se pide hasta que la
 *     tabla y el total son visibles (consulta + servidor de Next + representación);
 *   - `cruce`: la misma pantalla con un cruce de dimensiones;
 *   - `csv`: la exportación COMPLETA del conjunto (todas las páginas de la base),
 *     con las filas y los bytes recibidos y las filas verificadas contra el archivo;
 *   - `impresion`: la vista imprimible del conjunto completo (o la negativa
 *     explícita cuando supera el máximo imprimible).
 *
 * Reglas: se exige que CADA medición quede por debajo de 60 s, y la mediana se
 * informa aparte. El resultado se escribe en `docs/evidence/EPT-63/mediciones.json`
 * y se imprime como tabla. Para que los tiempos sean los de la aplicación real y
 * no los del modo de desarrollo, correr contra `next build` + `next start`.
 */

test.skip(process.env.EPT_SUPABASE_LOCAL !== '1', 'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.')
test.skip(process.env.EPT_BENCH !== '1', 'Requiere EPT_BENCH=1: es una medición, no una prueba funcional.')

const BASE_URL = process.env.EPT_BENCH_URL ?? 'http://localhost:3000'
const SESION = 'tests/.auth/directora.json'
const REPETICIONES = Number(process.env.EPT_BENCH_REPETICIONES ?? 5)
const LIMITE_MS = 60_000
const SALIDA = 'docs/evidence/EPT-63/mediciones.json'

type Medicion = { ms: number[]; mediana: number; minimo: number; maximo: number; [extra: string]: unknown }

const contextos: APIRequestContext[] = []
test.afterAll(async () => {
  await Promise.all(contextos.splice(0).map((c) => c.dispose()))
})

function estadistica(ms: number[]) {
  const ordenado = [...ms].sort((a, b) => a - b)
  const mediana = ordenado[Math.floor(ordenado.length / 2)]
  return { ms: ms.map((m) => Math.round(m)), mediana: Math.round(mediana), minimo: Math.round(ordenado[0]), maximo: Math.round(ordenado[ordenado.length - 1]) }
}

function entorno() {
  const version = (comando: string[]) => {
    try {
      return execFileSync(comando[0], comando.slice(1), { encoding: 'utf8', shell: process.platform === 'win32' }).trim().split('\n')[0]
    } catch {
      return 'no disponible'
    }
  }
  return {
    fecha: new Date().toISOString(),
    sistema: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: `${os.cpus()[0]?.model.trim()} × ${os.cpus().length}`,
    memoriaGiB: Math.round(os.totalmem() / 1024 ** 3),
    node: process.version,
    postgres: psql('SELECT version()'),
    next: version(['npx', 'next', '--version']),
    modoDeLaAplicacion: process.env.EPT_BENCH_MODO ?? 'desarrollo (npm run dev)',
    baseUrl: BASE_URL,
    repeticiones: REPETICIONES,
    maxRows: 1000,
  }
}

test.describe('DIRECTOR autenticado — rendimiento de los reportes', () => {
  test.use({ storageState: SESION })
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(30 * 60_000)

  const resultado: Record<string, Record<string, Medicion>> = {}
  const volumen: Record<string, number> = {}

  test.beforeAll(async () => {
    sembrarVolumen()
    volumen['matriculas vigentes'] = ESPERADO.matriculasVigentes()
    volumen['matriculas (con historial)'] = ESPERADO.matriculasTodas()
    volumen['alumno × materia'] = ESPERADO.materias()
    volumen['inscripciones deportivas activas'] = ESPERADO.deportivasActivas()
    volumen['inscripciones deportivas (con historial)'] = ESPERADO.deportivasTodas()
    volumen['alumno × franja (académicas + deportivas)'] = ESPERADO.franjas()
    volumen['inscripciones de transporte activas'] = ESPERADO.transporteActivo()
    volumen['inscripciones de transporte (con historial)'] = ESPERADO.transporteTodo()
    volumen['docente × asignación'] = ESPERADO.docentes()
    contextos.push(await crearContexto.newContext({ baseURL: BASE_URL, storageState: SESION }))
  })

  test.afterAll(() => {
    fs.mkdirSync(path.dirname(SALIDA), { recursive: true })
    fs.writeFileSync(SALIDA, JSON.stringify({ entorno: entorno(), volumen, limiteMs: LIMITE_MS, reportes: resultado }, null, 2) + '\n')
    limpiarVolumen()
    // Resumen legible en la consola de la corrida.
    console.log('\nMEDICIONES (ms, mediana de ' + REPETICIONES + ')')
    for (const [reporte, mediciones] of Object.entries(resultado)) {
      console.log(
        `  ${reporte.padEnd(24)}` +
          Object.entries(mediciones)
            .map(([nombre, m]) => `${nombre}=${m.mediana}`)
            .join('  ')
      )
    }
  })

  /** Repite `medir` N veces y exige que cada tiempo quede por debajo de un minuto. */
  async function repetir(reporte: string, nombre: string, medir: () => Promise<{ ms: number; extra?: Record<string, unknown> }>) {
    const tiempos: number[] = []
    let extra: Record<string, unknown> = {}
    for (let i = 0; i < REPETICIONES; i += 1) {
      const r = await medir()
      tiempos.push(r.ms)
      extra = { ...extra, ...(r.extra ?? {}) }
      expect(r.ms, `${reporte} · ${nombre} · repetición ${i + 1}`).toBeLessThan(LIMITE_MS)
    }
    resultado[reporte] ??= {}
    resultado[reporte][nombre] = { ...estadistica(tiempos), ...extra }
  }

  for (const id of REPORTES) {
    test(`${id}: pantalla, cruce, CSV completo e impresión, cada uno por debajo de 60 s`, async ({ page }) => {
      const contexto = contextos[0]

      // ---- pantalla: 100 filas, hasta que la tabla y el total son visibles ----
      await repetir(id, 'pantalla', async () => {
        const t0 = performance.now()
        await page.goto(`/dashboard/reportes/${id}?tamano=100`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('status').filter({ hasText: /Mostrando 1 a 100 de/ })).toBeVisible({ timeout: LIMITE_MS })
        await expect(page.getByRole('table').locator('tbody tr').first()).toBeVisible()
        const ms = performance.now() - t0
        const total = (await page.getByRole('status').filter({ hasText: /Mostrando/ }).innerText()).match(/de ([\d.]+) filas/)?.[1] ?? ''
        return { ms, extra: { filas: Number(total.replace(/\./g, '')) } }
      })

      // ---- cruce: una combinación de dimensiones propia de cada reporte ----
      const materia = ESPERADO.idMateria('Materia BENCH 05')
      const cruces: Record<string, string> = {
        'alumnos-por-curso': `materia=${materia}&deporte=${DEPORTE_BENCH_1}&recorrido=${NORTE}`,
        'alumnos-por-materia': `deporte=${DEPORTE_BENCH_1}&recorrido=${NORTE}`,
        'alumnos-por-deporte': `materia=${materia}&recorrido=${NORTE}`,
        'alumnos-por-horario': `deporte=${DEPORTE_BENCH_1}&recorrido=${NORTE}&nivel=1`,
        'alumnos-por-recorrido': `materia=${materia}&deporte=${DEPORTE_BENCH_1}&nivel=1`,
        'docentes-por-nivel': `nivel=1&origen=ACADEMICO&q=a`,
      }
      await repetir(id, 'cruce', async () => {
        const t0 = performance.now()
        await page.goto(`/dashboard/reportes/${id}?${cruces[id]}&tamano=100`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('status').filter({ hasText: /Mostrando|No hay resultados/ })).toBeVisible({ timeout: LIMITE_MS })
        return { ms: performance.now() - t0 }
      })

      // ---- CSV: TODAS las filas, verificadas contra el archivo recibido ----
      await repetir(id, 'csv', async () => {
        const t0 = performance.now()
        const respuesta = await contexto.get(`/api/reportes/${id}/exportar`, { timeout: LIMITE_MS })
        expect(respuesta.status()).toBe(200)
        const cuerpo = await respuesta.body()
        const ms = performance.now() - t0
        const total = Number(respuesta.headers()['x-total-filas'])
        const filas = analizarCsv(cuerpo.toString('utf8').replace(/^﻿/u, ''))
        expect(filas.length, `${id}: filas del archivo`).toBe(total + 1)
        return { ms, extra: { csvFilas: total, csvBytes: cuerpo.byteLength, csvPaginasDe1000: Math.ceil(total / 1000) } }
      })

      // ---- impresión: conjunto completo, o negativa explícita por el máximo ----
      await repetir(id, 'impresion', async () => {
        const t0 = performance.now()
        await page.goto(`/dashboard/reportes/${id}/imprimir`, { waitUntil: 'domcontentloaded' })
        const rechazo = page.getByRole('alert').filter({ hasText: 'demasiado grande para imprimirlo' })
        await expect(page.getByRole('article').or(rechazo)).toBeVisible({ timeout: LIMITE_MS })
        const ms = performance.now() - t0
        const rechazada = (await rechazo.count()) > 0
        const filas = rechazada ? 0 : await page.getByRole('article').getByRole('table').locator('tbody tr').count()
        return { ms, extra: { impresionFilas: filas, impresionRechazadaPorMaximo: rechazada } }
      })
    })
  }
})
