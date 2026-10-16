import {
  analizarCarga,
  clasificarFalloPreparacion,
  clasificarRespuestaSubida,
  consultarCarga,
  finalizarCarga,
  listarPagosPendientes,
  prepararCarga,
} from '@/servicios/comprobantes'
import type { ClienteEPT } from '@/servicios/supabase'
import { ErrorTransporte, type TransporteHttp } from '@/servicios/transporte-http'

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PERFIL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const A1 = '11111111-1111-4111-8111-111111111111'
const PAGO = '44444444-4444-4444-8444-444444444444'
const CARGA = '66666666-6666-4666-8666-666666666666'
const CLAVE = '55555555-5555-4555-8555-555555555555'

const carga = (extra: Record<string, unknown> = {}) => ({
  carga_id: CARGA,
  clave_carga: CLAVE,
  pago_id: PAGO,
  estado: 'PREPARADA',
  motivo_descarte: null,
  bucket_temporal: 'comprobantes-pago-temporal',
  ruta_temporal: `${PAGO}/${CARGA}`,
  tipo_mime: 'application/pdf',
  tamano_bytes: 1000,
  fecha_transferencia: '2026-10-14',
  importe_centavos: 1500050,
  numero_operacion: 'OP-1',
  comprobante_id: null,
  cantidad_archivos: 0,
  estado_pago: 'PENDIENTE_VERIFICACION',
  repetido: false,
  ...extra,
})

function clienteRpc(respuesta: { data?: unknown; error?: unknown; status?: number } | Error) {
  const llamadas: { nombre: string; args: unknown }[] = []
  const cliente = {
    rpc(nombre: string, args: unknown) {
      llamadas.push({ nombre, args })
      const c = {
        abortSignal: () => c,
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          (respuesta instanceof Error
            ? Promise.reject(respuesta)
            : Promise.resolve({ data: null, error: null, status: 200, ...respuesta })
          ).then(ok, ko),
      }
      return c
    },
  } as unknown as ClienteEPT
  return { cliente, llamadas }
}

function transporteConError(error: unknown): TransporteHttp {
  return { solicitar: jest.fn().mockRejectedValue(error) }
}

describe('analizarCarga', () => {
  it('interpreta una carga válida', () => {
    expect(analizarCarga(carga())).toMatchObject({
      cargaId: CARGA,
      estado: 'PREPARADA',
      tipoMime: 'application/pdf',
      importeCentavos: 1500050,
      comprobanteId: null,
    })
  })

  it.each([
    ['estado desconocido', { estado: 'APROBADA' }],
    ['tipo no permitido', { tipo_mime: 'image/gif' }],
    ['fecha mal formada', { fecha_transferencia: '14/10/2026' }],
    ['importe no entero', { importe_centavos: 10.5 }],
    ['id no UUID', { carga_id: 'no-uuid' }],
    ['tamaño cero', { tamano_bytes: 0 }],
    ['repetido ausente', { repetido: undefined }],
  ])('rechaza toda la respuesta con %s', (_nombre, extra) => {
    expect(() => analizarCarga(carga(extra))).toThrow()
  })
})

describe('clasificarFalloPreparacion', () => {
  it('un 4xx con código propio es un rechazo cierto', () => {
    for (const codigo of ['P6860', 'P6861', 'P6862', 'P6863', 'P6864', 'P6865', 'P6866', 'P6868']) {
      expect(clasificarFalloPreparacion({ code: codigo }, 400)).toEqual({ tipo: 'rechazada', codigo })
    }
    expect(clasificarFalloPreparacion({ code: '42501' }, 403)).toEqual({ tipo: 'rechazada', codigo: 'DENEGADO' })
    expect(clasificarFalloPreparacion({ code: 'XX000' }, 400)).toEqual({ tipo: 'rechazada', codigo: 'OTRO' })
  })

  it('sin red, 5xx o estado ilegible es incierto: no prueba nada', () => {
    expect(clasificarFalloPreparacion({ code: 'P6860' }, 0)).toEqual({ tipo: 'incierto' })
    expect(clasificarFalloPreparacion({}, 503)).toEqual({ tipo: 'incierto' })
    expect(clasificarFalloPreparacion({ code: 'P6860' }, Number.NaN)).toEqual({ tipo: 'incierto' })
  })
})

describe('prepararCarga', () => {
  const argumentos = {
    claveCarga: CLAVE,
    pagoId: PAGO,
    tipoMime: 'application/pdf' as const,
    tamanoBytes: 1000,
    datos: { fecha: '2026-10-14', importe: '15000.50', numero: 'OP-1' },
  }

  it('envía importe y fecha como texto exacto y nada que sea autoridad', async () => {
    const { cliente, llamadas } = clienteRpc({ data: carga() })
    const r = await prepararCarga(cliente, argumentos)
    expect(r).toMatchObject({ tipo: 'preparada' })
    expect(llamadas[0]).toEqual({
      nombre: 'preparar_carga_comprobante',
      args: {
        p_clave_carga: CLAVE,
        p_pago_id: PAGO,
        p_fecha: '2026-10-14',
        p_importe: '15000.50',
        p_numero: 'OP-1',
        p_tipo_mime: 'application/pdf',
        p_tamano: 1000,
      },
    })
    expect(Object.keys(llamadas[0].args as object).some(k => /usuario|padre|rol|hash|sha|validado/iu.test(k))).toBe(false)
  })

  it('sin datos propios deja que la base los herede del pago', async () => {
    const { cliente, llamadas } = clienteRpc({ data: carga() })
    await prepararCarga(cliente, { ...argumentos, datos: null })
    expect(llamadas[0].args).toMatchObject({ p_fecha: null, p_importe: null, p_numero: null })
  })

  it('una respuesta ilegible tras escribir es incierta, no un fracaso', async () => {
    expect(await prepararCarga(clienteRpc({ data: { raro: true } }).cliente, argumentos)).toEqual({ tipo: 'incierto' })
    expect(await prepararCarga(clienteRpc(new Error('red')).cliente, argumentos)).toEqual({ tipo: 'incierto' })
  })

  it('un 4xx es un rechazo cierto con su código', async () => {
    const r = await prepararCarga(clienteRpc({ error: { code: 'P6863' }, status: 400 }).cliente, argumentos)
    expect(r).toEqual({ tipo: 'rechazada', codigo: 'P6863' })
  })
})

describe('consultarCarga', () => {
  it('distingue registrada, no registrada y error', async () => {
    expect(await consultarCarga(clienteRpc({ data: { registrada: false } }).cliente, CLAVE)).toEqual({ tipo: 'no_registrada' })
    expect(await consultarCarga(clienteRpc({ data: { registrada: true, ...carga({ estado: 'CONFIRMADA', comprobante_id: CARGA }) } }).cliente, CLAVE))
      .toMatchObject({ tipo: 'registrada', carga: { estado: 'CONFIRMADA' } })
    expect(await consultarCarga(clienteRpc({ error: { code: 'X' } }).cliente, CLAVE)).toEqual({ tipo: 'error' })
    expect(await consultarCarga(clienteRpc({ data: { registrada: 'si' } }).cliente, CLAVE)).toEqual({ tipo: 'error' })
  })
})

describe('finalizarCarga', () => {
  it('solo una carga CONFIRMADA en un 2xx confirma', async () => {
    const ok: TransporteHttp = {
      solicitar: jest.fn().mockResolvedValue({ estado: 200, datos: { carga: carga({ estado: 'CONFIRMADA', comprobante_id: CARGA }) } }),
    }
    expect(await finalizarCarga(ok, CARGA)).toMatchObject({ tipo: 'confirmada' })
    expect(ok.solicitar).toHaveBeenCalledWith(`/api/comprobantes/cargas/${CARGA}/finalizacion`, { metodo: 'POST', senal: undefined })

    const pendiente: TransporteHttp = {
      solicitar: jest.fn().mockResolvedValue({ estado: 200, datos: { carga: carga() } }),
    }
    expect(await finalizarCarga(pendiente, CARGA)).toEqual({ tipo: 'incierto' })
    const ilegible: TransporteHttp = { solicitar: jest.fn().mockResolvedValue({ estado: 200, datos: { carga: 1 } }) }
    expect(await finalizarCarga(ilegible, CARGA)).toEqual({ tipo: 'incierto' })
  })

  it.each([
    [409, { codigo: 'ARCHIVO_NO_SUBIDO', mensaje: 'x' }, { tipo: 'no_subido' }],
    [422, { codigo: 'ARCHIVO_CORRUPTO', mensaje: 'Dañado.' }, { tipo: 'rechazada', codigo: 'ARCHIVO_CORRUPTO', mensaje: 'Dañado.' }],
    [409, { codigo: 'OPERACION_DUPLICADA', mensaje: 'Duplicado.' }, { tipo: 'rechazada', codigo: 'OPERACION_DUPLICADA', mensaje: 'Duplicado.' }],
    [410, { codigo: 'EXPIRADA', mensaje: 'Venció.' }, { tipo: 'rechazada', codigo: 'EXPIRADA', mensaje: 'Venció.' }],
    [503, { codigo: 'RESULTADO_INCIERTO', mensaje: 'x' }, { tipo: 'incierto' }],
    [500, { codigo: 'PUBLICACION_INCONSISTENTE', mensaje: 'x' }, { tipo: 'incierto' }],
    [400, null, { tipo: 'incierto' }],
  ])('estado %i con cuerpo %j', async (estado, cuerpo, esperado) => {
    const t = transporteConError(new ErrorTransporte('HTTP', { estado, cuerpo }))
    expect(await finalizarCarga(t, CARGA)).toEqual(esperado)
  })

  it.each(['TIEMPO_AGOTADO', 'SIN_CONEXION', 'CANCELADO', 'RESPUESTA_INVALIDA', 'SIN_SESION'] as const)(
    'un fallo de transporte (%s) es incierto: no se asume nada',
    async tipo => {
      expect(await finalizarCarga(transporteConError(new ErrorTransporte(tipo)), CARGA)).toEqual({ tipo: 'incierto' })
    },
  )
})

describe('clasificarRespuestaSubida', () => {
  it('interpreta las respuestas de Storage', () => {
    expect(clasificarRespuestaSubida(200, '{}')).toEqual({ tipo: 'subido' })
    expect(clasificarRespuestaSubida(409, '')).toEqual({ tipo: 'ya_existia' })
    expect(clasificarRespuestaSubida(400, '{"error":"Duplicate","message":"The resource already exists"}')).toEqual({ tipo: 'ya_existia' })
    expect(clasificarRespuestaSubida(400, '{"message":"new row violates row-level security policy"}')).toEqual({ tipo: 'rechazada', estado: 400 })
    expect(clasificarRespuestaSubida(403, '')).toEqual({ tipo: 'rechazada', estado: 403 })
    expect(clasificarRespuestaSubida(413, '')).toEqual({ tipo: 'rechazada', estado: 413 })
    expect(clasificarRespuestaSubida(502, '')).toEqual({ tipo: 'incierto' })
  })
})

describe('listarPagosPendientes', () => {
  function cliente(tablas: Record<string, unknown>) {
    return {
      from(tabla: string) {
        const datos = tablas[tabla]
        const c = {
          select: () => c,
          eq: () => c,
          in: () => c,
          order: () => c,
          limit: () => c,
          abortSignal: () => c,
          maybeSingle: () => Promise.resolve({ data: datos, error: null }),
          then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            Promise.resolve({ data: datos, error: null }).then(ok, ko),
        }
        return c
      },
    } as unknown as ClienteEPT
  }

  it('convierte importes exactos a centavos y cuenta los archivos propios', async () => {
    const c = cliente({
      perfiles: { id: PERFIL },
      pagos: [
        { id: PAGO, alumno_id: A1, creado_en: '2026-10-14T12:00:00+00:00', fecha_transferencia: '2026-10-14', numero_operacion: 'OP-1', total: '50000.00', importe: '49000.05' },
      ],
      comprobantes_pago: [{ pago_id: PAGO }, { pago_id: PAGO }],
    })
    const r = await listarPagosPendientes(c, U, A1)
    expect(r).toEqual([
      {
        pagoId: PAGO,
        alumnoId: A1,
        totalCentavos: 5000000,
        creadoEn: '2026-10-14T12:00:00+00:00',
        datosTransferencia: { fecha: '2026-10-14', importeCentavos: 4900005, numero: 'OP-1' },
        archivos: 2,
      },
    ])
  })

  it('un pago sin datos informados los deja en null', async () => {
    const c = cliente({
      perfiles: { id: PERFIL },
      pagos: [{ id: PAGO, alumno_id: A1, creado_en: 'x', fecha_transferencia: null, numero_operacion: null, total: '1.5', importe: null }],
      comprobantes_pago: [],
    })
    const [pago] = await listarPagosPendientes(c, U, A1)
    expect(pago).toMatchObject({ totalCentavos: 150, datosTransferencia: null, archivos: 0 })
  })

  it('rechaza un importe que no es decimal exacto en lugar de adivinarlo', async () => {
    const c = cliente({
      perfiles: { id: PERFIL },
      pagos: [{ id: PAGO, alumno_id: A1, creado_en: 'x', fecha_transferencia: null, numero_operacion: null, total: 50000.123, importe: null }],
      comprobantes_pago: [],
    })
    await expect(listarPagosPendientes(c, U, A1)).rejects.toThrow()
  })
})
