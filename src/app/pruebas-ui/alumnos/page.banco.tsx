import { notFound } from 'next/navigation'
import AlumnosLoading from '@/app/dashboard/alumnos/loading'
import { GestionAlumnos } from '@/app/dashboard/alumnos/_components/GestionAlumnos'
import type { AlumnoAcademico, CursoAsignable } from '@/services/alumnos.service'

/**
 * Banco visual determinista. Solo existe en desarrollo y además exige la
 * variable que Playwright define para los harness de interfaz.
 *
 * Los datos son sintéticos y no representan a ninguna persona real. Este banco
 * demuestra comportamiento de presentación; la persistencia se demuestra en
 * `tests/alumnos-auth.spec.ts` contra la base local.
 */
export const dynamic = 'force-dynamic'

const CURSOS: CursoAsignable[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    denominacion: '1er Grado',
    division: 'A',
    nivel_id: 2,
    nivel_nombre: 'PRIMARIO',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    denominacion: '2do Grado',
    division: 'B',
    nivel_id: 2,
    nivel_nombre: 'PRIMARIO',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    denominacion: 'Sala de 5',
    division: 'A',
    nivel_id: 1,
    nivel_nombre: 'INICIAL',
  },
]

const ALUMNOS: AlumnoAcademico[] = [
  {
    id: 'a1111111-1111-4111-8111-111111111111',
    nombre: 'Camila',
    apellido: 'Arrieta',
    dni: '48213907',
    legajo_nro: 'LEG-2027-018',
    fecha_nacimiento: '2016-04-11',
    telefono: '0362 4471902',
    direccion: 'Pasaje Los Lapachos 480',
    estado: 'ACTIVO',
    fecha_actualizacion: '2026-09-10T13:20:00.000Z',
    tiene_cuenta: true,
    matricula_id: 'm1111111-1111-4111-8111-111111111111',
    matricula_desde: '2026-03-02T12:00:00.000Z',
    curso_id: '11111111-1111-4111-8111-111111111111',
    curso_denominacion: '1er Grado',
    curso_division: 'A',
    curso_activo: true,
    nivel_id: 2,
    nivel_nombre: 'PRIMARIO',
  },
  {
    id: 'a2222222-2222-4222-8222-222222222222',
    nombre: 'Bautista',
    apellido: 'Ferreyra',
    dni: '4719238',
    legajo_nro: 'LEG-2027-041',
    fecha_nacimiento: '2014-09-27',
    telefono: null,
    direccion: null,
    estado: 'ACTIVO',
    fecha_actualizacion: '2026-09-11T09:05:00.000Z',
    tiene_cuenta: false,
    matricula_id: 'm2222222-2222-4222-8222-222222222222',
    matricula_desde: '2026-03-02T12:00:00.000Z',
    curso_id: '44444444-4444-4444-8444-444444444444',
    curso_denominacion: 'Sala de 4',
    curso_division: 'C',
    curso_activo: false,
    nivel_id: 1,
    nivel_nombre: 'INICIAL',
  },
  {
    id: 'a3333333-3333-4333-8333-333333333333',
    nombre: 'Renata',
    apellido: 'Quiroga',
    dni: '50124876',
    legajo_nro: 'LEG-2026-233',
    fecha_nacimiento: '2018-01-19',
    telefono: '0362 4638214',
    direccion: null,
    estado: 'INACTIVO',
    fecha_actualizacion: '2026-08-29T16:40:00.000Z',
    tiene_cuenta: false,
    matricula_id: null,
    matricula_desde: null,
    curso_id: null,
    curso_denominacion: null,
    curso_division: null,
    curso_activo: null,
    nivel_id: null,
    nivel_nombre: null,
  },
  {
    id: 'a4444444-4444-4444-8444-444444444444',
    nombre: 'Thiago',
    apellido: 'Zalazar',
    dni: '49660312',
    legajo_nro: null,
    fecha_nacimiento: null,
    telefono: null,
    direccion: null,
    estado: 'INACTIVO',
    fecha_actualizacion: '2026-09-01T11:15:00.000Z',
    tiene_cuenta: false,
    matricula_id: null,
    matricula_desde: null,
    curso_id: null,
    curso_denominacion: null,
    curso_division: null,
    curso_activo: null,
    nivel_id: null,
    nivel_nombre: null,
  },
]

export default async function PruebasAlumnosPage({
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
  const sinCursos = parametros['sin-cursos']

  if (estado === 'carga') {
    return (
      <div className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
        <AlumnosLoading />
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
        ? ({ tipo: 'exito', texto: 'Legajo académico actualizado correctamente.' } as const)
        : undefined

  return (
    <div className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
      <GestionAlumnos
        alumnos={vacio === '1' ? [] : ALUMNOS}
        cursos={sinCursos === '1' ? [] : CURSOS}
        mensajeInicial={mensajeInicial}
      />
    </div>
  )
}
