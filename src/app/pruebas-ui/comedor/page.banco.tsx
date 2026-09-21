import { notFound } from 'next/navigation'
import ComedorLoading from '@/app/dashboard/comedor/loading'
import { InscriptosComedor } from '@/app/dashboard/comedor/_components/InscriptosComedor'
import { MiComedor } from '@/app/dashboard/comedor/_components/MiComedor'
import type {
  InscripcionServicio,
  ServicioEscolar,
} from '@/services/comedor.service'

/**
 * Banco visual determinista del comedor (EPT-10).
 *
 * Solo existe en desarrollo y además exige la variable que Playwright define
 * para los harness de interfaz: `next.config.ts` no compila las páginas
 * `page.banco.tsx` en producción, y esta guarda en tiempo de ejecución se
 * conserva por si alguien cambiara esa configuración.
 *
 * Los datos son sintéticos: personas inventadas con legajos ficticios. Sirven
 * para fotografiar estados de presentación (vacío, carga, error, duplicado,
 * alumno inactivo) sin depender de una base. NO demuestran ninguna regla de
 * persistencia ni de autorización: eso lo prueban las suites autenticadas.
 */
export const dynamic = 'force-dynamic'

const SERVICIO: ServicioEscolar = {
  id: 'e0000000-0000-4000-8000-000000000010',
  tipo: 'COMEDOR',
  codigo: 'COMEDOR',
  nombre: 'Comedor escolar',
  activo: true,
}

const SERVICIO_INACTIVO: ServicioEscolar = { ...SERVICIO, activo: false }

const INSCRIPCION_ACTIVA: InscripcionServicio = {
  id: '11111111-1111-4111-8111-111111111111',
  alumno_id: 'aaaaaaaa-1111-4111-8111-111111111111',
  alumno_nombre: 'Beto',
  alumno_apellido: 'Estudiante',
  legajo_nro: 'LEG-BANCO-0002',
  alumno_estado: 'ACTIVO',
  servicio_id: SERVICIO.id,
  servicio_tipo: 'COMEDOR',
  servicio_codigo: 'COMEDOR',
  servicio_nombre: 'Comedor escolar',
  estado: 'ACTIVA',
  fecha_inscripcion: '2026-09-15T12:30:00.000Z',
  fecha_cancelacion: null,
}

const INSCRIPCION_CANCELADA: InscripcionServicio = {
  ...INSCRIPCION_ACTIVA,
  id: '22222222-2222-4222-8222-222222222222',
  estado: 'CANCELADA',
  fecha_inscripcion: '2026-08-01T11:00:00.000Z',
  fecha_cancelacion: '2026-08-20T15:45:00.000Z',
}

const INSCRIPCION_AJENA: InscripcionServicio = {
  ...INSCRIPCION_ACTIVA,
  id: '33333333-3333-4333-8333-333333333333',
  alumno_id: 'aaaaaaaa-3333-4333-8333-333333333333',
  alumno_nombre: 'Celeste',
  alumno_apellido: 'Ajena',
  legajo_nro: 'LEG-BANCO-0003',
  fecha_inscripcion: '2026-09-10T09:15:00.000Z',
}

const MENSAJE_DUPLICADO = 'Ya tenés una inscripción activa al comedor.'

const MENSAJE_ALUMNO_INACTIVO =
  'Tu legajo académico no está activo, así que no podés inscribirte al comedor. ' +
  'Comunicate con la administración del centro educativo.'

export default async function BancoComedor({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: 'alumno' | 'director'
    estado?:
      | 'carga'
      | 'sin-inscripcion'
      | 'inscripto'
      | 'duplicado'
      | 'inactivo'
      | 'servicio-inactivo'
      | 'error'
    vacio?: string
  }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') {
    notFound()
  }

  const { vista = 'alumno', estado = 'sin-inscripcion', vacio } = await searchParams

  if (estado === 'carga') {
    return (
      <main className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
        <ComedorLoading />
      </main>
    )
  }

  if (vista === 'director') {
    return (
      <main className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
        <InscriptosComedor
          servicio={SERVICIO}
          inscripciones={
            vacio === '1'
              ? []
              : [INSCRIPCION_ACTIVA, INSCRIPCION_AJENA, INSCRIPCION_CANCELADA]
          }
        />
      </main>
    )
  }

  const inscripciones =
    estado === 'inscripto' || estado === 'duplicado'
      ? [INSCRIPCION_ACTIVA, INSCRIPCION_CANCELADA]
      : vacio === '1'
        ? []
        : [INSCRIPCION_CANCELADA]

  return (
    <main className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
      <MiComedor
        servicio={estado === 'servicio-inactivo' ? SERVICIO_INACTIVO : SERVICIO}
        inscripciones={inscripciones}
        impedimento={
          estado === 'inactivo'
            ? MENSAJE_ALUMNO_INACTIVO
            : estado === 'servicio-inactivo'
              ? 'El comedor no está recibiendo inscripciones en este momento.'
              : undefined
        }
        mensajeInicial={
          estado === 'duplicado'
            ? MENSAJE_DUPLICADO
            : estado === 'error'
              ? 'No pudimos completar la operación. Volvé a intentarlo en unos minutos.'
              : undefined
        }
      />
    </main>
  )
}
