/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  expect,
  request as crearContexto,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { exigirMensajeSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Administración de inscripciones con sesiones reales (EPT-62, RF16).
 *
 * No hay mocks: cada petición atraviesa cookies SSR, `auth.getUser()`, el
 * control de Dirección del servidor, las funciones RPC y PostgreSQL. Los
 * rechazos por cancelada, cerrada, inexistente o de otro dominio los produce la
 * base, no una comprobación previa de la aplicación.
 *
 * `psql` sobre el contenedor local se usa solo para PREPARAR datos (las
 * inscripciones que se van a confirmar o cancelar) y para VERIFICAR el estado
 * final de las filas; nunca participa de una operación que se esté verificando.
 * Las confirmaciones son de solo agregado: únicamente la limpieza local
 * deshabilita la guarda, dentro de su transacción. Lo que crea esta suite lleva
 * el DNI 962000NN o el prefijo «E2E Insc Adm» y se retira antes y después, así
 * que se puede volver a correr sin reiniciar la base.
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
  docente: 'tests/.auth/docente.json',
  padre: 'tests/.auth/padre.json',
  personal: 'tests/.auth/personal.json',
  sinPerfil: 'tests/.auth/sin-perfil.json',
  directoraBloqueada: 'tests/.auth/director-bloqueado.json',
  estudianteBloqueado: 'tests/.auth/estudiante-bloqueado.json',
}

const BASE_URL = 'http://localhost:3000'
const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

const SERVICIO_COMEDOR = 'e0000000-0000-4000-8000-000000000010'
const SERVICIO_TRANSPORTE = 'e0000000-0000-4000-8000-000000000020'
const INEXISTENTE = '00000000-0000-4000-8000-000000000000'
const DNI_DOCENTE_COMPARTIDO = '99900004'

const ALUMNO = {
  dni: '96200001',
  legajo: 'LEG-E2E-EPT62-1',
  nombre: 'Ines',
  apellido: 'Confirmable',
}
const PREFIJO = 'E2E Insc Adm'

type Dominio = 'matriculas' | 'deportes' | 'comedor' | 'transporte'
const DOMINIOS: Dominio[] = ['matriculas', 'deportes', 'comedor', 'transporte']

const contextosActivos: APIRequestContext[] = []

test.afterEach(async () => {
  await Promise.all(contextosActivos.splice(0).map((contexto) => contexto.dispose()))
})

// ----------------------------------------------------------------
// Preparación, verificación y limpieza (solo base local)
// ----------------------------------------------------------------

function sql(sentencia: string) {
  return execFileSync(
    'docker',
    [
      'exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1',
    ],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

const perfilAlumno = () => `(SELECT id FROM public.perfiles WHERE dni = '${ALUMNO.dni}')`

/** Retira las confirmaciones, inscripciones y el catálogo deportivo de esta suite. */
function limpiarInscripciones() {
  sql(`
    BEGIN;
    ALTER TABLE public.confirmaciones_inscripcion
      DISABLE TRIGGER proteger_confirmacion_inscripcion_antes_de_escribir;
    DELETE FROM public.confirmaciones_inscripcion
      WHERE matricula_id IN (SELECT id FROM public.matriculas WHERE alumno_id = ${perfilAlumno()})
         OR inscripcion_servicio_id IN (SELECT id FROM public.inscripciones_servicios WHERE alumno_id = ${perfilAlumno()})
         OR inscripcion_deportiva_id IN (SELECT id FROM public.inscripciones_deportivas WHERE alumno_id = ${perfilAlumno()});
    ALTER TABLE public.confirmaciones_inscripcion
      ENABLE TRIGGER proteger_confirmacion_inscripcion_antes_de_escribir;
    DELETE FROM public.inscripciones_servicios WHERE alumno_id = ${perfilAlumno()};
    DELETE FROM public.inscripciones_deportivas WHERE alumno_id = ${perfilAlumno()};
    COMMIT;
  `)
}

/** Retira además el grupo, el deporte y el legajo de prueba. */
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
  // El alumno se retira en una sola transacción: el invariante diferido rechaza
  // un alumno sin matrícula y una matrícula sin alumno por separado.
  sql(`
    BEGIN;
    DELETE FROM public.matriculas WHERE alumno_id = ${perfilAlumno()};
    DELETE FROM public.alumnos WHERE perfil_id = ${perfilAlumno()};
    ALTER TABLE public.perfiles_historial DISABLE TRIGGER impedir_modificar_historial_perfiles;
    DELETE FROM public.perfiles_historial WHERE perfil_id = ${perfilAlumno()};
    ALTER TABLE public.perfiles_historial ENABLE TRIGGER impedir_modificar_historial_perfiles;
    DELETE FROM public.perfiles WHERE dni = '${ALUMNO.dni}';
    COMMIT;
  `)
}

function cursoDeSalaDeCinco(): string {
  return sql(
    `SELECT id FROM public.cursos WHERE denominacion = 'Sala de 5' AND division = 'A';`
  )
}

function alumnoId(): string {
  return sql(`SELECT id FROM public.perfiles WHERE dni = '${ALUMNO.dni}';`)
}

function matriculaVigente(): string {
  return sql(
    `SELECT id FROM public.matriculas WHERE alumno_id = ${perfilAlumno()} AND fecha_cierre IS NULL;`
  )
}

function insertarServicio(servicioId: string): string {
  return sql(`
    INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id)
    VALUES (${perfilAlumno()}, '${servicioId}') RETURNING id;
  `).split('\n')[0]
}

function insertarDeportiva(grupoId: string): string {
  return sql(`
    INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id, deporte_id)
    SELECT ${perfilAlumno()}, g.id, g.deporte_id FROM public.grupos_deportivos g
    WHERE g.id = '${grupoId}' RETURNING id;
  `).split('\n')[0]
}

const TABLA = {
  matriculas: { tabla: 'matriculas', columna: 'matricula_id' },
  deportes: { tabla: 'inscripciones_deportivas', columna: 'inscripcion_deportiva_id' },
  comedor: { tabla: 'inscripciones_servicios', columna: 'inscripcion_servicio_id' },
  transporte: { tabla: 'inscripciones_servicios', columna: 'inscripcion_servicio_id' },
} as const

function cantidadConfirmaciones(dominio: Dominio, id: string): number {
  return Number(
    sql(
      `SELECT count(*) FROM public.confirmaciones_inscripcion WHERE ${TABLA[dominio].columna} = '${id}';`
    )
  )
}

function estadoDe(dominio: Dominio, id: string): string {
  if (dominio === 'matriculas') {
    return sql(
      `SELECT CASE WHEN fecha_cierre IS NULL THEN 'ACTIVA' ELSE 'CERRADA' END FROM public.matriculas WHERE id = '${id}';`
    )
  }
  return sql(`SELECT estado FROM public.${TABLA[dominio].tabla} WHERE id = '${id}';`)
}

function existeFila(dominio: Dominio, id: string): boolean {
  return sql(`SELECT count(*) FROM public.${TABLA[dominio].tabla} WHERE id = '${id}';`) === '1'
}

// ----------------------------------------------------------------
// Peticiones con sesión real
// ----------------------------------------------------------------

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

/** Fragmentos que jamás deben aparecer en una respuesta de esta API. */
const PROHIBIDOS = [
  'service_role',
  'sqlstate',
  'app_private',
  'postgres',
  'supabase',
  'confirmaciones_inscripcion',
  'inscripciones_servicios',
  'inscripciones_deportivas',
  'matriculas_administracion',
  'servicios_escolares',
  'select ',
  'insert into',
  ALUMNO.dni,
  ALUMNO.legajo.toLowerCase(),
  ALUMNO.apellido.toLowerCase(),
  '@ept.local',
]

/** Lee el cuerpo y exige que no filtre SQL, SQLSTATE, tablas, correos ni datos del alumno. */
async function leer(respuesta: APIResponse): Promise<any> {
  const texto = await respuesta.text()
  const minuscula = texto.toLowerCase()
  for (const fragmento of PROHIBIDOS) {
    expect(minuscula, `la respuesta filtra «${fragmento}»: ${texto}`).not.toContain(fragmento)
  }
  expect(texto, 'SQLSTATE propio en la respuesta').not.toMatch(/\bP6[0-9]{3}\b|\bP55[0-9]{2}\b/u)
  expect(respuesta.headers()['cache-control']).toBe('no-store')
  const cuerpo = JSON.parse(texto)
  if (typeof cuerpo.error === 'string') exigirMensajeSinDetalleTecnico('respuesta de la API', cuerpo.error)
  return cuerpo
}

const directora = (url: string, opciones?: EjecutarPeticion[1]) =>
  pedirConSesion(SESION.directora, url, opciones)

const confirmar = (dominio: string, id: string, sesion = SESION.directora, data?: unknown) =>
  pedirConSesion(sesion, `/api/inscripciones/${dominio}/${id}/confirmacion`, {
    method: 'POST',
    data,
  })

const cancelar = (dominio: string, id: string, sesion = SESION.directora, data?: unknown) =>
  pedirConSesion(sesion, `/api/inscripciones/${dominio}/${id}/cancelacion`, {
    method: 'POST',
    data,
  })

// ----------------------------------------------------------------
// Fixtures de la dirección
// ----------------------------------------------------------------

let grupoDeportivo = ''

/** Crea el legajo activo de prueba con la API real, o lo reutiliza si ya existe. */
async function asegurarAlumno() {
  const existente = sql(
    `SELECT a.estado FROM public.alumnos a JOIN public.perfiles p ON p.id = a.perfil_id WHERE p.dni = '${ALUMNO.dni}';`
  )
  if (existente === 'ACTIVO') return

  if (existente === 'INACTIVO') {
    const reactivar = await directora(`/api/alumnos/${alumnoId()}`, {
      method: 'PATCH',
      data: { accion: 'reactivar', curso_id: cursoDeSalaDeCinco() },
    })
    expect(reactivar.status(), await reactivar.text()).toBe(200)
    return
  }

  const alta = await directora('/api/alumnos', {
    method: 'POST',
    data: {
      nombre: ALUMNO.nombre,
      apellido: ALUMNO.apellido,
      dni: ALUMNO.dni,
      estado: 'ACTIVO',
      legajo_nro: ALUMNO.legajo,
      curso_id: cursoDeSalaDeCinco(),
    },
  })
  expect(alta.status(), await alta.text()).toBe(201)
}

/** Crea un grupo deportivo del nivel del alumno, con horario, por la API real. */
async function asegurarGrupo(): Promise<string> {
  const deporte = await directora('/api/deportes', {
    method: 'POST',
    data: { nombre: `${PREFIJO} Deporte` },
  })
  expect(deporte.status(), await deporte.text()).toBe(201)
  const deporteId = (await deporte.json()).deporte.id as string

  const nivel = sql(`SELECT id FROM public.niveles WHERE nombre = 'INICIAL';`)
  const docente = sql(`SELECT id FROM public.perfiles WHERE dni = '${DNI_DOCENTE_COMPARTIDO}';`)

  const grupo = await directora('/api/deportes/grupos', {
    method: 'POST',
    data: {
      deporte_id: deporteId,
      nivel_id: Number(nivel),
      nombre: `${PREFIJO} Grupo`,
      cupo: 5,
      profesor_id: docente,
    },
  })
  expect(grupo.status(), await grupo.text()).toBe(201)
  const grupoId = (await grupo.json()).grupo.id as string

  const franja = await directora(`/api/deportes/grupos/${grupoId}/horarios`, {
    method: 'POST',
    data: { dia_semana: 7, hora_inicio: '18:00', hora_fin: '19:00' },
  })
  expect(franja.status(), await franja.text()).toBe(201)
  return grupoId
}

/** Siembra una inscripción activa y devuelve su identificador. */
function sembrar(dominio: Dominio): string {
  switch (dominio) {
    case 'matriculas':
      return matriculaVigente()
    case 'deportes':
      return insertarDeportiva(grupoDeportivo)
    case 'comedor':
      return insertarServicio(SERVICIO_COMEDOR)
    case 'transporte':
      return insertarServicio(SERVICIO_TRANSPORTE)
  }
}

const DOMINIO_DE_REGISTRO = {
  matriculas: 'MATRICULA',
  deportes: 'DEPORTE',
  comedor: 'SERVICIO',
  transporte: 'SERVICIO',
} as const

// ================================================================
// DIRECTOR: la API real, regla por regla
// ================================================================
test.describe.serial('DIRECTOR autenticado — administración de inscripciones (API)', () => {
  test.beforeAll(async () => {
    limpiarTodo()
    await asegurarAlumno()
    grupoDeportivo = await asegurarGrupo()
  })

  test.beforeEach(() => {
    // Cada prueba parte sin inscripciones ni confirmaciones del alumno de prueba.
    limpiarInscripciones()
  })

  test.afterAll(() => {
    limpiarTodo()
  })

  for (const dominio of DOMINIOS) {
    test(`confirma ${dominio}, es idempotente y no cambia la vigencia`, async () => {
      const id = sembrar(dominio)

      const primera = await confirmar(dominio, id)
      expect(primera.status()).toBe(200)
      const uno = await leer(primera)
      expect(uno.ok).toBe(true)
      expect(uno.confirmacion.ya_confirmada).toBe(false)
      expect(uno.confirmacion.dominio).toBe(DOMINIO_DE_REGISTRO[dominio])
      expect(uno.confirmacion.inscripcion_id).toBe(id)
      expect(typeof uno.confirmacion.confirmada_por_nombre).toBe('string')
      expect(uno.confirmacion.confirmada_por_nombre.length).toBeGreaterThan(0)
      expect(Number.isNaN(Date.parse(uno.confirmacion.confirmada_en))).toBe(false)
      // Nada del alumno viaja en la respuesta.
      expect(Object.keys(uno.confirmacion).sort()).toEqual([
        'confirmada_en',
        'confirmada_por_nombre',
        'dominio',
        'inscripcion_id',
        'ya_confirmada',
      ])

      const segunda = await confirmar(dominio, id)
      expect(segunda.status()).toBe(200)
      const dos = await leer(segunda)
      expect(dos.confirmacion.ya_confirmada).toBe(true)
      // La primera fecha y la primera persona se conservan.
      expect(dos.confirmacion.confirmada_en).toBe(uno.confirmacion.confirmada_en)
      expect(dos.confirmacion.confirmada_por_nombre).toBe(uno.confirmacion.confirmada_por_nombre)

      expect(cantidadConfirmaciones(dominio, id)).toBe(1)
      // Confirmar no condiciona la vigencia: la inscripción sigue activa.
      expect(estadoDe(dominio, id)).toBe('ACTIVA')
    })
  }

  test('dos confirmaciones simultáneas dejan una sola marca', async () => {
    const id = sembrar('comedor')

    const [a, b] = await Promise.all([confirmar('comedor', id), confirmar('comedor', id)])
    // Ninguna falla: si una espera el bloqueo de la fila, encuentra la de la otra.
    expect([a.status(), b.status()]).toEqual([200, 200])
    const cuerpos = [await leer(a), await leer(b)]
    expect(cuerpos.filter((c) => c.confirmacion.ya_confirmada === false)).toHaveLength(1)
    expect(cuerpos[0].confirmacion.confirmada_en).toBe(cuerpos[1].confirmacion.confirmada_en)
    expect(cantidadConfirmaciones('comedor', id)).toBe(1)
  })

  for (const dominio of ['comedor', 'transporte', 'deportes'] as const) {
    test(`cancela ${dominio}, conserva la fila y rechaza repetir la baja`, async () => {
      const id = sembrar(dominio)

      const baja = await cancelar(dominio, id)
      expect(baja.status()).toBe(200)
      const cuerpo = await leer(baja)
      expect(cuerpo.ok).toBe(true)
      expect(cuerpo.inscripcion.id).toBe(id)
      expect(cuerpo.inscripcion.estado).toBe('CANCELADA')
      expect(typeof cuerpo.inscripcion.fecha_cancelacion).toBe('string')
      // Sin alumno, grupo ni servicio: solo lo mínimo.
      expect(Object.keys(cuerpo.inscripcion).sort()).toEqual(['estado', 'fecha_cancelacion', 'id'])

      // Baja lógica: la fila existe y quedó cancelada; no se borró nada.
      expect(existeFila(dominio, id)).toBe(true)
      expect(estadoDe(dominio, id)).toBe('CANCELADA')

      const repetida = await cancelar(dominio, id)
      expect(repetida.status()).toBe(409)
      const rechazo = await leer(repetida)
      expect(rechazo.error).toBe('Esa inscripción ya estaba cancelada.')
      expect(rechazo.codigo).toBe('INSCRIPCION_YA_CANCELADA')
    })
  }

  for (const dominio of ['comedor', 'transporte', 'deportes'] as const) {
    test(`no confirma ${dominio} cancelada, pero la confirmación previa persiste tras cancelar`, async () => {
      const id = sembrar(dominio)

      expect((await confirmar(dominio, id)).status()).toBe(200)
      expect((await cancelar(dominio, id)).status()).toBe(200)

      // La marca histórica se conserva aunque la inscripción quede cancelada.
      expect(cantidadConfirmaciones(dominio, id)).toBe(1)

      const tardia = await confirmar(dominio, id)
      expect(tardia.status()).toBe(409)
      const cuerpo = await leer(tardia)
      expect(cuerpo.error).toBe('La inscripción está cancelada y no puede confirmarse.')
      expect(cuerpo.codigo).toBe('INSCRIPCION_NO_VIGENTE')
      expect(cantidadConfirmaciones(dominio, id)).toBe(1)
    })
  }

  test('confirmar una inscripción cancelada sin confirmación previa no crea ninguna marca', async () => {
    const id = sembrar('transporte')
    expect((await cancelar('transporte', id)).status()).toBe(200)

    const respuesta = await confirmar('transporte', id)
    expect(respuesta.status()).toBe(409)
    await leer(respuesta)
    expect(cantidadConfirmaciones('transporte', id)).toBe(0)
  })

  test('una matrícula cerrada no se confirma y su confirmación previa persiste', async () => {
    const cerrada = matriculaVigente()
    expect((await confirmar('matriculas', cerrada)).status()).toBe(200)

    // El cierre es el flujo vigente de Alumnos: inactivar cierra la matrícula.
    const inactivar = await directora(`/api/alumnos/${alumnoId()}`, {
      method: 'PATCH',
      data: { accion: 'inactivar' },
    })
    expect(inactivar.status(), await inactivar.text()).toBe(200)
    expect(estadoDe('matriculas', cerrada)).toBe('CERRADA')
    expect(cantidadConfirmaciones('matriculas', cerrada)).toBe(1)

    const tardia = await confirmar('matriculas', cerrada)
    expect(tardia.status()).toBe(409)
    const cuerpo = await leer(tardia)
    expect(cuerpo.error).toBe('La matrícula ya está cerrada y no puede confirmarse.')

    // Se deja al alumno activo de nuevo para el resto de las pruebas.
    const reactivar = await directora(`/api/alumnos/${alumnoId()}`, {
      method: 'PATCH',
      data: { accion: 'reactivar', curso_id: cursoDeSalaDeCinco() },
    })
    expect(reactivar.status(), await reactivar.text()).toBe(200)
  })

  test('una matrícula no se cancela: 400 con el motivo y sin tocar la matrícula', async () => {
    const id = matriculaVigente()

    const respuesta = await cancelar('matriculas', id)
    expect(respuesta.status()).toBe(400)
    const cuerpo = await leer(respuesta)
    expect(cuerpo.codigo).toBe('MATRICULA_NO_SE_CANCELA')
    expect(cuerpo.error).toContain('inactivá al alumno')
    expect(cuerpo.error).toContain('cambiale el curso')
    expect(cuerpo.error).toContain('Alumnos')

    // Ni simulada ni real: la matrícula sigue vigente.
    expect(estadoDe('matriculas', id)).toBe('ACTIVA')

    // Tampoco se simula con un identificador inexistente.
    const inexistente = await cancelar('matriculas', INEXISTENTE)
    expect(inexistente.status()).toBe(400)
    expect((await leer(inexistente)).codigo).toBe('MATRICULA_NO_SE_CANCELA')
  })

  test('un identificador inexistente responde 404 en cada dominio', async () => {
    for (const dominio of DOMINIOS) {
      const confirmacion = await confirmar(dominio, INEXISTENTE)
      expect(confirmacion.status(), `confirmar ${dominio}`).toBe(404)
      const cuerpo = await leer(confirmacion)
      expect(cuerpo.codigo).toBe('INSCRIPCION_NO_ENCONTRADA')
      expect(cuerpo.campo).toBe('id')
    }
    for (const dominio of ['comedor', 'transporte', 'deportes'] as const) {
      const baja = await cancelar(dominio, INEXISTENTE)
      expect(baja.status(), `cancelar ${dominio}`).toBe(404)
      expect((await leer(baja)).codigo).toBe('INSCRIPCION_NO_ENCONTRADA')
    }
  })

  test('un identificador de otro dominio responde igual que uno inexistente y no se toca', async () => {
    const comedor = sembrar('comedor')
    const transporte = sembrar('transporte')
    const deportiva = sembrar('deportes')
    const matricula = matriculaVigente()

    const cruces: { dominio: Dominio; id: string; propio: Dominio }[] = [
      { dominio: 'transporte', id: comedor, propio: 'comedor' },
      { dominio: 'comedor', id: transporte, propio: 'transporte' },
      { dominio: 'deportes', id: comedor, propio: 'comedor' },
      { dominio: 'comedor', id: deportiva, propio: 'deportes' },
      { dominio: 'matriculas', id: transporte, propio: 'transporte' },
      { dominio: 'transporte', id: matricula, propio: 'matriculas' },
    ]

    for (const { dominio, id, propio } of cruces) {
      const confirmacion = await confirmar(dominio, id)
      const referencia = await confirmar(dominio, INEXISTENTE)
      expect(confirmacion.status(), `confirmar ${id} como ${dominio}`).toBe(404)
      expect(await leer(confirmacion)).toEqual(await leer(referencia))
      expect(cantidadConfirmaciones(propio, id)).toBe(0)

      if (dominio !== 'matriculas') {
        const baja = await cancelar(dominio, id)
        const bajaReferencia = await cancelar(dominio, INEXISTENTE)
        expect(baja.status(), `cancelar ${id} como ${dominio}`).toBe(404)
        expect(await leer(baja)).toEqual(await leer(bajaReferencia))
        // La inscripción del otro dominio sigue activa: no se canceló nada.
        expect(estadoDe(propio, id)).toBe('ACTIVA')
      }
    }
  })

  test('rechaza un identificador o un dominio inválido con 400 y el campo en falta', async () => {
    const idInvalido = await confirmar('comedor', 'no-es-un-uuid')
    expect(idInvalido.status()).toBe(400)
    const a = await leer(idInvalido)
    expect(a.campo).toBe('id')
    expect(a.error).toBe('Identificador de inscripción inválido')

    const cancelacionInvalida = await cancelar('deportes', '123')
    expect(cancelacionInvalida.status()).toBe(400)
    expect((await leer(cancelacionInvalida)).campo).toBe('id')

    for (const dominio of ['becas', 'COMEDOR', 'servicios', 'matricula']) {
      const respuesta = await confirmar(dominio, INEXISTENTE)
      expect(respuesta.status(), dominio).toBe(400)
      const cuerpo = await leer(respuesta)
      expect(cuerpo.campo).toBe('dominio')
      expect(cuerpo.error).toBe('Dominio de inscripción inválido')

      const baja = await cancelar(dominio, INEXISTENTE)
      expect(baja.status(), dominio).toBe(400)
      expect((await leer(baja)).campo).toBe('dominio')
    }
  })

  test('el cuerpo se ignora: un alumno, un rol o un actor enviados no cambian sobre qué se opera', async () => {
    const id = sembrar('comedor')
    const otro = sembrar('transporte')

    const respuesta = await confirmar('comedor', id, SESION.directora, {
      alumno_id: alumnoId(),
      inscripcion_id: otro,
      rol: 'ESTUDIANTE',
      actor: alumnoId(),
      confirmada_por: alumnoId(),
    })
    expect(respuesta.status()).toBe(200)
    const cuerpo = await leer(respuesta)
    expect(cuerpo.confirmacion.inscripcion_id).toBe(id)
    expect(cantidadConfirmaciones('comedor', id)).toBe(1)
    // La inscripción que el cuerpo intentó colar no se tocó.
    expect(cantidadConfirmaciones('transporte', otro)).toBe(0)

    // El actor es quien tiene la sesión, no quien dice el cuerpo.
    const actor = sql(`
      SELECT p.nombre || ' ' || p.apellido FROM public.confirmaciones_inscripcion c
      JOIN public.perfiles p ON p.id = c.confirmada_por
      WHERE c.inscripcion_servicio_id = '${id}';
    `)
    expect(cuerpo.confirmacion.confirmada_por_nombre).toBe(actor)
    expect(actor).not.toContain(ALUMNO.apellido)

    // Un cuerpo que no es JSON tampoco cambia nada.
    const malformado = await pedirConSesion(
      SESION.directora,
      `/api/inscripciones/transporte/${otro}/cancelacion`,
      { method: 'POST', data: '{', headers: { 'Content-Type': 'application/json' } }
    )
    expect(malformado.status()).toBe(200)
    await leer(malformado)
    expect(estadoDe('transporte', otro)).toBe('CANCELADA')
  })

  test('los actores sin permiso reciben 403 sobre inscripciones reales y no cambia nada', async () => {
    const servicio = sembrar('comedor')
    const deportiva = sembrar('deportes')
    const matricula = matriculaVigente()

    const actores = [
      { sesion: SESION.estudiante, bloqueado: false },
      { sesion: SESION.padre, bloqueado: false },
      { sesion: SESION.docente, bloqueado: false },
      { sesion: SESION.personal, bloqueado: false },
      { sesion: SESION.sinPerfil, bloqueado: false },
      { sesion: SESION.directoraBloqueada, bloqueado: true },
      { sesion: SESION.estudianteBloqueado, bloqueado: true },
    ]

    for (const { sesion, bloqueado } of actores) {
      for (const [dominio, id] of [
        ['comedor', servicio],
        ['deportes', deportiva],
        ['matriculas', matricula],
      ] as const) {
        for (const operar of [confirmar, cancelar]) {
          const respuesta = await operar(dominio, id, sesion)
          expect(respuesta.status(), `${sesion} ${dominio}`).toBe(403)
          const cuerpo = await leer(respuesta)
          if (bloqueado) {
            expect(cuerpo.codigo).toBe('ACCESO_BLOQUEADO')
            expect(cuerpo.error).toBe('Tu acceso está bloqueado. Comunicate con Dirección.')
          } else {
            expect(cuerpo.error).toBe('Solo Dirección puede administrar las inscripciones.')
          }
        }
      }
    }

    expect(cantidadConfirmaciones('comedor', servicio)).toBe(0)
    expect(cantidadConfirmaciones('deportes', deportiva)).toBe(0)
    expect(cantidadConfirmaciones('matriculas', matricula)).toBe(0)
    expect(estadoDe('comedor', servicio)).toBe('ACTIVA')
    expect(estadoDe('deportes', deportiva)).toBe('ACTIVA')
    expect(estadoDe('matriculas', matricula)).toBe('ACTIVA')
  })

  test('un actor sin permiso recibe 403 antes de saber si el identificador o el dominio existen', async () => {
    const respuesta = await confirmar('no-es-un-dominio', 'no-es-un-uuid', SESION.estudiante)
    expect(respuesta.status()).toBe(403)
    const cuerpo = await leer(respuesta)
    expect(cuerpo.campo).toBeUndefined()
  })
})

// ================================================================
// El resto de los actores. Cada bloque corre con la sesión del proyecto que le
// corresponde, de modo que la denegación se prueba con la identidad que
// realmente debe ser rechazada y no con una simulación.
// ================================================================
for (const actor of [
  { etiqueta: 'ESTUDIANTE', sesion: SESION.estudiante },
  { etiqueta: 'DOCENTE', sesion: SESION.docente },
  { etiqueta: 'PADRE', sesion: SESION.padre },
  { etiqueta: 'PERSONAL', sesion: SESION.personal },
  { etiqueta: 'SIN PERFIL', sesion: SESION.sinPerfil },
]) {
  test.describe(`${actor.etiqueta} autenticado — administración de inscripciones`, () => {
    for (const dominio of DOMINIOS) {
      test(`recibe 403 al confirmar o cancelar ${dominio}, sin filtrar detalle técnico`, async () => {
        for (const operar of [confirmar, cancelar]) {
          const respuesta = await operar(dominio, INEXISTENTE, actor.sesion)
          expect(respuesta.status()).toBe(403)
          const cuerpo = await leer(respuesta)
          expect(cuerpo.error).toBe('Solo Dirección puede administrar las inscripciones.')
        }
      })
    }
  })
}

for (const actor of [
  { etiqueta: 'DIRECTOR BLOQUEADO', sesion: SESION.directoraBloqueada },
  { etiqueta: 'ESTUDIANTE BLOQUEADO', sesion: SESION.estudianteBloqueado },
]) {
  test.describe(`${actor.etiqueta} autenticado — administración de inscripciones`, () => {
    for (const dominio of DOMINIOS) {
      test(`recibe 403 ACCESO_BLOQUEADO al confirmar o cancelar ${dominio}`, async () => {
        for (const operar of [confirmar, cancelar]) {
          const respuesta = await operar(dominio, INEXISTENTE, actor.sesion)
          expect(respuesta.status()).toBe(403)
          const cuerpo = await leer(respuesta)
          expect(cuerpo.codigo).toBe('ACCESO_BLOQUEADO')
          expect(cuerpo.error).toBe('Tu acceso está bloqueado. Comunicate con Dirección.')
        }
      })
    }
  })
}
