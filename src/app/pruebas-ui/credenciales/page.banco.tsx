import { notFound } from 'next/navigation'
import { AccionesCredencial } from '@/components/credenciales/AccionesCredencial'
import { ErrorDeLectura } from '@/components/credenciales/EstadosPagina'
import { HistorialCredenciales } from '@/components/credenciales/HistorialCredenciales'
import { PanelCredenciales } from '@/components/credenciales/PanelCredenciales'
import { TarjetaCredencial, type VistaCredencial } from '@/components/credenciales/TarjetaCredencial'
import Cargando from '@/app/dashboard/credenciales/loading'
import { generarUriQr } from '@/lib/credenciales-qr/imagen'
import type {
  EntradaHistorial,
  EstadoTarjeta,
  FilaPanel,
  TarjetaCredencial as Tarjeta,
} from '@/lib/credenciales-qr/tipos'

export const dynamic = 'force-dynamic'

/**
 * Banco visual de la credencial QR (EPT-64). Solo existe con `EPT_UI_HARNESS=1`
 * y nunca en producción.
 *
 * Todo lo que muestra es FICTICIO. El texto del QR tiene el formato del payload
 * pero una firma de ceros y un `kid` que ninguna configuración conoce: es
 * IMPOSIBLE de validar en cualquier entorno. Los nombres y legajos son de
 * fantasía. Sirve para probar la presentación; la integración se prueba con
 * sesiones reales en `credenciales-qr-auth.spec.ts`.
 */

const TEXTO_FICTICIO = `EPT1.pruebas.${'A'.repeat(22)}.${'A'.repeat(43)}`

const ALUMNO = {
  id: 'eeeeeeee-6400-4000-8000-000000000001',
  nombre: 'Lucía',
  apellido: 'Ejemplo Ficticia',
  legajo_nro: 'LEG-PRUEBA-0064',
} as const

const EMITIDA = '2026-10-12T15:00:00.000Z'

function tarjetaDe(estado: EstadoTarjeta, inactivo = false): Tarjeta {
  const base = {
    alumno: { ...ALUMNO, estado: inactivo ? ('INACTIVO' as const) : ('ACTIVO' as const) },
  }
  switch (estado) {
    case 'SIN_CREDENCIAL':
      return { ...base, estado, credencial: null, qr: null }
    case 'REVOCADA':
      return {
        ...base,
        estado,
        credencial: { id: 'eeeeeeee-6400-4000-8000-000000000002', emitida_en: EMITIDA, revocada_en: '2026-10-14T15:00:00.000Z' },
        qr: null,
      }
    case 'VIGENTE':
      return {
        ...base,
        estado,
        credencial: { id: 'eeeeeeee-6400-4000-8000-000000000003', emitida_en: EMITIDA, revocada_en: null },
        qr: generarUriQr(TEXTO_FICTICIO),
      }
    default:
      return {
        ...base,
        estado,
        credencial: { id: 'eeeeeeee-6400-4000-8000-000000000003', emitida_en: EMITIDA, revocada_en: null },
        qr: null,
      }
  }
}

const HISTORIAL: EntradaHistorial[] = [
  {
    id: 'eeeeeeee-6400-4000-8000-000000000003',
    estado: 'ACTIVA',
    emitida_en: '2026-10-14T15:00:00.000Z',
    emitida_por_nombre: 'Dirección Ficticia',
    revocada_en: null,
    revocada_por_nombre: null,
    motivo_revocacion: null,
    reemplaza_a: 'eeeeeeee-6400-4000-8000-000000000002',
  },
  {
    id: 'eeeeeeee-6400-4000-8000-000000000002',
    estado: 'REVOCADA',
    emitida_en: EMITIDA,
    emitida_por_nombre: 'Dirección Ficticia',
    revocada_en: '2026-10-14T15:00:00.000Z',
    revocada_por_nombre: 'Dirección Ficticia',
    motivo_revocacion: 'Extravío de la tarjeta',
    reemplaza_a: null,
  },
]

const FILAS: FilaPanel[] = [
  { id: 'a1', nombre: 'Lucía', apellido: 'Ejemplo Ficticia', legajo_nro: 'LEG-PRUEBA-0064', estado: 'ACTIVO', curso: '1er Grado A', credencial: 'VIGENTE', emitida_en: EMITIDA },
  { id: 'a2', nombre: 'Mateo', apellido: 'Muestra Inventado', legajo_nro: 'LEG-PRUEBA-0065', estado: 'ACTIVO', curso: '1er Grado A', credencial: 'SIN_CREDENCIAL', emitida_en: null },
  { id: 'a3', nombre: 'Sofía', apellido: 'Prueba Imaginaria', legajo_nro: null, estado: 'INACTIVO', curso: null, credencial: 'REVOCADA', emitida_en: null },
]

const ESTADOS_TARJETA: Record<string, { estado: EstadoTarjeta; inactivo?: boolean }> = {
  vigente: { estado: 'VIGENTE' },
  'sin-credencial': { estado: 'SIN_CREDENCIAL' },
  revocada: { estado: 'REVOCADA' },
  inactivo: { estado: 'ALUMNO_INACTIVO', inactivo: true },
  bloqueado: { estado: 'ACCESO_BLOQUEADO' },
}

const VISTAS: Record<string, VistaCredencial> = {
  propia: 'PROPIA',
  hijo: 'HIJO',
  direccion: 'DIRECCION',
}

export default async function BancoCredenciales({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; vista?: string }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') notFound()
  const { estado = 'vigente', vista = 'propia' } = await searchParams

  if (estado === 'carga') return <Cargando />
  if (estado === 'error') {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <ErrorDeLectura
          titulo="No pudimos cargar tu credencial"
          mensaje="Las credenciales no están disponibles en este momento. Volvé a intentarlo en unos minutos."
          reintentarHref="/pruebas-ui/credenciales"
        />
      </div>
    )
  }
  if (estado === 'panel') return <div className="mx-auto max-w-4xl p-4"><PanelCredenciales filas={FILAS} /></div>
  if (estado === 'panel-vacio') return <div className="mx-auto max-w-4xl p-4"><PanelCredenciales filas={[]} /></div>
  if (estado === 'historial') return <div className="mx-auto max-w-2xl p-4"><HistorialCredenciales historial={HISTORIAL} /></div>

  const configuracion = ESTADOS_TARJETA[estado] ?? ESTADOS_TARJETA.vigente
  const tarjeta = tarjetaDe(configuracion.estado, configuracion.inactivo)
  const vistaElegida = VISTAS[vista] ?? 'PROPIA'

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 id="titulo-banco" className="text-2xl font-extrabold tracking-tight text-neutral-900 print:hidden">
        Mi credencial
      </h1>
      <TarjetaCredencial tarjeta={tarjeta} vista={vistaElegida} idTitulo="titulo-banco" />
      {vistaElegida === 'DIRECCION' && (
        <div className="print:hidden">
          <AccionesCredencial tarjeta={tarjeta} />
        </div>
      )}
    </main>
  )
}
