import { notFound } from 'next/navigation'
import DeportesLoading from '@/app/dashboard/deportes/loading'
import { GestionDeportes } from '@/app/dashboard/deportes/_components/GestionDeportes'
import { MisDeportes } from '@/app/dashboard/deportes/_components/MisDeportes'
import { PanelErrorLectura } from '@/app/dashboard/deportes/_components/Paneles'
import type {
  AlumnoInscribible,
  CompatibilidadPorGrupo,
  GrupoDeportivo,
  HorariosPorGrupo,
  InscripcionDeportiva,
} from '@/services/deportes.service'

/**
 * Banco visual determinista de deportes (EPT-11).
 *
 * Solo existe en desarrollo y además exige la variable que Playwright define
 * para los harness de interfaz: `next.config.ts` no compila las páginas
 * `page.banco.tsx` en producción, y esta guarda se conserva por si alguien
 * cambiara esa configuración.
 *
 * Los datos son sintéticos. Sirven para fotografiar estados de PRESENTACIÓN
 * (carga, vacío, error de lectura, límite, fallos de red o del servidor) sin
 * depender de una base. NO demuestran ninguna regla de persistencia ni de
 * autorización: eso lo prueban `deportes-auth.spec.ts`, `deportes_rls.sql` y
 * `deportes_concurrencia.mjs`.
 */
export const dynamic = 'force-dynamic'

const GRUPO_BASE: GrupoDeportivo = {
  grupo_id: '11111111-1111-4111-8111-111111111111',
  grupo_nombre: 'Primario turno mañana',
  deporte_id: 'e0000000-0000-4000-8000-000000000101',
  deporte_nombre: 'Fútbol',
  deporte_activo: true,
  nivel_id: 2,
  nivel_nombre: 'PRIMARIO',
  profesor_id: null,
  profesor_nombre: 'Darío',
  profesor_apellido: 'Docente',
  cupo: 20,
  ocupados: 12,
  disponibles: 8,
  activo: true,
  inscripcion_propia_id: null,
}

const GRUPOS: GrupoDeportivo[] = [
  GRUPO_BASE,
  {
    ...GRUPO_BASE,
    grupo_id: '22222222-2222-4222-8222-222222222222',
    grupo_nombre: 'Primario turno tarde con un nombre largo para probar el ajuste de línea',
    ocupados: 20,
    disponibles: 0,
  },
  {
    ...GRUPO_BASE,
    grupo_id: '33333333-3333-4333-8333-333333333333',
    grupo_nombre: 'Primario',
    deporte_id: 'e0000000-0000-4000-8000-000000000102',
    deporte_nombre: 'Natación',
    cupo: 10,
    ocupados: 9,
    disponibles: 1,
  },
  {
    ...GRUPO_BASE,
    grupo_id: '44444444-4444-4444-8444-444444444444',
    grupo_nombre: 'Primario',
    deporte_id: 'e0000000-0000-4000-8000-000000000103',
    deporte_nombre: 'Atletismo',
    cupo: 15,
    ocupados: 3,
    disponibles: 12,
  },
]

const INSCRIPCION: InscripcionDeportiva = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  alumno_id: 'bbbbbbbb-1111-4111-8111-111111111111',
  alumno_nombre: 'Beto',
  alumno_apellido: 'Estudiante',
  legajo_nro: 'LEG-BANCO-0002',
  grupo_id: GRUPOS[2].grupo_id,
  grupo_nombre: 'Primario',
  deporte_id: GRUPOS[2].deporte_id,
  deporte_nombre: 'Natación',
  nivel_id: 2,
  nivel_nombre: 'PRIMARIO',
  estado: 'ACTIVA',
  fecha_inscripcion: '2026-09-21T12:30:00.000Z',
  fecha_cancelacion: null,
}

const INSCRIPCION_ATLETISMO: InscripcionDeportiva = {
  ...INSCRIPCION,
  id: 'aaaaaaaa-2222-4222-8222-222222222222',
  grupo_id: GRUPOS[3].grupo_id,
  deporte_id: GRUPOS[3].deporte_id,
  deporte_nombre: 'Atletismo',
}

const INSCRIPCION_CANCELADA: InscripcionDeportiva = {
  ...INSCRIPCION,
  id: 'aaaaaaaa-3333-4333-8333-333333333333',
  grupo_id: GRUPO_BASE.grupo_id,
  deporte_id: GRUPO_BASE.deporte_id,
  deporte_nombre: 'Fútbol',
  grupo_nombre: GRUPO_BASE.grupo_nombre,
  estado: 'CANCELADA',
  fecha_inscripcion: '2026-09-01T11:00:00.000Z',
  fecha_cancelacion: '2026-09-10T15:45:00.000Z',
}

/** Franjas sintéticas (EPT-12). Fútbol choca con Natación el lunes. */
const franja = (id: string, grupoId: string, dia: number, inicio: string, fin: string) => ({
  id,
  grupo_id: grupoId,
  dia_semana: dia,
  hora_inicio: `${inicio}:00`,
  hora_fin: `${fin}:00`,
})

const HORARIOS: HorariosPorGrupo = {
  [GRUPOS[0].grupo_id]: [
    franja('f0000000-0000-4000-8000-000000000001', GRUPOS[0].grupo_id, 1, '10:00', '11:00'),
    franja('f0000000-0000-4000-8000-000000000002', GRUPOS[0].grupo_id, 3, '10:00', '11:00'),
  ],
  [GRUPOS[1].grupo_id]: [
    franja('f0000000-0000-4000-8000-000000000003', GRUPOS[1].grupo_id, 1, '16:00', '17:00'),
  ],
  [GRUPOS[2].grupo_id]: [
    franja('f0000000-0000-4000-8000-000000000004', GRUPOS[2].grupo_id, 1, '10:30', '11:30'),
  ],
  [GRUPOS[3].grupo_id]: [
    franja('f0000000-0000-4000-8000-000000000005', GRUPOS[3].grupo_id, 4, '10:00', '11:00'),
  ],
}

/** Grupo sin franjas: muestra el estado «sin horario». */
const GRUPO_SIN_HORARIO: GrupoDeportivo = {
  ...GRUPO_BASE,
  grupo_id: '55555555-5555-4555-8555-555555555555',
  grupo_nombre: 'Primario sin horario',
  deporte_id: 'e0000000-0000-4000-8000-000000000106',
  deporte_nombre: 'Básquet',
  ocupados: 0,
  disponibles: 20,
}

/** Compatibilidad con Natación activa: Fútbol (mañana) se superpone el lunes. */
const COMPATIBILIDAD_CON_NATACION: CompatibilidadPorGrupo = Object.fromEntries(
  [...GRUPOS, GRUPO_SIN_HORARIO].map((grupo) => [
    grupo.grupo_id,
    {
      grupo_id: grupo.grupo_id,
      tiene_horario: grupo.grupo_id in HORARIOS,
      conflicto:
        grupo.grupo_id === GRUPOS[0].grupo_id
          ? {
              deporte: 'Natación',
              grupo: 'Primario',
              dia_semana: 1,
              hora_inicio: '10:30:00',
              hora_fin: '11:30:00',
            }
          : null,
    },
  ])
)

const COMPATIBILIDAD_LIBRE: CompatibilidadPorGrupo = Object.fromEntries(
  [...GRUPOS, GRUPO_SIN_HORARIO].map((grupo) => [
    grupo.grupo_id,
    { grupo_id: grupo.grupo_id, tiene_horario: grupo.grupo_id in HORARIOS, conflicto: null },
  ])
)

const ALUMNOS: AlumnoInscribible[] = [
  {
    id: 'bbbbbbbb-1111-4111-8111-111111111111',
    nombre: 'Beto',
    apellido: 'Estudiante',
    legajo_nro: 'LEG-BANCO-0002',
    nivel_id: 2,
    nivel_nombre: 'PRIMARIO',
  },
]

const MENSAJE_INACTIVO =
  'Tu legajo académico no está activo, así que no podés inscribirte a deportes. Comunicate con la administración del centro educativo.'

export default async function BancoDeportes({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: 'alumno' | 'director'
    estado?:
      | 'carga'
      | 'disponible'
      | 'uno'
      | 'limite'
      | 'vacio'
      | 'inactivo'
      | 'error-lectura'
      | 'horarios'
      | 'sin-compatibilidad'
  }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') {
    notFound()
  }

  const { vista = 'alumno', estado = 'disponible' } = await searchParams

  const contenido = (() => {
    if (estado === 'carga') return <DeportesLoading />
    if (estado === 'error-lectura') {
      return (
        <PanelErrorLectura mensaje="No pudimos completar la operación. Volvé a intentarlo en unos minutos." />
      )
    }

    if (vista === 'director') {
      return (
        <GestionDeportes
          grupos={estado === 'vacio' ? [] : GRUPOS.map((grupo) => ({ ...grupo, profesor_id: 'cccccccc-1111-4111-8111-111111111111' }))}
          inscripciones={estado === 'vacio' ? [] : [INSCRIPCION, INSCRIPCION_ATLETISMO, INSCRIPCION_CANCELADA]}
          horarios={estado === 'vacio' ? {} : HORARIOS}
          alumnos={ALUMNOS}
          catalogo={{
            deportes: [
              { id: GRUPOS[0].deporte_id, nombre: 'Fútbol' },
              { id: GRUPOS[2].deporte_id, nombre: 'Natación' },
            ],
            niveles: [
              { id: 1, nombre: 'INICIAL' },
              { id: 2, nombre: 'PRIMARIO' },
            ],
            profesores: [{ id: 'cccccccc-1111-4111-8111-111111111111', nombre: 'Darío', apellido: 'Docente' }],
          }}
        />
      )
    }

    const activas =
      estado === 'limite'
        ? [INSCRIPCION, INSCRIPCION_ATLETISMO]
        : estado === 'uno' || estado === 'horarios' || estado === 'sin-compatibilidad'
          ? [INSCRIPCION]
          : []
    const grupos =
      estado === 'vacio' || estado === 'inactivo'
        ? []
        : [...GRUPOS, ...(estado === 'horarios' ? [GRUPO_SIN_HORARIO] : [])].map((grupo) => ({
            ...grupo,
            inscripcion_propia_id:
              activas.find((inscripcion) => inscripcion.grupo_id === grupo.grupo_id)?.id ?? null,
          }))

    return (
      <MisDeportes
        grupos={grupos}
        horarios={HORARIOS}
        compatibilidad={
          estado === 'sin-compatibilidad'
            ? null
            : activas.length > 0
              ? COMPATIBILIDAD_CON_NATACION
              : COMPATIBILIDAD_LIBRE
        }
        inscripciones={[...activas, INSCRIPCION_CANCELADA]}
        nivelNombre={estado === 'inactivo' ? null : 'PRIMARIO'}
        impedimento={estado === 'inactivo' ? MENSAJE_INACTIVO : undefined}
      />
    )
  })()

  return <main className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">{contenido}</main>
}
