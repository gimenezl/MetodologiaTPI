import { spawn } from 'node:child_process'

const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
const ESPERA_MAXIMA_MS = 30_000

let secuencia = 0

function conLimite(promesa, descripcion) {
  let temporizador
  const limite = new Promise((_, reject) => {
    temporizador = setTimeout(
      () => reject(new Error(`Tiempo agotado esperando ${descripcion}`)),
      ESPERA_MAXIMA_MS
    )
  })
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador))
}

class SesionPsql {
  constructor(nombre) {
    this.nombre = nombre
    this.salida = ''
    this.error = ''
    this.esperas = new Map()
    this.proceso = spawn(
      'docker',
      [
        'exec',
        '-i',
        CONTENEDOR,
        'psql',
        '-X',
        '-q',
        '-A',
        '-t',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )

    this.proceso.stdout.setEncoding('utf8')
    this.proceso.stderr.setEncoding('utf8')
    this.proceso.stdout.on('data', (fragmento) => {
      this.salida += fragmento
      this.revisarMarcadores()
    })
    this.proceso.stderr.on('data', (fragmento) => {
      this.error += fragmento
    })
    this.proceso.on('exit', (codigo) => {
      if (codigo === 0) return
      const error = new Error(
        `${this.nombre} terminó con código ${codigo}: ${this.error.trim()}`
      )
      for (const espera of this.esperas.values()) espera.reject(error)
      this.esperas.clear()
    })
  }

  revisarMarcadores() {
    for (const [marcador, espera] of this.esperas) {
      const posicion = this.salida.indexOf(marcador, espera.inicio)
      if (posicion === -1) continue
      this.esperas.delete(marcador)
      espera.resolve(this.salida.slice(espera.inicio, posicion))
    }
  }

  ejecutar(sql, etiqueta) {
    const marcador = `__EPT55_${this.nombre}_${etiqueta}_${secuencia++}__`
    const inicio = this.salida.length
    const resultado = new Promise((resolve, reject) => {
      this.esperas.set(marcador, { inicio, resolve, reject })
    })
    this.proceso.stdin.write(`${sql}\n\\echo ${marcador}\n`)
    return conLimite(resultado, `${this.nombre}/${etiqueta}`)
  }

  async escalar(expresion, etiqueta) {
    const prefijo = `__VALOR_${secuencia++}__`
    const salida = await this.ejecutar(
      `SELECT '${prefijo}' || COALESCE((${expresion})::text, '<NULL>');`,
      etiqueta
    )
    const linea = salida
      .split(/\r?\n/u)
      .find((candidata) => candidata.startsWith(prefijo))
    if (!linea) {
      throw new Error(`No se recibió el valor de ${this.nombre}/${etiqueta}: ${salida}`)
    }
    return linea.slice(prefijo.length)
  }

  async cerrar() {
    if (this.proceso.exitCode !== null) return
    const cerrado = new Promise((resolve) => this.proceso.once('exit', resolve))
    this.proceso.stdin.end('\\q\n')
    await conLimite(cerrado, `cierre de ${this.nombre}`)
  }
}

async function esperarBloqueo(sesion, bloqueador, bloqueado) {
  for (let intento = 0; intento < 1_000; intento += 1) {
    const bloqueadoPorSesion = await sesion.escalar(
      `pg_catalog.pg_blocking_pids(${bloqueado}) @> ARRAY[${bloqueador}]::integer[]`,
      `bloqueo_${intento}`
    )
    if (bloqueadoPorSesion === 'true') return
  }
  throw new Error(`La sesión ${bloqueado} no quedó bloqueada por ${bloqueador}`)
}

function insercion(tipo, nivelId, sufijo) {
  if (tipo === 'cursos') {
    return `INSERT INTO public.cursos (nivel_id, denominacion, division)
            VALUES (${nivelId}, 'Concurrencia EPT-55 ${sufijo}', 'C')`
  }
  return `INSERT INTO public.actividades (nombre, tipo, cupo_maximo, nivel_id)
          VALUES ('Concurrencia EPT-55 ${sufijo}', 'TALLER', 20, ${nivelId})`
}

function borrado(tipo, sufijo) {
  if (tipo === 'cursos') {
    return `DELETE FROM public.cursos WHERE denominacion = 'Concurrencia EPT-55 ${sufijo}'`
  }
  return `DELETE FROM public.actividades WHERE nombre = 'Concurrencia EPT-55 ${sufijo}'`
}

function conteo(tipo, sufijo) {
  if (tipo === 'cursos') {
    return `SELECT pg_catalog.count(*) FROM public.cursos
            WHERE denominacion = 'Concurrencia EPT-55 ${sufijo}'`
  }
  return `SELECT pg_catalog.count(*) FROM public.actividades
          WHERE nombre = 'Concurrencia EPT-55 ${sufijo}'`
}

async function probarAsignacionPrimero(sesionA, sesionB, pids, nivelId, tipo) {
  const sufijo = `${tipo} asignación primero`
  await sesionA.ejecutar(
    `UPDATE public.niveles SET activo = TRUE WHERE id = ${nivelId};
     ${borrado(tipo, sufijo)};
     BEGIN;
     ${insercion(tipo, nivelId, sufijo)};`,
    `${tipo}_asignacion_preparada`
  )

  const inactivacion = sesionB.ejecutar(
    `UPDATE public.niveles SET activo = FALSE WHERE id = ${nivelId};`,
    `${tipo}_inactivacion_pendiente`
  )
  await esperarBloqueo(sesionA, pids.a, pids.b)
  await sesionA.ejecutar('COMMIT;', `${tipo}_confirmar_asignacion`)
  await inactivacion

  const relaciones = await sesionA.escalar(
    `(${conteo(tipo, sufijo)})`,
    `${tipo}_verificar_historia`
  )
  const activo = await sesionA.escalar(
    `(SELECT activo FROM public.niveles WHERE id = ${nivelId})`,
    `${tipo}_verificar_inactivo`
  )
  if (relaciones !== '1' || activo !== 'false') {
    throw new Error(`${tipo}: la asignación ganadora no quedó como historia inactiva`)
  }
  console.log(`OK CONCURRENCIA ${tipo}: asignación primero conserva historia`)
}

async function probarInactivacionPrimero(sesionA, sesionB, pids, nivelId, tipo) {
  const sufijo = `${tipo} inactivación primero`
  await sesionA.ejecutar(
    `${borrado(tipo, sufijo)};
     UPDATE public.niveles SET activo = TRUE WHERE id = ${nivelId};
     BEGIN;
     UPDATE public.niveles SET activo = FALSE WHERE id = ${nivelId};`,
    `${tipo}_inactivacion_preparada`
  )

  const asignacion = sesionB.ejecutar(
    `DO $prueba$
     BEGIN
       BEGIN
         ${insercion(tipo, nivelId, sufijo)};
         RAISE EXCEPTION 'La asignación concurrente debía rechazarse';
       EXCEPTION WHEN SQLSTATE 'P5504' THEN
         NULL;
       END;
     END
     $prueba$;`,
    `${tipo}_asignacion_pendiente`
  )
  await esperarBloqueo(sesionA, pids.a, pids.b)
  await sesionA.ejecutar('COMMIT;', `${tipo}_confirmar_inactivacion`)
  await asignacion

  const relaciones = await sesionA.escalar(
    `(${conteo(tipo, sufijo)})`,
    `${tipo}_verificar_rechazo`
  )
  if (relaciones !== '0') {
    throw new Error(`${tipo}: se persistió una asignación después de la inactivación`)
  }
  console.log(`OK CONCURRENCIA ${tipo}: inactivación primero rechaza P5504`)
}

const sesionA = new SesionPsql('A')
const sesionB = new SesionPsql('B')

try {
  const pidA = Number(await sesionA.escalar('pg_catalog.pg_backend_pid()', 'pid'))
  const pidB = Number(await sesionB.escalar('pg_catalog.pg_backend_pid()', 'pid'))

  await sesionA.ejecutar(
    `DELETE FROM public.cursos WHERE denominacion LIKE 'Concurrencia EPT-55%';
     DELETE FROM public.actividades WHERE nombre LIKE 'Concurrencia EPT-55%';
     DELETE FROM public.niveles WHERE nombre = 'CONCURRENCIA EPT-55';
     INSERT INTO public.niveles (nombre, activo, orden, es_institucional)
     VALUES ('CONCURRENCIA EPT-55', TRUE, 990000, FALSE);`,
    'preparar_fixture'
  )
  const nivelId = Number(
    await sesionA.escalar(
      `(SELECT id FROM public.niveles WHERE nombre = 'CONCURRENCIA EPT-55')`,
      'nivel_id'
    )
  )
  const pids = { a: pidA, b: pidB }

  for (const tipo of ['cursos', 'actividades']) {
    await probarAsignacionPrimero(sesionA, sesionB, pids, nivelId, tipo)
    await probarInactivacionPrimero(sesionA, sesionB, pids, nivelId, tipo)
  }

  await sesionA.ejecutar(
    `DELETE FROM public.cursos WHERE denominacion LIKE 'Concurrencia EPT-55%';
     DELETE FROM public.actividades WHERE nombre LIKE 'Concurrencia EPT-55%';
     DELETE FROM public.niveles WHERE id = ${nivelId};`,
    'limpiar_fixture'
  )
} finally {
  await Promise.allSettled([sesionA.ejecutar('ROLLBACK;', 'rollback'), sesionB.ejecutar('ROLLBACK;', 'rollback')])
  await Promise.allSettled([sesionA.cerrar(), sesionB.cerrar()])
}
