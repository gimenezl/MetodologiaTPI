import { createServerSupabaseClient } from '@/services/supabase.server'
import { leerTodasLasFilas } from '@/lib/paginacion'

/**
 * Lectura de pagos pendientes con sus comprobantes para Dirección (EPT-109).
 *
 * Solo servidor. Nunca usa `service_role`: las lecturas atraviesan RLS con la
 * sesión del usuario (solo un DIRECTOR habilitado ve `pagos` ajenos y
 * `comprobantes_pago`; EPT-101). No expone la ruta del archivo: el original se
 * pide por `/api/comprobantes/[id]/archivo`, que firma una URL de 60 s con las
 * credenciales de quien descarga.
 *
 * Dinero como texto exacto (`::text`), sin pasar por `number`.
 *
 * La decisión se realiza por la RPC de EPT-111, nunca por estas lecturas.
 */

export interface ArchivoComprobante {
  id: string
  tipoMime: string
  tamanoBytes: number
  creadoEn: string
}

export interface PagoPendienteVista {
  pagoId: string
  alumno: string
  creadoEn: string
  totalCalculado: string
  importeInformado: string | null
  fechaTransferencia: string | null
  numeroOperacion: string | null
  archivos: ArchivoComprobante[]
  estado: 'PENDIENTE_VERIFICACION' | 'APROBADO' | 'RECHAZADO'
  reciboId: string | null
  motivoRechazo: string | null
  items: Array<{ itemId: string; facturaId: string; periodo: string; tipo: string; importe: string }>
}

export type ResultadoLectura =
  | { ok: true; datos: { pagos: PagoPendienteVista[]; truncado: boolean } }
  | { ok: false; mensaje: string }

const LIMITE = 200
type ArchivoFila = { id: string; pago_id: string; tipo_mime: string; tamano_bytes: number; creado_en: string }
type ItemFila = { id: string; pago_id: string; item_factura_id: string; importe: string;
  items_factura: { factura_id: string; tipo: string; facturas: { periodo: string } } }
const MENSAJE_FALLA = 'No pudimos cargar los pagos pendientes. Volvé a intentarlo en unos minutos.'

export async function obtenerPagosPendientes(pagina = 1, pagoId?: string): Promise<ResultadoLectura> {
  try {
    const supabase = await createServerSupabaseClient()

    let consulta = supabase
      .from('pagos')
      .select(
        'id, alumno_id, creado_en, fecha_transferencia, numero_operacion, total_calculado::text, importe_informado::text, estado, motivo_rechazo'
      )
      .order('creado_en', { ascending: false })
      .order('id', { ascending: false })
    consulta = pagoId ? consulta.eq('id', pagoId) : consulta.eq('estado', 'PENDIENTE_VERIFICACION')
    const inicio = pagoId ? 0 : (pagina - 1) * LIMITE
    const pagos = await consulta.range(inicio, inicio + LIMITE)
    if (pagos.error) return { ok: false, mensaje: MENSAJE_FALLA }

    const filas = (pagos.data ?? []) as unknown as Array<{
      id: string
      alumno_id: string
      creado_en: string
      fecha_transferencia: string | null
      numero_operacion: string | null
      total_calculado: string
      importe_informado: string | null
      estado: PagoPendienteVista['estado']
      motivo_rechazo: string | null
    }>
    const truncado = filas.length > LIMITE
    const visibles = truncado ? filas.slice(0, LIMITE) : filas
    if (visibles.length === 0) return { ok: true, datos: { pagos: [], truncado: false } }

    const idsPago = visibles.map((p) => p.id)
    const idsAlumno = [...new Set(visibles.map((p) => p.alumno_id))]

    const [archivos, alumnos, imputaciones, recibos] = await Promise.all([
      leerTodasLasFilas<ArchivoFila>((desde, hasta) => supabase
        .from('comprobantes_pago')
        .select('id, pago_id, tipo_mime, tamano_bytes, creado_en')
        .in('pago_id', idsPago)
        .order('creado_en', { ascending: true }).order('id').range(desde, hasta)),
      supabase.from('perfiles').select('id, nombre, apellido').in('id', idsAlumno),
      leerTodasLasFilas<ItemFila>(async (desde, hasta) => {
        const r = await supabase.from('imputaciones_pago')
          .select('pago_id, item_factura_id, importe::text, items_factura(factura_id, tipo, facturas(periodo))')
          .in('pago_id', idsPago).order('pago_id').order('item_factura_id').range(desde, hasta)
        return { error: r.error, data: r.data?.map(x => ({ ...x, id: `${x.pago_id}:${x.item_factura_id}` })) ?? null }
      }),
      supabase.from('recibos').select('id,pago_id').in('pago_id',idsPago),
    ])
    if (recibos.error) return { ok: false, mensaje: MENSAJE_FALLA }
    if (!archivos.ok || alumnos.error || !imputaciones.ok) return { ok: false, mensaje: MENSAJE_FALLA }

    const porItems = new Map<string, PagoPendienteVista['items']>()
    for (const x of imputaciones.datos) {
      const lista = porItems.get(x.pago_id) ?? []
      lista.push({ itemId: x.item_factura_id, facturaId: x.items_factura.factura_id,
        periodo: x.items_factura.facturas.periodo, tipo: x.items_factura.tipo, importe: x.importe })
      porItems.set(x.pago_id, lista)
    }

    const nombres = new Map<string, string>()
    for (const a of alumnos.data ?? []) {
      nombres.set(a.id, `${a.apellido}, ${a.nombre}`)
    }
    const porPago = new Map<string, ArchivoComprobante[]>()
    for (const f of archivos.datos) {
      const lista = porPago.get(f.pago_id) ?? []
      lista.push({
        id: f.id,
        tipoMime: f.tipo_mime,
        tamanoBytes: Number(f.tamano_bytes),
        creadoEn: f.creado_en,
      })
      porPago.set(f.pago_id, lista)
    }

    return {
      ok: true,
      datos: {
        truncado,
        pagos: visibles.map((p) => ({
          pagoId: p.id,
          alumno: nombres.get(p.alumno_id) ?? 'Alumno sin datos de perfil',
          creadoEn: p.creado_en,
          totalCalculado: p.total_calculado,
          importeInformado: p.importe_informado,
          fechaTransferencia: p.fecha_transferencia,
          numeroOperacion: p.numero_operacion,
          archivos: porPago.get(p.id) ?? [],
          estado: p.estado,
          reciboId: recibos.data?.find(r=>r.pago_id===p.id)?.id ?? null,
          motivoRechazo: p.motivo_rechazo,
          items: porItems.get(p.id) ?? [],
        })),
      },
    }
  } catch {
    return { ok: false, mensaje: MENSAJE_FALLA }
  }
}
