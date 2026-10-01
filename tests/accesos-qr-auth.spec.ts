import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'
import { capturarSinHerramientas } from './_captura'
import {
  IDENT,
  clienteAutenticado,
  idAlumnoPorDni,
  limpiarCredenciales,
  sql,
} from './_credenciales-qr'
import {
  RUTA_REGISTRO,
  SERVICIOS,
  cancelarInscripcion,
  cancelarTransporte,
  contarAccesos,
  contarContadores,
  credencialActiva,
  escribirVideoFalsoY4m,
  gifDelQr,
  idPerfil,
  inscribir,
  limpiarAccesos,
  limpiarContadores,
  nuevoIntento,
  payloadConFirmaAlterada,
  payloadFirmado,
  rutaAnulacion,
  ultimoAcceso,
} from './_accesos-qr'

/**
 * Registro de accesos con QR con SESIONES REALES contra el stack local (EPT-65, RF21).
 *
 * Cada actor corre en su propio proyecto de Playwright (ver `playwright.config.ts`):
 * el `grep` enruta cada bloque `describe` a la sesión que de verdad debe ser aceptada
 * o rechazada. Por cada actor se prueban las TRES capas: pantalla, API (códigos y
 * `Cache-Control: no-store`) y PostgREST directo (permisos de función y RLS), porque un
 * menú oculto no es autorización.
 *
 * La clave de firma es EFÍMERA (la genera `supabase/tests/correr-autenticadas.mjs` y
 * nunca se imprime). Los payloads se firman con ella; ninguno vale fuera de la corrida.
 * Las capturas solo se escriben con `EPT_CAPTURAS=1` y NUNCA muestran un QR válido ni
 * datos de personas reales (todos los alumnos son sintéticos).
 *
 * Datos que esta suite siembra como propietario (inscripciones, credenciales) los
 * retira al terminar: otras suites parten de que esos alumnos no tienen inscripciones.
 */

const CAPTURAS = path.join('docs', 'evidence', 'EPT-65')
const escribirCapturas = process.env.EPT_CAPTURAS === '1'

async function captura(page: Page, nombre: string) {
  if (!escribirCapturas) return
  fs.mkdirSync(CAPTURAS, { recursive: true })
  await capturarSinHerramientas(page, path.join(CAPTURAS, `${test.info().project.name}-${nombre}.png`))
}

// Cámara falsa de Chromium para probar la lectura real de un QR sin un dispositivo.
// El QR del video es el de una credencial FIJA de esta corrida, firmada con la clave
// efímera; el archivo vive en el directorio temporal, nunca en el repositorio.
const CREDENCIAL_CAMARA = 'ea650002-0000-4000-8000-000000000001'
const VIDEO_CAMARA = escribirVideoFalsoY4m(payloadFirmado(CREDENCIAL_CAMARA))
test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${VIDEO_CAMARA}`,
    ],
  },
  permissions: ['camera'],
})
test.afterAll(() => {
  fs.rmSync(VIDEO_CAMARA, { force: true })
})

function exigirNoStore(respuesta: APIResponse, contexto: string) {
  expect(respuesta.headers()['cache-control'], `${contexto}: Cache-Control`).toBe('no-store')
}

type Cuerpo = Record<string, unknown>
const json = async (respuesta: APIResponse) => (await respuesta.json()) as Cuerpo

/** El cuerpo de un error de la API: solo `error` en español y `codigo`, nada técnico. */
async function exigirError(respuesta: APIResponse, estado: number, codigo: string, contexto: string) {
  expect(respuesta.status(), `${contexto}: estado`).toBe(estado)
  exigirNoStore(respuesta, contexto)
  const cuerpo = await json(respuesta)
  expect(cuerpo.codigo, `${contexto}: código`).toBe(codigo)
  const claves = Object.keys(cuerpo).sort()
  expect(claves.filter((c) => c !== 'reintentar_en_segundos'), `${contexto}: forma del error`).toEqual(['codigo', 'error'])
  expect(String(cuerpo.error), `${contexto}: mensaje en español`).toMatch(/[a-záéíóúñ]{3,}/i)
  expect(JSON.stringify(cuerpo), `${contexto}: sin detalle técnico`).not.toMatch(
    /P5\d{3}|PGRST|SQLSTATE|supabase|postgres|constraint|violates|stack|service_role|hmac/i
  )
}

type Registro = { estado: number; cuerpo: Cuerpo; cabeceras: Record<string, string> }

async function registrar(
  request: APIRequestContext,
  datos: { payload: string; servicio?: string; sentido?: 'IDA' | 'VUELTA'; intento?: string },
  cabeceras: Record<string, string> = {}
): Promise<Registro> {
  const respuesta = await request.post(RUTA_REGISTRO, {
    headers: cabeceras,
    data: {
      payload: datos.payload,
      intento_id: datos.intento ?? nuevoIntento(),
      servicio_id: datos.servicio ?? SERVICIOS.comedor,
      ...(datos.sentido ? { sentido: datos.sentido } : {}),
    },
  })
  exigirNoStore(respuesta, 'POST registro')
  return { estado: respuesta.status(), cuerpo: await json(respuesta), cabeceras: respuesta.headers() }
}

const beto = () => idAlumnoPorDni(IDENT.ESTUDIANTE.dni)
const celeste = () => idAlumnoPorDni(IDENT.AJENO.dni)

/** Alumno con credencial vigente e inscripciones indicadas, sin accesos previos. */
function preparar(alumno: string, { comedor = false, transporte }: { comedor?: boolean; transporte?: 'norte' | 'sur' } = {}) {
  limpiarAccesos()
  limpiarContadores()
  cancelarInscripcion(alumno, SERVICIOS.comedor)
  cancelarTransporte(alumno)
  const credencial = credencialActiva(alumno)
  if (comedor) inscribir(alumno, SERVICIOS.comedor)
  if (transporte) inscribir(alumno, SERVICIOS[transporte])
  return { credencial, payload: payloadFirmado(credencial) }
}

/** Deja la base como la encontraron las demás suites. */
function limpiarEscenario() {
  const alumnos = [beto(), celeste()]
  limpiarAccesos()
  limpiarContadores()
  sql(`DELETE FROM public.inscripciones_servicios WHERE alumno_id IN (${alumnos.map((a) => `'${a}'`).join(', ')});`)
  limpiarCredenciales(alumnos)
}

async function sinStorageNiUrl(page: Page, payload: string) {
  const expuesto = await page.evaluate((texto) => {
    const almacenes = [window.localStorage, window.sessionStorage].flatMap((a) =>
      Array.from({ length: a.length }, (_, i) => `${a.key(i)}=${a.getItem(a.key(i) as string)}`)
    )
    return [window.location.href, document.cookie, ...almacenes].some((valor) => valor.includes(texto) || /EPT1\./.test(valor))
  }, payload)
  expect(expuesto, 'el payload no debe quedar en la URL, las cookies ni el almacenamiento').toBe(false)
}

/** Lo que cualquier actor SIN permiso de escáner ve y recibe (capas API, pantalla y PostgREST). */
async function exigirSinEscaner(
  request: APIRequestContext,
  page: Page,
  identidad: { email: string; password: string },
  estadoEsperado: { estado: number; codigo: string }
) {
  const { payload } = { payload: payloadFirmado(randomUUID()) }
  const antes = contarAccesos()
  await exigirError(
    await request.post(RUTA_REGISTRO, { data: { payload, intento_id: nuevoIntento(), servicio_id: SERVICIOS.comedor } }),
    estadoEsperado.estado,
    estadoEsperado.codigo,
    'POST registro'
  )
  await exigirError(
    await request.post(rutaAnulacion(randomUUID()), { data: { motivo: 'Motivo de prueba' } }),
    estadoEsperado.estado,
    estadoEsperado.codigo,
    'POST anulación'
  )
  expect(contarAccesos(), 'ninguna llamada rechazada dejó un evento').toBe(antes)
  void page

  // PostgREST directo con la sesión real: la operación no existe para este actor.
  const cliente = await clienteAutenticado(identidad.email, identidad.password)
  for (const [nombre, llamada] of [
    ['registrar_acceso_servicio', () => cliente.rpc('registrar_acceso_servicio', { p_actor_user_id: randomUUID(), p_intento_id: nuevoIntento(), p_credencial_id: randomUUID(), p_clave_kid: 'k1', p_servicio_id: SERVICIOS.comedor })],
    ['consumir_cupo_escaneo', () => cliente.rpc('consumir_cupo_escaneo', { p_actor_user_id: randomUUID() })],
    ['listar_accesos_servicios', () => cliente.rpc('listar_accesos_servicios', {})],
    ['anular_acceso_servicio', () => cliente.rpc('anular_acceso_servicio', { p_acceso_id: randomUUID(), p_motivo: 'Motivo de prueba' })],
    ['tabla accesos_servicios', () => cliente.from('accesos_servicios').select('id')],
  ] as const) {
    const { data, error } = await llamada()
    expect(error, `${nombre}: debe rechazarse`).not.toBeNull()
    expect(data, `${nombre}: sin datos`).toBeNull()
  }
}

/**
 * La navegación del panel (EPT-59) no monta la ruta si el rol no la tiene en el menú: muestra
 * su propio «Acceso restringido». La guarda del servidor de la página y la de la API son capas
 * distintas y se prueban por separado.
 */
async function pantallaRestringida(page: Page, ruta: string) {
  await page.goto(ruta)
  await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
  await expect(page.getByText("No tenés permisos para ver esta sección del panel.")).toBeVisible()
  await expect(page.getByRole('button', { name: /Escanear con la cámara/ })).toHaveCount(0)
}

// ---------------------------------------------------------------------------

test.describe('DIRECTOR autenticado', () => {
  test.describe.configure({ retries: 0, mode: 'serial' })
  test.afterAll(() => limpiarEscenario())

  test('API: comedor — registrar, repetir, reintentar, reutilizar el intento y firma alterada', async ({ request }) => {
    const alumno = beto()
    const { credencial, payload } = preparar(alumno, { comedor: true })
    const intento = nuevoIntento()

    const primero = await registrar(request, { payload, intento })
    expect(primero.estado).toBe(200)
    expect(primero.cuerpo).toMatchObject({
      codigo: 'REGISTRADO',
      mensaje: 'Acceso registrado.',
      alumno: { nombre: IDENT.ESTUDIANTE.nombre, apellido: IDENT.ESTUDIANTE.apellido, legajo: IDENT.ESTUDIANTE.legajo },
    })
    // Forma cerrada: nada de identificadores internos, credencial, DNI ni actor.
    expect(Object.keys(primero.cuerpo).sort()).toEqual(['alumno', 'codigo', 'mensaje', 'registrado_en'])
    expect(Object.keys(primero.cuerpo.alumno as object).sort()).toEqual(['apellido', 'legajo', 'nombre'])
    expect(JSON.stringify(primero.cuerpo)).not.toMatch(new RegExp(`${credencial}|${alumno}|${IDENT.ESTUDIANTE.dni}`))
    expect(contarAccesos(alumno, 'REGISTRADO')).toBe(1)
    // La hora la sella la base: es reciente y no la eligió el cliente.
    expect(Math.abs(Date.now() - Date.parse(String(primero.cuerpo.registrado_en)))).toBeLessThan(60_000)

    // Reintento por timeout: mismo intento, mismos argumentos → el resultado previo, sin duplicar.
    const reintento = await registrar(request, { payload, intento })
    expect(reintento.cuerpo).toMatchObject({ codigo: 'REGISTRADO', registrado_en: primero.cuerpo.registrado_en })
    expect(contarAccesos(alumno)).toBe(1)

    // Mismo intento, otros argumentos → 409 sin alterar nada.
    const otroServicio = await request.post(RUTA_REGISTRO, {
      data: { payload, intento_id: intento, servicio_id: SERVICIOS.norte, sentido: 'IDA' },
    })
    await exigirError(otroServicio, 409, 'INTENTO_REUTILIZADO', 'intento reutilizado')
    expect(contarAccesos(alumno)).toBe(1)

    // Segundo escaneo el mismo día → YA_REGISTRADO, sin identidad.
    const repetido = await registrar(request, { payload })
    expect(repetido.estado).toBe(200)
    expect(repetido.cuerpo).toEqual({ codigo: 'YA_REGISTRADO', mensaje: expect.any(String) })
    expect(contarAccesos(alumno, 'REGISTRADO')).toBe(1)
    expect(ultimoAcceso(alumno, 'DENEGADO').motivo).toBe('YA_REGISTRADO')

    // Firma alterada → NO_RECONOCIDO y NINGÚN evento nuevo (nunca llega a la credencial).
    const antes = contarAccesos()
    const alterado = await registrar(request, { payload: payloadConFirmaAlterada(payload) })
    expect(alterado.cuerpo).toEqual({ codigo: 'NO_RECONOCIDO', mensaje: expect.any(String) })
    expect(contarAccesos()).toBe(antes)
    expect(contarContadores(IDENT.DIRECTORA.dni, 'INVALIDO')).toBe(1)

    // Un identificador bien firmado que la base no conoce responde lo MISMO, sin evento.
    const desconocido = await registrar(request, { payload: payloadFirmado(randomUUID()) })
    expect(desconocido.cuerpo).toEqual({ codigo: 'NO_RECONOCIDO', mensaje: expect.any(String) })
    expect(contarAccesos()).toBe(antes)
  })

  test('API: transporte — IDA y VUELTA el mismo día, repetición y recorrido declarado', async ({ request }) => {
    const alumno = celeste()
    const { payload } = preparar(alumno, { transporte: 'norte' })

    expect((await registrar(request, { payload, servicio: SERVICIOS.norte, sentido: 'IDA' })).cuerpo.codigo).toBe('REGISTRADO')
    expect((await registrar(request, { payload, servicio: SERVICIOS.norte, sentido: 'IDA' })).cuerpo.codigo).toBe('YA_REGISTRADO')
    expect((await registrar(request, { payload, servicio: SERVICIOS.norte, sentido: 'VUELTA' })).cuerpo.codigo).toBe('REGISTRADO')
    expect((await registrar(request, { payload, servicio: SERVICIOS.norte, sentido: 'VUELTA' })).cuerpo.codigo).toBe('YA_REGISTRADO')
    expect(contarAccesos(alumno, 'REGISTRADO')).toBe(2)

    // El operador declara el recorrido: si no coincide con el del alumno, se deniega genérico.
    const discrepancia = await registrar(request, { payload, servicio: SERVICIOS.sur, sentido: 'IDA' })
    expect(discrepancia.cuerpo).toEqual({ codigo: 'NO_HABILITADO', mensaje: expect.any(String) })
    expect(ultimoAcceso(alumno, 'DENEGADO').motivo).toBe('RECORRIDO_DISTINTO')
    expect(JSON.stringify(discrepancia.cuerpo)).not.toMatch(/recorrido|norte|sur|inscri/i)

    // Sentido incoherente con el servicio → 422, sin evento.
    const antes = contarAccesos()
    await exigirError(
      await request.post(RUTA_REGISTRO, { data: { payload, intento_id: nuevoIntento(), servicio_id: SERVICIOS.norte } }),
      422,
      'SERVICIO_INVALIDO',
      'transporte sin sentido'
    )
    await exigirError(
      await request.post(RUTA_REGISTRO, { data: { payload, intento_id: nuevoIntento(), servicio_id: SERVICIOS.comedor, sentido: 'IDA' } }),
      422,
      'SERVICIO_INVALIDO',
      'comedor con sentido'
    )
    await exigirError(
      await request.post(RUTA_REGISTRO, { data: { payload, intento_id: nuevoIntento(), servicio_id: randomUUID() } }),
      422,
      'SERVICIO_INVALIDO',
      'servicio inexistente'
    )
    expect(contarAccesos()).toBe(antes)
  })

  test('API: denegaciones genéricas — sin inscripción, credencial revocada, alumno inactivo y perfil bloqueado', async ({ request }) => {
    const alumno = beto()
    const { credencial, payload } = preparar(alumno, { comedor: false })
    const generica = { codigo: 'NO_HABILITADO', mensaje: expect.any(String) }

    // Sin inscripción.
    expect((await registrar(request, { payload })).cuerpo).toEqual(generica)
    expect(ultimoAcceso(alumno, 'DENEGADO').motivo).toBe('SIN_INSCRIPCION')

    // Perfil del alumno bloqueado.
    inscribir(alumno, SERVICIOS.comedor)
    sql(`UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = '${alumno}';`)
    try {
      expect((await registrar(request, { payload })).cuerpo).toEqual(generica)
      expect(ultimoAcceso(alumno, 'DENEGADO').motivo).toBe('ACCESO_BLOQUEADO')
    } finally {
      sql(`UPDATE public.perfiles SET estado_acceso = 'HABILITADO' WHERE id = '${alumno}';`)
    }

    // Credencial revocada (por la operación real de Dirección, vía PostgREST con su sesión).
    const director = await clienteAutenticado(IDENT.DIRECTORA.email, IDENT.DIRECTORA.password)
    const revocada = await director.rpc('revocar_credencial_qr', { p_credencial_id: credencial, p_motivo: 'Revocada por la prueba' })
    expect(revocada.error).toBeNull()
    expect((await registrar(request, { payload })).cuerpo).toEqual(generica)
    expect(ultimoAcceso(alumno, 'DENEGADO').motivo).toBe('CREDENCIAL_REVOCADA')
    // La respuesta es idéntica sea cual sea el motivo: ningún dato interno al operador.
    for (const motivo of ['SIN_INSCRIPCION', 'ACCESO_BLOQUEADO', 'CREDENCIAL_REVOCADA']) {
      expect(JSON.stringify(generica)).not.toContain(motivo)
    }
    expect(contarAccesos(alumno, 'REGISTRADO')).toBe(0)
  })

  test('API: anulación de Dirección — libera el cupo, conserva la historia y no se repite', async ({ request }) => {
    const alumno = beto()
    const { payload } = preparar(alumno, { comedor: true })
    expect((await registrar(request, { payload })).cuerpo.codigo).toBe('REGISTRADO')
    const evento = ultimoAcceso(alumno, 'REGISTRADO').id
    const ruta = rutaAnulacion(evento)

    // Validaciones del cuerpo y del identificador.
    await exigirError(await request.post(ruta, { data: { motivo: 'ab' } }), 422, 'MOTIVO_INVALIDO', 'motivo corto')
    await exigirError(await request.post(ruta, { data: { motivo: 'x'.repeat(201) } }), 422, 'MOTIVO_INVALIDO', 'motivo largo')
    await exigirError(await request.post(ruta, { data: {} }), 422, 'MOTIVO_INVALIDO', 'sin motivo')
    await exigirError(await request.post(rutaAnulacion('no-es-un-uuid'), { data: { motivo: 'Motivo válido' } }), 404, 'ACCESO_NO_ENCONTRADO', 'id inválido')
    await exigirError(await request.post(rutaAnulacion(randomUUID()), { data: { motivo: 'Motivo válido' } }), 404, 'ACCESO_NO_ENCONTRADO', 'id inexistente')

    // Un DENEGADO no se anula.
    expect((await registrar(request, { payload })).cuerpo.codigo).toBe('YA_REGISTRADO')
    const denegado = ultimoAcceso(alumno, 'DENEGADO').id
    await exigirError(await request.post(rutaAnulacion(denegado), { data: { motivo: 'Motivo válido' } }), 409, 'ACCESO_NO_ANULABLE', 'anular un denegado')

    // Anulación válida.
    const anulada = await request.post(ruta, { data: { motivo: '  Se escaneó la credencial equivocada  ' } })
    expect(anulada.status()).toBe(200)
    exigirNoStore(anulada, 'anulación')
    expect(await json(anulada)).toEqual({ acceso: { id: evento, anulado: true } })
    expect(sql(`SELECT motivo FROM public.anulaciones_accesos_servicios WHERE acceso_id = '${evento}';`)).toBe('Se escaneó la credencial equivocada')
    expect(sql(`SELECT p.dni FROM public.anulaciones_accesos_servicios a JOIN public.perfiles p ON p.id = a.anulado_por WHERE a.acceso_id = '${evento}';`)).toBe(IDENT.DIRECTORA.dni)

    // No se anula dos veces y el evento original sigue ahí.
    await exigirError(await request.post(ruta, { data: { motivo: 'Segunda vez' } }), 409, 'ACCESO_YA_ANULADO', 'segunda anulación')
    expect(contarAccesos(alumno, 'REGISTRADO')).toBe(1)

    // El acceso anulado NO bloquea el nuevo registro legítimo del día.
    expect((await registrar(request, { payload })).cuerpo.codigo).toBe('REGISTRADO')
    expect(contarAccesos(alumno, 'REGISTRADO')).toBe(2)
    expect((await registrar(request, { payload })).cuerpo.codigo).toBe('YA_REGISTRADO')
  })

  test('API: cuerpo, tamaño, tipo de contenido y origen se validan antes de registrar nada', async ({ request }) => {
    const { payload } = preparar(beto(), { comedor: true })
    const antes = contarAccesos()
    const valido = { payload, intento_id: nuevoIntento(), servicio_id: SERVICIOS.comedor }

    await exigirError(await request.post(RUTA_REGISTRO, { headers: { 'Content-Type': 'application/json' }, data: '{no es json' }), 400, 'CUERPO_INVALIDO', 'JSON inválido')
    await exigirError(await request.post(RUTA_REGISTRO, { headers: { 'Content-Type': 'text/plain' }, data: JSON.stringify(valido) }), 400, 'CUERPO_INVALIDO', 'tipo de contenido')
    await exigirError(await request.post(RUTA_REGISTRO, { data: { ...valido, payload: 'x'.repeat(5000) } }), 413, 'CUERPO_DEMASIADO_GRANDE', 'cuerpo excesivo')
    await exigirError(await request.post(RUTA_REGISTRO, { data: { ...valido, intento_id: 'no-uuid' } }), 400, 'CUERPO_INVALIDO', 'intento inválido')
    await exigirError(await request.post(RUTA_REGISTRO, { data: { ...valido, payload: '' } }), 400, 'CUERPO_INVALIDO', 'payload vacío')
    await exigirError(await request.post(RUTA_REGISTRO, { data: { ...valido, sentido: 'DIAGONAL' } }), 422, 'SERVICIO_INVALIDO', 'sentido inválido')

    // Ninguna identidad, credencial ni actor puede viajar: el esquema es estricto.
    for (const extra of [{ actor_user_id: randomUUID() }, { credencial_id: randomUUID() }, { alumno_id: beto() }, { legajo: 'LEG-1' }, { dni: '12345678' }]) {
      await exigirError(await request.post(RUTA_REGISTRO, { data: { ...valido, ...extra } }), 400, 'CUERPO_INVALIDO', `campo ${Object.keys(extra)[0]}`)
    }
    // Solo con un id y sin firma, jamás se registra: no hay dónde ponerlo.
    await exigirError(
      await request.post(RUTA_REGISTRO, { data: { credencial_id: credencialActiva(beto()), intento_id: nuevoIntento(), servicio_id: SERVICIOS.comedor } }),
      400,
      'CUERPO_INVALIDO',
      'solo credencial_id'
    )

    // Origen ajeno, aun con sesión válida.
    await exigirError(await request.post(RUTA_REGISTRO, { data: valido, headers: { Origin: 'https://sitio-ajeno.example' } }), 403, 'ORIGEN_NO_PERMITIDO', 'origen ajeno')
    await exigirError(await request.post(RUTA_REGISTRO, { data: valido, headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403, 'ORIGEN_NO_PERMITIDO', 'sitio cruzado')
    expect(contarAccesos(), 'ninguna petición inválida dejó un evento').toBe(antes)
  })

  test('API: el límite de solicitudes responde 429 con Retry-After ANTES de verificar la firma', async ({ request }) => {
    const alumno = beto()
    const { payload } = preparar(alumno, { comedor: true })
    const sinInscripcion = payloadFirmado(randomUUID())
    try {
      // 60 solicitudes se admiten (firmas válidas de credenciales desconocidas: ningún evento).
      for (let i = 0; i < 60; i += 1) {
        const r = await request.post(RUTA_REGISTRO, { data: { payload: sinInscripcion, intento_id: nuevoIntento(), servicio_id: SERVICIOS.comedor } })
        expect(r.status(), `solicitud ${i + 1}`).toBe(200)
      }
      expect(contarContadores(IDENT.DIRECTORA.dni, 'SOLICITUD')).toBe(60)

      // La 61 se rechaza.
      const excedida = await request.post(RUTA_REGISTRO, { data: { payload, intento_id: nuevoIntento(), servicio_id: SERVICIOS.comedor } })
      await exigirError(excedida, 429, 'LIMITE_EXCEDIDO', 'solicitud 61')
      const espera = Number(excedida.headers()['retry-after'])
      expect(Number.isInteger(espera) && espera > 0 && espera <= 900, `Retry-After ${excedida.headers()['retry-after']}`).toBe(true)
      expect((await json(excedida)).reintentar_en_segundos).toBe(espera)

      // Bloqueada la cuenta, ni siquiera una credencial VÁLIDA y habilitada se registra
      // (el límite va antes que la firma) y no queda ningún evento.
      const valida = await request.post(RUTA_REGISTRO, { data: { payload, intento_id: nuevoIntento(), servicio_id: SERVICIOS.comedor } })
      await exigirError(valida, 429, 'LIMITE_EXCEDIDO', 'bloqueada')
      expect(contarAccesos(alumno)).toBe(0)
      expect(contarContadores(IDENT.DIRECTORA.dni, 'SOLICITUD'), 'las rechazadas no suman').toBe(60)

      // Otro operador no se ve afectado: el límite es por cuenta.
      expect(contarContadores(IDENT.PERSONAL.dni)).toBe(0)
    } finally {
      limpiarContadores()
    }
  })

  test('API: diez intentos inválidos bloquean la cuenta y no guardan el payload', async ({ request }) => {
    const { payload } = preparar(beto(), { comedor: true })
    try {
      for (let i = 0; i < 10; i += 1) {
        const r = await registrar(request, { payload: payloadConFirmaAlterada(payload) })
        expect(r.cuerpo.codigo, `inválido ${i + 1}`).toBe('NO_RECONOCIDO')
      }
      expect(contarContadores(IDENT.DIRECTORA.dni, 'INVALIDO')).toBe(10)
      expect(contarContadores(IDENT.DIRECTORA.dni, 'BLOQUEO')).toBe(1)
      await exigirError(
        await request.post(RUTA_REGISTRO, { data: { payload, intento_id: nuevoIntento(), servicio_id: SERVICIOS.comedor } }),
        429,
        'LIMITE_EXCEDIDO',
        'tras diez inválidos'
      )
      // Lo guardado no permite reconstruir ningún QR.
      const columnas = sql(`SELECT string_agg(column_name, ',') FROM information_schema.columns WHERE table_schema = 'app_private' AND table_name = 'contadores_escaneo';`)
      expect(columnas).not.toMatch(/payload|firma|secret|clave|token/i)
    } finally {
      limpiarContadores()
    }
  })

  test('PostgREST directo: conocer un credencial_id NO permite registrar un acceso', async () => {
    const alumno = beto()
    const { credencial } = preparar(alumno, { comedor: true })
    const cliente = await clienteAutenticado(IDENT.DIRECTORA.email, IDENT.DIRECTORA.password)
    const usuario = sql(`SELECT user_id FROM public.perfiles WHERE dni = '${IDENT.DIRECTORA.dni}';`)

    // Dirección SÍ conoce el id (lo lee por RLS)…
    const leido = await cliente.from('credenciales_qr').select('id').eq('id', credencial)
    expect(leido.error).toBeNull()
    expect(leido.data).toEqual([{ id: credencial }])

    // …pero ninguna vía de la Data API crea un REGISTRADO.
    const intentos = [
      cliente.rpc('registrar_acceso_servicio', { p_actor_user_id: usuario, p_intento_id: nuevoIntento(), p_credencial_id: credencial, p_clave_kid: 'k1', p_servicio_id: SERVICIOS.comedor }),
      cliente.rpc('registrar_acceso_servicio', { p_actor_user_id: randomUUID(), p_intento_id: nuevoIntento(), p_credencial_id: credencial, p_clave_kid: 'k1', p_servicio_id: SERVICIOS.comedor }),
      cliente.rpc('consumir_cupo_escaneo', { p_actor_user_id: usuario }),
      cliente.rpc('registrar_escaneo_invalido', { p_actor_user_id: usuario }),
      cliente.from('accesos_servicios').insert({ intento_id: nuevoIntento(), operador_perfil_id: idPerfil(IDENT.DIRECTORA.dni), credencial_id: credencial, alumno_id: alumno, servicio_id: SERVICIOS.comedor, resultado: 'REGISTRADO' }),
      cliente.from('accesos_servicios').select('id'),
      cliente.from('anulaciones_accesos_servicios').select('acceso_id'),
    ]
    for (const [indice, consulta] of intentos.entries()) {
      const { error } = await consulta
      expect(error, `intento ${indice + 1}`).not.toBeNull()
      expect(String(error?.code), `intento ${indice + 1}`).toMatch(/^(42501|PGRST\d+)$/)
    }
    expect(contarAccesos(), 'ningún ataque creó un evento').toBe(0)
    expect(contarContadores(IDENT.DIRECTORA.dni), 'ni un contador').toBe(0)

    // Dirección sí consulta por la función de solo lectura.
    const lectura = await cliente.rpc('listar_accesos_servicios', { p_limite: 10 })
    expect(lectura.error).toBeNull()
    expect(Array.isArray(lectura.data)).toBe(true)

    // La función de EPT-64 (auditada): con solo el id Dirección lee la validez, pero NO registra.
    const validez = await cliente.rpc('consultar_validez_credencial_qr', { p_credencial_id: credencial })
    expect(validez.error).toBeNull()
    expect(contarAccesos()).toBe(0)
  })

  test('pantalla: el escáner por foto registra, repite, rechaza y no deja el payload en ningún lado', async ({ page }) => {
    const alumno = beto()
    const { payload } = preparar(alumno, { comedor: true })
    const respuesta = await page.goto('/dashboard/accesos')
    expect(respuesta?.headers()['permissions-policy']).toBe('camera=(self), microphone=(), geolocation=()')
    await expect(page.getByRole('heading', { name: 'Registrar accesos' })).toBeVisible()

    await page.getByLabel('Comedor', { exact: true }).check()
    const foto = page.getByTestId('escaner-foto')
    await foto.setInputFiles(gifDelQr(payload))

    const exito = page.locator('[role="status"][aria-live="polite"]').getByTestId('escaner-resultado')
    await expect(exito.getByRole('heading', { name: 'Acceso registrado' })).toBeVisible()
    await expect(exito.getByTestId('escaner-datos')).toContainText(`${IDENT.ESTUDIANTE.nombre} ${IDENT.ESTUDIANTE.apellido}`)
    await expect(exito.getByTestId('escaner-datos')).toContainText(String(IDENT.ESTUDIANTE.legajo))
    // El foco se mueve al resultado y la UI no usa solo el color.
    await expect(exito.getByRole('heading', { name: 'Acceso registrado' })).toBeFocused()
    await sinStorageNiUrl(page, payload)
    expect(contarAccesos(alumno, 'REGISTRADO')).toBe(1)
    await captura(page, 'escaner-registrado')

    // A los ~5 segundos los datos personales desaparecen de la pantalla.
    await expect(page.getByTestId('escaner-datos-ocultos')).toBeVisible({ timeout: 9_000 })
    await expect(page.getByText(`${IDENT.ESTUDIANTE.nombre} ${IDENT.ESTUDIANTE.apellido}`)).toHaveCount(0)

    // «Escanear siguiente» vuelve a la lectura; el mismo QR ya fue registrado hoy.
    await page.getByRole('button', { name: 'Escanear siguiente' }).click()
    await foto.setInputFiles(gifDelQr(payload))
    const rechazo = page.locator('[role="alert"][aria-live="assertive"]').getByTestId('escaner-resultado')
    await expect(rechazo.getByRole('heading', { name: 'Ya registrado hoy' })).toBeVisible()
    await expect(rechazo.getByRole('heading', { name: 'Ya registrado hoy' })).toBeFocused()
    expect(await rechazo.innerText()).not.toContain(IDENT.ESTUDIANTE.apellido)
    await captura(page, 'escaner-ya-registrado')

    // Firma alterada → no reconocido. Imagen sin QR → mensaje de ilegible, sin enviar nada.
    await page.getByRole('button', { name: 'Escanear siguiente' }).click()
    await foto.setInputFiles(gifDelQr(payloadConFirmaAlterada(payload)))
    await expect(page.getByRole('heading', { name: 'Código QR no reconocido' })).toBeVisible()
    await page.getByRole('button', { name: 'Escanear siguiente' }).click()
    const antes = contarAccesos()
    await foto.setInputFiles({ name: 'vacio.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') })
    await expect(page.getByTestId('escaner-ilegible')).toBeVisible()
    expect(contarAccesos(), 'una imagen ilegible no envía nada').toBe(antes)
  })

  test('pantalla: la cámara lee el QR, registra y suelta TODAS las pistas', async ({ page }) => {
    const alumno = celeste()
    limpiarAccesos()
    limpiarContadores()
    cancelarInscripcion(alumno, SERVICIOS.comedor)
    sql(`
      BEGIN;
      ALTER TABLE public.credenciales_qr DISABLE TRIGGER USER;
      DELETE FROM public.credenciales_qr WHERE alumno_id = '${alumno}';
      ALTER TABLE public.credenciales_qr ENABLE TRIGGER USER;
      INSERT INTO public.credenciales_qr (id, alumno_id, clave_kid, emitida_por)
      VALUES ('${CREDENCIAL_CAMARA}', '${alumno}', '${process.env.QR_CREDENCIAL_KID_ACTIVA ?? 'k1'}',
              (SELECT id FROM public.perfiles WHERE dni = '${IDENT.DIRECTORA.dni}'));
      COMMIT;
    `)
    inscribir(alumno, SERVICIOS.comedor)

    // Registro de las pistas que crea el navegador.
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      ;(window as unknown as { __flujos: MediaStream[] }).__flujos = []
      navigator.mediaDevices.getUserMedia = async (restricciones) => {
        const flujo = await original(restricciones)
        ;(window as unknown as { __flujos: MediaStream[] }).__flujos.push(flujo)
        return flujo
      }
    })
    await page.goto('/dashboard/accesos')
    await page.getByLabel('Comedor', { exact: true }).check()
    await page.getByRole('button', { name: 'Escanear con la cámara' }).click()

    const exito = page.locator('[role="status"][aria-live="polite"]').getByTestId('escaner-resultado')
    await expect(exito.getByRole('heading', { name: 'Acceso registrado' })).toBeVisible({ timeout: 20_000 })
    await expect(exito.getByTestId('escaner-datos')).toContainText(IDENT.AJENO.apellido)
    expect(contarAccesos(alumno, 'REGISTRADO')).toBe(1)

    // Todas las pistas terminaron y el video no retiene ningún flujo.
    const estados = await page.evaluate(() => ({
      pistas: (window as unknown as { __flujos: MediaStream[] }).__flujos.flatMap((f) => f.getTracks().map((p) => p.readyState)),
      video: document.querySelector('video')?.srcObject ?? null,
    }))
    expect(estados.pistas.length).toBeGreaterThan(0)
    expect(estados.pistas.every((e) => e === 'ended')).toBe(true)
    expect(estados.video).toBeNull()
  })

  test('pantalla: la auditoría lista, filtra, anula con motivo y no expone al operador del escáner', async ({ page }) => {
    const alumno = beto()
    const { payload } = preparar(alumno, { comedor: true })
    const request = page.request
    expect((await registrar(request, { payload })).cuerpo.codigo).toBe('REGISTRADO')
    expect((await registrar(request, { payload })).cuerpo.codigo).toBe('YA_REGISTRADO')

    const respuesta = await page.goto('/dashboard/accesos/auditoria')
    expect(respuesta?.headers()['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
    await expect(page.getByRole('heading', { name: 'Auditoría de accesos' })).toBeVisible()
    const filas = page.getByTestId('auditoria-fila')
    await expect(filas).toHaveCount(2)
    // Dirección ve el motivo interno de la denegación y la identidad.
    await expect(page.getByText('Motivo interno: Ya estaba registrado ese día')).toBeVisible()
    await expect(filas.first()).toContainText(IDENT.ESTUDIANTE.apellido)
    await captura(page, 'auditoria')

    // Filtro por resultado.
    await page.getByLabel('Resultado').selectOption('DENEGADO')
    await page.getByRole('button', { name: 'Filtrar' }).click()
    await expect(page.getByTestId('auditoria-fila')).toHaveCount(1)
    await expect(page).toHaveURL(/resultado=DENEGADO/)
    await expect(page).not.toHaveURL(/EPT1|payload|dni|legajo/i)
    await page.getByLabel('Resultado').selectOption('')
    await page.getByRole('button', { name: 'Filtrar' }).click()
    await expect(page.getByTestId('auditoria-fila')).toHaveCount(2)

    // Anulación con diálogo accesible.
    const boton = page.getByRole('button', { name: /^Anular el acceso de las/ })
    await boton.click()
    const dialogo = page.getByRole('dialog', { name: 'Anular un acceso registrado' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByLabel(/Motivo/)).toBeFocused()
    await dialogo.getByLabel(/Motivo/).fill('ab')
    await dialogo.getByRole('button', { name: 'Anular acceso' }).click()
    await expect(dialogo.getByRole('alert')).toContainText('entre 3 y 200 caracteres')
    await dialogo.getByLabel(/Motivo/).fill('Se escaneó la credencial equivocada')
    await dialogo.getByRole('button', { name: 'Anular acceso' }).click()
    await expect(page.getByTestId('auditoria-aviso')).toContainText('Acceso anulado')
    await expect(page.locator('[data-resultado="REGISTRADO"][data-anulado="si"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /^Anular el acceso de las/ })).toHaveCount(0)
    await captura(page, 'auditoria-anulado')
    expect(sql(`SELECT count(*) FROM public.anulaciones_accesos_servicios;`)).toBe('1')
    // El acceso anulado libera el cupo: un nuevo escaneo legítimo se registra.
    expect((await registrar(request, { payload })).cuerpo.codigo).toBe('REGISTRADO')
  })

  test('la clave, el payload y los identificadores internos no aparecen en el HTML ni en las respuestas', async ({ page, request }) => {
    const { credencial, payload } = preparar(beto(), { comedor: true })
    const claves = process.env.QR_CREDENCIAL_CLAVES ?? ''
    const material = claves.split(',').map((par) => par.split(':')[1]).filter(Boolean)
    expect(material.length).toBeGreaterThan(0)

    const registro = await request.post(RUTA_REGISTRO, { data: { payload, intento_id: nuevoIntento(), servicio_id: SERVICIOS.comedor } })
    const textos = [await registro.text(), JSON.stringify(registro.headers())]
    for (const ruta of ['/dashboard/accesos', '/dashboard/accesos/auditoria']) {
      await page.goto(ruta)
      textos.push(await page.content())
    }
    for (const texto of textos) {
      for (const secreto of [...material, process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'no-hay', payload, payload.split('.')[3]]) {
        expect(texto).not.toContain(secreto)
      }
      expect(texto).not.toMatch(/QR_CREDENCIAL|SERVICE_ROLE|service_role/i)
      expect(texto).not.toContain(credencial)
    }
  })
})

// ---------------------------------------------------------------------------

test.describe('PERSONAL autenticado', () => {
  test.describe.configure({ retries: 0, mode: 'serial' })
  test.afterAll(() => limpiarEscenario())

  test('API: PERSONAL opera el escáner con su propia cuenta y no anula', async ({ request }) => {
    const alumno = beto()
    const { payload } = preparar(alumno, { comedor: true })
    const primero = await registrar(request, { payload })
    expect(primero.estado).toBe(200)
    expect(primero.cuerpo.codigo).toBe('REGISTRADO')
    // El operador del evento es quien tiene la sesión, no quien el cliente diga.
    expect(
      sql(`SELECT p.dni FROM public.accesos_servicios a JOIN public.perfiles p ON p.id = a.operador_perfil_id WHERE a.alumno_id = '${alumno}' AND a.resultado = 'REGISTRADO';`)
    ).toBe(IDENT.PERSONAL.dni)
    expect(contarContadores(IDENT.PERSONAL.dni, 'SOLICITUD')).toBe(1)
    expect((await registrar(request, { payload })).cuerpo.codigo).toBe('YA_REGISTRADO')

    // Pero no consulta nada ni anula.
    const evento = ultimoAcceso(alumno, 'REGISTRADO').id
    await exigirError(await request.post(rutaAnulacion(evento), { data: { motivo: 'Intento de PERSONAL' } }), 403, 'SIN_PERMISO', 'PERSONAL anula')
    expect(sql(`SELECT count(*) FROM public.anulaciones_accesos_servicios;`)).toBe('0')
  })

  test('PostgREST directo: PERSONAL no registra por RPC, no consulta ni lee ninguna tabla', async () => {
    const alumno = beto()
    const { credencial } = preparar(alumno, { comedor: true })
    const cliente = await clienteAutenticado(IDENT.PERSONAL.email, IDENT.PERSONAL.password)
    const usuario = sql(`SELECT user_id FROM public.perfiles WHERE dni = '${IDENT.PERSONAL.dni}';`)

    const intentos = [
      cliente.rpc('registrar_acceso_servicio', { p_actor_user_id: usuario, p_intento_id: nuevoIntento(), p_credencial_id: credencial, p_clave_kid: 'k1', p_servicio_id: SERVICIOS.comedor }),
      cliente.rpc('registrar_acceso_servicio', { p_actor_user_id: randomUUID(), p_intento_id: nuevoIntento(), p_credencial_id: credencial, p_clave_kid: 'k1', p_servicio_id: SERVICIOS.comedor }),
      cliente.rpc('consumir_cupo_escaneo', { p_actor_user_id: usuario }),
      cliente.rpc('listar_accesos_servicios', { p_limite: 10 }),
      cliente.rpc('anular_acceso_servicio', { p_acceso_id: randomUUID(), p_motivo: 'Motivo de prueba' }),
      cliente.rpc('consultar_validez_credencial_qr', { p_credencial_id: credencial }),
      cliente.from('accesos_servicios').select('id'),
      cliente.from('anulaciones_accesos_servicios').select('acceso_id'),
      cliente.from('accesos_servicios').insert({ intento_id: nuevoIntento(), operador_perfil_id: idPerfil(IDENT.PERSONAL.dni), credencial_id: credencial, alumno_id: alumno, servicio_id: SERVICIOS.comedor, resultado: 'REGISTRADO' }),
    ]
    for (const [indice, consulta] of intentos.entries()) {
      const { data, error } = await consulta
      expect(error, `intento ${indice + 1}`).not.toBeNull()
      expect(data, `intento ${indice + 1}`).toBeNull()
    }
    expect(contarAccesos()).toBe(0)

    // El catálogo de servicios sí se lee (es público para toda sesión autenticada).
    const catalogo = await cliente.from('servicios_escolares').select('id, tipo, codigo, nombre').eq('activo', true)
    expect(catalogo.error).toBeNull()
    expect((catalogo.data ?? []).length).toBeGreaterThanOrEqual(5)
  })

  test('pantalla: PERSONAL ve el escáner, no la auditoría, y registra comedor y transporte', async ({ page }) => {
    const alumno = beto()
    const { payload } = preparar(alumno, { comedor: true, transporte: 'sur' })
    await page.goto('/dashboard/accesos')
    await expect(page.getByRole('heading', { name: 'Registrar accesos' })).toBeVisible()
    // El menú ofrece el escáner y NO la auditoría.
    const menu = page.getByRole('navigation', { name: 'Menú del dashboard' })
    await expect(menu.getByRole('link', { name: 'Registrar accesos' })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Auditoría de accesos' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Ver la auditoría de accesos' })).toHaveCount(0)
    await captura(page, 'escaner-inicio')

    const foto = page.getByTestId('escaner-foto')
    // Sin elegir recorrido y sentido, la lectura está deshabilitada y se explica por qué.
    await page.getByLabel('Transporte', { exact: true }).check()
    await expect(page.getByRole('button', { name: 'Escanear con la cámara' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Usar una foto del QR' })).toBeDisabled()
    await expect(page.getByText('Elegí el recorrido y el sentido para habilitar la lectura.')).toBeVisible()
    await page.getByLabel('Recorrido donde estás escaneando').selectOption({ label: 'Recorrido Sur (ficticio)' })
    await page.getByLabel('Ida', { exact: true }).check()
    await expect(page.getByRole('button', { name: 'Usar una foto del QR' })).toBeEnabled()
    await foto.setInputFiles(gifDelQr(payload))
    await expect(page.getByRole('heading', { name: 'Acceso registrado' })).toBeVisible()
    expect(ultimoAcceso(alumno, 'REGISTRADO').sentido).toBe('IDA')

    // Recorrido equivocado → denegación genérica, sin nombre.
    await page.getByRole('button', { name: 'Escanear siguiente' }).click()
    await page.getByLabel('Recorrido donde estás escaneando').selectOption({ label: 'Recorrido Norte (ficticio)' })
    await foto.setInputFiles(gifDelQr(payload))
    const rechazo = page.locator('[role="alert"][aria-live="assertive"]').getByTestId('escaner-resultado')
    await expect(rechazo.getByRole('heading', { name: 'No habilitado' })).toBeVisible()
    expect(await rechazo.innerText()).not.toMatch(new RegExp(`${IDENT.ESTUDIANTE.nombre}|${IDENT.ESTUDIANTE.apellido}|sur|norte|inscri`, 'i'))
    await captura(page, 'escaner-denegado')
  })

  test('pantalla: la auditoría y la anulación están cerradas para PERSONAL', async ({ page }) => {
    await pantallaRestringida(page, '/dashboard/accesos/auditoria')
    await page.goto('/dashboard/accesos/auditoria?resultado=DENEGADO')
    await expect(page.getByTestId('auditoria-fila')).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// Actores que NO operan el escáner
// ---------------------------------------------------------------------------

for (const [etiqueta, identidad] of [
  ['ESTUDIANTE', IDENT.ESTUDIANTE],
  ['DOCENTE', IDENT.DOCENTE],
  ['PADRE', IDENT.PADRE],
  ['SIN PERFIL', IDENT.SIN_PERFIL],
] as const) {
  test.describe(`${etiqueta} autenticado`, () => {
    test.describe.configure({ retries: 0 })

    test(`${etiqueta}: la API, las funciones y las tablas están cerradas`, async ({ request, page }) => {
      limpiarContadores()
      await exigirSinEscaner(request, page, identidad, { estado: 403, codigo: 'SIN_PERMISO' })
    })

    test(`${etiqueta}: la pantalla del escáner y la auditoría muestran «Acceso restringido»`, async ({ page }) => {
      await pantallaRestringida(page, '/dashboard/accesos')
      await pantallaRestringida(page, '/dashboard/accesos/auditoria')
    })
  })
}

for (const [etiqueta, identidad] of [
  ['DIRECTOR BLOQUEADO', IDENT.DIRECTOR_BLOQUEADO],
  ['PERSONAL BLOQUEADO', IDENT.PERSONAL_BLOQUEADO],
  ['ESTUDIANTE BLOQUEADO', IDENT.ESTUDIANTE_BLOQUEADO],
  ['DOCENTE BLOQUEADO', IDENT.DOCENTE_BLOQUEADO],
  ['PADRE BLOQUEADO', IDENT.PADRE_BLOQUEADO],
] as const) {
  test.describe(`${etiqueta} autenticado`, () => {
    test.describe.configure({ retries: 0 })

    test(`${etiqueta}: con la sesión vieja, todo se rechaza y no se consume ningún cupo`, async ({ request, page }) => {
      limpiarContadores()
      await exigirSinEscaner(request, page, identidad, { estado: 403, codigo: 'ACCESO_BLOQUEADO' })
      expect(contarContadores(identidad.dni), 'un bloqueado no consume cupo').toBe(0)
    })

    test(`${etiqueta}: la navegación lo lleva a la pantalla de acceso bloqueado`, async ({ page }) => {
      await page.goto('/dashboard/accesos')
      await expect(page).toHaveURL(/\/acceso-bloqueado/)
      await expect(page.getByRole('button', { name: /Escanear con la cámara/ })).toHaveCount(0)
    })
  })
}
