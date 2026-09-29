import { notFound } from 'next/navigation'
import AlumnosLoading from '@/app/dashboard/alumnos/loading'
import { GestionAlumnos } from '@/app/dashboard/alumnos/_components/GestionAlumnos'
import { MatriculasAdministracion } from '@/components/inscripciones/MatriculasAdministracion'
import type { AlumnoAcademico, CursoAsignable } from '@/services/alumnos.service'
import type { MatriculaAdministracion } from '@/services/inscripciones-administracion.service'

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

/**
 * Matrículas de una alumna, como las lee Dirección (EPT-62): la vigente y dos
 * tramos cerrados del historial, uno por cada motivo de cierre. Sirven para
 * fotografiar el estado de confirmación sin depender de una base.
 */
const MATRICULA_VIGENTE: MatriculaAdministracion = {
  id: 'b1111111-1111-4111-8111-111111111111',
  alumno_id: 'a1111111-1111-4111-8111-111111111111',
  alumno_nombre: 'Camila',
  alumno_apellido: 'Arrieta',
  legajo_nro: 'LEG-2027-018',
  alumno_estado: 'ACTIVO',
  curso_id: '11111111-1111-4111-8111-111111111111',
  curso_denominacion: '1er Grado',
  curso_division: 'A',
  nivel_id: 2,
  nivel_nombre: 'PRIMARIO',
  fecha_inicio: '2026-03-02T12:00:00.000Z',
  fecha_cierre: null,
  motivo_cierre: null,
  vigente: true,
  confirmada: false,
  confirmada_en: null,
  confirmada_por_nombre: null,
  confirmada_por_apellido: null,
}

const MATRICULAS_CERRADAS: MatriculaAdministracion[] = [
  {
    ...MATRICULA_VIGENTE,
    id: 'b2222222-2222-4222-8222-222222222222',
    curso_denominacion: 'Sala de 5',
    curso_division: 'A',
    nivel_id: 1,
    nivel_nombre: 'INICIAL',
    fecha_inicio: '2025-03-03T12:00:00.000Z',
    fecha_cierre: '2026-03-02T12:00:00.000Z',
    motivo_cierre: 'CAMBIO_DE_CURSO',
    vigente: false,
    confirmada: true,
    confirmada_en: '2025-03-05T13:10:00.000Z',
    confirmada_por_nombre: 'Dora',
    confirmada_por_apellido: 'Directora',
  },
  {
    ...MATRICULA_VIGENTE,
    id: 'b3333333-3333-4333-8333-333333333333',
    curso_denominacion: 'Sala de 4',
    curso_division: 'B',
    nivel_id: 1,
    nivel_nombre: 'INICIAL',
    fecha_inicio: '2024-03-04T12:00:00.000Z',
    fecha_cierre: '2025-03-03T12:00:00.000Z',
    motivo_cierre: 'INACTIVACION',
    vigente: false,
  },
]

export default async function PruebasAlumnosPage({
  searchParams,
}: {
  searchParams: Promise<{
    vacio?: string
    'sin-cursos'?: string
    estado?: 'carga' | 'error' | 'exito'
    matriculas?: 'sin-confirmar' | 'confirmada' | 'vacio' | 'error-lectura'
  }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') {
    notFound()
  }

  const parametros = await searchParams
  const { vacio, estado } = parametros
  const sinCursos = parametros['sin-cursos']

  if (parametros.matriculas) {
    const vigente: MatriculaAdministracion =
      parametros.matriculas === 'confirmada'
        ? {
            ...MATRICULA_VIGENTE,
            confirmada: true,
            confirmada_en: '2026-03-03T15:40:00.000Z',
            confirmada_por_nombre: 'Dora',
            confirmada_por_apellido: 'Directora',
          }
        : MATRICULA_VIGENTE
    return (
      <main className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
        <div className="max-w-4xl mx-auto">
          <MatriculasAdministracion
            alumno="Arrieta, Camila"
            matriculas={parametros.matriculas === 'vacio' ? [] : [vigente, ...MATRICULAS_CERRADAS]}
            errorLectura={
              parametros.matriculas === 'error-lectura'
                ? 'No pudimos completar la operación. Volvé a intentarlo en unos minutos.'
                : undefined
            }
          />
        </div>
      </main>
    )
  }

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
