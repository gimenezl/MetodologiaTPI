import { createServerSupabaseClient } from '@/services/supabase.server'

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
 * NO aprueba ni rechaza (EPT-111): es una lectura.
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
}

export type ResultadoLectura =
  | { ok: true; datos: { pagos: PagoPendienteVista[]; truncado: boolean } }
  | { ok: false; mensaje: string }

const LIMITE = 200
const MENSAJE_FALLA = 'No pudimos cargar los pagos pendientes. Volvé a intentarlo en unos minutos.'

export async function obtenerPagosPendientes(): Promise<ResultadoLectura> {
  try {
    const supabase = await createServerSupabaseClient()

    const pagos = await supabase
      .from('pagos')
      .select(
        'id, alumno_id, creado_en, fecha_transferencia, numero_operacion, total_calculado::text, importe_informado::text'
      )
      .eq('estado', 'PENDIENTE_VERIFICACION')
      .order('creado_en', { ascending: false })
      .limit(LIMITE + 1)
    if (pagos.error) return { ok: false, mensaje: MENSAJE_FALLA }

    const filas = (pagos.data ?? []) as unknown as Array<{
      id: string
      alumno_id: string
      creado_en: string
      fecha_transferencia: string | null
      numero_operacion: string | null
      total_calculado: string
      importe_informado: string | null
    }>
    const truncado = filas.length > LIMITE
    const visibles = truncado ? filas.slice(0, LIMITE) : filas
    if (visibles.length === 0) return { ok: true, datos: { pagos: [], truncado: false } }

    const idsPago = visibles.map((p) => p.id)
    const idsAlumno = [...new Set(visibles.map((p) => p.alumno_id))]

    const [archivos, alumnos] = await Promise.all([
      supabase
        .from('comprobantes_pago')
        .select('id, pago_id, tipo_mime, tamano_bytes, creado_en')
        .in('pago_id', idsPago)
        .order('creado_en', { ascending: true }),
      supabase.from('perfiles').select('id, nombre, apellido').in('id', idsAlumno),
    ])
    if (archivos.error) return { ok: false, mensaje: MENSAJE_FALLA }

    const nombres = new Map<string, string>()
    for (const a of alumnos.data ?? []) {
      nombres.set(a.id, `${a.apellido}, ${a.nombre}`)
    }
    const porPago = new Map<string, ArchivoComprobante[]>()
    for (const f of archivos.data ?? []) {
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
        })),
      },
    }
  } catch {
    return { ok: false, mensaje: MENSAJE_FALLA }
  }
}
