// Almacenamiento cifrado de la sesión sobre expo-secure-store (Keychain en iOS, Keystore en Android).
//
// Una sesión de Supabase puede superar el límite práctico de ~2 KB por entrada, así que el valor lógico se
// divide en fragmentos y cada fragmento se guarda cifrado por la plataforma. No hay criptografía propia ni
// texto plano: el único cifrado es el del sistema operativo.
//
// Atomicidad: los fragmentos se escriben bajo una generación nueva y la entrada «manifiesto» se escribe al
// final. Hasta que el manifiesto cambia, el valor anterior sigue siendo íntegro. Un fallo parcial deja la
// versión previa y limpia los fragmentos nuevos.
//
// Los errores nunca incluyen el valor ni la clave de sesión: solo un código.
import * as SecureStore from 'expo-secure-store'

export type CodigoErrorAlmacenamiento = 'LECTURA_FALLIDA' | 'ESCRITURA_FALLIDA' | 'BORRADO_FALLIDO'

export class ErrorAlmacenamiento extends Error {
  readonly codigo: CodigoErrorAlmacenamiento
  constructor(codigo: CodigoErrorAlmacenamiento) {
    super(`Error de almacenamiento seguro: ${codigo}`)
    this.name = 'ErrorAlmacenamiento'
    this.codigo = codigo
  }
}

export interface AlmacenamientoSeguro {
  getItem(clave: string): Promise<string | null>
  setItem(clave: string, valor: string): Promise<void>
  removeItem(clave: string): Promise<void>
}

export interface OpcionesAlmacenamiento {
  /** Bytes UTF-8 máximos por fragmento. Debe quedar holgado bajo el límite de la plataforma. */
  bytesPorFragmento?: number
  /** Observador de códigos (nunca de valores). Permite métricas sin filtrar credenciales. */
  alFallar?: (codigo: CodigoErrorAlmacenamiento) => void
}

const VERSION = 1
const PREFIJO = 'ept'
const MAXIMO_FRAGMENTOS = 64

interface Manifiesto {
  v: number
  /** Generación: identifica el conjunto de fragmentos vigente. */
  g: string
  /** Cantidad de fragmentos. */
  n: number
  /** Longitud total del valor en unidades UTF-16. */
  l: number
  /** Suma de verificación del valor completo. */
  c: string
}

export function longitudUtf8(codigoPunto: number): number {
  if (codigoPunto < 0x80) return 1
  if (codigoPunto < 0x800) return 2
  if (codigoPunto < 0x10000) return 3
  return 4
}

/** Divide por puntos de código sin partir pares sustitutos ni exceder `maxBytes` por fragmento. */
export function dividirPorBytes(valor: string, maxBytes: number): string[] {
  if (maxBytes < 4) throw new RangeError('maxBytes debe ser al menos 4')
  const partes: string[] = []
  let actual = ''
  let bytes = 0
  for (const caracter of valor) {
    const largo = longitudUtf8(caracter.codePointAt(0) ?? 0)
    if (bytes + largo > maxBytes) {
      partes.push(actual)
      actual = ''
      bytes = 0
    }
    actual += caracter
    bytes += largo
  }
  if (actual.length > 0 || partes.length === 0) partes.push(actual)
  return partes
}

/** FNV-1a de 32 bits: detecta corrupción accidental. No es una función de seguridad. */
export function sumaDeVerificacion(texto: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function claveSegura(clave: string): string {
  return `${PREFIJO}.${clave.replace(/[^A-Za-z0-9._-]/gu, '_')}`
}

function esManifiesto(valor: unknown): valor is Manifiesto {
  if (typeof valor !== 'object' || valor === null) return false
  const m = valor as Record<string, unknown>
  return (
    m.v === VERSION &&
    typeof m.g === 'string' &&
    /^[A-Za-z0-9]{1,40}$/u.test(m.g) &&
    Number.isInteger(m.n) &&
    (m.n as number) >= 1 &&
    (m.n as number) <= MAXIMO_FRAGMENTOS &&
    Number.isInteger(m.l) &&
    (m.l as number) >= 0 &&
    typeof m.c === 'string'
  )
}

export function crearAlmacenamientoSeguro(opciones: OpcionesAlmacenamiento = {}): AlmacenamientoSeguro {
  const bytesPorFragmento = opciones.bytesPorFragmento ?? 1500
  const colas = new Map<string, Promise<unknown>>()
  let contador = 0

  const manifiestoDe = (clave: string) => `${claveSegura(clave)}.m`
  const fragmentoDe = (clave: string, generacion: string, indice: number) => `${claveSegura(clave)}.${generacion}.${indice}`
  const nuevaGeneracion = () =>
    `${Date.now().toString(36)}${(contador++).toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`

  // Serializa las operaciones por clave: dos setItem concurrentes no intercalan fragmentos.
  function enCola<T>(clave: string, tarea: () => Promise<T>): Promise<T> {
    const anterior = colas.get(clave) ?? Promise.resolve()
    const siguiente = anterior.then(tarea, tarea)
    const marcador = siguiente.catch(() => undefined)
    colas.set(clave, marcador)
    void marcador.then(() => {
      if (colas.get(clave) === marcador) colas.delete(clave)
    })
    return siguiente
  }

  async function borrarSilencioso(claves: string[]): Promise<void> {
    await Promise.all(claves.map(k => SecureStore.deleteItemAsync(k).catch(() => undefined)))
  }

  async function leerManifiesto(clave: string): Promise<Manifiesto | null | 'corrupto'> {
    let crudo: string | null
    try {
      crudo = await SecureStore.getItemAsync(manifiestoDe(clave))
    } catch {
      opciones.alFallar?.('LECTURA_FALLIDA')
      throw new ErrorAlmacenamiento('LECTURA_FALLIDA')
    }
    if (crudo === null) return null
    try {
      const analizado: unknown = JSON.parse(crudo)
      return esManifiesto(analizado) ? analizado : 'corrupto'
    } catch {
      return 'corrupto'
    }
  }

  async function purgar(clave: string, manifiesto: Manifiesto | null): Promise<void> {
    const claves = [manifiestoDe(clave)]
    if (manifiesto) for (let i = 0; i < manifiesto.n; i++) claves.push(fragmentoDe(clave, manifiesto.g, i))
    await borrarSilencioso(claves)
  }

  async function leer(clave: string): Promise<string | null> {
    const manifiesto = await leerManifiesto(clave)
    if (manifiesto === null) return null
    if (manifiesto === 'corrupto') {
      await purgar(clave, null)
      return null
    }
    const partes: string[] = []
    for (let i = 0; i < manifiesto.n; i++) {
      let parte: string | null
      try {
        parte = await SecureStore.getItemAsync(fragmentoDe(clave, manifiesto.g, i))
      } catch {
        // Un fallo nativo no prueba que el dato esté dañado (p. ej. almacén bloqueado): no se purga.
        opciones.alFallar?.('LECTURA_FALLIDA')
        throw new ErrorAlmacenamiento('LECTURA_FALLIDA')
      }
      if (parte === null) {
        await purgar(clave, manifiesto)
        return null
      }
      partes.push(parte)
    }
    const valor = partes.join('')
    if (valor.length !== manifiesto.l || sumaDeVerificacion(valor) !== manifiesto.c) {
      await purgar(clave, manifiesto)
      return null
    }
    return valor
  }

  async function escribir(clave: string, valor: string): Promise<void> {
    const partes = dividirPorBytes(valor, bytesPorFragmento)
    if (partes.length > MAXIMO_FRAGMENTOS) {
      opciones.alFallar?.('ESCRITURA_FALLIDA')
      throw new ErrorAlmacenamiento('ESCRITURA_FALLIDA')
    }
    let previo: Manifiesto | null = null
    try {
      const m = await leerManifiesto(clave)
      previo = m === 'corrupto' ? null : m
    } catch {
      previo = null // un manifiesto ilegible no impide guardar uno nuevo
    }
    const generacion = nuevaGeneracion()
    const escritos: string[] = []
    try {
      for (let i = 0; i < partes.length; i++) {
        const destino = fragmentoDe(clave, generacion, i)
        await SecureStore.setItemAsync(destino, partes[i] ?? '')
        escritos.push(destino)
      }
      const manifiesto: Manifiesto = {
        v: VERSION,
        g: generacion,
        n: partes.length,
        l: valor.length,
        c: sumaDeVerificacion(valor),
      }
      await SecureStore.setItemAsync(manifiestoDe(clave), JSON.stringify(manifiesto))
    } catch {
      await borrarSilencioso(escritos)
      opciones.alFallar?.('ESCRITURA_FALLIDA')
      throw new ErrorAlmacenamiento('ESCRITURA_FALLIDA')
    }
    if (previo) {
      const viejos: string[] = []
      for (let i = 0; i < previo.n; i++) viejos.push(fragmentoDe(clave, previo.g, i))
      await borrarSilencioso(viejos)
    }
  }

  async function borrar(clave: string): Promise<void> {
    let manifiesto: Manifiesto | null = null
    try {
      const m = await leerManifiesto(clave)
      manifiesto = m === 'corrupto' ? null : m
    } catch {
      manifiesto = null
    }
    try {
      // El manifiesto va primero: desde ahí el valor lógico ya no existe aunque queden fragmentos.
      await SecureStore.deleteItemAsync(manifiestoDe(clave))
    } catch {
      opciones.alFallar?.('BORRADO_FALLIDO')
      throw new ErrorAlmacenamiento('BORRADO_FALLIDO')
    }
    if (manifiesto) {
      const claves: string[] = []
      for (let i = 0; i < manifiesto.n; i++) claves.push(fragmentoDe(clave, manifiesto.g, i))
      await borrarSilencioso(claves)
    }
  }

  return {
    getItem: clave => enCola(clave, () => leer(clave)),
    setItem: (clave, valor) => enCola(clave, () => escribir(clave, valor)),
    removeItem: clave => enCola(clave, () => borrar(clave)),
  }
}
