import { notFound } from 'next/navigation'
import MisAsignacionesLoading from '@/app/dashboard/mis-asignaciones/loading'
import { VistaMisAsignaciones } from '@/app/dashboard/mis-asignaciones/_components/VistaMisAsignaciones'
import type { MisAsignaciones } from '@/services/profesores.service'

/**
 * Banco visual determinista de «Mis asignaciones» (EPT-58). Solo existe en
 * desarrollo y con la variable de los bancos de interfaz. Datos sintéticos.
 */
export const dynamic = 'force-dynamic'

const MATERIA_BIOLOGIA = 'eeeeeeee-1111-4111-8111-111111111111'
const MATERIA_QUIMICA = 'eeeeeeee-2222-4222-8222-222222222222'
const GRUPO_VOLEY = 'eeeeeeee-3333-4333-8333-333333333333'
const MATERIA_FISICA = 'eeeeeeee-4444-4444-8444-444444444444'

const DATOS: MisAsignaciones = {
  ficha: {
    perfil_id: 'dddddddd-1111-4111-8111-111111111111',
    nombre: 'Laura',
    apellido: 'Quinteros',
    legajo_nro: 'LEG-DOC-4471',
    especialidad: 'Ciencias Naturales',
    estado: 'ACTIVO',
    ficha_completa: true,
  },
  asignaciones: [
    {
      tipo: 'MATERIA',
      relacion_id: MATERIA_BIOLOGIA,
      vigente: true,
      actividad_nombre: 'Biología',
      grupo_nombre: null,
      curso_denominacion: '3er Año',
      curso_division: 'A',
      nivel_nombre: 'SECUNDARIO',
      actividad_activa: true,
      curso_activo: true,
    },
    {
      tipo: 'MATERIA',
      relacion_id: MATERIA_QUIMICA,
      vigente: true,
      actividad_nombre: 'Química',
      grupo_nombre: null,
      curso_denominacion: '4to Año',
      curso_division: 'B',
      nivel_nombre: 'SECUNDARIO',
      actividad_activa: true,
      curso_activo: true,
    },
    {
      tipo: 'GRUPO_DEPORTIVO',
      relacion_id: GRUPO_VOLEY,
      vigente: true,
      actividad_nombre: 'Vóley',
      grupo_nombre: 'Grupo A',
      curso_denominacion: null,
      curso_division: null,
      nivel_nombre: 'SECUNDARIO',
      actividad_activa: true,
      curso_activo: null,
    },
    {
      tipo: 'MATERIA',
      relacion_id: MATERIA_FISICA,
      vigente: false,
      actividad_nombre: 'Física',
      grupo_nombre: null,
      curso_denominacion: '2do Año',
      curso_division: 'A',
      nivel_nombre: 'SECUNDARIO',
      actividad_activa: true,
      curso_activo: false,
    },
  ],
  horarios: [
    { tipo: 'MATERIA', relacion_id: MATERIA_BIOLOGIA, franja_id: 'ffffffff-1111-4111-8111-111111111111', dia_semana: 1, hora_inicio: '08:00:00', hora_fin: '09:20:00' },
    { tipo: 'MATERIA', relacion_id: MATERIA_BIOLOGIA, franja_id: 'ffffffff-2222-4222-8222-222222222222', dia_semana: 3, hora_inicio: '10:00:00', hora_fin: '11:20:00' },
    { tipo: 'MATERIA', relacion_id: MATERIA_QUIMICA, franja_id: 'ffffffff-3333-4333-8333-333333333333', dia_semana: 2, hora_inicio: '08:00:00', hora_fin: '09:20:00' },
    { tipo: 'GRUPO_DEPORTIVO', relacion_id: GRUPO_VOLEY, franja_id: 'ffffffff-4444-4444-8444-444444444444', dia_semana: 4, hora_inicio: '16:00:00', hora_fin: '17:30:00' },
  ],
}

export default async function PruebasMisAsignacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ vacio?: string; inactivo?: string; estado?: 'carga' }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') {
    notFound()
  }

  const { vacio, inactivo, estado } = await searchParams

  if (estado === 'carga') {
    return (
      <div className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
        <MisAsignacionesLoading />
      </div>
    )
  }

  const datos: MisAsignaciones = {
    ficha:
      inactivo === '1'
        ? { ...DATOS.ficha, estado: 'INACTIVO', especialidad: null, ficha_completa: false }
        : DATOS.ficha,
    asignaciones: vacio === '1' ? [] : DATOS.asignaciones,
    horarios: vacio === '1' ? [] : DATOS.horarios,
  }

  return (
    <div className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
      <VistaMisAsignaciones datos={datos} />
    </div>
  )
}
