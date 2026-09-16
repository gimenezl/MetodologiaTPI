import { notFound } from 'next/navigation'
import MateriasLoading from '@/app/dashboard/materias/loading'
import { GestionMaterias } from '@/app/dashboard/materias/_components/GestionMaterias'
import type {
  AsignacionMateria,
  CursoAsignableMateria,
  Materia,
  ProfesorAsignable,
} from '@/services/materias.service'

/**
 * Banco visual determinista. Solo existe en desarrollo y además exige la
 * variable que Playwright define para los harness de interfaz.
 */
export const dynamic = 'force-dynamic'

/** Mismo orden alfabético por nombre que devuelve `listarMaterias`. */
const MATERIAS: Materia[] = [
  { id: 3, nombre: 'Historia', activo: false },
  { id: 2, nombre: 'Lengua y Literatura', activo: true },
  { id: 1, nombre: 'Matemática', activo: true },
]

const ASIGNACIONES: AsignacionMateria[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    materia_id: 1,
    materia_nombre: 'Matemática',
    materia_activa: true,
    curso_id: 'aaaaaaaa-1111-4111-8111-111111111111',
    curso_denominacion: '1er Grado',
    curso_division: 'A',
    curso_activo: true,
    nivel_nombre: 'PRIMARIO',
    profesor_id: 'bbbbbbbb-1111-4111-8111-111111111111',
    profesor_nombre: 'Darío',
    profesor_apellido: 'Docente',
    activo: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    materia_id: 1,
    materia_nombre: 'Matemática',
    materia_activa: true,
    curso_id: 'aaaaaaaa-2222-4222-8222-222222222222',
    curso_denominacion: '1er Grado',
    curso_division: 'B',
    curso_activo: false,
    nivel_nombre: 'PRIMARIO',
    profesor_id: null,
    profesor_nombre: null,
    profesor_apellido: null,
    activo: false,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    materia_id: 3,
    materia_nombre: 'Historia',
    materia_activa: false,
    curso_id: 'aaaaaaaa-1111-4111-8111-111111111111',
    curso_denominacion: '1er Grado',
    curso_division: 'A',
    curso_activo: true,
    nivel_nombre: 'PRIMARIO',
    profesor_id: 'bbbbbbbb-1111-4111-8111-111111111111',
    profesor_nombre: 'Darío',
    profesor_apellido: 'Docente',
    activo: true,
  },
]

const CURSOS: CursoAsignableMateria[] = [
  {
    id: 'aaaaaaaa-1111-4111-8111-111111111111',
    denominacion: '1er Grado',
    division: 'A',
    nivel_nombre: 'PRIMARIO',
  },
  {
    id: 'aaaaaaaa-3333-4333-8333-333333333333',
    denominacion: 'Sala de 5',
    division: 'A',
    nivel_nombre: 'INICIAL',
  },
]

const PROFESORES: ProfesorAsignable[] = [
  { id: 'bbbbbbbb-1111-4111-8111-111111111111', nombre: 'Darío', apellido: 'Docente' },
  { id: 'bbbbbbbb-2222-4222-8222-222222222222', nombre: 'Elena', apellido: 'Suplente' },
]

export default async function PruebasMateriasPage({
  searchParams,
}: {
  searchParams: Promise<{
    vacio?: string
    'sin-cursos'?: string
    estado?: 'carga' | 'error' | 'exito'
  }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') {
    notFound()
  }

  const parametros = await searchParams
  const { vacio, estado } = parametros
  const sinCursos = parametros['sin-cursos'] === '1'

  if (estado === 'carga') {
    return (
      <div className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
        <MateriasLoading />
      </div>
    )
  }

  const mensajeInicial =
    estado === 'error'
      ? ({
          tipo: 'error',
          texto: 'No pudimos guardar el cambio. Revisá los datos y volvé a intentarlo.',
        } as const)
      : estado === 'exito'
        ? ({ tipo: 'exito', texto: 'Materia actualizada correctamente.' } as const)
        : undefined

  return (
    <div className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
      <GestionMaterias
        materias={vacio === '1' ? [] : MATERIAS}
        asignaciones={vacio === '1' ? [] : ASIGNACIONES}
        cursos={sinCursos ? [] : CURSOS}
        profesores={PROFESORES}
        mensajeInicial={mensajeInicial}
      />
    </div>
  )
}
