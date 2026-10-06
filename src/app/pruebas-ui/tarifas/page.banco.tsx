import { notFound } from 'next/navigation'
import TarifasLoading from '@/app/dashboard/tarifas/loading'
import { GestionTarifas } from '@/app/dashboard/tarifas/_components/GestionTarifas'
import { PanelErrorTarifas } from '@/app/dashboard/tarifas/_components/PanelErrorTarifas'
import { agruparTarifas, type FilaTarifa } from '@/lib/tarifas'

/**
 * Banco visual determinista de las tarifas (EPT-103).
 *
 * Solo existe en desarrollo y además exige la variable que Playwright define
 * para los harness de interfaz: `next.config.ts` no compila las páginas
 * `page.banco.tsx` en producción, y esta guarda en tiempo de ejecución se
 * conserva por si alguien cambiara esa configuración.
 *
 * Los datos son sintéticos y claramente identificables (referencias ficticias,
 * importes redondos): sirven para fotografiar estados de presentación (carga,
 * error, vacío, vigente, futura, finalizada, sin tarifa vigente) sin depender de
 * una base. NO demuestran ninguna regla de persistencia ni de autorización:
 * eso lo prueban `tarifas-auth.spec.ts`, `tarifas_administracion_rls.sql` y
 * `tarifas_administracion_concurrencia.mjs`.
 *
 * Las fechas son fijas y el día de lectura también (`hoy` = 2030-06-15), de modo
 * que el estado de cada versión no depende del reloj de quien ejecuta.
 */
export const dynamic = 'force-dynamic'

const HOY = '2030-06-15'

const NIVELES = [
  { referencia_id: '1', nombre: 'INICIAL', detalle: null, activa: true },
  { referencia_id: '2', nombre: 'PRIMARIO', detalle: null, activa: true },
  { referencia_id: '3', nombre: 'SECUNDARIO', detalle: null, activa: true },
]

const DEPORTES = [
  { referencia_id: 'e1030000-0000-4000-8000-000000000001', nombre: 'Deporte ficticio A', detalle: null, activa: true },
  { referencia_id: 'e1030000-0000-4000-8000-000000000002', nombre: 'Deporte ficticio B', detalle: null, activa: true },
  { referencia_id: 'e1030000-0000-4000-8000-000000000003', nombre: 'Deporte ficticio C', detalle: null, activa: false },
]

const RECORRIDOS = [
  { referencia_id: 'e1030000-0000-4000-8000-000000000020', nombre: 'Recorrido ficticio Norte', detalle: 'TR-NORTE', activa: true },
  { referencia_id: 'e1030000-0000-4000-8000-000000000021', nombre: 'Recorrido ficticio Sur', detalle: 'TR-SUR', activa: true },
]

const COMEDOR = [
  { referencia_id: 'e1030000-0000-4000-8000-000000000010', nombre: 'Comedor ficticio', detalle: 'COMEDOR', activa: true },
]

function fila(
  concepto: FilaTarifa['concepto'],
  referencia_id: string,
  id: string,
  importe: string,
  desde: string,
  hasta: string | null
): FilaTarifa {
  return { id, concepto, referencia_id, importe, desde, hasta }
}

const TARIFAS: FilaTarifa[] = [
  // Cuota inicial: una versión finalizada y una vigente sin fin (historial de dos versiones).
  fila('CUOTA', '1', 'e1030000-0000-4000-8000-0000000000a1', '30000.00', '2030-01-01', '2030-05-31'),
  fila('CUOTA', '1', 'e1030000-0000-4000-8000-0000000000a2', '1234567.89', '2030-06-01', null),
  // Primario: vigente hoy con fin propio y una próxima (futura).
  fila('CUOTA', '2', 'e1030000-0000-4000-8000-0000000000a3', '0.00', '2030-01-01', '2030-06-30'),
  fila('CUOTA', '2', 'e1030000-0000-4000-8000-0000000000a4', '45000.50', '2030-07-01', null),
  // Deporte A: vigente. Deporte B: sin tarifas (vacío). Deporte C: solo una versión ya terminada.
  fila('DEPORTE', DEPORTES[0].referencia_id, 'e1030000-0000-4000-8000-0000000000b1', '8000.00', '2030-01-01', null),
  fila('DEPORTE', DEPORTES[2].referencia_id, 'e1030000-0000-4000-8000-0000000000b3', '5000.00', '2029-01-01', '2029-12-31'),
  // Norte: solo futura (sin vigente hoy). Sur: sin tarifas.
  fila('TRANSPORTE', RECORRIDOS[0].referencia_id, 'e1030000-0000-4000-8000-0000000000c1', '12000.00', '2030-09-01', null),
  // Comedor: vigente.
  fila('COMEDOR', COMEDOR[0].referencia_id, 'e1030000-0000-4000-8000-0000000000d1', '9000.00', '2030-01-01', null),
]

export default async function BancoTarifas({
  searchParams,
}: {
  searchParams: Promise<{ estado?: 'datos' | 'carga' | 'error' | 'vacio' }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') {
    notFound()
  }

  const { estado = 'datos' } = await searchParams

  if (estado === 'carga') {
    return (
      <main className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
        <TarifasLoading />
      </main>
    )
  }

  if (estado === 'error') {
    return (
      <main className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
        <PanelErrorTarifas mensaje="No pudimos completar la operación. Volvé a intentarlo en unos minutos." />
      </main>
    )
  }

  const catalogos = {
    CUOTA: NIVELES,
    DEPORTE: DEPORTES,
    TRANSPORTE: RECORRIDOS,
    COMEDOR: COMEDOR,
  }

  return (
    <main className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
      <GestionTarifas
        grupos={agruparTarifas(catalogos, estado === 'vacio' ? [] : TARIFAS)}
        hoy={HOY}
      />
    </main>
  )
}
