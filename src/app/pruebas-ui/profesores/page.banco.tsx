import { notFound } from 'next/navigation'
import ProfesoresLoading from '@/app/dashboard/profesores/loading'
import { ErrorDeCarga } from '@/app/dashboard/profesores/_components/ErrorDeCarga'
import { GestionProfesores } from '@/app/dashboard/profesores/_components/GestionProfesores'
import type { FichaResumen } from '@/services/profesores.service'

/**
 * Banco visual determinista de Profesores (EPT-58). Solo existe en desarrollo y
 * además exige la variable que Playwright define para los bancos de interfaz.
 * Las personas son sintéticas. El detalle de cada ficha se pide a
 * `/api/profesores/:id`, que las pruebas interceptan.
 */
export const dynamic = 'force-dynamic'

/** Mismo orden por apellido que devuelve `listar_profesores`. */
const PROFESORES: FichaResumen[] = [
  {
    perfil_id: 'dddddddd-2222-4222-8222-222222222222',
    nombre: 'Tomás',
    apellido: 'Benítez',
    legajo_nro: null,
    especialidad: null,
    estado: 'ACTIVO',
    ficha_completa: false,
    rol_docente_vigente: true,
    asignaciones_activas: 0,
    grupos_activos: 0,
  },
  {
    perfil_id: 'dddddddd-3333-4333-8333-333333333333',
    nombre: 'Irene',
    apellido: 'Castro',
    legajo_nro: 'LEG-DOC-4472',
    especialidad: 'Educación Física',
    estado: 'INACTIVO',
    ficha_completa: true,
    rol_docente_vigente: true,
    asignaciones_activas: 0,
    grupos_activos: 0,
  },
  {
    perfil_id: 'dddddddd-4444-4444-8444-444444444444',
    nombre: 'Hugo',
    apellido: 'Paredes',
    legajo_nro: 'LEG-DOC-4473',
    especialidad: null,
    estado: 'INACTIVO',
    ficha_completa: false,
    rol_docente_vigente: false,
    asignaciones_activas: 0,
    grupos_activos: 0,
  },
  {
    perfil_id: 'dddddddd-1111-4111-8111-111111111111',
    nombre: 'Laura',
    apellido: 'Quinteros',
    legajo_nro: 'LEG-DOC-4471',
    especialidad: 'Ciencias Naturales',
    estado: 'ACTIVO',
    ficha_completa: true,
    rol_docente_vigente: true,
    asignaciones_activas: 2,
    grupos_activos: 1,
  },
]

export default async function PruebasProfesoresPage({
  searchParams,
}: {
  searchParams: Promise<{ vacio?: string; estado?: 'carga' | 'error' | 'exito' }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') {
    notFound()
  }

  const { vacio, estado } = await searchParams

  if (estado === 'carga') {
    return (
      <div className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
        <ProfesoresLoading />
      </div>
    )
  }

  if (estado === 'error') {
    return (
      <div className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
        <ErrorDeCarga mensaje="No pudimos completar la operación. Volvé a intentarlo en unos minutos." />
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
      <GestionProfesores
        profesores={vacio === '1' ? [] : PROFESORES}
        mensajeExitoInicial={estado === 'exito' ? 'Ficha de Quinteros, Laura guardada.' : undefined}
      />
    </div>
  )
}
