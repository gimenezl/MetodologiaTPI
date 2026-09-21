'use client'

import { useId, useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, Plus, SoccerBall, WarningCircle } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { Input, Select } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { crearGrupoDeportivoRemoto, ErrorDeportes } from '@/services/deportes.client'
import type {
  CatalogoAltaGrupo,
  GrupoDeportivo,
  InscripcionDeportiva,
} from '@/services/deportes.service'
import { fecha, nombreNivel, plazas } from './formato'

interface GestionDeportesProps {
  grupos: GrupoDeportivo[]
  inscripciones: InscripcionDeportiva[]
  /** `null` si no se pudieron cargar las opciones del alta. */
  catalogo: CatalogoAltaGrupo | null
}

type Filtro = 'ACTIVAS' | 'CANCELADAS' | 'TODAS'

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'ACTIVAS', etiqueta: 'Activas' },
  { valor: 'CANCELADAS', etiqueta: 'Canceladas' },
  { valor: 'TODAS', etiqueta: 'Todas' },
]

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
 * Consulta deportiva de la dirección y alta mínima de grupos (EPT-11).
 *
 * La dirección consulta todos los grupos con su ocupación y todas las
 * inscripciones, y puede crear un grupo. No inscribe ni cancela en nombre de
 * ningún alumno: esta pantalla no tiene controles para eso, y la API y la base
 * también lo rechazan. Las filas que se ven son las que devuelve PostgreSQL.
 */
export function GestionDeportes({ grupos, inscripciones, catalogo }: GestionDeportesProps) {
  const router = useRouter()
  const [refrescando, iniciarRefresco] = useTransition()
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO)
  const [errores, setErrores] = useState<ErroresFormulario>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('ACTIVAS')
  const [busqueda, setBusqueda] = useState('')
  const idBusqueda = useId()

  const sinProfesores = catalogo !== null && catalogo.profesores.length === 0

  const visibles = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase('es-AR')
    return inscripciones
      .filter((inscripcion) =>
        filtro === 'TODAS'
          ? true
          : filtro === 'ACTIVAS'
            ? inscripcion.estado === 'ACTIVA'
            : inscripcion.estado === 'CANCELADA'
      )
      .filter((inscripcion) => {
        if (!termino) return true
        return [
          inscripcion.alumno_apellido,
          inscripcion.alumno_nombre,
          inscripcion.legajo_nro ?? '',
          inscripcion.deporte_nombre,
          inscripcion.grupo_nombre,
        ]
          .join(' ')
          .toLocaleLowerCase('es-AR')
          .includes(termino)
      })
  }, [inscripciones, filtro, busqueda])

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
            Consultá los grupos deportivos, su ocupación y las inscripciones de los alumnos.
          </p>
        </div>
        <Button
          onClick={abrirDialogo}
          disabled={catalogo === null}
          className="self-start sm:self-auto"
        >
          <Plus size={18} weight="bold" aria-hidden="true" />
          Nuevo grupo
        </Button>
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
        {exito && (
          <div
            role="status"
            className="bg-green-50 border border-green-200 rounded-2xl p-4 flex gap-3 items-start"
          >
            <CheckCircle size={20} weight="fill" className="text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-green-800">{exito}</p>
          </div>
        )}
      </div>

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
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="inscripciones-titulo" className="space-y-3">
        <h2 id="inscripciones-titulo" className="text-lg font-bold text-neutral-900">
          Inscripciones de los alumnos
        </h2>
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
            {FILTROS.map(({ valor, etiqueta }) => (
              <button
                key={valor}
                type="button"
                onClick={() => setFiltro(valor)}
                aria-pressed={filtro === valor}
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-semibold border transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
                  filtro === valor
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:border-brand-400'
                )}
              >
                {etiqueta}
              </button>
            ))}
          </div>
          <div className="md:ml-auto md:w-80">
            <Input
              id={idBusqueda}
              label="Buscar"
              placeholder="Alumno, legajo, deporte o grupo"
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
            />
          </div>
        </div>

        <p className="text-sm text-neutral-500" role="status">
          {visibles.length === 1 ? '1 inscripción' : `${visibles.length} inscripciones`}
        </p>

        {visibles.length === 0 ? (
          <div className="bg-white rounded-2xl border border-neutral-200 py-8 px-5 text-center">
            <p className="text-sm text-neutral-600 font-semibold">
              No hay inscripciones para mostrar
            </p>
            <p className="text-neutral-500 text-sm mt-1">
              Probá con otro filtro o con otra búsqueda.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {visibles.map((inscripcion) => (
              <li
                key={inscripcion.id}
                className="bg-white rounded-2xl border border-neutral-200 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900 break-words">
                    {inscripcion.alumno_apellido}, {inscripcion.alumno_nombre}
                    <span className="font-normal text-neutral-500">
                      {' '}
                      · Legajo {inscripcion.legajo_nro ?? '—'}
                    </span>
                  </p>
                  <p className="text-sm text-neutral-600 break-words">
                    {inscripcion.deporte_nombre} · {inscripcion.grupo_nombre} ·{' '}
                    {nombreNivel(inscripcion.nivel_nombre)}
                  </p>
                  <p className="text-xs text-neutral-500">
                    Alta: {fecha(inscripcion.fecha_inscripcion)}
                    {inscripcion.fecha_cancelacion
                      ? ` · Baja: ${fecha(inscripcion.fecha_cancelacion)}`
                      : ''}
                  </p>
                </div>
                {inscripcion.estado === 'ACTIVA' ? (
                  <Badge variant="success" dot className="self-start md:self-auto">
                    Activa
                  </Badge>
                ) : (
                  <Badge variant="default" className="self-start md:self-auto">
                    Cancelada
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
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
                No hay personas con rol DOCENTE para asignar como responsables. Dá de alta un
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
    </div>
  )
}
