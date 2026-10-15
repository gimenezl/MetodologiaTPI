import type { AlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'
import {
  descartarIntentoPendiente,
  guardarIntentoPendiente,
  leerIntentoPendiente,
  type IntentoPendiente,
} from '@/servicios/intento-pago'

const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ALUMNO = '11111111-1111-4111-8111-111111111111'
const CLAVE = '22222222-2222-4222-8222-222222222222'
const I1 = '33333333-3333-4333-8333-333333333331'
const I2 = '33333333-3333-4333-8333-333333333332'

function memoria(): AlmacenamientoSeguro & { datos: Map<string, string> } {
  const datos = new Map<string, string>()
  return {
    datos,
    getItem: async k => datos.get(k) ?? null,
    setItem: async (k, v) => { datos.set(k, v) },
    removeItem: async k => { datos.delete(k) },
  }
}

const intento = (usuarioId = U1): IntentoPendiente => ({
  usuarioId, alumnoId: ALUMNO, claveIntento: CLAVE, itemIds: [I2, I1], totalCentavos: 5800000, creadoEn: '2026-11-02T12:00:00.000Z',
})

describe('intento de pago pendiente', () => {
  it('guarda y recupera el intento con la selección canónica', async () => {
    const almacen = memoria()
    await guardarIntentoPendiente(almacen, intento())
    const leido = await leerIntentoPendiente(almacen, U1, ALUMNO)
    expect(leido?.claveIntento).toBe(CLAVE)
    expect(leido?.itemIds).toEqual([I1, I2])
    expect(leido?.totalCentavos).toBe(5800000)
  })

  it('no guarda credenciales ni datos personales: solo identificadores y el total visto', async () => {
    const almacen = memoria()
    await guardarIntentoPendiente(almacen, intento())
    const crudo = [...almacen.datos.values()][0] ?? ''
    expect(Object.keys(JSON.parse(crudo) as object).sort()).toEqual(
      ['alumnoId', 'claveIntento', 'creadoEn', 'itemIds', 'totalCentavos', 'usuarioId', 'v'],
    )
  })

  it('un estudiante nunca ve ni pisa el intento de otro de la misma cuenta', async () => {
    const almacen = memoria()
    const OTRO = '99999999-9999-4999-8999-999999999999'
    await guardarIntentoPendiente(almacen, intento())
    expect(await leerIntentoPendiente(almacen, U1, OTRO)).toBeNull()
    await guardarIntentoPendiente(almacen, { ...intento(), alumnoId: OTRO, claveIntento: '88888888-8888-4888-8888-888888888888' })
    expect((await leerIntentoPendiente(almacen, U1, ALUMNO))?.claveIntento).toBe(CLAVE)
    await descartarIntentoPendiente(almacen, U1, OTRO)
    expect((await leerIntentoPendiente(almacen, U1, ALUMNO))?.claveIntento).toBe(CLAVE)
  })

  it('una respuesta tardía no borra un intento posterior con otra clave', async () => {
    const almacen = memoria()
    await guardarIntentoPendiente(almacen, intento())
    await descartarIntentoPendiente(almacen, U1, ALUMNO, '77777777-7777-4777-8777-777777777777')
    expect(await leerIntentoPendiente(almacen, U1, ALUMNO)).not.toBeNull()
    await descartarIntentoPendiente(almacen, U1, ALUMNO, CLAVE)
    expect(await leerIntentoPendiente(almacen, U1, ALUMNO)).toBeNull()
  })

  it('otra cuenta nunca recupera el intento ajeno', async () => {
    const almacen = memoria()
    await guardarIntentoPendiente(almacen, intento(U1))
    expect(await leerIntentoPendiente(almacen, U2, ALUMNO)).toBeNull()
    // Aun si un valor ajeno apareciera bajo la clave de otra cuenta, el usuarioId embebido lo descarta.
    const [clave, valor] = [...almacen.datos.entries()][0] ?? ['', '']
    almacen.datos.set(clave.replace(U1, U2), valor)
    expect(await leerIntentoPendiente(almacen, U2, ALUMNO)).toBeNull()
  })

  it('un valor dañado o con otra forma se descarta', async () => {
    const almacen = memoria()
    almacen.datos.set(`pago.pendiente.${U1}.${ALUMNO}`, '{no es json')
    expect(await leerIntentoPendiente(almacen, U1, ALUMNO)).toBeNull()
    almacen.datos.set(`pago.pendiente.${U1}.${ALUMNO}`, JSON.stringify({ v: 1, usuarioId: U1, alumnoId: 'x', claveIntento: CLAVE, itemIds: [], totalCentavos: 1, creadoEn: 'x' }))
    expect(await leerIntentoPendiente(almacen, U1, ALUMNO)).toBeNull()
  })

  it('descartar elimina el intento y tolera un fallo del almacenamiento', async () => {
    const almacen = memoria()
    await guardarIntentoPendiente(almacen, intento())
    await descartarIntentoPendiente(almacen, U1, ALUMNO)
    expect(await leerIntentoPendiente(almacen, U1, ALUMNO)).toBeNull()
    const roto: AlmacenamientoSeguro = {
      getItem: async () => { throw new Error('x') },
      setItem: async () => { throw new Error('x') },
      removeItem: async () => { throw new Error('x') },
    }
    await expect(descartarIntentoPendiente(roto, U1, ALUMNO)).resolves.toBeUndefined()
    expect(await leerIntentoPendiente(roto, U1, ALUMNO)).toBeNull()
  })
})
