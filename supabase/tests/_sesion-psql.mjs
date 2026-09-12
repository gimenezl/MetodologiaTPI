import { spawn } from 'node:child_process'

/**
 * Arnés de concurrencia con conexiones PostgreSQL reales.
 *
 * Cada `SesionPsql` es un proceso `psql` independiente, de modo que dos sesiones
 * compiten de verdad por los bloqueos de fila. La coordinación es determinista:
 * `esperarBloqueo` consulta `pg_blocking_pids` hasta comprobar que una sesión
 * está efectivamente esperando a la otra. No se usan esperas por tiempo, que
 * darían una prueba que pasa o falla según la carga de la máquina.
 *
 * Lo comparten `niveles_concurrencia.mjs` (EPT-55) y
 * `alumnos_academicos_concurrencia.mjs` (EPT-9).
 */

const CONTENEDOR =
  process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
const ESPERA_MAXIMA_MS = 30_000

let secuencia = 0

export function conLimite(promesa, descripcion) {
  let temporizador
  const limite = new Promise((_, reject) => {
    temporizador = setTimeout(
      () => reject(new Error(`Tiempo agotado esperando ${descripcion}`)),
      ESPERA_MAXIMA_MS
    )
  })
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador))
}

export class SesionPsql {
  constructor(nombre, prefijoMarcador = 'EPT') {
    this.nombre = nombre
    this.prefijoMarcador = prefijoMarcador
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
    const marcador = `__${this.prefijoMarcador}_${this.nombre}_${etiqueta}_${secuencia++}__`
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

/**
 * Espera hasta comprobar que `bloqueado` está efectivamente detenido por
 * `bloqueador`. Es lo que hace determinista el orden de las dos transacciones.
 */
export async function esperarBloqueo(sesion, bloqueador, bloqueado) {
  for (let intento = 0; intento < 1_000; intento += 1) {
    const bloqueadoPorSesion = await sesion.escalar(
      `pg_catalog.pg_blocking_pids(${bloqueado}) @> ARRAY[${bloqueador}]::integer[]`,
      `bloqueo_${intento}`
    )
    if (bloqueadoPorSesion === 'true') return
  }
  throw new Error(`La sesión ${bloqueado} no quedó bloqueada por ${bloqueador}`)
}
