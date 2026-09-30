import fs from 'node:fs'
import path from 'node:path'
import { expect, request as crearContexto, test, type APIResponse, type Page } from '@playwright/test'
import { capturarSinHerramientas } from './_captura'
import {
  COLUMNAS_PUBLICAS,
  FORMA_PAYLOAD,
  IDENT,
  clienteAnonimo,
  clienteAutenticado,
  contarCredenciales,
  decodificarQrDesdeUri,
  estadoAlumno,
  idAlumnoPorDni,
  idPerfilPorDni,
  limpiarCredenciales,
  ponerAcceso,
  sembrarActiva,
  sql,
} from './_credenciales-qr'

/**
 * Credencial QR con SESIONES REALES contra el stack local (EPT-64, RF20).
 *
 * Cada actor corre en su propio proyecto de Playwright (ver `playwright.config.ts`):
 * el `grep` de cada proyecto enruta el bloque `describe` a la sesión que de verdad
 * debe ser aceptada o rechazada. Por cada actor se prueban las TRES capas:
 *   - pantalla: lo que se ve y a dónde lleva la navegación;
 *   - API: los códigos 200/401/403/404/405/409/413/422 y `Cache-Control: no-store`;
 *   - PostgREST directo (RLS y permisos de función), con una sesión real y sin
 *     pasar por la aplicación, porque un menú oculto no es autorización.
 *
 * La clave de firma es EFÍMERA (la genera `supabase/tests/correr-autenticadas.mjs`
 * y nunca se imprime). Los QR se comprueban decodificando la imagen que entrega la
 * propia aplicación, sin conocer la clave. Las capturas solo se escriben con
 * `EPT_CAPTURAS=1` y únicamente muestran estados SIN un QR válido (revocada,
 * sin credencial, inactivo, bloqueado).
 */

const CAPTURAS = path.join('docs', 'evidence', 'EPT-64')
const escribirCapturas = process.env.EPT_CAPTURAS === '1'

async function captura(page: Page, nombre: string) {
  if (!escribirCapturas) return
  fs.mkdirSync(CAPTURAS, { recursive: true })
  await capturarSinHerramientas(page, path.join(CAPTURAS, `${test.info().project.name}-${nombre}.png`))
}

function exigirNoStore(respuesta: APIResponse, contexto: string) {
  expect(respuesta.headers()['cache-control'], `${contexto}: Cache-Control`).toBe('no-store')
}

type Cuerpo = Record<string, unknown>

async function json(respuesta: APIResponse): Promise<Cuerpo> {
  return (await respuesta.json()) as Cuerpo
}

/** El cuerpo de un error de la API: solo `error` en español y `codigo`, nada técnico. */
async function exigirError(respuesta: APIResponse, estado: number, codigo: string, contexto: string) {
  expect(respuesta.status(), `${contexto}: estado`).toBe(estado)
  exigirNoStore(respuesta, contexto)
  const cuerpo = await json(respuesta)
  expect(cuerpo.codigo, `${contexto}: código`).toBe(codigo)
  expect(Object.keys(cuerpo).sort(), `${contexto}: forma del error`).toEqual(['codigo', 'error'])
  expect(String(cuerpo.error), `${contexto}: mensaje en español`).toMatch(/[a-záéíóúñ]{3,}/i)
  expect(JSON.stringify(cuerpo), `${contexto}: sin detalle técnico`).not.toMatch(
    /P5\d{3}|PGRST|SQLSTATE|supabase|postgres|constraint|violates|stack/i
  )
}

const RUTA = '/api/credenciales-qr'

async function tarjetaDe(request: import('@playwright/test').APIRequestContext, alumnoId: string) {
  const respuesta = await request.get(`${RUTA}/${alumnoId}`)
  expect(respuesta.status()).toBe(200)
  exigirNoStore(respuesta, 'GET tarjeta')
  return ((await json(respuesta)).tarjeta as {
    alumno: { id: string; nombre: string; apellido: string; legajo_nro: string | null; estado: string }
    estado: string
    credencial: { id: string; emitida_en: string; revocada_en: string | null } | null
    qr: string | null
  })
}

async function verificar(request: import('@playwright/test').APIRequestContext, payload: unknown) {
  const respuesta = await request.post(`${RUTA}/verificacion`, { data: { payload } })
  exigirNoStore(respuesta, 'POST verificacion')
  return { estado: respuesta.status(), cuerpo: await json(respuesta) }
}

function sinDesborde(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
}

// ---------------------------------------------------------------------------

test.describe('DIRECTOR autenticado', () => {
  test.describe.configure({ retries: 0, mode: 'serial' })

  const beto = () => idAlumnoPorDni(IDENT.ESTUDIANTE.dni)
  const celeste = () => idAlumnoPorDni(IDENT.AJENO.dni)

  test('API: ciclo completo emitir → verificar → reponer → revocar, con historial y códigos', async ({ request }) => {
    const alumno = beto()
    expect(estadoAlumno(alumno), 'el escenario parte con el alumno ACTIVO').toBe('ACTIVO')
    limpiarCredenciales([alumno])

    // Sin credencial: leer NO emite nada.
    let tarjeta = await tarjetaDe(request, alumno)
    expect(tarjeta.estado).toBe('SIN_CREDENCIAL')
    expect(tarjeta.qr).toBeNull()
    expect(tarjeta.credencial).toBeNull()
    expect(contarCredenciales(alumno)).toBe(0)

    // Emitir; una segunda emisión se rechaza y sigue habiendo una sola ACTIVA.
    const emision = await request.post(`${RUTA}/${alumno}`)
    expect(emision.status()).toBe(201)
    exigirNoStore(emision, 'POST emitir')
    const primera = ((await json(emision)).credencial as { id: string }).id
    expect(primera).toMatch(/^[0-9a-f-]{36}$/)
    await exigirError(await request.post(`${RUTA}/${alumno}`), 409, 'CREDENCIAL_YA_ACTIVA', 'segunda emisión')
    expect(contarCredenciales(alumno, 'ACTIVA')).toBe(1)

    // La tarjeta trae un QR legible con la forma del payload y sin datos personales.
    tarjeta = await tarjetaDe(request, alumno)
    expect(tarjeta.estado).toBe('VIGENTE')
    expect(tarjeta.credencial?.id).toBe(primera)
    expect(tarjeta.alumno).toMatchObject({ nombre: IDENT.ESTUDIANTE.nombre, apellido: IDENT.ESTUDIANTE.apellido, legajo_nro: IDENT.ESTUDIANTE.legajo })
    expect(JSON.stringify(tarjeta)).not.toContain(IDENT.ESTUDIANTE.dni)
    const payloadA = decodificarQrDesdeUri(tarjeta.qr!)
    expect(payloadA).toMatch(FORMA_PAYLOAD)
    for (const dato of [IDENT.ESTUDIANTE.nombre, IDENT.ESTUDIANTE.apellido, IDENT.ESTUDIANTE.dni, IDENT.ESTUDIANTE.legajo, alumno, primera]) {
      expect(payloadA.toLowerCase()).not.toContain(dato.toLowerCase())
    }

    // Verificación: firma primero y estado después.
    expect(await verificar(request, payloadA)).toEqual({ estado: 200, cuerpo: { reconocido: true, valida: true, mensaje: 'La credencial es válida.' } })

    // Sin oráculo: firma alterada, basura y kid desconocido responden lo MISMO.
    const partes = payloadA.split('.')
    const alterada = `${partes[0]}.${partes[1]}.${partes[2]}.${partes[3].slice(0, -1)}${partes[3].endsWith('A') ? 'B' : 'A'}`
    const kidOtro = `${partes[0]}.zz9.${partes[2]}.${partes[3]}`
    const respuestas = await Promise.all([alterada, kidOtro, 'basura', 'EPT2.k1.a.b', ' '].map((p) => verificar(request, p)))
    for (const r of respuestas) {
      expect(r).toEqual({ estado: 200, cuerpo: { reconocido: false, valida: false, mensaje: 'El código QR no es reconocido.' } })
    }

    // Historial interno (solo Dirección): quién emitió.
    const historial = await request.get(`${RUTA}/${alumno}/historial`)
    expect(historial.status()).toBe(200)
    exigirNoStore(historial, 'GET historial')
    const filas = (await json(historial)).historial as { id: string; estado: string; emitida_por_nombre: string; motivo_revocacion: string | null }[]
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ id: primera, estado: 'ACTIVA', emitida_por_nombre: 'Ana Directora', motivo_revocacion: null })

    // Reponer: validación estricta del cuerpo.
    const url = (id: string, op: 'reposicion' | 'revocacion') => `${RUTA}/credenciales/${id}/${op}`
    await exigirError(await request.post(url(primera, 'reposicion'), { data: { motivo: 'ab' } }), 422, 'MOTIVO_INVALIDO', 'motivo corto')
    await exigirError(await request.post(url(primera, 'reposicion'), { data: { motivo: 'x'.repeat(201) } }), 422, 'MOTIVO_INVALIDO', 'motivo largo')
    await exigirError(await request.post(url(primera, 'reposicion'), { data: {} }), 422, 'MOTIVO_INVALIDO', 'sin motivo')
    await exigirError(await request.post(url(primera, 'reposicion'), { data: { motivo: 'Extravío', alumno_id: alumno } }), 400, 'CUERPO_INVALIDO', 'campo extra')
    await exigirError(await request.post(url(primera, 'reposicion'), { data: { motivo: 'Extravío', rol: 'DIRECTOR' } }), 400, 'CUERPO_INVALIDO', 'rol en el cuerpo')
    await exigirError(await request.post(url(primera, 'reposicion'), { data: 'no es json', headers: { 'content-type': 'application/json' } }), 400, 'CUERPO_INVALIDO', 'cuerpo no JSON')
    await exigirError(await request.post(url(primera, 'reposicion'), { data: 'x'.repeat(5000), headers: { 'content-type': 'application/json' } }), 413, 'CUERPO_DEMASIADO_GRANDE', 'cuerpo enorme')
    await exigirError(await request.post(url('no-es-uuid', 'reposicion'), { data: { motivo: 'Extravío' } }), 400, 'IDENTIFICADOR_INVALIDO', 'id de credencial inválido')
    await exigirError(await request.post(url('00000000-0000-4000-8000-000000000099', 'reposicion'), { data: { motivo: 'Extravío' } }), 404, 'CREDENCIAL_NO_ENCONTRADA', 'credencial inexistente')
    expect(contarCredenciales(alumno)).toBe(1)

    const reposicion = await request.post(url(primera, 'reposicion'), { data: { motivo: '  Extravío de la tarjeta  ' } })
    expect(reposicion.status()).toBe(200)
    exigirNoStore(reposicion, 'POST reposicion')
    const segunda = ((await json(reposicion)).credencial as { id: string }).id
    expect(segunda).not.toBe(primera)
    expect(contarCredenciales(alumno, 'ACTIVA')).toBe(1)

    // La anterior dejó de valer para siempre; la nueva vale; reponer con la obsoleta no toca a la nueva.
    expect((await verificar(request, payloadA)).cuerpo).toMatchObject({ reconocido: true, valida: false, motivo: 'CREDENCIAL_REVOCADA' })
    tarjeta = await tarjetaDe(request, alumno)
    const payloadB = decodificarQrDesdeUri(tarjeta.qr!)
    expect(payloadB).not.toBe(payloadA)
    expect((await verificar(request, payloadB)).cuerpo).toMatchObject({ reconocido: true, valida: true })
    await exigirError(await request.post(url(primera, 'reposicion'), { data: { motivo: 'Otra vez' } }), 409, 'CREDENCIAL_NO_VIGENTE', 'reponer la obsoleta')
    await exigirError(await request.post(url(primera, 'revocacion'), { data: { motivo: 'Otra vez' } }), 409, 'CREDENCIAL_NO_VIGENTE', 'revocar la obsoleta')
    expect((await tarjetaDe(request, alumno)).credencial?.id).toBe(segunda)

    // Revocar: nunca vuelve a valer; se puede emitir una nueva; el historial crece.
    const revocacion = await request.post(url(segunda, 'revocacion'), { data: { motivo: 'Baja por egreso' } })
    expect(revocacion.status()).toBe(200)
    expect((await verificar(request, payloadB)).cuerpo).toMatchObject({ reconocido: true, valida: false, motivo: 'CREDENCIAL_REVOCADA' })
    tarjeta = await tarjetaDe(request, alumno)
    expect(tarjeta.estado).toBe('REVOCADA')
    expect(tarjeta.qr).toBeNull()
    await exigirError(await request.post(url(segunda, 'revocacion'), { data: { motivo: 'Baja por egreso' } }), 409, 'CREDENCIAL_NO_VIGENTE', 'revocar dos veces')

    const nueva = await request.post(`${RUTA}/${alumno}`)
    expect(nueva.status()).toBe(201)
    const tercera = ((await json(nueva)).credencial as { id: string }).id
    const historialFinal = (await json(await request.get(`${RUTA}/${alumno}/historial`))).historial as {
      id: string; estado: string; motivo_revocacion: string | null; reemplaza_a: string | null; revocada_por_nombre: string | null
    }[]
    expect(historialFinal.map((h) => h.id)).toEqual([tercera, segunda, primera])
    expect(historialFinal.map((h) => h.estado)).toEqual(['ACTIVA', 'REVOCADA', 'REVOCADA'])
    expect(historialFinal.find((h) => h.id === primera)).toMatchObject({ motivo_revocacion: 'Extravío de la tarjeta', revocada_por_nombre: 'Ana Directora' })
    expect(historialFinal.find((h) => h.id === segunda)?.reemplaza_a).toBe(primera)
    expect(contarCredenciales(alumno)).toBe(3)
  })

  test('API: identificadores, métodos y cabeceras', async ({ request }) => {
    const alumno = beto()
    sembrarActiva(alumno)

    await exigirError(await request.get(`${RUTA}/no-es-uuid`), 400, 'IDENTIFICADOR_INVALIDO', 'GET id inválido')
    await exigirError(await request.post(`${RUTA}/no-es-uuid`), 400, 'IDENTIFICADOR_INVALIDO', 'POST id inválido')
    await exigirError(await request.get(`${RUTA}/00000000-0000-4000-8000-000000000099`), 404, 'ALUMNO_NO_ENCONTRADO', 'GET alumno inexistente')
    await exigirError(await request.post(`${RUTA}/00000000-0000-4000-8000-000000000099`), 404, 'ALUMNO_NO_ENCONTRADO', 'POST alumno inexistente')
    await exigirError(await request.get(`${RUTA}/no-es-uuid/historial`), 400, 'IDENTIFICADOR_INVALIDO', 'historial id inválido')

    const credencial = ((await tarjetaDe(request, alumno)).credencial as { id: string }).id
    const casos: { metodo: 'put' | 'patch' | 'delete' | 'get' | 'post'; ruta: string; allow: string }[] = [
      { metodo: 'put', ruta: `${RUTA}/${alumno}`, allow: 'GET, POST, OPTIONS' },
      { metodo: 'patch', ruta: `${RUTA}/${alumno}`, allow: 'GET, POST, OPTIONS' },
      { metodo: 'delete', ruta: `${RUTA}/${alumno}`, allow: 'GET, POST, OPTIONS' },
      { metodo: 'post', ruta: `${RUTA}/${alumno}/historial`, allow: 'GET, OPTIONS' },
      { metodo: 'delete', ruta: `${RUTA}/${alumno}/historial`, allow: 'GET, OPTIONS' },
      { metodo: 'get', ruta: `${RUTA}/credenciales/${credencial}/reposicion`, allow: 'POST, OPTIONS' },
      { metodo: 'delete', ruta: `${RUTA}/credenciales/${credencial}/reposicion`, allow: 'POST, OPTIONS' },
      { metodo: 'get', ruta: `${RUTA}/credenciales/${credencial}/revocacion`, allow: 'POST, OPTIONS' },
      { metodo: 'put', ruta: `${RUTA}/credenciales/${credencial}/revocacion`, allow: 'POST, OPTIONS' },
      { metodo: 'delete', ruta: `${RUTA}/credenciales/${credencial}/revocacion`, allow: 'POST, OPTIONS' },
      { metodo: 'get', ruta: `${RUTA}/verificacion`, allow: 'POST, OPTIONS' },
      { metodo: 'delete', ruta: `${RUTA}/verificacion`, allow: 'POST, OPTIONS' },
    ]
    for (const caso of casos) {
      const respuesta = await request[caso.metodo](caso.ruta)
      expect(respuesta.status(), `${caso.metodo.toUpperCase()} ${caso.ruta}`).toBe(405)
      expect(respuesta.headers().allow, `${caso.metodo.toUpperCase()} ${caso.ruta}: Allow`).toBe(caso.allow)
    }
    const opciones = await request.fetch(`${RUTA}/${alumno}`, { method: 'OPTIONS' })
    expect(opciones.status()).toBe(204)
    expect(opciones.headers().allow).toBe('GET, POST, OPTIONS')

    // El borrado físico no existe en ninguna capa: la credencial sigue ahí.
    expect(contarCredenciales(alumno, 'ACTIVA')).toBe(1)

    // Verificación: cuerpo estricto.
    await exigirError(await request.post(`${RUTA}/verificacion`, { data: {} }), 400, 'CUERPO_INVALIDO', 'verificar sin payload')
    await exigirError(await request.post(`${RUTA}/verificacion`, { data: { payload: 'x', extra: 1 } }), 400, 'CUERPO_INVALIDO', 'verificar con campo extra')
    await exigirError(await request.post(`${RUTA}/verificacion`, { data: { payload: 42 } }), 400, 'CUERPO_INVALIDO', 'payload no textual')
    await exigirError(await request.post(`${RUTA}/verificacion`, { data: { payload: 'a'.repeat(300) } }), 400, 'CUERPO_INVALIDO', 'payload demasiado largo')
    await exigirError(await request.post(`${RUTA}/verificacion`, { data: 'no es json', headers: { 'content-type': 'application/json' } }), 400, 'CUERPO_INVALIDO', 'verificar no JSON')
  })

  test('el estado del alumno decide la validez: inactivar invalida, reactivar restaura la MISMA; el bloqueo invalida', async ({ request }) => {
    const alumno = beto()
    const perfil = idPerfilPorDni(IDENT.ESTUDIANTE.dni)
    limpiarCredenciales([alumno])
    const creada = await request.post(`${RUTA}/${alumno}`)
    expect(creada.status()).toBe(201)
    const id = ((await json(creada)).credencial as { id: string }).id
    const payload = decodificarQrDesdeUri((await tarjetaDe(request, alumno)).qr!)
    const curso = sql(`SELECT curso_id FROM public.matriculas WHERE alumno_id = '${alumno}' ORDER BY fecha_inicio DESC LIMIT 1;`)

    try {
      // Inactivar con el flujo real de alumnos.
      const inactivar = await request.patch(`/api/alumnos/${alumno}`, { data: { accion: 'inactivar' } })
      expect(inactivar.status()).toBe(200)
      expect((await verificar(request, payload)).cuerpo).toMatchObject({ reconocido: true, valida: false, motivo: 'ALUMNO_INACTIVO' })
      const inactiva = await tarjetaDe(request, alumno)
      expect(inactiva.estado).toBe('ALUMNO_INACTIVO')
      expect(inactiva.qr).toBeNull()
      // La credencial NO se tocó: la validez se calcula al consultar.
      expect(contarCredenciales(alumno, 'ACTIVA')).toBe(1)
      expect(sql(`SELECT id FROM public.credenciales_qr WHERE alumno_id = '${alumno}' AND estado = 'ACTIVA';`)).toBe(id)

      // Reactivar: vale la misma credencial y el mismo payload.
      const reactivar = await request.patch(`/api/alumnos/${alumno}`, { data: { accion: 'reactivar', curso_id: curso } })
      expect(reactivar.status()).toBe(200)
      expect((await verificar(request, payload)).cuerpo).toMatchObject({ reconocido: true, valida: true })
      const reactivada = await tarjetaDe(request, alumno)
      expect(reactivada.estado).toBe('VIGENTE')
      expect(reactivada.credencial?.id).toBe(id)
      expect(decodificarQrDesdeUri(reactivada.qr!)).toBe(payload)

      // Bloqueo de acceso del perfil.
      ponerAcceso(perfil, 'BLOQUEADO')
      expect((await verificar(request, payload)).cuerpo).toMatchObject({ reconocido: true, valida: false, motivo: 'ACCESO_BLOQUEADO' })
      expect((await tarjetaDe(request, alumno)).estado).toBe('ACCESO_BLOQUEADO')
      ponerAcceso(perfil, 'HABILITADO')
      expect((await verificar(request, payload)).cuerpo).toMatchObject({ reconocido: true, valida: true })

      // Una revocada NO se restaura al inactivar y reactivar.
      const revocar = await request.post(`${RUTA}/credenciales/${id}/revocacion`, { data: { motivo: 'Baja por egreso' } })
      expect(revocar.status()).toBe(200)
      expect((await request.patch(`/api/alumnos/${alumno}`, { data: { accion: 'inactivar' } })).status()).toBe(200)
      expect((await request.patch(`/api/alumnos/${alumno}`, { data: { accion: 'reactivar', curso_id: curso } })).status()).toBe(200)
      expect((await verificar(request, payload)).cuerpo).toMatchObject({ reconocido: true, valida: false, motivo: 'CREDENCIAL_REVOCADA' })
      expect((await tarjetaDe(request, alumno)).estado).toBe('REVOCADA')
    } finally {
      ponerAcceso(perfil, 'HABILITADO')
      if (estadoAlumno(alumno) === 'INACTIVO') {
        await request.patch(`/api/alumnos/${alumno}`, { data: { accion: 'reactivar', curso_id: curso } })
      }
    }
    expect(estadoAlumno(alumno)).toBe('ACTIVO')
  })

  test('un alumno inactivo no recibe ni repone credencial, pero Dirección sí puede revocarla', async ({ page, request }) => {
    const alumno = beto()
    limpiarCredenciales([alumno])
    const curso = sql(`SELECT curso_id FROM public.matriculas WHERE alumno_id = '${alumno}' ORDER BY fecha_inicio DESC LIMIT 1;`)
    const creada = await request.post(`${RUTA}/${alumno}`)
    expect(creada.status()).toBe(201)
    const id = ((await json(creada)).credencial as { id: string }).id

    try {
      expect((await request.patch(`/api/alumnos/${alumno}`, { data: { accion: 'inactivar' } })).status()).toBe(200)

      // Reponer: rechazado y la vigente no se toca (la transacción entera se revierte).
      await exigirError(
        await request.post(`${RUTA}/credenciales/${id}/reposicion`, { data: { motivo: 'Extravío de la tarjeta' } }),
        409, 'ALUMNO_INACTIVO', 'reponer con el alumno inactivo'
      )
      expect(contarCredenciales(alumno)).toBe(1)
      expect(contarCredenciales(alumno, 'ACTIVA')).toBe(1)

      // La pantalla no ofrece lo que la base rechaza: solo queda Revocar, con su explicación.
      await page.goto(`/dashboard/credenciales/${alumno}`)
      await expect(page.getByRole('button', { name: 'Revocar credencial' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Reponer credencial' })).toHaveCount(0)
      await expect(page.getByTestId('credencial-no-emisible')).toContainText('no se puede reponer')

      // Revocar por seguridad sí se puede. Sin ACTIVA, emitir sigue rechazado y no deja filas.
      expect((await request.post(`${RUTA}/credenciales/${id}/revocacion`, { data: { motivo: 'Baja por inactivación' } })).status()).toBe(200)
      await exigirError(await request.post(`${RUTA}/${alumno}`), 409, 'ALUMNO_INACTIVO', 'emitir con el alumno inactivo')
      expect(contarCredenciales(alumno, 'ACTIVA')).toBe(0)
      expect(contarCredenciales(alumno)).toBe(1)

      await page.goto(`/dashboard/credenciales/${alumno}`)
      await expect(page.getByRole('button', { name: /Emitir credencial/ })).toHaveCount(0)
      await expect(page.getByTestId('credencial-no-emisible')).toContainText('no se puede emitir')

      // Reactivado, se emite una credencial nueva (otra fila): la revocada no revive.
      expect((await request.patch(`/api/alumnos/${alumno}`, { data: { accion: 'reactivar', curso_id: curso } })).status()).toBe(200)
      const nueva = await request.post(`${RUTA}/${alumno}`)
      expect(nueva.status()).toBe(201)
      expect(((await json(nueva)).credencial as { id: string }).id).not.toBe(id)
    } finally {
      if (estadoAlumno(alumno) === 'INACTIVO') {
        await request.patch(`/api/alumnos/${alumno}`, { data: { accion: 'reactivar', curso_id: curso } })
      }
      limpiarCredenciales([alumno])
    }
    expect(estadoAlumno(alumno)).toBe('ACTIVO')
  })

  test('cambiar curso, DNI o legajo no modifica el payload ni exige reemisión', async ({ request }) => {
    const alumno = beto()
    limpiarCredenciales([alumno])
    expect((await request.post(`${RUTA}/${alumno}`)).status()).toBe(201)
    const antes = await tarjetaDe(request, alumno)
    const payload = decodificarQrDesdeUri(antes.qr!)

    const cursoActual = sql(`SELECT curso_id FROM public.matriculas WHERE alumno_id = '${alumno}' AND fecha_cierre IS NULL;`)
    const otroCurso = sql(`SELECT id FROM public.cursos WHERE activo AND id <> '${cursoActual}' ORDER BY id LIMIT 1;`)
    expect(otroCurso, 'se necesita otro curso activo').toMatch(/^[0-9a-f-]{36}$/)

    try {
      expect((await request.patch(`/api/alumnos/${alumno}`, { data: { accion: 'cambiar_curso', curso_id: otroCurso } })).status()).toBe(200)
      expect((await request.patch(`/api/alumnos/${alumno}`, { data: { accion: 'corregir_identidad', dni: '99900202', legajo_nro: 'LEG-EPT64-TMP' } })).status()).toBe(200)

      const despues = await tarjetaDe(request, alumno)
      expect(despues.credencial?.id).toBe(antes.credencial?.id)
      expect(despues.alumno.legajo_nro).toBe('LEG-EPT64-TMP')
      expect(decodificarQrDesdeUri(despues.qr!)).toBe(payload)
      expect((await verificar(request, payload)).cuerpo).toMatchObject({ reconocido: true, valida: true })
      expect(contarCredenciales(alumno)).toBe(1)
    } finally {
      await request.patch(`/api/alumnos/${alumno}`, { data: { accion: 'corregir_identidad', dni: IDENT.ESTUDIANTE.dni, legajo_nro: IDENT.ESTUDIANTE.legajo } })
      await request.patch(`/api/alumnos/${alumno}`, { data: { accion: 'cambiar_curso', curso_id: cursoActual } })
    }
    expect(sql(`SELECT dni || '/' || legajo_nro FROM public.perfiles WHERE id = '${alumno}';`)).toBe(`${IDENT.ESTUDIANTE.dni}/${IDENT.ESTUDIANTE.legajo}`)
  })

  test('concurrencia por HTTP: doble emisión, doble reposición y ráfaga dejan una sola ACTIVA', async ({ request }) => {
    const alumno = beto()
    limpiarCredenciales([alumno])

    const dobles = await Promise.all([request.post(`${RUTA}/${alumno}`), request.post(`${RUTA}/${alumno}`)])
    expect(dobles.map((r) => r.status()).sort()).toEqual([201, 409])
    expect(contarCredenciales(alumno, 'ACTIVA')).toBe(1)
    const original = sql(`SELECT id FROM public.credenciales_qr WHERE alumno_id = '${alumno}' AND estado = 'ACTIVA';`)

    const reposiciones = await Promise.all([
      request.post(`${RUTA}/credenciales/${original}/reposicion`, { data: { motivo: 'Reposición concurrente' } }),
      request.post(`${RUTA}/credenciales/${original}/reposicion`, { data: { motivo: 'Reposición concurrente' } }),
    ])
    expect(reposiciones.map((r) => r.status()).sort()).toEqual([200, 409])
    expect(contarCredenciales(alumno, 'ACTIVA')).toBe(1)
    expect(contarCredenciales(alumno)).toBe(2)

    const ajeno = celeste()
    limpiarCredenciales([ajeno])
    const rafaga = await Promise.all(Array.from({ length: 6 }, () => request.post(`${RUTA}/${ajeno}`)))
    expect(rafaga.map((r) => r.status()).sort()).toEqual([201, 409, 409, 409, 409, 409])
    expect(contarCredenciales(ajeno, 'ACTIVA')).toBe(1)
    expect(contarCredenciales(ajeno)).toBe(1)
    limpiarCredenciales([ajeno])
  })

  test('pantalla: panel, emisión explícita, reposición, revocación, persistencia y móvil', async ({ page }) => {
    const alumno = beto()
    limpiarCredenciales([alumno])

    // Navegación: solo lo de Dirección.
    await page.goto('/dashboard')
    const nav = page.getByRole('navigation').first()
    await expect(nav.getByRole('link', { name: 'Credenciales', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Mi credencial' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Credenciales de mis hijos' })).toHaveCount(0)

    await page.goto('/dashboard/credenciales')
    await expect(page.getByRole('heading', { name: 'Credenciales', exact: true })).toBeVisible()
    await page.getByLabel('Buscar por nombre, apellido o legajo').fill(IDENT.ESTUDIANTE.legajo)
    const lista = page.getByRole('list', { name: 'Alumnos y estado de su credencial' })
    await expect(lista.getByRole('listitem')).toHaveCount(1)
    await expect(lista.getByText('Sin credencial')).toBeVisible()
    expect(await lista.innerText()).not.toContain(IDENT.ESTUDIANTE.dni)

    await page.getByRole('link', { name: `Ver la credencial de ${IDENT.ESTUDIANTE.nombre} ${IDENT.ESTUDIANTE.apellido}` }).click()
    await expect(page.getByRole('heading', { name: 'Todavía no hay una credencial' })).toBeVisible()
    await captura(page, 'director-sin-credencial')
    // Ver la pantalla NO emite.
    expect(contarCredenciales(alumno)).toBe(0)

    // Emitir con un clic explícito.
    await page.getByRole('button', { name: 'Emitir credencial' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Credencial emitida.' })).toBeVisible()
    await expect(page.getByRole('article', { name: `Credencial digital de ${IDENT.ESTUDIANTE.nombre} ${IDENT.ESTUDIANTE.apellido}` })).toBeVisible()
    await expect(page.getByText('Credencial vigente')).toBeVisible()
    expect(contarCredenciales(alumno, 'ACTIVA')).toBe(1)

    // Persiste tras recargar y muestra un QR legible.
    await page.reload()
    const imagen = page.getByRole('img', { name: `Código QR de la credencial de ${IDENT.ESTUDIANTE.nombre} ${IDENT.ESTUDIANTE.apellido}` })
    await expect(imagen).toBeVisible()
    const uri = await imagen.getAttribute('src')
    expect(decodificarQrDesdeUri(uri!)).toMatch(FORMA_PAYLOAD)
    await expect(page.getByRole('heading', { name: 'Historial' })).toBeVisible()

    // Descargar desde la pantalla de Dirección.
    const descarga = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Descargar imagen' }).click()
    expect((await descarga).suggestedFilename()).toBe('credencial-estudiante-beto.png')

    // Reponer: el diálogo pide el motivo y devuelve el foco al cerrar.
    const reponer = page.getByRole('button', { name: 'Reponer credencial' })
    await reponer.click()
    const dialogo = page.getByRole('dialog', { name: 'Reponer credencial' })
    await dialogo.getByLabel(/Motivo/).fill('Extravío de la tarjeta')
    await dialogo.getByRole('button', { name: 'Reponer credencial' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Credencial repuesta. La anterior quedó revocada.' })).toBeVisible()
    await expect(dialogo).toBeHidden()
    expect(contarCredenciales(alumno, 'ACTIVA')).toBe(1)
    expect(contarCredenciales(alumno)).toBe(2)
    await page.reload()
    const items = page.getByRole('list', { name: /Historial de credenciales/ }).getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(1)).toContainText('Extravío de la tarjeta')
    await expect(items.nth(1)).toContainText('Ana Directora')

    // Revocar.
    await page.getByRole('button', { name: 'Revocar credencial' }).click()
    const revocar = page.getByRole('dialog', { name: 'Revocar credencial' })
    await expect(revocar).toContainText('no se puede restaurar')
    await revocar.getByLabel(/Motivo/).fill('Baja por egreso')
    await revocar.getByRole('button', { name: 'Revocar credencial' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Credencial revocada.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Credencial revocada' })).toBeVisible()
    await expect(page.getByRole('img', { name: /Código QR/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Emitir credencial nueva' })).toBeVisible()
    await captura(page, 'director-revocada')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Credencial revocada' })).toBeVisible()

    // Móvil sin desborde.
    await page.setViewportSize({ width: 375, height: 812 })
    expect(await sinDesborde(page)).toBe(true)
    await page.goto('/dashboard/credenciales')
    expect(await sinDesborde(page)).toBe(true)
    await captura(page, 'director-panel-movil')
  })

  test('PostgREST directo como Dirección: lee columnas públicas, no los datos internos, no escribe', async () => {
    const alumno = beto()
    sembrarActiva(alumno)
    const cliente = await clienteAutenticado(IDENT.DIRECTORA.email, IDENT.DIRECTORA.password)

    const lectura = await cliente.from('credenciales_qr').select(COLUMNAS_PUBLICAS).eq('alumno_id', alumno)
    expect(lectura.error).toBeNull()
    expect((lectura.data ?? []).length).toBeGreaterThanOrEqual(1)
    for (const interno of ['motivo_revocacion', 'emitida_por', 'revocada_por', 'reemplaza_a']) {
      const r = await cliente.from('credenciales_qr').select(interno).limit(1)
      expect(r.error?.code, `columna interna ${interno}`).toBe('42501')
    }
    expect((await cliente.from('credenciales_qr').select('*').limit(1)).error?.code).toBe('42501')

    const insercion = await cliente.from('credenciales_qr').insert({ alumno_id: alumno, clave_kid: 'k1', emitida_por: alumno })
    expect(insercion.error?.code).toBe('42501')
    expect((await cliente.from('credenciales_qr').update({ estado: 'REVOCADA' }).eq('alumno_id', alumno)).error?.code).toBe('42501')
    expect((await cliente.from('credenciales_qr').delete().eq('alumno_id', alumno)).error?.code).toBe('42501')

    // Las funciones validan sus argumentos en la base.
    expect((await cliente.rpc('emitir_credencial_qr', { p_alumno_id: alumno, p_clave_kid: 'K.1' })).error?.code).toBe('P5625')
    expect((await cliente.rpc('emitir_credencial_qr', { p_alumno_id: alumno, p_clave_kid: 'k1' })).error?.code).toBe('P5621')
    expect((await cliente.rpc('revocar_credencial_qr', { p_credencial_id: alumno, p_motivo: 'Baja por egreso' })).error?.code).toBe('P5622')
    const validez = await cliente.rpc('consultar_validez_credencial_qr', { p_credencial_id: '00000000-0000-4000-8000-000000000099' })
    expect(validez.error).toBeNull()
    expect(validez.data).toEqual([])
  })
})

// ---------------------------------------------------------------------------

test.describe('ESTUDIANTE autenticado', () => {
  test.describe.configure({ retries: 0 })

  test('ve, descarga e imprime SOLO la propia; no puede administrar nada', async ({ page, request }) => {
    const propio = idAlumnoPorDni(IDENT.ESTUDIANTE.dni)
    const ajeno = idAlumnoPorDni(IDENT.AJENO.dni)
    limpiarCredenciales([propio, ajeno])
    const idPropia = sembrarActiva(propio)
    sembrarActiva(ajeno)

    await page.goto('/dashboard/mi-credencial')
    await expect(page.getByRole('heading', { name: 'Mi credencial' })).toBeVisible()
    const nav = page.getByRole('navigation').first()
    await expect(nav.getByRole('link', { name: 'Mi credencial' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Credenciales', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Credenciales de mis hijos' })).toHaveCount(0)

    const tarjeta = page.getByRole('article', { name: `Credencial digital de ${IDENT.ESTUDIANTE.nombre} ${IDENT.ESTUDIANTE.apellido}` })
    await expect(tarjeta).toBeVisible()
    await expect(tarjeta).toContainText(`Legajo: ${IDENT.ESTUDIANTE.legajo}`)
    expect(await tarjeta.innerText()).not.toMatch(/dni|documento|99900002/i)
    expect(await page.locator('body').innerText()).not.toContain(IDENT.AJENO.apellido)

    const uri = await tarjeta.getByRole('img').getAttribute('src')
    const payload = decodificarQrDesdeUri(uri!)
    expect(payload).toMatch(FORMA_PAYLOAD)
    for (const dato of [IDENT.ESTUDIANTE.nombre, IDENT.ESTUDIANTE.apellido, IDENT.ESTUDIANTE.dni, IDENT.ESTUDIANTE.legajo, propio, idPropia]) {
      expect(payload.toLowerCase()).not.toContain(dato.toLowerCase())
    }
    // El texto del payload no aparece en el HTML como texto ni atributo (salvo el SVG codificado).
    expect((await page.content()).includes(payload)).toBe(false)

    // Descargar y persistir tras recargar.
    const descarga = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Descargar imagen' }).click()
    const archivo = await descarga
    expect(archivo.suggestedFilename()).toBe('credencial-estudiante-beto.png')
    expect([...fs.readFileSync(await archivo.path()).subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await page.evaluate(() => { (window as unknown as { __n: number }).__n = 0; window.print = () => { (window as unknown as { __n: number }).__n += 1 } })
    await page.getByRole('button', { name: 'Imprimir' }).click()
    expect(await page.evaluate(() => (window as unknown as { __n: number }).__n)).toBe(1)
    await page.reload()
    await expect(tarjeta).toBeVisible()

    await page.setViewportSize({ width: 375, height: 812 })
    expect(await sinDesborde(page)).toBe(true)
    await page.setViewportSize({ width: 1280, height: 720 })

    // Pantallas de otros roles: acceso restringido (y sin menú que las muestre).
    for (const ruta of ['/dashboard/credenciales', `/dashboard/credenciales/${propio}`, '/dashboard/credenciales-hijos']) {
      await page.goto(ruta)
      await expect(page.getByRole('heading', { name: 'Acceso restringido' }), ruta).toBeVisible()
      await expect(page.getByRole('img', { name: /Código QR/ })).toHaveCount(0)
    }

    // API: lee la propia; la ajena es indistinguible de una inexistente; no administra.
    const propiaApi = await request.get(`${RUTA}/${propio}`)
    expect(propiaApi.status()).toBe(200)
    exigirNoStore(propiaApi, 'GET propia')
    expect(((await json(propiaApi)).tarjeta as { estado: string }).estado).toBe('VIGENTE')
    await exigirError(await request.get(`${RUTA}/${ajeno}`), 404, 'ALUMNO_NO_ENCONTRADO', 'GET ajena')
    await exigirError(await request.get(`${RUTA}/00000000-0000-4000-8000-000000000099`), 404, 'ALUMNO_NO_ENCONTRADO', 'GET inexistente (igual que la ajena)')
    await exigirError(await request.post(`${RUTA}/${propio}`), 403, 'SIN_PERMISO', 'emitir')
    await exigirError(await request.post(`${RUTA}/credenciales/${idPropia}/reposicion`, { data: { motivo: 'Extravío' } }), 403, 'SIN_PERMISO', 'reponer')
    await exigirError(await request.post(`${RUTA}/credenciales/${idPropia}/revocacion`, { data: { motivo: 'Extravío' } }), 403, 'SIN_PERMISO', 'revocar')
    await exigirError(await request.get(`${RUTA}/${propio}/historial`), 403, 'SIN_PERMISO', 'historial')
    await exigirError(await request.post(`${RUTA}/verificacion`, { data: { payload } }), 403, 'SIN_PERMISO', 'verificar')
    expect(contarCredenciales(propio, 'ACTIVA')).toBe(1)
  })

  test('PostgREST directo: solo la propia fila, sin datos internos y sin escrituras', async () => {
    const propio = idAlumnoPorDni(IDENT.ESTUDIANTE.dni)
    const ajeno = idAlumnoPorDni(IDENT.AJENO.dni)
    const id = sembrarActiva(propio)
    sembrarActiva(ajeno)
    const cliente = await clienteAutenticado(IDENT.ESTUDIANTE.email, IDENT.ESTUDIANTE.password)

    const todas = await cliente.from('credenciales_qr').select(COLUMNAS_PUBLICAS)
    expect(todas.error).toBeNull()
    expect((todas.data ?? []).every((f: { alumno_id: string }) => f.alumno_id === propio)).toBe(true)
    expect((todas.data ?? []).length).toBeGreaterThanOrEqual(1)
    expect(((await cliente.from('credenciales_qr').select('id').eq('alumno_id', ajeno)).data ?? [])).toEqual([])
    expect((await cliente.from('credenciales_qr').select('motivo_revocacion').limit(1)).error?.code).toBe('42501')
    expect((await cliente.from('credenciales_qr').select('emitida_por').limit(1)).error?.code).toBe('42501')
    expect((await cliente.from('credenciales_qr').insert({ alumno_id: propio, clave_kid: 'k1', emitida_por: propio })).error?.code).toBe('42501')
    expect((await cliente.from('credenciales_qr').update({ estado: 'REVOCADA' }).eq('id', id)).error?.code).toBe('42501')
    expect((await cliente.from('credenciales_qr').delete().eq('id', id)).error?.code).toBe('42501')
    expect((await cliente.rpc('emitir_credencial_qr', { p_alumno_id: propio, p_clave_kid: 'k1' })).error?.code).toBe('42501')
    expect((await cliente.rpc('reponer_credencial_qr', { p_credencial_id: id, p_clave_kid: 'k1', p_motivo: 'Extravío' })).error?.code).toBe('42501')
    expect((await cliente.rpc('revocar_credencial_qr', { p_credencial_id: id, p_motivo: 'Extravío' })).error?.code).toBe('42501')
    expect((await cliente.rpc('historial_credenciales_qr', { p_alumno_id: propio })).error?.code).toBe('42501')
    expect((await cliente.rpc('consultar_validez_credencial_qr', { p_credencial_id: id })).error?.code).toBe('42501')
    expect(contarCredenciales(propio, 'ACTIVA')).toBe(1)
  })
})

test.describe('ESTUDIANTE AJENO autenticado', () => {
  test.describe.configure({ retries: 0 })

  test('sin credencial: la pantalla lo dice y NO emite nada; no ve la de otro alumno', async ({ page, request }) => {
    const propio = idAlumnoPorDni(IDENT.AJENO.dni)
    const beto = idAlumnoPorDni(IDENT.ESTUDIANTE.dni)
    limpiarCredenciales([propio])
    sembrarActiva(beto)

    await page.goto('/dashboard/mi-credencial')
    await expect(page.getByRole('heading', { name: 'Todavía no tenés una credencial' })).toBeVisible()
    await expect(page.getByRole('img', { name: /Código QR/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Emitir|Descargar|Imprimir/ })).toHaveCount(0)
    await captura(page, 'estudiante-sin-credencial')
    await page.reload()
    expect((await request.get(`${RUTA}/${propio}`)).status()).toBe(200)
    expect(contarCredenciales(propio)).toBe(0)

    await exigirError(await request.get(`${RUTA}/${beto}`), 404, 'ALUMNO_NO_ENCONTRADO', 'GET de otro alumno')
    expect(await page.locator('body').innerText()).not.toContain(IDENT.ESTUDIANTE.apellido)
  })
})

test.describe('ESTUDIANTE INACTIVO autenticado', () => {
  test.describe.configure({ retries: 0 })

  test('con una credencial vigente pero inactivo: lo dice y no muestra el QR', async ({ page, request }) => {
    const propio = idAlumnoPorDni(IDENT.INACTIVO.dni)
    expect(estadoAlumno(propio)).toBe('INACTIVO')
    limpiarCredenciales([propio])
    sembrarActiva(propio)

    await page.goto('/dashboard/mi-credencial')
    await expect(page.getByRole('heading', { name: 'Estás inactivo' })).toBeVisible()
    await expect(page.getByText(/vuelve a valer la misma/)).toBeVisible()
    await expect(page.getByRole('img', { name: /Código QR/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Descargar|Imprimir/ })).toHaveCount(0)
    await captura(page, 'estudiante-inactivo')

    const tarjeta = ((await json(await request.get(`${RUTA}/${propio}`))).tarjeta as { estado: string; qr: string | null })
    expect(tarjeta.estado).toBe('ALUMNO_INACTIVO')
    expect(tarjeta.qr).toBeNull()
    limpiarCredenciales([propio])
  })
})

test.describe('PADRE autenticado', () => {
  test.describe.configure({ retries: 0, mode: 'serial' })

  test('ve solo las de sus hijos vinculados; desvincular corta el acceso en el acto', async ({ page, request }) => {
    const apto = idAlumnoPorDni(IDENT.HIJO_APTO.dni)
    const concurrente = idAlumnoPorDni(IDENT.HIJO_CONCURRENTE.dni)
    const beto = idAlumnoPorDni(IDENT.ESTUDIANTE.dni)
    const padre = idPerfilPorDni(IDENT.PADRE.dni)
    limpiarCredenciales([apto, concurrente])
    sembrarActiva(apto)
    sembrarActiva(beto)

    await page.goto('/dashboard/credenciales-hijos')
    await expect(page.getByRole('heading', { name: 'Credenciales de mis hijos' })).toBeVisible()
    const nav = page.getByRole('navigation').first()
    await expect(nav.getByRole('link', { name: 'Credenciales de mis hijos' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Credenciales', exact: true })).toHaveCount(0)

    // Los dos hijos aparecen; el ajeno no.
    await expect(page.getByRole('heading', { name: `${IDENT.HIJO_APTO.nombre} ${IDENT.HIJO_APTO.apellido}` })).toBeVisible()
    await expect(page.getByRole('heading', { name: `${IDENT.HIJO_CONCURRENTE.nombre} ${IDENT.HIJO_CONCURRENTE.apellido}` })).toBeVisible()
    expect(await page.locator('body').innerText()).not.toContain(IDENT.ESTUDIANTE.apellido)
    expect(await page.locator('body').innerText()).not.toContain(IDENT.AJENO.apellido)

    // El hijo sin credencial lo dice (y no se emite nada al mirar).
    await expect(page.getByText(`Cuando Dirección emita la credencial de ${IDENT.HIJO_CONCURRENTE.nombre}`)).toBeVisible()
    expect(contarCredenciales(concurrente)).toBe(0)

    // El hijo con credencial muestra QR si está activo, o el aviso de inactivo.
    if (estadoAlumno(apto) === 'ACTIVO') {
      const tarjeta = page.getByRole('article', { name: `Credencial digital de ${IDENT.HIJO_APTO.nombre} ${IDENT.HIJO_APTO.apellido}` })
      await expect(tarjeta).toBeVisible()
      await expect(tarjeta).toContainText(`Legajo: ${IDENT.HIJO_APTO.legajo}`)
      expect(await tarjeta.innerText()).not.toMatch(/dni|documento/i)
      expect(decodificarQrDesdeUri((await tarjeta.getByRole('img').getAttribute('src'))!)).toMatch(FORMA_PAYLOAD)
      const descarga = page.waitForEvent('download')
      await tarjeta.locator('xpath=ancestor::section').getByRole('button', { name: 'Descargar imagen' }).click()
      expect((await descarga).suggestedFilename()).toBe('credencial-vinculada-lara.png')
    } else {
      await expect(page.getByText(new RegExp(`La credencial de ${IDENT.HIJO_APTO.nombre} no es válida mientras esté inactivo`))).toBeVisible()
      await expect(page.getByRole('img', { name: /Código QR/ })).toHaveCount(0)
    }
    await page.setViewportSize({ width: 375, height: 812 })
    expect(await sinDesborde(page)).toBe(true)
    // Sin captura: con un hijo activo la pantalla muestra un QR, y la evidencia no incluye QR válidos.
    await page.setViewportSize({ width: 1280, height: 720 })

    // API y otras pantallas.
    const api = await request.get(`${RUTA}/${apto}`)
    expect(api.status()).toBe(200)
    exigirNoStore(api, 'GET hijo')
    await exigirError(await request.get(`${RUTA}/${beto}`), 404, 'ALUMNO_NO_ENCONTRADO', 'GET de un no hijo')
    await exigirError(await request.post(`${RUTA}/${apto}`), 403, 'SIN_PERMISO', 'emitir')
    await exigirError(await request.get(`${RUTA}/${apto}/historial`), 403, 'SIN_PERMISO', 'historial')
    await exigirError(await request.post(`${RUTA}/verificacion`, { data: { payload: 'x' } }), 403, 'SIN_PERMISO', 'verificar')
    for (const ruta of ['/dashboard/credenciales', '/dashboard/mi-credencial']) {
      await page.goto(ruta)
      await expect(page.getByRole('heading', { name: 'Acceso restringido' }), ruta).toBeVisible()
    }

    // PostgREST directo.
    const cliente = await clienteAutenticado(IDENT.PADRE.email, IDENT.PADRE.password)
    const filas = (await cliente.from('credenciales_qr').select(COLUMNAS_PUBLICAS)).data ?? []
    expect(filas.every((f: { alumno_id: string }) => [apto, concurrente].includes(f.alumno_id))).toBe(true)
    expect(filas.some((f: { alumno_id: string }) => f.alumno_id === apto)).toBe(true)
    expect(((await cliente.from('credenciales_qr').select('id').eq('alumno_id', beto)).data ?? [])).toEqual([])
    expect((await cliente.from('credenciales_qr').select('motivo_revocacion').limit(1)).error?.code).toBe('42501')
    expect((await cliente.rpc('emitir_credencial_qr', { p_alumno_id: apto, p_clave_kid: 'k1' })).error?.code).toBe('42501')

    // Desvincular: el hijo desaparece de la pantalla, de la API y de PostgREST.
    sql(`DELETE FROM public.padres_hijos WHERE padre_id = '${padre}' AND hijo_id = '${apto}';`)
    try {
      await exigirError(await request.get(`${RUTA}/${apto}`), 404, 'ALUMNO_NO_ENCONTRADO', 'GET de un hijo desvinculado')
      await page.goto('/dashboard/credenciales-hijos')
      await expect(page.getByRole('heading', { name: `${IDENT.HIJO_APTO.nombre} ${IDENT.HIJO_APTO.apellido}` })).toHaveCount(0)
      expect(((await cliente.from('credenciales_qr').select('id').eq('alumno_id', apto)).data ?? [])).toEqual([])
    } finally {
      sql(`INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES ('${padre}', '${apto}') ON CONFLICT DO NOTHING;`)
    }
    expect((await request.get(`${RUTA}/${apto}`)).status()).toBe(200)
  })
})

test.describe('PADRE SEGUNDO autenticado', () => {
  test.describe.configure({ retries: 0 })

  test('sin hijos vinculados: estado vacío y ninguna credencial ajena', async ({ page, request }) => {
    const apto = idAlumnoPorDni(IDENT.HIJO_APTO.dni)
    sembrarActiva(apto)

    await page.goto('/dashboard/credenciales-hijos')
    await expect(page.getByText('Todavía no tenés hijos vinculados')).toBeVisible()
    await expect(page.getByRole('img', { name: /Código QR/ })).toHaveCount(0)
    await captura(page, 'padre-sin-hijos')

    await exigirError(await request.get(`${RUTA}/${apto}`), 404, 'ALUMNO_NO_ENCONTRADO', 'GET del hijo de otro padre')
    const cliente = await clienteAutenticado(IDENT.PADRE_SEGUNDO.email, IDENT.PADRE_SEGUNDO.password)
    expect((await cliente.from('credenciales_qr').select('id')).data ?? []).toEqual([])
  })
})

test.describe('DOCENTE autenticado', () => {
  test.describe.configure({ retries: 0 })

  test('sin acceso en pantalla, API ni PostgREST', async ({ page, request }) => {
    const alumno = idAlumnoPorDni(IDENT.ESTUDIANTE.dni)
    sembrarActiva(alumno)
    const id = sql(`SELECT id FROM public.credenciales_qr WHERE alumno_id = '${alumno}' AND estado = 'ACTIVA';`)

    for (const ruta of ['/dashboard/credenciales', `/dashboard/credenciales/${alumno}`, '/dashboard/mi-credencial', '/dashboard/credenciales-hijos']) {
      await page.goto(ruta)
      await expect(page.getByRole('heading', { name: 'Acceso restringido' }), ruta).toBeVisible()
    }
    await expect(page.getByRole('link', { name: /credencial/i })).toHaveCount(0)

    await exigirError(await request.get(`${RUTA}/${alumno}`), 403, 'SIN_PERMISO', 'GET')
    await exigirError(await request.post(`${RUTA}/${alumno}`), 403, 'SIN_PERMISO', 'emitir')
    await exigirError(await request.post(`${RUTA}/credenciales/${id}/reposicion`, { data: { motivo: 'Extravío' } }), 403, 'SIN_PERMISO', 'reponer')
    await exigirError(await request.get(`${RUTA}/${alumno}/historial`), 403, 'SIN_PERMISO', 'historial')
    await exigirError(await request.post(`${RUTA}/verificacion`, { data: { payload: 'x' } }), 403, 'SIN_PERMISO', 'verificar')

    const cliente = await clienteAutenticado(IDENT.DOCENTE.email, IDENT.DOCENTE.password)
    expect((await cliente.from('credenciales_qr').select('id')).data ?? []).toEqual([])
    expect((await cliente.rpc('emitir_credencial_qr', { p_alumno_id: alumno, p_clave_kid: 'k1' })).error?.code).toBe('42501')
    expect((await cliente.rpc('consultar_validez_credencial_qr', { p_credencial_id: id })).error?.code).toBe('42501')
    expect((await cliente.rpc('historial_credenciales_qr', { p_alumno_id: alumno })).error?.code).toBe('42501')
  })
})

test.describe('PERSONAL autenticado', () => {
  test.describe.configure({ retries: 0 })

  test('PERSONAL no verifica, no lee y no administra: EPT-64 no le concede permisos de escáner', async ({ page, request }) => {
    const alumno = idAlumnoPorDni(IDENT.ESTUDIANTE.dni)
    sembrarActiva(alumno)
    const id = sql(`SELECT id FROM public.credenciales_qr WHERE alumno_id = '${alumno}' AND estado = 'ACTIVA';`)

    for (const ruta of ['/dashboard/credenciales', '/dashboard/mi-credencial', '/dashboard/credenciales-hijos']) {
      await page.goto(ruta)
      await expect(page.getByRole('heading', { name: 'Acceso restringido' }), ruta).toBeVisible()
    }
    await exigirError(await request.get(`${RUTA}/${alumno}`), 403, 'SIN_PERMISO', 'GET')
    await exigirError(await request.post(`${RUTA}/verificacion`, { data: { payload: 'EPT1.k1.AAAAAAAAAAAAAAAAAAAAAA.' + 'A'.repeat(43) } }), 403, 'SIN_PERMISO', 'verificar')
    await exigirError(await request.post(`${RUTA}/${alumno}`), 403, 'SIN_PERMISO', 'emitir')

    const cliente = await clienteAutenticado(IDENT.PERSONAL.email, IDENT.PERSONAL.password)
    expect((await cliente.from('credenciales_qr').select('id')).data ?? []).toEqual([])
    expect((await cliente.rpc('consultar_validez_credencial_qr', { p_credencial_id: id })).error?.code).toBe('42501')
    expect((await cliente.rpc('emitir_credencial_qr', { p_alumno_id: alumno, p_clave_kid: 'k1' })).error?.code).toBe('42501')
  })
})

test.describe('SIN PERFIL autenticado', () => {
  test.describe.configure({ retries: 0 })

  test('una cuenta sin perfil no accede; y sin ninguna sesión (anónimo) todo responde 401', async ({ request, page }) => {
    const alumno = idAlumnoPorDni(IDENT.ESTUDIANTE.dni)
    sembrarActiva(alumno)
    const id = sql(`SELECT id FROM public.credenciales_qr WHERE alumno_id = '${alumno}' AND estado = 'ACTIVA';`)

    await exigirError(await request.get(`${RUTA}/${alumno}`), 403, 'SIN_PERMISO', 'GET sin perfil')
    await exigirError(await request.post(`${RUTA}/${alumno}`), 403, 'SIN_PERMISO', 'emitir sin perfil')
    await page.goto('/dashboard/credenciales')
    await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()

    const cliente = await clienteAutenticado(IDENT.SIN_PERFIL.email, IDENT.SIN_PERFIL.password)
    expect((await cliente.from('credenciales_qr').select('id')).data ?? []).toEqual([])
    expect((await cliente.rpc('emitir_credencial_qr', { p_alumno_id: alumno, p_clave_kid: 'k1' })).error?.code).toBe('42501')

    // Anónimo: sin cookies, cada ruta responde 401 sin revelar nada; PostgREST niega el privilegio.
    const anonimo = await crearContexto.newContext({ baseURL: 'http://localhost:3000', storageState: { cookies: [], origins: [] } })
    try {
      const pedidos: [string, () => Promise<APIResponse>][] = [
        ['GET tarjeta', () => anonimo.get(`${RUTA}/${alumno}`)],
        ['GET id inválido', () => anonimo.get(`${RUTA}/no-es-uuid`)],
        ['POST emitir', () => anonimo.post(`${RUTA}/${alumno}`)],
        ['GET historial', () => anonimo.get(`${RUTA}/${alumno}/historial`)],
        ['POST reposicion', () => anonimo.post(`${RUTA}/credenciales/${id}/reposicion`, { data: { motivo: 'Extravío' } })],
        ['POST revocacion', () => anonimo.post(`${RUTA}/credenciales/${id}/revocacion`, { data: { motivo: 'Extravío' } })],
        ['POST verificacion', () => anonimo.post(`${RUTA}/verificacion`, { data: { payload: 'x' } })],
      ]
      for (const [nombre, pedir] of pedidos) {
        await exigirError(await pedir(), 401, 'NO_AUTENTICADO', `anónimo ${nombre}`)
      }
      // La pantalla redirige al inicio de sesión.
      const redireccion = await anonimo.get('/dashboard/mi-credencial', { maxRedirects: 0 })
      expect([301, 302, 303, 307, 308]).toContain(redireccion.status())
      expect(redireccion.headers().location).toContain('/login')
    } finally {
      await anonimo.dispose()
    }

    const anon = clienteAnonimo()
    expect((await anon.from('credenciales_qr').select('id')).error?.code).toBe('42501')
    expect((await anon.rpc('emitir_credencial_qr', { p_alumno_id: alumno, p_clave_kid: 'k1' })).error?.code).toBe('42501')
    expect((await anon.rpc('consultar_validez_credencial_qr', { p_credencial_id: id })).error?.code).toBe('42501')
    expect((await anon.rpc('historial_credenciales_qr', { p_alumno_id: alumno })).error?.code).toBe('42501')
  })
})

for (const [rol, clave, esperaAlumno] of [
  ['DIRECTOR', 'DIRECTOR_BLOQUEADO', false],
  ['DOCENTE', 'DOCENTE_BLOQUEADO', false],
  ['ESTUDIANTE', 'ESTUDIANTE_BLOQUEADO', true],
  ['PADRE', 'PADRE_BLOQUEADO', false],
  ['PERSONAL', 'PERSONAL_BLOQUEADO', false],
] as const) {
  test.describe(`${rol} BLOQUEADO autenticado`, () => {
    test.describe.configure({ retries: 0 })

    test('el acceso bloqueado niega pantalla, API y PostgREST aunque la sesión siga viva', async ({ page, request }) => {
      const identidad = IDENT[clave]
      const alumno = idAlumnoPorDni(IDENT.ESTUDIANTE.dni)
      sembrarActiva(alumno)
      const id = sql(`SELECT id FROM public.credenciales_qr WHERE alumno_id = '${alumno}' AND estado = 'ACTIVA';`)
      const propioBloqueado = esperaAlumno ? idAlumnoPorDni(identidad.dni) : null
      if (propioBloqueado) sembrarActiva(propioBloqueado)

      for (const ruta of ['/dashboard/mi-credencial', '/dashboard/credenciales', '/dashboard/credenciales-hijos']) {
        await page.goto(ruta)
        await expect(page, ruta).toHaveURL(/\/acceso-bloqueado$/u)
      }
      await captura(page, `${rol.toLowerCase()}-bloqueado`)

      await exigirError(await request.get(`${RUTA}/${propioBloqueado ?? alumno}`), 403, 'ACCESO_BLOQUEADO', 'GET')
      await exigirError(await request.post(`${RUTA}/${alumno}`), 403, 'ACCESO_BLOQUEADO', 'emitir')
      await exigirError(await request.get(`${RUTA}/${alumno}/historial`), 403, 'ACCESO_BLOQUEADO', 'historial')
      await exigirError(await request.post(`${RUTA}/credenciales/${id}/revocacion`, { data: { motivo: 'Extravío' } }), 403, 'ACCESO_BLOQUEADO', 'revocar')
      await exigirError(await request.post(`${RUTA}/verificacion`, { data: { payload: 'x' } }), 403, 'ACCESO_BLOQUEADO', 'verificar')

      const cliente = await clienteAutenticado(identidad.email, identidad.password)
      expect((await cliente.from('credenciales_qr').select('id')).data ?? []).toEqual([])
      if (propioBloqueado) {
        expect(((await cliente.from('credenciales_qr').select('id').eq('alumno_id', propioBloqueado)).data ?? [])).toEqual([])
        expect(contarCredenciales(propioBloqueado, 'ACTIVA')).toBe(1)
      }
      expect((await cliente.rpc('emitir_credencial_qr', { p_alumno_id: alumno, p_clave_kid: 'k1' })).error?.code).toBe('42501')
      expect((await cliente.rpc('revocar_credencial_qr', { p_credencial_id: id, p_motivo: 'Extravío' })).error?.code).toBe('42501')
      expect((await cliente.rpc('consultar_validez_credencial_qr', { p_credencial_id: id })).error?.code).toBe('42501')
      expect((await cliente.rpc('historial_credenciales_qr', { p_alumno_id: alumno })).error?.code).toBe('42501')
      expect(contarCredenciales(alumno, 'ACTIVA')).toBe(1)
    })
  })
}

// ---------------------------------------------------------------------------
// Servidor SIN clave de firma (falla cerrado). Requiere un segundo servidor de Next
// sin las variables de la clave; ver `docs/evidence/EPT-64.md`. Se ejecuta con
// `EPT_URL_SIN_CLAVE=http://localhost:3100`.
// ---------------------------------------------------------------------------

test.describe('DIRECTOR autenticado', () => {
  test.describe.configure({ retries: 0 })
  test.skip(!process.env.EPT_URL_SIN_CLAVE, 'requiere EPT_URL_SIN_CLAVE (servidor sin clave de firma)')

  test('sin clave de firma el servidor falla cerrado: no emite, no muestra QR, no verifica y no filtra la causa', async () => {
    const alumno = idAlumnoPorDni(IDENT.ESTUDIANTE.dni)
    limpiarCredenciales([alumno])
    const sinClave = await crearContexto.newContext({
      baseURL: process.env.EPT_URL_SIN_CLAVE,
      storageState: 'tests/.auth/directora.json',
    })
    try {
      // Emitir: 503 y NADA persistido.
      await exigirError(await sinClave.post(`${RUTA}/${alumno}`), 503, 'SERVICIO_NO_DISPONIBLE', 'emitir sin clave')
      expect(contarCredenciales(alumno)).toBe(0)

      // Con una credencial ya emitida (sembrada), leerla no muestra el QR.
      sembrarActiva(alumno)
      await exigirError(await sinClave.get(`${RUTA}/${alumno}`), 503, 'SERVICIO_NO_DISPONIBLE', 'leer sin clave')
      const credencial = sql(`SELECT id FROM public.credenciales_qr WHERE alumno_id = '${alumno}' AND estado = 'ACTIVA';`)
      await exigirError(await sinClave.post(`${RUTA}/credenciales/${credencial}/reposicion`, { data: { motivo: 'Extravío' } }), 503, 'SERVICIO_NO_DISPONIBLE', 'reponer sin clave')
      expect(contarCredenciales(alumno, 'ACTIVA')).toBe(1)
      expect(contarCredenciales(alumno)).toBe(1)

      // Verificar: 503 (nunca «válida» ni «no reconocida» por falta de clave).
      await exigirError(await sinClave.post(`${RUTA}/verificacion`, { data: { payload: 'EPT1.k1.AAAAAAAAAAAAAAAAAAAAAA.' + 'A'.repeat(43) } }), 503, 'SERVICIO_NO_DISPONIBLE', 'verificar sin clave')

      // Revocar no necesita la clave: sigue funcionando y deja el historial coherente.
      const revocar = await sinClave.post(`${RUTA}/credenciales/${credencial}/revocacion`, { data: { motivo: 'Baja por egreso' } })
      expect(revocar.status()).toBe(200)
    } finally {
      await sinClave.dispose()
      limpiarCredenciales([alumno])
    }
  })
})
