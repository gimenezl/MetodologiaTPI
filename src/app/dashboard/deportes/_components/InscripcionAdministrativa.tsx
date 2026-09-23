'use client'

import { useRef, useState, type FormEvent } from 'react'
import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { Select } from '@/components/ui/Input'
import { describirFranjaBreve, MENSAJE_SIN_HORARIO, mensajeConflicto, ordenarFranjas } from '@/lib/horarios'
import {
  consultarCompatibilidadRemota,
  ErrorDeportes,
  inscribirAlumnoRemoto,
} from '@/services/deportes.client'
import type {
  AlumnoInscribible,
  CompatibilidadGrupo,
  GrupoDeportivo,
  HorariosPorGrupo,
} from '@/services/deportes.service'
import { nombreNivel } from './formato'

type Consulta =
  | { estado: 'inactiva' }
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'lista'; grupos: CompatibilidadGrupo[] }

/**
 * Alta deportiva de un alumno realizada por la dirección (EPT-40).
 *
 * La dirección elige el alumno y, entre los grupos activos de SU nivel, el
 * grupo. Al elegir el alumno se consulta su compatibilidad horaria en la base,
 * con la misma función que decide el alta, y se muestra para el grupo elegido:
 * sin conflictos, sin horario o el conflicto con deporte, día y rango.
 *
 * La consulta no bloquea el envío: la decisión es de PostgreSQL, que aplica
 * exactamente las mismas reglas que al alta del propio alumno —cupo, nivel,
 * máximo de dos, duplicados y horario— y responde con el motivo si rechaza.
 * No hay cancelación ni edición administrativa acá: eso es EPT-62.
 */
export function InscripcionAdministrativa({
  alumnos,
  grupos,
  horarios,
  onCerrar,
  onInscripto,
}: {
  alumnos: AlumnoInscribible[]
  grupos: GrupoDeportivo[]
  horarios: HorariosPorGrupo
  onCerrar: () => void
  onInscripto: (mensaje: string) => void
}) {
  const [alumnoId, setAlumnoId] = useState('')
  const [grupoId, setGrupoId] = useState('')
  const [consulta, setConsulta] = useState<Consulta>({ estado: 'inactiva' })
  const [errores, setErrores] = useState<{ alumno_id?: string; grupo_id?: string }>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // Descarta respuestas de una consulta anterior si la persona cambió de alumno.
  const consultaVigente = useRef(0)

  const alumno = alumnos.find((candidato) => candidato.id === alumnoId)
  const gruposDelNivel =
    consulta.estado === 'lista'
      ? consulta.grupos
          .map((compatibilidad) => ({
            compatibilidad,
            grupo: grupos.find((grupo) => grupo.grupo_id === compatibilidad.grupo_id),
          }))
          .filter(
            (fila): fila is { compatibilidad: CompatibilidadGrupo; grupo: GrupoDeportivo } =>
              fila.grupo !== undefined
          )
      : []
  const elegido = gruposDelNivel.find((fila) => fila.grupo.grupo_id === grupoId)

  function elegirAlumno(id: string) {
    setAlumnoId(id)
    setGrupoId('')
    setErrores({})
    setErrorGeneral(null)
    if (!id) {
      consultaVigente.current += 1
      setConsulta({ estado: 'inactiva' })
      return
    }
    void consultar(id)
  }

  /** Lee la compatibilidad en la base. No toca la selección ni los avisos. */
  async function consultar(id: string) {
    const numero = ++consultaVigente.current
    setConsulta({ estado: 'cargando' })
    try {
      const respuesta = await consultarCompatibilidadRemota(id)
      if (numero !== consultaVigente.current) return
      setConsulta({ estado: 'lista', grupos: respuesta })
    } catch (problema) {
      if (numero !== consultaVigente.current) return
      setConsulta({
        estado: 'error',
        mensaje:
          problema instanceof ErrorDeportes
            ? problema.message
            : 'No pudimos consultar los grupos del alumno. Volvé a intentarlo.',
      })
    }
  }

  async function inscribir(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (enviando) return

    const encontrados: { alumno_id?: string; grupo_id?: string } = {}
    if (!alumnoId) encontrados.alumno_id = 'Seleccioná un alumno'
    if (!grupoId) encontrados.grupo_id = 'Seleccioná un grupo deportivo'
    setErrores(encontrados)
    setErrorGeneral(null)
    if (Object.keys(encontrados).length > 0) return

    setEnviando(true)
    try {
      await inscribirAlumnoRemoto({ alumno_id: alumnoId, grupo_id: grupoId })
      onInscripto(
        `Inscribiste a ${alumno?.apellido}, ${alumno?.nombre} en ${elegido?.grupo.deporte_nombre} (${elegido?.grupo.grupo_nombre}).`
      )
    } catch (problema) {
      setErrorGeneral(
        problema instanceof ErrorDeportes
          ? problema.estado === 401
            ? 'Tu sesión venció. Iniciá sesión nuevamente para continuar.'
            : problema.message
          : 'No pudimos completar la inscripción. Volvé a intentarlo.'
      )
      // El rechazo pudo deberse a un cambio de otra persona: se vuelve a
      // consultar la compatibilidad para mostrar el estado actual.
      void consultar(alumnoId)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo
      tituloId="deportes-inscripcion-administrativa"
      titulo="Inscribir a un alumno"
      descripcion="La inscripción pasa por las mismas reglas que cuando se inscribe el propio alumno: cupo, nivel, máximo de dos deportes y compatibilidad horaria."
      selectorFocoInicial="#inscripcion-alumno"
      onCerrar={() => {
        if (!enviando) onCerrar()
      }}
    >
      <form onSubmit={inscribir} noValidate className="space-y-4">
        {errorGeneral && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2 items-start text-sm text-red-800"
          >
            <WarningCircle size={18} weight="fill" className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
            <p>{errorGeneral}</p>
          </div>
        )}

        {alumnos.length === 0 && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
            No hay alumnos activos con un curso vigente para inscribir.
          </p>
        )}

        <Select
          id="inscripcion-alumno"
          label="Alumno"
          placeholder="Seleccioná un alumno"
          options={alumnos.map((opcion) => ({
            value: opcion.id,
            label: `${opcion.apellido}, ${opcion.nombre} · Legajo ${opcion.legajo_nro ?? '—'} · ${nombreNivel(opcion.nivel_nombre)}`,
          }))}
          value={alumnoId}
          onChange={(evento) => elegirAlumno(evento.target.value)}
          error={errores.alumno_id}
          required
        />

        <div aria-live="polite" aria-busy={consulta.estado === 'cargando'}>
          {consulta.estado === 'cargando' && (
            <p className="text-sm text-neutral-500" role="status">
              Consultando los grupos y la compatibilidad horaria del alumno…
            </p>
          )}
          {consulta.estado === 'error' && (
            <p role="alert" className="text-sm text-red-700">
              {consulta.mensaje}
            </p>
          )}
          {consulta.estado === 'lista' && gruposDelNivel.length === 0 && (
            <p className="text-sm text-neutral-600" role="status">
              No hay grupos activos para el nivel de este alumno.
            </p>
          )}
        </div>

        {consulta.estado === 'lista' && gruposDelNivel.length > 0 && (
          <Select
            id="inscripcion-grupo"
            label="Grupo deportivo"
            placeholder="Seleccioná un grupo"
            options={gruposDelNivel.map(({ grupo }) => ({
              value: grupo.grupo_id,
              label: `${grupo.deporte_nombre} · ${grupo.grupo_nombre} (${grupo.disponibles} de ${grupo.cupo} plazas libres)`,
            }))}
            value={grupoId}
            onChange={(evento) => {
              setGrupoId(evento.target.value)
              setErrores((anteriores) => ({ ...anteriores, grupo_id: undefined }))
              setErrorGeneral(null)
            }}
            error={errores.grupo_id}
            required
          />
        )}

        <div aria-live="polite">
          {elegido && (
            <div className="rounded-xl border border-neutral-200 p-3 space-y-2 text-sm">
              <p className="font-semibold text-neutral-900">Horarios del grupo</p>
              {(horarios[elegido.grupo.grupo_id] ?? []).length === 0 ? (
                <p className="text-neutral-600">Sin horarios cargados.</p>
              ) : (
                <ul className="text-neutral-700">
                  {ordenarFranjas(horarios[elegido.grupo.grupo_id] ?? []).map((franja) => (
                    <li key={franja.id}>{describirFranjaBreve(franja)}</li>
                  ))}
                </ul>
              )}
              {!elegido.compatibilidad.tiene_horario ? (
                <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  {MENSAJE_SIN_HORARIO}
                </p>
              ) : elegido.compatibilidad.conflicto ? (
                <p className="text-red-800 bg-red-50 border border-red-200 rounded-lg p-2">
                  {mensajeConflicto(elegido.compatibilidad.conflicto)}
                </p>
              ) : (
                <p className="text-green-800 bg-green-50 border border-green-200 rounded-lg p-2 flex gap-2 items-start">
                  <CheckCircle size={16} weight="fill" className="text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
                  Sin conflictos con las actividades deportivas activas del alumno.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" disabled={enviando} aria-busy={enviando}>
            {enviando ? 'Inscribiendo…' : 'Inscribir'}
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}
