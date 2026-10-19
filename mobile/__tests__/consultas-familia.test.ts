import {
  analizarFacturaPeriodo,
  analizarInscripcion,
  analizarRegistroComprobante,
  consultarFacturasPeriodo,
  consultarInscripciones,
  consultarRegistroComprobantes,
  entradaAIso,
  ErrorConsultaFamilia,
  fechaArgentina,
  fechaIsoValida,
  formatearEntradaFecha,
  isoAEntrada,
  rangoDelAnio,
  validarRango,
} from '@/servicios/consultas-familia'
import type { ClienteEPT } from '@/servicios/supabase'

type Fila = Record<string, unknown>

function inscripcion(extra: Fila = {}): Fila {
  return {
    categoria: 'DEPORTE', inscripcion_id: 'i1', estado: 'ACTIVA', nombre: 'Fútbol', grupo: 'Sub-12', nivel: 'PRIMARIO',
    catalogo_activo: true, fecha_inscripcion: '2026-03-01T12:00:00+00:00', fecha_cancelacion: null, ...extra,
  }
}

function factura(extra: Fila = {}): Fila {
  return {
    factura_id: 'f1', alumno_id: 'a1', periodo: '2026-01-01', vencimiento: '2026-01-10', total_centavos: 5000000,
    pagado_centavos: 0, saldo_centavos: 5000000, estado: 'PENDIENTE', inconsistente: false, fecha_corte: '2026-02-01',
    cantidad_pagos: 1, cantidad_archivos: 2, ...extra,
  }
}

function registro(extra: Fila = {}): Fila {
  return {
    pago_id: 'p1', estado: 'PENDIENTE_VERIFICACION', fecha_transferencia: '2026-01-05', importe_informado_centavos: 5000000,
    total_calculado_centavos: 5000000, creado_en: '2026-01-04T12:00:00+00:00', cantidad_archivos: 1,
    items: [], recibo_id:null, verificado_en:null, motivo_rechazo:null, ultima_carga_en: '2026-01-06T12:00:00+00:00', periodos: ['2026-01-01'], ...extra,
  }
}

interface Llamada { nombre: string; args: Record<string, unknown>; senal?: AbortSignal }

/** Cliente cuyas RPC devuelven lo indicado y registran lo que se pidió. */
function clienteRpc(respuesta: { data?: unknown; error?: { code?: string; message?: string } | null }): { cliente: ClienteEPT; llamadas: Llamada[] } {
  const llamadas: Llamada[] = []
  const cliente = {
    rpc(nombre: string, args: Record<string, unknown>) {
      const llamada: Llamada = { nombre, args }
      llamadas.push(llamada)
      const constructor = {
        range:()=>constructor,
        abortSignal: (senal: AbortSignal) => { llamada.senal = senal; return constructor },
        then: (resolver: (v: unknown) => unknown, rechazar?: (e: unknown) => unknown) =>
          Promise.resolve({ data: respuesta.data ?? null, error: respuesta.error ?? null }).then(resolver, rechazar),
      }
      return constructor
    },
  } as unknown as ClienteEPT
  return { cliente, llamadas }
}

describe('fechas civiles', () => {
  it('acepta solo fechas reales, con años bisiestos', () => {
    expect(fechaIsoValida('2026-02-28')).toBe('2026-02-28')
    expect(fechaIsoValida('2028-02-29')).toBe('2028-02-29')
    expect(fechaIsoValida('2026-02-29')).toBeNull()
    expect(fechaIsoValida('2100-02-29')).toBeNull()
    expect(fechaIsoValida('2000-02-29')).toBe('2000-02-29')
    expect(fechaIsoValida('2026-04-31')).toBeNull()
    expect(fechaIsoValida('2026-13-01')).toBeNull()
    expect(fechaIsoValida('2026-00-10')).toBeNull()
    expect(fechaIsoValida('26-01-01')).toBeNull()
    expect(fechaIsoValida('2026-1-1')).toBeNull()
    expect(fechaIsoValida('infinity')).toBeNull()
  })

  it('la máscara escribe DD/MM/AAAA solo con dígitos y se convierte a ISO', () => {
    expect(formatearEntradaFecha('3')).toBe('3')
    expect(formatearEntradaFecha('3112')).toBe('31/12')
    expect(formatearEntradaFecha('31122026')).toBe('31/12/2026')
    expect(formatearEntradaFecha('31/12/2026999')).toBe('31/12/2026')
    expect(formatearEntradaFecha('3a1b')).toBe('31')
    expect(entradaAIso('31/12/2026')).toBe('2026-12-31')
    expect(entradaAIso('30/02/2026')).toBeNull()
    expect(entradaAIso('31/12/26')).toBeNull()
    expect(isoAEntrada('2026-01-05')).toBe('05/01/2026')
  })

  it('la fecha de Argentina no depende del huso del teléfono', () => {
    // 02:30 UTC del 11 es todavía el 10 en Argentina (UTC−3); 03:00 UTC ya es el 11.
    expect(fechaArgentina('2026-11-11T02:30:00+00:00')).toBe('2026-11-10')
    expect(fechaArgentina('2026-11-11T03:00:00+00:00')).toBe('2026-11-11')
    expect(fechaArgentina('2026-12-31T23:30:00-03:00')).toBe('2026-12-31')
    // Formatos reales de PostgREST: microsegundos, huso con y sin dos puntos, Z.
    expect(fechaArgentina('2026-01-06T12:00:00.123456+00:00')).toBe('2026-01-06')
    expect(fechaArgentina('2026-01-06T00:30:00.5Z')).toBe('2026-01-05')
    expect(fechaArgentina('2026-01-06 02:59:59+00')).toBe('2026-01-05')
    expect(fechaArgentina('2026-01-06T03:00:00+0000')).toBe('2026-01-06')
    expect(fechaArgentina('2026-01-06T01:00:00+02:00')).toBe('2026-01-05')
    expect(() => fechaArgentina('2026-02-30T12:00:00+00:00')).toThrow(ErrorConsultaFamilia)
    expect(() => fechaArgentina('no es fecha')).toThrow(ErrorConsultaFamilia)
  })

  it('el rango inicial es el año calendario', () => {
    expect(rangoDelAnio(new Date(2026, 5, 15))).toEqual({ desde: '01/01/2026', hasta: '31/12/2026' })
  })
})

describe('validarRango', () => {
  it('acepta un rango real con extremos iguales o en distinto año', () => {
    expect(validarRango('05/01/2026', '05/01/2026')).toEqual({ ok: true, rango: { desde: '2026-01-05', hasta: '2026-01-05' } })
    expect(validarRango('31/12/2025', '01/01/2026')).toEqual({ ok: true, rango: { desde: '2025-12-31', hasta: '2026-01-01' } })
  })

  it('rechaza campos vacíos, fechas inexistentes y un rango invertido, sin completar nada por su cuenta', () => {
    expect(validarRango('', '01/01/2026')).toEqual({ ok: false, errores: { desde: 'Ingresá la fecha desde.' } })
    expect(validarRango('01/01/2026', '')).toEqual({ ok: false, errores: { hasta: 'Ingresá la fecha hasta.' } })
    const inexistente = validarRango('30/02/2026', '01/03/2026')
    expect(inexistente.ok).toBe(false)
    if (!inexistente.ok) expect(inexistente.errores.desde).toMatch(/no existe/u)
    const incompleta = validarRango('01/01/20', '01/03/2026')
    expect(incompleta.ok).toBe(false)
    const invertido = validarRango('02/01/2026', '01/01/2026')
    expect(invertido).toEqual({ ok: false, errores: { rango: 'La fecha desde no puede ser posterior a la fecha hasta.' } })
  })
})

describe('análisis de respuestas', () => {
  it('inscripción: estado, fechas civiles de Argentina y coherencia de cancelación', () => {
    const activa = analizarInscripcion(inscripcion())
    expect(activa).toMatchObject({ categoria: 'DEPORTE', estado: 'ACTIVA', grupo: 'Sub-12', fechaInscripcion: '2026-03-01', fechaCancelacion: null })
    const cancelada = analizarInscripcion(inscripcion({ estado: 'CANCELADA', fecha_cancelacion: '2026-04-02T01:00:00+00:00' }))
    expect(cancelada.fechaCancelacion).toBe('2026-04-01')
    expect(() => analizarInscripcion(inscripcion({ estado: 'CANCELADA' }))).toThrow(ErrorConsultaFamilia)
    expect(() => analizarInscripcion(inscripcion({ fecha_cancelacion: '2026-04-02T01:00:00+00:00' }))).toThrow(ErrorConsultaFamilia)
    expect(() => analizarInscripcion(inscripcion({ categoria: 'OTRA' }))).toThrow(ErrorConsultaFamilia)
    expect(() => analizarInscripcion(inscripcion({ catalogo_activo: 'si' }))).toThrow(ErrorConsultaFamilia)
    expect(analizarInscripcion(inscripcion({ categoria: 'COMEDOR', grupo: null, nivel: null }))).toMatchObject({ grupo: null, nivel: null })
  })

  it('factura: centavos enteros seguros y contadores no negativos', () => {
    expect(analizarFacturaPeriodo(factura())).toMatchObject({ totalCentavos: 5000000, cantidadPagos: 1, cantidadArchivos: 2, estado: 'PENDIENTE' })
    expect(() => analizarFacturaPeriodo(factura({ total_centavos: 50000.5 }))).toThrow(ErrorConsultaFamilia)
    expect(() => analizarFacturaPeriodo(factura({ total_centavos: '5000000' }))).toThrow(ErrorConsultaFamilia)
    expect(() => analizarFacturaPeriodo(factura({ cantidad_archivos: -1 }))).toThrow(ErrorConsultaFamilia)
    expect(() => analizarFacturaPeriodo(factura({ estado: 'OTRO' }))).toThrow(ErrorConsultaFamilia)
    expect(() => analizarFacturaPeriodo(factura({ periodo: '2026-02-30' }))).toThrow(ErrorConsultaFamilia)
  })

  it('registro: datos no informados se conservan como null y no hay campos de archivo', () => {
    const sinDatos = analizarRegistroComprobante(registro({
      fecha_transferencia: null, importe_informado_centavos: null, cantidad_archivos: 0, ultima_carga_en: null, periodos: [],
    }))
    expect(sinDatos).toMatchObject({ fechaTransferencia: null, importeInformadoCentavos: null, cantidadArchivos: 0, ultimaCarga: null, periodos: [] })
    const ok = analizarRegistroComprobante(registro())
    expect(Object.keys(ok).sort()).toEqual([
      'cantidadArchivos', 'creadoEn', 'estado', 'fechaTransferencia', 'importeInformadoCentavos', 'pagoId',
      'periodos', 'totalCalculadoCentavos', 'ultimaCarga', 'items', 'reciboId', 'verificadoEn', 'motivoRechazo',
    ].sort())
    expect(() => analizarRegistroComprobante(registro({ cantidad_archivos: 0 }))).toThrow(ErrorConsultaFamilia)
    expect(() => analizarRegistroComprobante(registro({ cantidad_archivos: 1, ultima_carga_en: null }))).toThrow(ErrorConsultaFamilia)
    expect(() => analizarRegistroComprobante(registro({ periodos: 'x' }))).toThrow(ErrorConsultaFamilia)
    expect(() => analizarRegistroComprobante(registro({ estado: 'OTRO' }))).toThrow(ErrorConsultaFamilia)
  })
})

describe('consultas', () => {
  it('inscripciones: llama a la RPC con el alumno indicado y propaga la señal', async () => {
    const { cliente, llamadas } = clienteRpc({ data: [inscripcion()] })
    const control = new AbortController()
    const resultado = await consultarInscripciones(cliente, 'a1', control.signal)
    expect(resultado).toHaveLength(1)
    expect(llamadas).toEqual([{ nombre: 'consultar_inscripciones_alumno', args: { p_alumno_id: 'a1' }, senal: control.signal }])
  })

  it('facturas por período: envía el rango validado y rechaza filas de otro alumno', async () => {
    const { cliente, llamadas } = clienteRpc({ data: [factura()] })
    await expect(consultarFacturasPeriodo(cliente, 'a1', { desde: '2026-01-01', hasta: '2026-02-28' })).resolves.toHaveLength(1)
    expect(llamadas[0]).toMatchObject({ nombre: 'consultar_facturas_periodo', args: { p_alumno_id: 'a1', p_desde: '2026-01-01', p_hasta: '2026-02-28' } })
    const mezclado = clienteRpc({ data: [factura(), factura({ factura_id: 'f2', alumno_id: 'a2' })] })
    await expect(consultarFacturasPeriodo(mezclado.cliente, 'a1', { desde: '2026-01-01', hasta: '2026-02-28' }))
      .rejects.toMatchObject({ causa: 'respuesta' })
  })

  it('registro: envía criterio y rango, y una lista vacía es un resultado válido', async () => {
    const { cliente, llamadas } = clienteRpc({ data: [] })
    await expect(consultarRegistroComprobantes(cliente, 'a1', 'FECHA_TRANSFERENCIA', { desde: '2026-01-01', hasta: '2026-01-31' }))
      .resolves.toEqual([])
    expect(llamadas[0]).toMatchObject({
      nombre: 'consultar_registro_comprobantes',
      args: { p_alumno_id: 'a1', p_criterio: 'FECHA_TRANSFERENCIA', p_desde: '2026-01-01', p_hasta: '2026-01-31' },
    })
    const sinDatos = clienteRpc({ data: null })
    await expect(consultarInscripciones(sinDatos.cliente, 'a1')).resolves.toEqual([])
  })

  it('clasifica los errores sin revelar la existencia de datos ajenos', async () => {
    const rango = clienteRpc({ error: { code: 'P6871', message: 'detalle interno' } })
    await expect(consultarFacturasPeriodo(rango.cliente, 'a1', { desde: '2026-02-01', hasta: '2026-01-01' })).rejects.toMatchObject({ causa: 'rango' })
    const fecha = clienteRpc({ error: { code: '22008' } })
    await expect(consultarFacturasPeriodo(fecha.cliente, 'a1', { desde: '2026-02-01', hasta: '2026-03-01' })).rejects.toMatchObject({ causa: 'rango' })
    const permiso = clienteRpc({ error: { code: '42501', message: 'permission denied for function x' } })
    const error = (await consultarInscripciones(permiso.cliente, 'a1').then(() => null, (e: unknown) => e)) as ErrorConsultaFamilia
    expect(error).toMatchObject({ causa: 'permiso', message: 'No tenés permiso para consultar esta información.' })
    const red = clienteRpc({ error: { message: 'Failed to fetch' } })
    await expect(consultarInscripciones(red.cliente, 'a1')).rejects.toMatchObject({ causa: 'red' })
    // El mensaje mostrado nunca arrastra el detalle técnico del servidor.
    expect(String(error.message)).not.toMatch(/function|permission/u)
  })

  it('la respuesta que no es una lista se rechaza', async () => {
    const { cliente } = clienteRpc({ data: { no: 'lista' } })
    await expect(consultarInscripciones(cliente, 'a1')).rejects.toMatchObject({ causa: 'respuesta' })
  })
})

describe('historial paginado EPT-113',()=>{
 it('recorre más de mil registros y propaga rango y señal en cada página',async()=>{
  const registros=Array.from({length:1006},(_,n)=>registro({pago_id:`p${n}`}));const rangos:number[][]=[];let limite=[0,0]
  const mock={rpc:()=>{const q={range:(a:number,b:number)=>{limite=[a,b];rangos.push(limite);return q},abortSignal:()=>q,then:(resolver:(v:unknown)=>unknown)=>Promise.resolve({data:registros.slice(limite[0],limite[1]+1),error:null}).then(resolver)};return q}} as unknown as ClienteEPT
  const res=await consultarRegistroComprobantes(mock,'a1','PERIODO_FACTURA',{desde:'2026-01-01',hasta:'2026-12-31'},new AbortController().signal)
  expect(res).toHaveLength(1006);expect(rangos).toHaveLength(6);expect(res.at(-1)?.pagoId).toBe('p1005')
 })
 it('un contrato sin ítems no se presenta como historial completo',()=>{
  expect(()=>analizarRegistroComprobante(registro({items:undefined}))).toThrow(ErrorConsultaFamilia)
 })
})
