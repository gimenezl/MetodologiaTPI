import { notFound } from 'next/navigation'
import TransporteLoading from '@/app/dashboard/transporte/loading'
import { GestionTransporte } from '@/app/dashboard/transporte/_components/GestionTransporte'
import { MiTransporte } from '@/app/dashboard/transporte/_components/MiTransporte'
import type {
  InscripcionTransporte,
  Recorrido,
} from '@/services/transporte.service'

/**
 * Banco visual determinista del transporte (EPT-60).
 *
 * Solo existe en desarrollo y además exige la variable que Playwright define
 * para los harness de interfaz: `next.config.ts` no compila las páginas
 * `page.banco.tsx` en producción, y esta guarda en tiempo de ejecución se
 * conserva por si alguien cambiara esa configuración.
 *
 * Los datos son sintéticos: personas y recorridos inventados con legajos
 * ficticios. Sirven para fotografiar estados de presentación (vacío, carga,
 * error, alumno inactivo, recorrido inactivo) sin depender de una base. NO
 * demuestran ninguna regla de persistencia ni de autorización: eso lo prueban
 * las suites autenticadas y `transporte_rls.sql` / `transporte_concurrencia.mjs`.
 */
export const dynamic = 'force-dynamic'

const TR_NORTE: Recorrido = {
  id: 'e0000000-0000-4000-8000-000000000020',
  codigo: 'TR-NORTE',
  nombre: 'Recorrido Norte (ficticio)',
  activo: true,
  paradas: [
    { orden: 1, nombre: 'Escuela' },
    { orden: 2, nombre: 'Plaza del Norte' },
    { orden: 3, nombre: 'Los Álamos' },
  ],
}

const TR_SUR: Recorrido = {
  id: 'e0000000-0000-4000-8000-000000000021',
  codigo: 'TR-SUR',
  nombre: 'Recorrido Sur (ficticio)',
  activo: true,
  paradas: [
    { orden: 1, nombre: 'Escuela' },
    { orden: 2, nombre: 'Parque del Sur' },
    { orden: 3, nombre: 'El Molino' },
  ],
}

const TR_ESTE: Recorrido = {
  id: 'e0000000-0000-4000-8000-000000000022',
  codigo: 'TR-ESTE',
  nombre: 'Recorrido Este (ficticio)',
  activo: false,
  paradas: [
    { orden: 1, nombre: 'Escuela' },
    { orden: 2, nombre: 'Centro Este' },
    { orden: 3, nombre: 'La Ribera' },
  ],
}

const TR_OESTE: Recorrido = {
  id: 'e0000000-0000-4000-8000-000000000023',
  codigo: 'TR-OESTE',
  nombre: 'Recorrido Oeste (ficticio)',
  activo: true,
  paradas: [
    { orden: 1, nombre: 'Escuela' },
    { orden: 2, nombre: 'Polideportivo Oeste' },
    { orden: 3, nombre: 'Los Aromos' },
  ],
}

const RECORRIDOS = [TR_NORTE, TR_SUR, TR_ESTE, TR_OESTE]

const INSCRIPCION_ACTIVA: InscripcionTransporte = {
  id: '11111111-1111-4111-8111-111111111111',
  alumno_id: 'aaaaaaaa-1111-4111-8111-111111111111',
  alumno_nombre: 'Beto',
  alumno_apellido: 'Estudiante',
  legajo_nro: 'LEG-BANCO-0002',
  alumno_estado: 'ACTIVO',
  servicio_id: TR_NORTE.id,
  servicio_codigo: TR_NORTE.codigo,
  servicio_nombre: TR_NORTE.nombre,
  estado: 'ACTIVA',
  fecha_inscripcion: '2026-09-15T12:30:00.000Z',
  fecha_cancelacion: null,
}

const INSCRIPCION_CANCELADA: InscripcionTransporte = {
  ...INSCRIPCION_ACTIVA,
  id: '22222222-2222-4222-8222-222222222222',
  servicio_id: TR_SUR.id,
  servicio_codigo: TR_SUR.codigo,
  servicio_nombre: TR_SUR.nombre,
  estado: 'CANCELADA',
  fecha_inscripcion: '2026-08-01T11:00:00.000Z',
  fecha_cancelacion: '2026-08-20T15:45:00.000Z',
}

const INSCRIPCION_AJENA: InscripcionTransporte = {
  ...INSCRIPCION_ACTIVA,
  id: '33333333-3333-4333-8333-333333333333',
  alumno_id: 'aaaaaaaa-3333-4333-8333-333333333333',
  alumno_nombre: 'Celeste',
  alumno_apellido: 'Ajena',
  legajo_nro: 'LEG-BANCO-0003',
  servicio_id: TR_OESTE.id,
  servicio_codigo: TR_OESTE.codigo,
  servicio_nombre: TR_OESTE.nombre,
  fecha_inscripcion: '2026-09-10T09:15:00.000Z',
}

const MENSAJE_ALUMNO_INACTIVO =
  'Tu legajo académico no está activo, así que no podés usar el transporte. ' +
  'Comunicate con la administración del centro educativo.'

export default async function BancoTransporte({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: 'alumno' | 'director'
    estado?: 'carga' | 'sin-recorrido' | 'con-recorrido' | 'inactivo' | 'error'
    vacio?: string
  }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') {
    notFound()
  }

  const { vista = 'alumno', estado = 'sin-recorrido', vacio } = await searchParams

  if (estado === 'carga') {
    return (
      <main className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
        <TransporteLoading />
      </main>
    )
  }

  if (vista === 'director') {
    return (
      <main className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
        <GestionTransporte
          recorridos={RECORRIDOS}
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
    estado === 'con-recorrido'
      ? [INSCRIPCION_ACTIVA, INSCRIPCION_CANCELADA]
      : vacio === '1'
        ? []
        : [INSCRIPCION_CANCELADA]

  return (
    <main className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
      <MiTransporte
        recorridos={RECORRIDOS}
        inscripciones={inscripciones}
        impedimento={estado === 'inactivo' ? MENSAJE_ALUMNO_INACTIVO : undefined}
        mensajeInicial={
          estado === 'error'
            ? 'No pudimos completar la operación. Volvé a intentarlo en unos minutos.'
            : undefined
        }
      />
    </main>
  )
}
