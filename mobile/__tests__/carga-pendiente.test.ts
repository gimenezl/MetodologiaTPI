import type { AlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'
import {
  descartarCargaPendiente,
  guardarCargaPendiente,
  leerCargaPendiente,
} from '@/servicios/carga-pendiente'

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const U2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
const PAGO = '44444444-4444-4444-8444-444444444444'
const PAGO_B = '44444444-4444-4444-8444-444444444445'
const CARGA = '66666666-6666-4666-8666-666666666666'
const CLAVE = '55555555-5555-4555-8555-555555555555'
const CLAVE_B = '55555555-5555-4555-8555-555555555556'

function memoria() {
  const datos = new Map<string, string>()
  const almacen: AlmacenamientoSeguro = {
    getItem: async k => datos.get(k) ?? null,
    setItem: async (k, v) => {
      datos.set(k, v)
    },
    removeItem: async k => {
      datos.delete(k)
    },
  }
  return { almacen, datos }
}

const carga = (extra: Record<string, unknown> = {}) => ({
  usuarioId: U,
  pagoId: PAGO,
  claveCarga: CLAVE,
  cargaId: CARGA as string | null,
  creadaEn: '2026-10-14T12:00:00.000Z',
  ...extra,
})

describe('carga pendiente', () => {
  it('guarda y recupera solo identificadores, sin credenciales ni datos de la transferencia', async () => {
    const { almacen, datos } = memoria()
    await guardarCargaPendiente(almacen, carga())
    expect(await leerCargaPendiente(almacen, U, PAGO)).toEqual(carga())
    const crudo = [...datos.values()][0]
    expect(crudo).not.toMatch(/token|jwt|numero|importe|uri|file:/iu)
  })

  it('admite una carga cuya preparación aún no confirmó su id', async () => {
    const { almacen } = memoria()
    await guardarCargaPendiente(almacen, carga({ cargaId: null }))
    expect((await leerCargaPendiente(almacen, U, PAGO))?.cargaId).toBeNull()
  })

  it('una cuenta no recupera la carga de otra ni de otro pago', async () => {
    const { almacen } = memoria()
    await guardarCargaPendiente(almacen, carga())
    expect(await leerCargaPendiente(almacen, U2, PAGO)).toBeNull()
    expect(await leerCargaPendiente(almacen, U, PAGO_B)).toBeNull()
  })

  it('un registro dañado o de otra versión se ignora', async () => {
    const { almacen, datos } = memoria()
    await guardarCargaPendiente(almacen, carga())
    const [clave] = [...datos.keys()]
    datos.set(clave, '{"v":2}')
    expect(await leerCargaPendiente(almacen, U, PAGO)).toBeNull()
    datos.set(clave, 'no es json')
    expect(await leerCargaPendiente(almacen, U, PAGO)).toBeNull()
    datos.set(clave, JSON.stringify({ v: 1, ...carga({ claveCarga: 'x' }) }))
    expect(await leerCargaPendiente(almacen, U, PAGO)).toBeNull()
  })

  it('descartar con clave no borra la carga posterior de otro intento', async () => {
    const { almacen } = memoria()
    await guardarCargaPendiente(almacen, carga({ claveCarga: CLAVE_B }))
    await descartarCargaPendiente(almacen, U, PAGO, CLAVE)
    expect(await leerCargaPendiente(almacen, U, PAGO)).not.toBeNull()
    await descartarCargaPendiente(almacen, U, PAGO, CLAVE_B)
    expect(await leerCargaPendiente(almacen, U, PAGO)).toBeNull()
  })

  it('un almacén que falla no rompe la lectura ni el descarte', async () => {
    const roto: AlmacenamientoSeguro = {
      getItem: async () => {
        throw new Error('x')
      },
      setItem: async () => undefined,
      removeItem: async () => {
        throw new Error('x')
      },
    }
    expect(await leerCargaPendiente(roto, U, PAGO)).toBeNull()
    await expect(descartarCargaPendiente(roto, U, PAGO)).resolves.toBeUndefined()
  })
})
