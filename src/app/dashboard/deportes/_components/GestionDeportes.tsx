'use client'

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, Clock, Plus, SoccerBall, UserPlus, WarningCircle } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { Input, Select } from '@/components/ui/Input'
import { ListaInscripcionesAdministrativas } from '@/components/inscripciones/ListaInscripcionesAdministrativas'
import { nombreAlumno } from '@/components/inscripciones/formato'
import {
  confirmacionDe,
  textoDeBusqueda,
  type FilaInscripcion,
} from '@/components/inscripciones/tipos'
import { crearGrupoDeportivoRemoto, ErrorDeportes } from '@/services/deportes.client'
import type {
  AdministracionDeportes,
  AlumnoInscribible,
  CatalogoAltaGrupo,
  GrupoDeportivo,
  HorariosPorGrupo,
} from '@/services/deportes.service'
import type { InscripcionDeportivaAdministracion } from '@/services/inscripciones-administracion.service'
import { AccionesGrupo } from './AccionesGrupo'
import { CatalogoDeportes } from './CatalogoDeportes'
import { nombreNivel, plazas } from './formato'
import { HorariosGrupo } from './HorariosGrupo'
import { InscripcionAdministrativa } from './InscripcionAdministrativa'
import { ListaFranjas } from './ListaFranjas'

interface GestionDeportesProps {
  grupos: GrupoDeportivo[]
  /** Inscripciones activas y canceladas con su confirmación, tal como las lee Dirección (EPT-62). */
  inscripciones: InscripcionDeportivaAdministracion[]
  /** Franjas activas por grupo (EPT-12). */
  horarios: HorariosPorGrupo
  /** `null` si no se pudieron cargar las opciones del alta. */
  catalogo: CatalogoAltaGrupo | null
  /** Alumnos activos para el alta administrativa; `null` si no se pudieron cargar. */
  alumnos: AlumnoInscribible[] | null
  /**
   * Catálogo completo y docentes con su estado (EPT-61); `null` si no se
   * pudieron cargar: la pantalla conserva la consulta y oculta la administración.
   */
  administracion: AdministracionDeportes | null
}

function aFila(inscripcion: InscripcionDeportivaAdministracion): FilaInscripcion {
  const alumno = nombreAlumno(inscripcion.alumno_apellido, inscripcion.alumno_nombre)
  return {
    id: inscripcion.id,
    alumno,
    legajo: inscripcion.legajo_nro,
    detalles: {
      deporte: { principal: inscripcion.deporte_nombre },
      grupo: {
        principal: inscripcion.grupo_nombre,
        secundario: `Nivel: ${nombreNivel(inscripcion.nivel_nombre)}`,
      },
    },
    descripcion: `${inscripcion.deporte_nombre} (${inscripcion.grupo_nombre})`,
    estado: inscripcion.estado,
    fechaAlta: inscripcion.fecha_inscripcion,
    fechaBaja: inscripcion.fecha_cancelacion,
    confirmacion: confirmacionDe(inscripcion),
    busqueda: textoDeBusqueda(
      inscripcion.alumno_apellido,
      inscripcion.alumno_nombre,
      inscripcion.legajo_nro,
      inscripcion.deporte_nombre,
      inscripcion.grupo_nombre
    ),
  }
}

type CampoFormulario = 'deporte_id' | 'nivel_id' | 'nombre' | 'cupo' | 'profesor_id'
type ErroresFormulario = Partial<Record<CampoFormulario, string>>

const FORMULARIO_VACIO = {
  deporte_id: '',
  nivel_id: '',
  nombre: '',
  cupo: '',
  profesor_id: '',
}

/**
 * Administración deportiva de la dirección: consulta y alta mínima de grupos
 * (EPT-11), franjas e inscripción administrativa (EPT-12) y administración del
 * catálogo y de los grupos (EPT-61).
 *
 * La dirección consulta todos los grupos con su ocupación y sus horarios y
 * todas las inscripciones; administra el catálogo de deportes (alta, renombrado,
 * inactivar y reactivar), crea y edita grupos (nombre, cupo y profesor; el
 * deporte y el nivel no cambian), los inactiva y reactiva, asigna o da de baja
 * franjas e inscribe a un alumno. Las reglas las aplica PostgreSQL con las filas
 * bloqueadas: lo que la pantalla anticipa es una ayuda. Desde EPT-62 confirma y
 * cancela inscripciones en nombre del alumno (baja lógica: no borra nada).
 */
export function GestionDeportes({
  grupos,
  inscripciones,
  horarios,
  catalogo,
  alumnos,
  administracion,
}: GestionDeportesProps) {
  const router = useRouter()
  const [refrescando, iniciarRefresco] = useTransition()
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [grupoHorarios, setGrupoHorarios] = useState<string | null>(null)
  const [inscribiendo, setInscribiendo] = useState(false)
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO)
  const [errores, setErrores] = useState<ErroresFormulario>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState<string | null>(null)
  const regionExito = useRef<HTMLDivElement>(null)

  const sinProfesores = catalogo !== null && catalogo.profesores.length === 0
  const grupoSeleccionado = grupos.find((grupo) => grupo.grupo_id === grupoHorarios)

  const filas = useMemo(() => inscripciones.map(aFila), [inscripciones])

  // La confirmación aparece arriba de la página: si la operación se hizo sobre
  // una tarjeta lejana, se la acerca a la vista sin mover el foco.
  useEffect(() => {
    if (exito) regionExito.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [exito])

  /** Operación de administración confirmada: informa y vuelve a leer el estado real. */
  function alCambiar(mensaje: string) {
    setExito(mensaje)
    iniciarRefresco(() => router.refresh())
  }

  /** Rechazo o resultado incierto: solo se vuelve a leer, para no mostrar datos viejos. */
  function alReleer() {
    iniciarRefresco(() => router.refresh())
  }

  function abrirDialogo() {
    setFormulario(FORMULARIO_VACIO)
    setErrores({})
    setErrorGeneral(null)
    setExito(null)
    setDialogoAbierto(true)
  }

  function validar(): ErroresFormulario {
    const encontrados: ErroresFormulario = {}
    if (!formulario.deporte_id) encontrados.deporte_id = 'Seleccioná un deporte'
    if (!formulario.nivel_id) encontrados.nivel_id = 'Seleccioná un nivel educativo'
    if (!formulario.nombre.trim()) encontrados.nombre = 'El nombre del grupo es requerido'
    else if (formulario.nombre.trim().length > 100)
      encontrados.nombre = 'El nombre del grupo no puede superar los 100 caracteres'
    const cupo = Number(formulario.cupo)
    if (!formulario.cupo || !Number.isInteger(cupo) || cupo < 1 || cupo > 100)
      encontrados.cupo = 'El cupo debe ser un número entero entre 1 y 100'
    if (!formulario.profesor_id) encontrados.profesor_id = 'Seleccioná un profesor con rol DOCENTE'
    return encontrados
  }

  async function crearGrupo(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (enviando) return

    const encontrados = validar()
    setErrores(encontrados)
    setErrorGeneral(null)
    if (Object.keys(encontrados).length > 0) return

    setEnviando(true)
    try {
      await crearGrupoDeportivoRemoto({
        deporte_id: formulario.deporte_id,
        nivel_id: Number(formulario.nivel_id),
        nombre: formulario.nombre,
        cupo: Number(formulario.cupo),
        profesor_id: formulario.profesor_id,
      })
      setDialogoAbierto(false)
      setExito(`Creaste el grupo «${formulario.nombre.trim()}».`)
      iniciarRefresco(() => router.refresh())
    } catch (problema) {
      if (problema instanceof ErrorDeportes) {
        const mensaje =
          problema.estado === 401
            ? 'Tu sesión venció. Iniciá sesión nuevamente para continuar.'
            : problema.message
        if (problema.campo && problema.campo in FORMULARIO_VACIO) {
          setErrores({ [problema.campo as CampoFormulario]: mensaje })
        } else {
          setErrorGeneral(mensaje)
        }
      } else {
        setErrorGeneral('No pudimos crear el grupo. Volvé a intentarlo.')
      }
    } finally {
      setEnviando(false)
    }
  }

  function actualizar<K extends keyof typeof FORMULARIO_VACIO>(campo: K, valor: string) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
    setErrores((anteriores) => ({ ...anteriores, [campo]: undefined }))
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
            Actividades deportivas
          </p>
          <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Deportes</h1>
          <p className="text-neutral-500 text-sm mt-1 max-w-[64ch]">
            Administrá el catálogo de deportes y sus grupos, y consultá la ocupación, los horarios
            y las inscripciones de los alumnos.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            onClick={() => {
              setExito(null)
              setInscribiendo(true)
            }}
            disabled={alumnos === null}
          >
            <UserPlus size={18} weight="bold" aria-hidden="true" />
            Inscribir alumno
          </Button>
          <Button onClick={abrirDialogo} disabled={catalogo === null}>
            <Plus size={18} weight="bold" aria-hidden="true" />
            Nuevo grupo
          </Button>
        </div>
      </header>

      <div aria-live="polite" className="space-y-3">
        {catalogo === null && (
          <div
            role="alert"
            className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900"
          >
            No pudimos cargar las opciones para crear grupos. Podés consultar el listado y
            reintentar más tarde.
          </div>
        )}
        {alumnos === null && (
          <div
            role="alert"
            className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900"
          >
            No pudimos cargar el listado de alumnos para la inscripción administrativa. Podés
            consultar el resto de la pantalla y reintentar más tarde.
          </div>
        )}
        {administracion === null && (
          <div
            role="alert"
            className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900"
          >
            No pudimos cargar los datos para administrar el catálogo y los grupos. Podés consultar
            el listado y reintentar más tarde.
          </div>
        )}
        {exito && (
          <div
            ref={regionExito}
            role="status"
            className="bg-green-50 border border-green-200 rounded-2xl p-4 flex gap-3 items-start"
          >
            <CheckCircle size={20} weight="fill" className="text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-green-800">{exito}</p>
          </div>
        )}
      </div>

      {administracion && (
        <CatalogoDeportes
          deportes={administracion.deportes}
          grupos={grupos}
          onCambio={alCambiar}
          onReleer={alReleer}
          actualizando={refrescando}
        />
      )}

      <section aria-labelledby="grupos-titulo" aria-busy={refrescando} className="space-y-3">
        <h2 id="grupos-titulo" className="text-lg font-bold text-neutral-900">
          Grupos deportivos
        </h2>
        {grupos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-neutral-200 py-10 px-5 text-center">
            <SoccerBall size={36} className="text-neutral-300 mx-auto mb-3" aria-hidden="true" />
            <p className="text-sm text-neutral-600 font-semibold">Todavía no hay grupos deportivos</p>
            <p className="text-neutral-500 text-sm mt-1">
              Creá el primero con el botón «Nuevo grupo».
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {grupos.map((grupo) => (
              <li
                key={grupo.grupo_id}
                className="bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col gap-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-neutral-900 break-words">{grupo.deporte_nombre}</h3>
                  {grupo.activo ? (
                    <Badge variant="success" dot>
                      Activo
                    </Badge>
                  ) : (
                    <Badge variant="default">Inactivo</Badge>
                  )}
                  {grupo.activo && grupo.disponibles <= 0 && <Badge variant="danger">Completo</Badge>}
                  {!grupo.deporte_activo && <Badge variant="warning">Deporte inactivo</Badge>}
                </div>
                <p className="text-sm text-neutral-700 break-words">{grupo.grupo_nombre}</p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-neutral-500">Nivel</dt>
                  <dd className="text-neutral-900">{nombreNivel(grupo.nivel_nombre)}</dd>
                  <dt className="text-neutral-500">Profesor</dt>
                  <dd className="text-neutral-900 break-words">
                    {grupo.profesor_apellido}, {grupo.profesor_nombre}
                  </dd>
                  <dt className="text-neutral-500">Ocupación</dt>
                  <dd className="text-neutral-900">
                    {grupo.ocupados} de {plazas(grupo.cupo)}
                  </dd>
                  <dt className="text-neutral-500">Disponibles</dt>
                  <dd className="text-neutral-900">{grupo.disponibles}</dd>
                </dl>
                <ListaFranjas franjas={horarios[grupo.grupo_id] ?? []} />
                <div className="flex flex-wrap gap-2 mt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-8"
                    onClick={() => setGrupoHorarios(grupo.grupo_id)}
                    aria-label={`Gestionar los horarios de ${grupo.deporte_nombre}, ${grupo.grupo_nombre}`}
                  >
                    <Clock size={16} weight="bold" aria-hidden="true" />
                    Horarios
                  </Button>
                  <AccionesGrupo
                    grupo={grupo}
                    administracion={administracion}
                    onCambio={alCambiar}
                    onReleer={alReleer}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="inscripciones-titulo" className="space-y-3">
        <h2 id="inscripciones-titulo" className="text-lg font-bold text-neutral-900">
          Inscripciones de los alumnos
        </h2>
        <ListaInscripcionesAdministrativas
          dominio="deportes"
          filas={filas}
          columnas={[
            { clave: 'deporte', titulo: 'Deporte' },
            { clave: 'grupo', titulo: 'Grupo y nivel' },
          ]}
          caption="Alumnos inscriptos a deportes con legajo, deporte, grupo, nivel, estado, confirmación, fechas y acciones"
          filtroEstado={{
            etiquetaGrupo: 'Filtrar por estado',
            etiquetas: { ACTIVAS: 'Activas', CANCELADAS: 'Canceladas', TODAS: 'Todas' },
          }}
          busqueda={{ etiqueta: 'Buscar', placeholder: 'Alumno, legajo, deporte o grupo' }}
          resumen={({ visibles }) =>
            visibles === 1 ? '1 inscripción' : `${visibles} inscripciones`
          }
          vacio={{
            titulo: 'No hay inscripciones para mostrar',
            ayuda: 'Probá con otro filtro o con otra búsqueda.',
          }}
        />
      </section>

      {dialogoAbierto && catalogo && (
        <Dialogo
          tituloId="deportes-nuevo-grupo"
          titulo="Nuevo grupo deportivo"
          descripcion="Cada inscripción activa ocupa una plaza del cupo. El profesor responsable debe tener el rol DOCENTE."
          selectorFocoInicial="#grupo-deporte"
          onCerrar={() => {
            if (!enviando) setDialogoAbierto(false)
          }}
        >
          <form onSubmit={crearGrupo} noValidate className="space-y-4">
            {errorGeneral && (
              <div
                role="alert"
                className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2 items-start text-sm text-red-800"
              >
                <WarningCircle size={18} weight="fill" className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
                <p>{errorGeneral}</p>
              </div>
            )}
            {sinProfesores && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                No hay personas con rol DOCENTE para asignar como responsables. Da de alta un
                docente antes de crear el grupo.
              </p>
            )}
            <Select
              id="grupo-deporte"
              label="Deporte"
              placeholder="Seleccioná un deporte"
              options={catalogo.deportes.map((deporte) => ({ value: deporte.id, label: deporte.nombre }))}
              value={formulario.deporte_id}
              onChange={(evento) => actualizar('deporte_id', evento.target.value)}
              error={errores.deporte_id}
              required
            />
            <Select
              id="grupo-nivel"
              label="Nivel educativo"
              placeholder="Seleccioná un nivel"
              options={catalogo.niveles.map((nivel) => ({
                value: nivel.id,
                label: nombreNivel(nivel.nombre),
              }))}
              value={formulario.nivel_id}
              onChange={(evento) => actualizar('nivel_id', evento.target.value)}
              error={errores.nivel_id}
              required
            />
            <Input
              id="grupo-nombre"
              label="Nombre del grupo"
              placeholder="Por ejemplo: Primario turno mañana"
              value={formulario.nombre}
              maxLength={100}
              onChange={(evento) => actualizar('nombre', evento.target.value)}
              error={errores.nombre}
              required
            />
            <Input
              id="grupo-cupo"
              label="Cupo (plazas)"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              step={1}
              value={formulario.cupo}
              onChange={(evento) => actualizar('cupo', evento.target.value)}
              error={errores.cupo}
              helperText="Entre 1 y 100 plazas."
              required
            />
            <Select
              id="grupo-profesor"
              label="Profesor responsable"
              placeholder="Seleccioná un docente"
              options={catalogo.profesores.map((profesor) => ({
                value: profesor.id,
                label: `${profesor.apellido}, ${profesor.nombre}`,
              }))}
              value={formulario.profesor_id}
              onChange={(evento) => actualizar('profesor_id', evento.target.value)}
              error={errores.profesor_id}
              required
            />
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogoAbierto(false)}
                disabled={enviando}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={enviando || sinProfesores} aria-busy={enviando}>
                {enviando ? 'Creando grupo…' : 'Crear grupo'}
              </Button>
            </div>
          </form>
        </Dialogo>
      )}

      {grupoHorarios && grupoSeleccionado && (
        <HorariosGrupo
          grupo={grupoSeleccionado}
          franjas={horarios[grupoSeleccionado.grupo_id] ?? []}
          onCerrar={() => setGrupoHorarios(null)}
        />
      )}

      {inscribiendo && alumnos && (
        <InscripcionAdministrativa
          alumnos={alumnos}
          grupos={grupos}
          horarios={horarios}
          onCerrar={() => setInscribiendo(false)}
          onInscripto={(mensaje) => {
            setInscribiendo(false)
            setExito(mensaje)
            iniciarRefresco(() => router.refresh())
          }}
        />
      )}
    </div>
  )
}
