import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { capturarSinHerramientas } from './_captura'
import { exigirContraste } from './_contraste'
import {
  expect,
  request as crearContexto,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test'

/**
 * Legajo académico con sesiones reales contra la base local descartable.
 *
 * A diferencia de `alumnos-ui.spec.ts`, acá no hay ningún dato simulado: cada
 * aserción atraviesa la API, PostgreSQL y RLS. Es la prueba de que lo que la
 * interfaz muestra quedó realmente persistido.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const CAPTURAR = process.env.EPT_CAPTURAS === '1'
const BASE_URL = 'http://localhost:3000'

const SESION_DIRECTORA = 'tests/.auth/directora.json'
const SESION_ESTUDIANTE = 'tests/.auth/estudiante.json'
const SESION_ESTUDIANTE_AJENO = 'tests/.auth/estudiante-ajeno.json'
const SESION_DOCENTE = 'tests/.auth/docente.json'
const SESION_PADRE = 'tests/.auth/padre.json'
const SESION_PERSONAL = 'tests/.auth/personal.json'
const SESION_SIN_PERFIL = 'tests/.auth/sin-perfil.json'

const MENSAJE_NO_AUTORIZADO = 'Solo el director puede administrar los legajos académicos.'

const FILTRACIONES_PROHIBIDAS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'service_role',
  'postgres',
  'supabase.co',
  'select ',
  'insert into',
  'pg_',
  'SQLSTATE',
  '23505',
  '23503',
  'P5504',
  'P5505',
  'P5510',
  'P5511',
  'P5512',
  'P5513',
  'P5514',
  'P5515',
  'P5516',
  'perfiles_dni',
  'idx_matriculas',
]

function esperarSinFiltraciones(cuerpo: string) {
  for (const fragmento of FILTRACIONES_PROHIBIDAS) {
    expect(
      cuerpo.toLowerCase(),
      `la respuesta no debe filtrar "${fragmento}"`
    ).not.toContain(fragmento.toLowerCase())
  }
}

/** Prefijo de los cursos que crea esta suite, para poder retirarlos después. */
const PREFIJO_CURSO = 'EPT-9 '

/** Prefijo de los DNI sintéticos que crea esta suite. */
const PREFIJO_DNI = '98'

/**
 * Devuelve el catálogo al estado que dejó la siembra.
 *
 * Sin esto, los legajos y cursos que crean estas pruebas quedarían ocupando
 * «1er Grado A» y sumando filas al listado, y romperían dos garantías legítimas
 * de la suite de Cursos: su recuento exacto y la baja lógica de ese curso.
 *
 * Se hace en una única transacción porque borrar matrículas y legajos por
 * separado es justamente lo que la invariante diferida impide.
 */
function retirarDatosDeEstaSuite() {
  const contenedor =
    process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

  execFileSync(
    'docker',
    ['exec', '-i', contenedor, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres',
     '-v', 'ON_ERROR_STOP=1'],
    {
      input: `
        BEGIN;
        DELETE FROM public.matriculas
          WHERE alumno_id IN (
            SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%'
          );
        DELETE FROM public.alumnos
          WHERE perfil_id IN (
            SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%'
          );
        DELETE FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%';
        DELETE FROM public.cursos WHERE denominacion LIKE '${PREFIJO_CURSO}%';
        COMMIT;
      `,
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  )
}

test.afterAll(() => {
  if (process.env.EPT_SUPABASE_LOCAL !== '1') return
  retirarDatosDeEstaSuite()
})

const contextosActivos: APIRequestContext[] = []

type EjecutarPeticion = Parameters<APIRequestContext['fetch']>

async function pedirConSesion(
  archivoSesion: string,
  url: EjecutarPeticion[0],
  opciones?: EjecutarPeticion[1]
) {
  const limite = Date.now() + 20_000
  let ultimoEstado: number | null = null

  do {
    if (fs.existsSync(archivoSesion)) {
      const contexto = await crearContexto.newContext({
        baseURL: BASE_URL,
        storageState: archivoSesion,
      })
      const respuesta: APIResponse = await contexto.fetch(url, opciones)
      ultimoEstado = respuesta.status()

      if (ultimoEstado !== 401) {
        contextosActivos.push(contexto)
        return respuesta
      }
      await contexto.dispose()
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  } while (Date.now() < limite)

  if (ultimoEstado !== null) {
    throw new Error(
      `La sesión local ${archivoSesion} continuó respondiendo ${ultimoEstado} durante 20 segundos.`
    )
  }
  throw new Error(`No se encontró la sesión local ${archivoSesion}. Ejecutá auth.setup.ts primero.`)
}

test.afterEach(async () => {
  await Promise.all(contextosActivos.splice(0).map((contexto) => contexto.dispose()))
})

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  await capturarSinHerramientas(
    page,
    path.join('docs/evidence/EPT-9', `real-${nombre}.png`)
  )
}

/**
 * Retira y restituye el permiso de lectura del historial academico.
 *
 * Es la unica forma honesta de comprobar el estado de error: la lectura tiene
 * que fallar de verdad. No se otorga ningun privilegio nuevo; se quita el que
 * la migracion 008 concedio y se devuelve exactamente igual.
 */
function conHistorialIlegible(cuerpo: () => Promise<void>) {
  const contenedor =
    process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

  const psql = (sentencia: string) =>
    execFileSync(
      'docker',
      ['exec', '-i', contenedor, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres',
       '-v', 'ON_ERROR_STOP=1'],
      { input: sentencia, stdio: ['pipe', 'pipe', 'pipe'] }
    )

  psql('REVOKE SELECT ON public.matriculas_historial FROM authenticated;')
  return cuerpo().finally(() => {
    psql('GRANT SELECT ON public.matriculas_historial TO authenticated;')
  })
}

/** DNI sintéticos únicos por corrida, dentro del contrato de 8 dígitos. */
let contadorDni = 0
function dniUnico() {
  contadorDni += 1
  const sufijo = String((Date.now() % 100_000) * 10 + (contadorDni % 10)).padStart(6, '0')
  return `${PREFIJO_DNI}${sufijo.slice(-6)}`
}

function legajoUnico(prefijo: string) {
  return `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 50)
}

/**
 * Lee los cursos que la aplicación ofrece realmente para una asignación nueva.
 *
 * Sale del selector del formulario de alta, no de una consulta paralela: así la
 * prueba usa exactamente las mismas opciones que ve el director.
 */
async function cursosActivos(page: Page) {
  await page.goto('/dashboard/alumnos')
  await page.getByRole('button', { name: 'Nuevo alumno' }).click()

  const opciones = await page
    .locator('#formulario-nuevo-alumno')
    .getByLabel('Curso')
    .locator('option')
    .evaluateAll((elementos) =>
      elementos.map((elemento) => (elemento as HTMLOptionElement).value).filter(Boolean)
    )

  expect(
    opciones.length,
    'la página debe ofrecer al menos un curso activo'
  ).toBeGreaterThan(0)
  return opciones
}

// ================================================================
test.describe('DIRECTOR autenticado — alumnos', () => {
  test('crea, cambia de curso, inactiva y reactiva conservando la historia', async ({
    page,
  }) => {
    const cursos = await cursosActivos(page)
    const dni = dniUnico()
    const legajo = legajoUnico('LEG-API')

    const alta = await pedirConSesion(SESION_DIRECTORA, '/api/alumnos', {
      method: 'POST',
      data: {
        nombre: 'Milena',
        apellido: 'Barrios',
        dni,
        estado: 'ACTIVO',
        legajo_nro: legajo,
        curso_id: cursos[0],
      },
    })
    expect(alta.status()).toBe(201)
    const alumnoId = (await alta.json()).alumno_id as string
    expect(alumnoId).toMatch(/^[0-9a-f-]{36}$/)

    // El detalle refleja la situación vigente y el nivel derivado del curso. Se
    // navega con el navegador porque el panel se resuelve después de hidratar.
    await page.goto(`/dashboard/alumnos/${alumnoId}`)
    await expect(page.getByRole('heading', { name: 'Barrios, Milena' })).toBeVisible()
    const situacion = page.getByLabel('Situación actual')
    await expect(situacion).toContainText(legajo)
    await expect(situacion).toContainText('Activo')
    await expect(situacion).toContainText('PRIMARIO')

    // Cambio de curso: si solo hay un curso activo, la propia base lo rechaza.
    if (cursos.length > 1) {
      const cambio = await pedirConSesion(SESION_DIRECTORA, `/api/alumnos/${alumnoId}`, {
        method: 'PATCH',
        data: { accion: 'cambiar_curso', curso_id: cursos[1] },
      })
      expect(cambio.status()).toBe(200)
    }

    const inactivacion = await pedirConSesion(SESION_DIRECTORA, `/api/alumnos/${alumnoId}`, {
      method: 'PATCH',
      data: { accion: 'inactivar' },
    })
    expect(inactivacion.status()).toBe(200)

    const reactivacion = await pedirConSesion(SESION_DIRECTORA, `/api/alumnos/${alumnoId}`, {
      method: 'PATCH',
      data: { accion: 'reactivar', curso_id: cursos[0] },
    })
    expect(reactivacion.status()).toBe(200)

    // El historial conserva todos los tramos y el legajo nunca cambió.
    await page.goto(`/dashboard/alumnos/${alumnoId}`)
    await expect(page.getByRole('heading', { name: 'Historial de cursos' })).toBeVisible()
    await expect(page.getByLabel('Situación actual')).toContainText(legajo)

    const historial = page.getByRole('table', { name: 'Tabla del historial de cursos' })
    await expect(historial).toContainText('Cambio de curso')
    await expect(historial).toContainText('Inactivación del estudiante')
    await expect(historial).toContainText('Vigente')
  })

  test('rechaza un curso inexistente y uno inactivo sin persistir nada', async ({
    page,
  }) => {
    const cursos = await cursosActivos(page)

    const inexistente = await pedirConSesion(SESION_DIRECTORA, '/api/alumnos', {
      method: 'POST',
      data: {
        nombre: 'Curso',
        apellido: 'Inexistente',
        dni: dniUnico(),
        estado: 'ACTIVO',
        legajo_nro: legajoUnico('LEG-NOEXISTE'),
        curso_id: '00000000-0000-4000-8000-000000000000',
      },
    })
    expect(inexistente.status()).toBe(400)
    const cuerpoInexistente = await inexistente.text()
    expect(JSON.parse(cuerpoInexistente)).toMatchObject({
      error: 'El curso elegido no existe.',
      campo: 'curso_id',
    })
    esperarSinFiltraciones(cuerpoInexistente)

    // Un curso creado y luego inactivado ya no admite asignaciones nuevas.
    const nuevoCurso = await pedirConSesion(SESION_DIRECTORA, '/api/cursos', {
      method: 'POST',
      data: {
        denominacion: `${PREFIJO_CURSO}${Date.now()}`,
        division: 'Z',
        nivel_id: 2,
      },
    })
    expect(nuevoCurso.status()).toBe(201)
    const cursoId = (await nuevoCurso.json()).curso.id as string

    const baja = await pedirConSesion(SESION_DIRECTORA, `/api/cursos/${cursoId}`, {
      method: 'PATCH',
      data: { activo: false },
    })
    expect(baja.status()).toBe(200)

    const conCursoInactivo = await pedirConSesion(SESION_DIRECTORA, '/api/alumnos', {
      method: 'POST',
      data: {
        nombre: 'Curso',
        apellido: 'Inactivo',
        dni: dniUnico(),
        estado: 'ACTIVO',
        legajo_nro: legajoUnico('LEG-INACTIVO'),
        curso_id: cursoId,
      },
    })
    expect(conCursoInactivo.status()).toBe(409)
    const cuerpoInactivo = await conCursoInactivo.text()
    expect(JSON.parse(cuerpoInactivo)).toMatchObject({
      error: 'El curso elegido está inactivo. Elegí un curso activo.',
      campo: 'curso_id',
    })
    esperarSinFiltraciones(cuerpoInactivo)

    expect(cursos.length).toBeGreaterThan(0)
  })

  test('traduce el DNI y el legajo duplicados reales de PostgreSQL', async ({ page }) => {
    const cursos = await cursosActivos(page)
    const dni = dniUnico()
    const legajo = legajoUnico('LEG-DUP')

    const primera = await pedirConSesion(SESION_DIRECTORA, '/api/alumnos', {
      method: 'POST',
      data: {
        nombre: 'Duplicada',
        apellido: 'Primera',
        dni,
        estado: 'ACTIVO',
        legajo_nro: legajo,
        curso_id: cursos[0],
      },
    })
    expect(primera.status()).toBe(201)

    const dniRepetido = await pedirConSesion(SESION_DIRECTORA, '/api/alumnos', {
      method: 'POST',
      data: {
        nombre: 'Duplicada',
        apellido: 'Segunda',
        dni,
        estado: 'INACTIVO',
      },
    })
    expect(dniRepetido.status()).toBe(409)
    const cuerpoDni = await dniRepetido.text()
    expect(JSON.parse(cuerpoDni)).toMatchObject({
      error: 'Ya existe una persona registrada con ese DNI.',
      campo: 'dni',
    })
    esperarSinFiltraciones(cuerpoDni)

    // Mismo legajo con otra combinación de mayúsculas: también es duplicado.
    const legajoRepetido = await pedirConSesion(SESION_DIRECTORA, '/api/alumnos', {
      method: 'POST',
      data: {
        nombre: 'Duplicada',
        apellido: 'Tercera',
        dni: dniUnico(),
        estado: 'ACTIVO',
        legajo_nro: legajo.toUpperCase(),
        curso_id: cursos[0],
      },
    })
    expect(legajoRepetido.status()).toBe(409)
    const cuerpoLegajo = await legajoRepetido.text()
    expect(JSON.parse(cuerpoLegajo)).toMatchObject({
      error: 'Ya existe un legajo con ese número.',
      campo: 'legajo_nro',
    })
    esperarSinFiltraciones(cuerpoLegajo)
  })

  test('corrige el DNI conservando el identificador interno y el historial', async ({
    page,
  }) => {
    const cursos = await cursosActivos(page)
    const legajo = legajoUnico('LEG-CORR')

    const alta = await pedirConSesion(SESION_DIRECTORA, '/api/alumnos', {
      method: 'POST',
      data: {
        nombre: 'Corrección',
        apellido: 'Válida',
        dni: dniUnico(),
        estado: 'ACTIVO',
        legajo_nro: legajo,
        curso_id: cursos[0],
      },
    })
    expect(alta.status()).toBe(201)
    const alumnoId = (await alta.json()).alumno_id as string

    const dniCorregido = dniUnico()
    const correccion = await pedirConSesion(SESION_DIRECTORA, `/api/alumnos/${alumnoId}`, {
      method: 'PATCH',
      data: { accion: 'corregir_identidad', dni: dniCorregido, legajo_nro: legajo },
    })
    expect(correccion.status()).toBe(200)
    expect((await correccion.json()).alumno_id).toBe(alumnoId)

    await page.goto(`/dashboard/alumnos/${alumnoId}`)
    const situacion = page.getByLabel('Situación actual')
    await expect(situacion).toContainText(dniCorregido)
    await expect(situacion).toContainText(legajo)
    await expect(situacion).toContainText('Activo')
  })

  test('rechaza un DNI inválido en el servidor aunque la interfaz se saltee', async () => {
    for (const dni of ['12345', 'T1234567', '123456789', '1234 567']) {
      const respuesta = await pedirConSesion(SESION_DIRECTORA, '/api/alumnos', {
        method: 'POST',
        data: { nombre: 'DNI', apellido: 'Inválido', dni, estado: 'INACTIVO' },
      })
      expect(respuesta.status(), `el DNI "${dni}" debe rechazarse`).toBe(400)
      esperarSinFiltraciones(await respuesta.text())
    }
  })

  test('rechaza un estado fuera del catálogo y una acción desconocida', async () => {
    const estadoInvalido = await pedirConSesion(SESION_DIRECTORA, '/api/alumnos', {
      method: 'POST',
      data: {
        nombre: 'Estado',
        apellido: 'Inválido',
        dni: dniUnico(),
        estado: 'SUSPENDIDO',
      },
    })
    expect(estadoInvalido.status()).toBe(400)
    esperarSinFiltraciones(await estadoInvalido.text())

    const accionInvalida = await pedirConSesion(
      SESION_DIRECTORA,
      '/api/alumnos/11111111-1111-4111-8111-111111111111',
      { method: 'PATCH', data: { accion: 'eliminar' } }
    )
    expect(accionInvalida.status()).toBe(400)
    esperarSinFiltraciones(await accionInvalida.text())
  })

  test('devuelve 404 para un legajo que no existe, sin revelar nada', async () => {
    const respuesta = await pedirConSesion(
      SESION_DIRECTORA,
      '/api/alumnos/00000000-0000-4000-8000-000000000000',
      { method: 'PATCH', data: { accion: 'inactivar' } }
    )
    expect(respuesta.status()).toBe(404)
    const cuerpo = await respuesta.text()
    expect(JSON.parse(cuerpo).error).toBe('El legajo académico solicitado no existe.')
    esperarSinFiltraciones(cuerpo)
  })

  test('no puede inactivar un curso con estudiantes matriculados', async ({ page }) => {
    const cursos = await cursosActivos(page)
    const nuevoCurso = await pedirConSesion(SESION_DIRECTORA, '/api/cursos', {
      method: 'POST',
      data: {
        denominacion: `${PREFIJO_CURSO}ocupado ${Date.now()}`,
        division: 'Y',
        nivel_id: 2,
      },
    })
    expect(nuevoCurso.status()).toBe(201)
    const cursoId = (await nuevoCurso.json()).curso.id as string

    const alta = await pedirConSesion(SESION_DIRECTORA, '/api/alumnos', {
      method: 'POST',
      data: {
        nombre: 'Ocupa',
        apellido: 'Curso',
        dni: dniUnico(),
        estado: 'ACTIVO',
        legajo_nro: legajoUnico('LEG-OCUPA'),
        curso_id: cursoId,
      },
    })
    expect(alta.status()).toBe(201)
    const alumnoId = (await alta.json()).alumno_id as string

    const bajaBloqueada = await pedirConSesion(SESION_DIRECTORA, `/api/cursos/${cursoId}`, {
      method: 'PATCH',
      data: { activo: false },
    })
    expect(bajaBloqueada.status()).toBe(409)
    const cuerpo = await bajaBloqueada.text()
    expect(JSON.parse(cuerpo).error).toBe(
      'No se puede inactivar un curso con estudiantes matriculados. Reasignalos o inactivalos primero.'
    )
    esperarSinFiltraciones(cuerpo)

    // Al reasignar al estudiante, la baja del curso vuelve a estar disponible.
    const reasignacion = await pedirConSesion(SESION_DIRECTORA, `/api/alumnos/${alumnoId}`, {
      method: 'PATCH',
      data: { accion: 'cambiar_curso', curso_id: cursos[0] },
    })
    expect(reasignacion.status()).toBe(200)

    const bajaPermitida = await pedirConSesion(SESION_DIRECTORA, `/api/cursos/${cursoId}`, {
      method: 'PATCH',
      data: { activo: false },
    })
    expect(bajaPermitida.status()).toBe(200)
  })

  test('el listado y el detalle persisten después de recargar', async ({ page }) => {
    const cursos = await cursosActivos(page)
    const legajo = legajoUnico('LEG-UI')
    const alta = await pedirConSesion(SESION_DIRECTORA, '/api/alumnos', {
      method: 'POST',
      data: {
        nombre: 'Persistente',
        apellido: 'Zabala',
        dni: dniUnico(),
        estado: 'ACTIVO',
        legajo_nro: legajo,
        curso_id: cursos[0],
      },
    })
    expect(alta.status()).toBe(201)
    const alumnoId = (await alta.json()).alumno_id as string

    await page.goto('/dashboard/alumnos')
    await expect(
      page.getByRole('table', { name: 'Tabla de alumnos' })
    ).toContainText('Zabala, Persistente')
    await capturar(page, 'escritorio-listado')

    await page.reload()
    await expect(
      page.getByRole('table', { name: 'Tabla de alumnos' })
    ).toContainText(legajo)

    await page.goto(`/dashboard/alumnos/${alumnoId}`)
    await expect(page.getByRole('heading', { name: 'Zabala, Persistente' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Historial de cursos' })).toBeVisible()
    await capturar(page, 'escritorio-detalle-historial')
  })

  test('inactiva y reactiva desde la interfaz y el cambio queda persistido', async ({
    page,
  }) => {
    const cursos = await cursosActivos(page)
    const alta = await pedirConSesion(SESION_DIRECTORA, '/api/alumnos', {
      method: 'POST',
      data: {
        nombre: 'Ciclo',
        apellido: 'Yaniz',
        dni: dniUnico(),
        estado: 'ACTIVO',
        legajo_nro: legajoUnico('LEG-CICLO'),
        curso_id: cursos[0],
      },
    })
    expect(alta.status()).toBe(201)

    await page.goto('/dashboard/alumnos')
    await page.getByRole('button', { name: 'Inactivar al alumno Yaniz, Ciclo' }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmar inactivación' })
      .click()
    await expect(page.getByRole('status')).toContainText(
      'Yaniz, Ciclo quedó inactivo. Se conservan legajo e historial.'
    )

    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Reactivar al alumno Yaniz, Ciclo' })
    ).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Reactivar al alumno Yaniz, Ciclo' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Reactivar a Yaniz, Ciclo' })
    await dialogo.getByLabel('Curso para la reactivación').selectOption(cursos[0])
    await dialogo.getByRole('button', { name: 'Confirmar reactivación' }).click()
    await expect(page.getByRole('status')).toContainText(
      'Yaniz, Ciclo volvió a estar activo con una matrícula nueva.'
    )

    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Inactivar al alumno Yaniz, Ciclo' })
    ).toBeVisible({ timeout: 15_000 })
  })

  test('el detalle del legajo cumple el contraste AA', async ({ page }) => {
    // `SituacionAcademica` usa rotulos pequenos que la revision midio en
    // 3,05:1. Se comprueba sobre la pantalla real, con datos reales.
    const cursos = await cursosActivos(page)
    const dni = dniUnico()
    const alta = await pedirConSesion(SESION_DIRECTORA, '/api/alumnos', {
      method: 'POST',
      data: {
        nombre: 'Contraste',
        apellido: 'Detalle',
        dni,
        estado: 'ACTIVO',
        legajo_nro: legajoUnico('LEG-CONTRASTE'),
        curso_id: cursos[0],
      },
    })
    expect(alta.status()).toBe(201)
    const alumnoId = (await alta.json()).alumno_id as string

    await page.goto(`/dashboard/alumnos/${alumnoId}`)
    await expect(page.getByRole('heading', { name: 'Situación actual' })).toBeVisible()
    await exigirContraste(page, 'detalle del legajo académico')

    await page.goto('/dashboard/alumnos')
    await expect(page.getByRole('heading', { name: 'Alumnos' })).toBeVisible()
    await exigirContraste(page, 'listado administrativo con datos reales')
  })

  test('el banco visual sirve datos sinteticos y jamas los reales', async ({ page }) => {
    // Que el banco no exista en produccion se demuestra por comportamiento, no
    // leyendo el codigo: `supabase/tests/harness_produccion.mjs` compila la
    // aplicacion, la levanta con EPT_UI_HARNESS=1 y comprueba que las tres
    // rutas responden igual que una que nunca existio.
    //
    // Lo que se comprueba aca es lo otro que importa: que el banco este
    // aislado de la base. Este servidor tiene sesion de directora y una base
    // sembrada; si el banco leyera de ahi, mostraria personas reales.
    await page.goto('/pruebas-ui/alumnos')

    await expect(page.getByRole('heading', { name: 'Alumnos' })).toBeVisible()
    await expect(page.getByText('Arrieta, Camila').first()).toBeVisible()

    // Ninguna de las identidades sembradas por `auth.setup.ts` aparece aca.
    const cuerpo = page.locator('body')
    await expect(cuerpo).not.toContainText('Estudiante, Beto')
    await expect(cuerpo).not.toContainText('LEG-PRUEBA-0002')
    await expect(cuerpo).not.toContainText('99900002')
  })
})

// ================================================================
test.describe('ESTUDIANTE autenticado — alumnos', () => {
  test('consulta su propio legajo académico con su curso y nivel', async ({ page }) => {
    await page.goto('/dashboard/mi-legajo')

    await expect(
      page.getByRole('heading', { name: 'Mi legajo académico' })
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Situación actual' })).toBeVisible()
    const situacion = page.getByLabel('Situación actual')
    await expect(situacion).toContainText('LEG-PRUEBA-0002')
    await expect(situacion).toContainText('Sala de 5 A')
    await expect(situacion).toContainText('INICIAL')
    await expect(page.getByRole('heading', { name: 'Historial de cursos' })).toBeVisible()
    await capturar(page, 'escritorio-estudiante-mi-legajo')
  })

test('distingue no tener trayectoria de no poder leerla', async ({ page }) => {
    await conHistorialIlegible(async () => {
      await page.goto('/dashboard/mi-legajo')

      // La situacion actual se lee igual: el fallo es solo del historial.
      await expect(page.getByRole('heading', { name: 'Situación actual' })).toBeVisible()

      // Y el historial dice que no se pudo leer, no que no existe.
      const aviso = page.getByRole('alert').filter({
        hasText: 'No pudimos cargar el historial de cursos',
      })
      await expect(aviso).toBeVisible()
      await expect(aviso).toContainText('No pudimos leer el historial en este momento.')
      await expect(aviso).toContainText(
        'Esto no significa que el legajo no tenga trayectoria: no se pudo leer.'
      )

      // El mensaje no le atribuye al estudiante una falta de permiso que no
      // tiene: su propio historial sí le corresponde.
      await expect(aviso).not.toContainText('Solo el director')
      await expect(aviso.getByRole('link', { name: 'Reintentar' })).toBeVisible()

      // El estado vacio, que diria lo contrario, no aparece.
      await expect(
        page.getByText('Todavía no hay matrículas registradas para este legajo.')
      ).toHaveCount(0)

      await capturar(page, 'escritorio-estudiante-historial-ilegible')
    })

    // Restituido el permiso, el reintento muestra la trayectoria real.
    await page.goto('/dashboard/mi-legajo')
    await expect(page.getByRole('heading', { name: 'Historial de cursos' })).toBeVisible()
    await expect(
      page.getByRole('alert').filter({ hasText: 'No pudimos cargar el historial de cursos' })
    ).toHaveCount(0)
    await expect(page.getByLabel('Tabla del historial de cursos')).toContainText('Sala de 5 A')
  })

  test('mi legajo cumple el contraste AA', async ({ page }) => {
    await page.goto('/dashboard/mi-legajo')
    await expect(page.getByRole('heading', { name: 'Situación actual' })).toBeVisible()
    await exigirContraste(page, 'mi legajo académico')
  })

  test('ve Mi legajo en la navegación pero no Alumnos', async ({ page }) => {
    await page.goto('/dashboard')
    const menu = page.getByRole('navigation', { name: 'Menú del dashboard' })
    await expect(menu.getByRole('link', { name: 'Mi legajo' })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Alumnos' })).toHaveCount(0)
  })

  test('no accede al panel administrativo', async ({ page }) => {
    await page.goto('/dashboard/alumnos')
    await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Tabla de alumnos' })).toHaveCount(0)
    await capturar(page, 'escritorio-estudiante-restringido')
  })

  test('recibe 403 antes de que se valide un cuerpo inválido', async () => {
    const respuesta = await pedirConSesion(SESION_ESTUDIANTE, '/api/alumnos', {
      method: 'POST',
      data: { nombre: '', dni: 'invalido', estado: 'INVENTADO' },
    })
    expect(respuesta.status()).toBe(403)
    const cuerpo = await respuesta.text()
    expect(JSON.parse(cuerpo).error).toBe(MENSAJE_NO_AUTORIZADO)
    esperarSinFiltraciones(cuerpo)
  })

  test('no puede cambiar su propio estado, curso, DNI ni legajo', async () => {
    for (const data of [
      { accion: 'corregir_identidad', dni: '47000001' },
      { accion: 'cambiar_curso', curso_id: '11111111-1111-4111-8111-111111111111' },
      { accion: 'inactivar' },
      { accion: 'reactivar', curso_id: '11111111-1111-4111-8111-111111111111' },
    ]) {
      const respuesta = await pedirConSesion(
        SESION_ESTUDIANTE,
        '/api/alumnos/11111111-1111-4111-8111-111111111111',
        { method: 'PATCH', data }
      )
      expect(respuesta.status()).toBe(403)
      esperarSinFiltraciones(await respuesta.text())
    }
  })
})

// ================================================================
test.describe('ESTUDIANTE AJENO autenticado — alumnos', () => {
  test('ve su propio legajo y nunca el de otra persona', async ({ page }) => {
    await page.goto('/dashboard/mi-legajo')
    await expect(page.getByLabel('Situación actual')).toContainText('LEG-PRUEBA-0003')
    // El legajo del otro estudiante no aparece por ninguna vía.
    await expect(page.getByText('LEG-PRUEBA-0002')).toHaveCount(0)
  })

  test('el detalle administrativo de otro estudiante queda restringido', async ({
    page,
  }) => {
    await page.goto('/dashboard/alumnos/11111111-1111-4111-8111-111111111111')
    await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
  })

  test('tampoco puede operar sobre otro estudiante por la API', async () => {
    for (const data of [
      { accion: 'corregir_identidad', dni: '47000002' },
      { accion: 'cambiar_curso', curso_id: '11111111-1111-4111-8111-111111111111' },
      { accion: 'inactivar' },
      { accion: 'reactivar', curso_id: '11111111-1111-4111-8111-111111111111' },
    ]) {
      const respuesta = await pedirConSesion(
        SESION_ESTUDIANTE_AJENO,
        '/api/alumnos/11111111-1111-4111-8111-111111111111',
        { method: 'PATCH', data }
      )
      // 403 y no 404: la autorización responde antes de que exista siquiera la
      // oportunidad de deducir si ese legajo existe.
      expect(respuesta.status()).toBe(403)
      esperarSinFiltraciones(await respuesta.text())
    }
  })
})

// ================================================================
for (const [rol, sesion] of [
  ['DOCENTE', SESION_DOCENTE],
  ['PADRE', SESION_PADRE],
  ['PERSONAL', SESION_PERSONAL],
  ['SIN PERFIL', SESION_SIN_PERFIL],
] as const) {
  test.describe(`${rol} autenticado — alumnos`, () => {
    test('no obtiene acceso académico en la navegación ni en el panel', async ({
      page,
    }) => {
      await page.goto('/dashboard')
      const menu = page.getByRole('navigation', { name: 'Menú del dashboard' })
      await expect(menu.getByRole('link', { name: 'Alumnos' })).toHaveCount(0)
      await expect(menu.getByRole('link', { name: 'Mi legajo' })).toHaveCount(0)

      await page.goto('/dashboard/alumnos')
      await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
      await expect(page.getByRole('table', { name: 'Tabla de alumnos' })).toHaveCount(0)
    })

    test('no alcanza la vista propia del legajo académico', async ({ page }) => {
      // El guardián del panel bloquea la ruta antes de montarla, porque
      // `/dashboard/mi-legajo` está declarada solo para ESTUDIANTE.
      await page.goto('/dashboard/mi-legajo')
      await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Situación actual' })).toHaveCount(0)
    })

    test('recibe 403 en todas las operaciones académicas', async () => {
      const alta = await pedirConSesion(sesion, '/api/alumnos', {
        method: 'POST',
        data: {
          nombre: 'Intruso',
          apellido: 'Denegado',
          dni: '47000099',
          estado: 'INACTIVO',
        },
      })
      expect(alta.status()).toBe(403)
      expect(JSON.parse(await alta.text()).error).toBe(MENSAJE_NO_AUTORIZADO)

      for (const data of [
        { accion: 'corregir_identidad', dni: '47000098' },
        { accion: 'cambiar_curso', curso_id: '11111111-1111-4111-8111-111111111111' },
        { accion: 'inactivar' },
        { accion: 'reactivar', curso_id: '11111111-1111-4111-8111-111111111111' },
      ]) {
        const respuesta = await pedirConSesion(
          sesion,
          '/api/alumnos/11111111-1111-4111-8111-111111111111',
          { method: 'PATCH', data }
        )
        expect(respuesta.status()).toBe(403)
        esperarSinFiltraciones(await respuesta.text())
      }
    })
  })
}
