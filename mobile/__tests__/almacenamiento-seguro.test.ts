import * as SecureStore from 'expo-secure-store'

import {
  crearAlmacenamientoSeguro,
  dividirPorBytes,
  ErrorAlmacenamiento,
  longitudUtf8,
  sumaDeVerificacion,
} from '@/servicios/almacenamiento-seguro'

// Doble en mockMemoria de expo-secure-store que reproduce el límite práctico por entrada y permite inyectar mockFallos.
const MOCK_LIMITE_BYTES = 2048
const mockMemoria = new Map<string, string>()
const mockFallos = {
  alEscribir: null as null | ((clave: string, escritura: number) => boolean),
  alLeer: null as null | ((clave: string) => boolean),
  escrituras: 0,
}

function mockBytesUtf8(texto: string): number {
  let total = 0
  for (const c of texto) total += longitudUtf8(c.codePointAt(0) ?? 0)
  return total
}

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (clave: string) => {
    if (mockFallos.alLeer?.(clave)) throw new Error('keystore bloqueado token=SECRETO')
    return mockMemoria.get(clave) ?? null
  }),
  setItemAsync: jest.fn(async (clave: string, valor: string) => {
    mockFallos.escrituras += 1
    if (!/^[\w.-]+$/u.test(clave)) throw new Error('clave inválida')
    if (mockBytesUtf8(valor) > MOCK_LIMITE_BYTES) throw new Error('valor demasiado grande')
    if (mockFallos.alEscribir?.(clave, mockFallos.escrituras)) throw new Error('fallo nativo token=SECRETO')
    mockMemoria.set(clave, valor)
  }),
  deleteItemAsync: jest.fn(async (clave: string) => {
    mockMemoria.delete(clave)
  }),
}))

function sesionDeTamano(bytes: number): string {
  const base = 'eyJhbGciOiJIUzI1NiJ9.ñandú-€-😀.'
  let token = ''
  while (mockBytesUtf8(token) < bytes) token += base
  return JSON.stringify({ access_token: token, refresh_token: 'abc', user: { email: 'a@b.c' } })
}

beforeEach(() => {
  mockMemoria.clear()
  mockFallos.alEscribir = null
  mockFallos.alLeer = null
  mockFallos.escrituras = 0
  jest.clearAllMocks()
})

describe('utilidades puras', () => {
  it('divide por bytes sin partir caracteres multibyte ni exceder el máximo', () => {
    const valor = 'á€😀'.repeat(300)
    const partes = dividirPorBytes(valor, 100)
    expect(partes.join('')).toBe(valor)
    for (const p of partes) expect(mockBytesUtf8(p)).toBeLessThanOrEqual(100)
  })

  it('devuelve un fragmento vacío para un valor vacío', () => {
    expect(dividirPorBytes('', 10)).toEqual([''])
  })

  it('la suma de verificación cambia ante una modificación de un carácter', () => {
    expect(sumaDeVerificacion('abc')).not.toBe(sumaDeVerificacion('abd'))
  })
})

describe('almacenamiento seguro fragmentado', () => {
  it('recorre ida y vuelta una sesión de varios KB con texto no ASCII', async () => {
    const almacen = crearAlmacenamientoSeguro()
    const sesion = sesionDeTamano(9000)
    expect(mockBytesUtf8(sesion)).toBeGreaterThan(MOCK_LIMITE_BYTES * 4)
    await almacen.setItem('sb-proyecto-auth-token', sesion)
    expect(await almacen.getItem('sb-proyecto-auth-token')).toBe(sesion)
  })

  it('nunca escribe una entrada que supere el límite de la plataforma', async () => {
    const almacen = crearAlmacenamientoSeguro()
    await almacen.setItem('clave', sesionDeTamano(20000))
    for (const [, valor] of mockMemoria) expect(mockBytesUtf8(valor)).toBeLessThanOrEqual(MOCK_LIMITE_BYTES)
  })

  it('devuelve null cuando no hay valor', async () => {
    expect(await crearAlmacenamientoSeguro().getItem('inexistente')).toBeNull()
  })

  it('sobrescribe sin dejar fragmentos de la versión anterior', async () => {
    const almacen = crearAlmacenamientoSeguro()
    await almacen.setItem('k', sesionDeTamano(9000))
    const entradasGrande = mockMemoria.size
    await almacen.setItem('k', 'corto')
    expect(await almacen.getItem('k')).toBe('corto')
    expect(mockMemoria.size).toBeLessThan(entradasGrande)
    expect(mockMemoria.size).toBe(2) // un fragmento + manifiesto
  })

  it('removeItem elimina manifiesto y fragmentos', async () => {
    const almacen = crearAlmacenamientoSeguro()
    await almacen.setItem('k', sesionDeTamano(9000))
    await almacen.removeItem('k')
    expect(mockMemoria.size).toBe(0)
    expect(await almacen.getItem('k')).toBeNull()
  })

  it('un fallo parcial al escribir conserva el valor anterior y limpia los fragmentos nuevos', async () => {
    const almacen = crearAlmacenamientoSeguro()
    const anterior = sesionDeTamano(6000)
    await almacen.setItem('k', anterior)
    const entradasAntes = mockMemoria.size
    mockFallos.escrituras = 0
    mockFallos.alEscribir = (_clave, n) => n === 3 // falla a mitad de los fragmentos
    await expect(almacen.setItem('k', sesionDeTamano(9000))).rejects.toMatchObject({ codigo: 'ESCRITURA_FALLIDA' })
    mockFallos.alEscribir = null
    expect(await almacen.getItem('k')).toBe(anterior)
    expect(mockMemoria.size).toBe(entradasAntes)
  })

  it('un fallo al escribir el manifiesto no deja la sesión a medias', async () => {
    const almacen = crearAlmacenamientoSeguro()
    const anterior = sesionDeTamano(4000)
    await almacen.setItem('k', anterior)
    mockFallos.alEscribir = clave => clave.endsWith('.m')
    await expect(almacen.setItem('k', sesionDeTamano(4000) + 'x')).rejects.toBeInstanceOf(ErrorAlmacenamiento)
    mockFallos.alEscribir = null
    expect(await almacen.getItem('k')).toBe(anterior)
  })

  it('un fragmento corrupto se detecta, se purga y se informa como ausente', async () => {
    const almacen = crearAlmacenamientoSeguro()
    await almacen.setItem('k', sesionDeTamano(6000))
    const fragmento = [...mockMemoria.keys()].find(k => !k.endsWith('.m'))!
    mockMemoria.set(fragmento, mockMemoria.get(fragmento)!.replace(/.$/u, '#'))
    expect(await almacen.getItem('k')).toBeNull()
    expect(mockMemoria.size).toBe(0)
  })

  it('un fragmento faltante se trata como ausente', async () => {
    const almacen = crearAlmacenamientoSeguro()
    await almacen.setItem('k', sesionDeTamano(6000))
    const fragmento = [...mockMemoria.keys()].find(k => !k.endsWith('.m'))!
    mockMemoria.delete(fragmento)
    expect(await almacen.getItem('k')).toBeNull()
    expect(mockMemoria.size).toBe(0)
  })

  it('un manifiesto ilegible se purga y no rompe la lectura', async () => {
    const almacen = crearAlmacenamientoSeguro()
    mockMemoria.set('ept.k.m', '{no es json')
    expect(await almacen.getItem('k')).toBeNull()
    expect(mockMemoria.has('ept.k.m')).toBe(false)
  })

  it('un error nativo de lectura no purga el dato y no filtra el mensaje original', async () => {
    const almacen = crearAlmacenamientoSeguro()
    const sesion = sesionDeTamano(3000)
    await almacen.setItem('k', sesion)
    mockFallos.alLeer = () => true
    const intento = almacen.getItem('k')
    await expect(intento).rejects.toBeInstanceOf(ErrorAlmacenamiento)
    await expect(intento).rejects.not.toThrow(/SECRETO/u)
    mockFallos.alLeer = null
    expect(await almacen.getItem('k')).toBe(sesion)
  })

  it('los errores nunca contienen el valor guardado', async () => {
    const almacen = crearAlmacenamientoSeguro()
    mockFallos.alEscribir = () => true
    const valor = 'valor-confidencial-12345'
    const error = await almacen.setItem('k', valor).catch((e: unknown) => e as Error)
    expect(error).toBeInstanceOf(ErrorAlmacenamiento)
    expect(`${(error as Error).message}${JSON.stringify(error)}`).not.toContain(valor)
    expect(`${(error as Error).message}`).not.toContain('SECRETO')
  })

  it('serializa escrituras concurrentes de la misma clave: gana la última y no hay mezcla', async () => {
    const almacen = crearAlmacenamientoSeguro()
    const a = sesionDeTamano(5000)
    const b = sesionDeTamano(7000) + 'B'
    await Promise.all([almacen.setItem('k', a), almacen.setItem('k', b)])
    expect(await almacen.getItem('k')).toBe(b)
  })

  it('sanea claves con caracteres no admitidos por el almacén nativo', async () => {
    const almacen = crearAlmacenamientoSeguro()
    await almacen.setItem('sb:proyecto/auth token', 'x')
    expect(await almacen.getItem('sb:proyecto/auth token')).toBe('x')
    expect(SecureStore.setItemAsync).toHaveBeenCalled()
  })

  it('informa solo códigos al observador de mockFallos', async () => {
    const codigos: string[] = []
    const almacen = crearAlmacenamientoSeguro({ alFallar: c => codigos.push(c) })
    mockFallos.alEscribir = () => true
    await almacen.setItem('k', 'v').catch(() => undefined)
    expect(codigos).toEqual(['ESCRITURA_FALLIDA'])
  })
})
