'use client'

import { useState, type FormEvent } from 'react'
import { PencilSimple, Power } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { Input, Select } from '@/components/ui/Input'
import {
  mensajeCupoBajoOcupacion,
  mensajeGrupoConInscripciones,
  MENSAJES_REACTIVACION_GRUPO,
} from '@/lib/deportes-administracion'
import { cn } from '@/lib/utils'
import {
  cambiarEstadoGrupoDeportivoRemoto,
  editarGrupoDeportivoRemoto,
} from '@/services/deportes.client'
import type { AdministracionDeportes, GrupoDeportivo } from '@/services/deportes.service'
import { AlertaError, avisoDeError, campoDeError, debeReleer, type AvisoError } from './avisos'
import { nombreNivel, plazas } from './formato'
import { useEnvio } from './useEnvio'

interface AccionesGrupoProps {
  grupo: GrupoDeportivo
  /** `null` si no se pudieron cargar los datos de administración: no hay acciones. */
  administracion: AdministracionDeportes | null
  onCambio: (mensaje: string) => void
  onReleer: () => void
}

type Dialogo = 'editar' | 'estado' | null

type CampoEdicion = 'nombre' | 'cupo' | 'profesor_id'
type ErroresEdicion = Partial<Record<CampoEdicion, string>>

/**
 * Motivo por el que un grupo no se puede inactivar o reactivar ahora, o
 * `undefined`. Son las mismas reglas que aplica PostgreSQL con el grupo
 * bloqueado (P5975 al inactivar; P5561, P5563, P5565 y P5605 al reactivar): lo
 * que se anticipa es lo que la base decidiría con los datos de este momento.
 */
function motivoCambioEstado(
  grupo: GrupoDeportivo,
  administracion: AdministracionDeportes
): string | undefined {
  if (grupo.activo) {
    return grupo.ocupados > 0 ? mensajeGrupoConInscripciones(grupo.ocupados) : undefined
  }
  if (!grupo.deporte_activo) return MENSAJES_REACTIVACION_GRUPO.deporteInactivo
  if (!administracion.nivelesActivos.includes(grupo.nivel_id)) {
    return MENSAJES_REACTIVACION_GRUPO.nivelInactivo
  }
  const docente = administracion.docentes.find((candidato) => candidato.id === grupo.profesor_id)
  if (!docente) return MENSAJES_REACTIVACION_GRUPO.profesorSinRol
  if (!docente.activo) return MENSAJES_REACTIVACION_GRUPO.profesorInactivo
  return undefined
}

/**
 * Acciones de administración de un grupo (EPT-61): editar nombre, cupo y
 * profesor, e inactivar o reactivar. El deporte y el nivel no se pueden cambiar:
 * son la identidad del grupo. Nada se borra.
 *
 * Se renderiza dentro de la fila de acciones de la tarjeta del grupo.
 */
export function AccionesGrupo({ grupo, administracion, onCambio, onReleer }: AccionesGrupoProps) {
  const [dialogo, setDialogo] = useState<Dialogo>(null)

  if (!administracion) return null

  const motivo = motivoCambioEstado(grupo, administracion)
  const idMotivo = `motivo-estado-${grupo.grupo_id}`
  const etiquetaGrupo = `${grupo.grupo_nombre} de ${grupo.deporte_nombre}`

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 sm:min-h-8"
        onClick={() => setDialogo('editar')}
        aria-label={`Editar el grupo ${etiquetaGrupo}`}
      >
        <PencilSimple size={16} weight="bold" aria-hidden="true" />
        Editar
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn('min-h-11 sm:min-h-8', motivo && 'opacity-50 cursor-not-allowed')}
        aria-disabled={motivo ? true : undefined}
        aria-describedby={motivo ? idMotivo : undefined}
        onClick={() => {
          if (motivo) return
          setDialogo('estado')
        }}
        aria-label={`${grupo.activo ? 'Inactivar' : 'Reactivar'} el grupo ${etiquetaGrupo}`}
      >
        <Power size={16} weight="bold" aria-hidden="true" />
        {grupo.activo ? 'Inactivar' : 'Reactivar'}
      </Button>
      {motivo && (
        <p id={idMotivo} className="basis-full text-xs text-neutral-700">
          {motivo}
        </p>
      )}

      {dialogo === 'editar' && (
        <DialogoEditarGrupo
          grupo={grupo}
          administracion={administracion}
          onCerrar={() => setDialogo(null)}
          onGuardado={(mensaje) => {
            setDialogo(null)
            onCambio(mensaje)
          }}
          onReleer={onReleer}
        />
      )}

      {dialogo === 'estado' && (
        <DialogoEstadoGrupo
          grupo={grupo}
          motivo={motivo}
          onCerrar={() => setDialogo(null)}
          onCambiado={(mensaje) => {
            setDialogo(null)
            onCambio(mensaje)
          }}
          onReleer={onReleer}
        />
      )}
    </>
  )
}

// ----------------------------------------------------------------
// Edición
// ----------------------------------------------------------------

function DialogoEditarGrupo({
  grupo,
  administracion,
  onCerrar,
  onGuardado,
  onReleer,
}: {
  grupo: GrupoDeportivo
  administracion: AdministracionDeportes
  onCerrar: () => void
  onGuardado: (mensaje: string) => void
  onReleer: () => void
}) {
  const profesorActual = grupo.profesor_id ?? ''
  const [nombre, setNombre] = useState(grupo.grupo_nombre)
  const [cupo, setCupo] = useState(String(grupo.cupo))
  const [profesor, setProfesor] = useState(profesorActual)
  const [errores, setErrores] = useState<ErroresEdicion>({})
  const [aviso, setAviso] = useState<AvisoError | null>(null)
  const { enviando, ejecutar } = useEnvio()

  // Solo docentes activos, más el responsable actual aunque ya no lo sea, para
  // que el formulario muestre la verdad y se pueda guardar sin cambiarlo.
  const nombreProfesorActual = `${grupo.profesor_apellido}, ${grupo.profesor_nombre}`
  const opciones = administracion.docentes
    .filter((docente) => docente.activo || docente.id === profesorActual)
    .map((docente) => ({
      value: docente.id,
      label: `${docente.apellido}, ${docente.nombre}${docente.activo ? '' : ' (inactivo)'}`,
    }))
  if (profesorActual && !administracion.docentes.some((docente) => docente.id === profesorActual)) {
    opciones.push({ value: profesorActual, label: `${nombreProfesorActual} (ya no es docente)` })
  }
  const profesorActualInvalido =
    profesorActual !== '' &&
    !administracion.docentes.some((docente) => docente.id === profesorActual && docente.activo)

  const minimoCupo = Math.max(1, grupo.ocupados)

  function validar(): ErroresEdicion {
    const encontrados: ErroresEdicion = {}
    const recortado = nombre.trim()
    if (!recortado) encontrados.nombre = 'El nombre del grupo es requerido'
    else if (recortado.length > 100)
      encontrados.nombre = 'El nombre del grupo no puede superar los 100 caracteres'

    const valorCupo = Number(cupo)
    if (!cupo.trim() || !Number.isInteger(valorCupo) || valorCupo < 1 || valorCupo > 100) {
      encontrados.cupo = 'El cupo debe ser un número entero entre 1 y 100'
    } else if (valorCupo < grupo.ocupados) {
      encontrados.cupo = mensajeCupoBajoOcupacion(grupo.ocupados)
    }

    if (!profesor) encontrados.profesor_id = 'Seleccioná un profesor con rol DOCENTE'
    return encontrados
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setAviso(null)

    const encontrados = validar()
    setErrores(encontrados)
    if (Object.keys(encontrados).length > 0) return

    const datos = { nombre: nombre.trim(), cupo: Number(cupo), profesor_id: profesor }
    if (
      datos.nombre === grupo.grupo_nombre &&
      datos.cupo === grupo.cupo &&
      datos.profesor_id === profesorActual
    ) {
      setAviso({ texto: 'No hiciste ningún cambio en el grupo.', sesionVencida: false })
      return
    }

    await ejecutar(async () => {
      try {
        await editarGrupoDeportivoRemoto(grupo.grupo_id, datos)
        onGuardado(`Guardaste los cambios del grupo «${datos.nombre}».`)
      } catch (fallo) {
        const resumen = avisoDeError(fallo, 'No pudimos guardar los cambios. Volvé a intentarlo.')
        const campo = campoDeError(fallo)
        if (campo === 'nombre' || campo === 'cupo' || campo === 'profesor_id') {
          setErrores({ [campo]: resumen.texto })
        } else {
          setAviso(resumen)
        }
        if (debeReleer(fallo)) onReleer()
      }
    })
  }

  function cambiar<K extends CampoEdicion>(campo: K, valor: string) {
    if (campo === 'nombre') setNombre(valor)
    if (campo === 'cupo') setCupo(valor)
    if (campo === 'profesor_id') setProfesor(valor)
    setErrores((anteriores) => ({ ...anteriores, [campo]: undefined }))
  }

  return (
    <Dialogo
      tituloId={`grupo-editar-${grupo.grupo_id}`}
      titulo={`Editar ${grupo.deporte_nombre} · ${grupo.grupo_nombre}`}
      descripcion="Podés cambiar el nombre, el cupo y el profesor responsable. El deporte y el nivel no se pueden cambiar; si necesitás otros, creá un grupo nuevo."
      selectorFocoInicial="#grupo-editar-nombre"
      onCerrar={() => {
        if (!enviando) onCerrar()
      }}
    >
      <form onSubmit={guardar} noValidate className="space-y-4">
        <AlertaError aviso={aviso} />

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm bg-neutral-50 border border-neutral-200 rounded-xl p-3">
          <dt className="text-neutral-600">Deporte</dt>
          <dd className="text-neutral-900 break-words">{grupo.deporte_nombre}</dd>
          <dt className="text-neutral-600">Nivel</dt>
          <dd className="text-neutral-900">{nombreNivel(grupo.nivel_nombre)}</dd>
          <dt className="text-neutral-600">Ocupación actual</dt>
          <dd className="text-neutral-900">
            {grupo.ocupados} de {plazas(grupo.cupo)}
          </dd>
        </dl>

        <Input
          id="grupo-editar-nombre"
          label="Nombre del grupo"
          value={nombre}
          maxLength={100}
          className="min-h-11 sm:min-h-10"
          onChange={(evento) => cambiar('nombre', evento.target.value)}
          error={errores.nombre}
          required
        />
        <Input
          id="grupo-editar-cupo"
          label="Cupo (plazas)"
          type="number"
          inputMode="numeric"
          min={minimoCupo}
          max={100}
          step={1}
          className="min-h-11 sm:min-h-10"
          value={cupo}
          onChange={(evento) => cambiar('cupo', evento.target.value)}
          error={errores.cupo}
          helperText={
            grupo.ocupados > 0
              ? `Entre ${minimoCupo} y 100 plazas. No puede ser menor que las inscripciones activas (${grupo.ocupados}).`
              : 'Entre 1 y 100 plazas.'
          }
          required
        />
        <Select
          id="grupo-editar-profesor"
          label="Profesor responsable"
          placeholder="Seleccioná un docente"
          options={opciones}
          value={profesor}
          className="min-h-11 sm:min-h-10"
          onChange={(evento) => cambiar('profesor_id', evento.target.value)}
          error={errores.profesor_id}
          helperText={
            profesorActualInvalido
              ? 'El profesor actual no está disponible. Podés guardar otros cambios, pero para reactivar el grupo tenés que elegir un docente activo.'
              : 'Solo se ofrecen docentes activos.'
          }
          required
        />

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:min-h-10"
            onClick={onCerrar}
            disabled={enviando}
          >
            Cancelar
          </Button>
          <Button type="submit" className="min-h-11 sm:min-h-10" disabled={enviando} aria-busy={enviando}>
            {enviando ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}

// ----------------------------------------------------------------
// Inactivar o reactivar
// ----------------------------------------------------------------

function DialogoEstadoGrupo({
  grupo,
  motivo,
  onCerrar,
  onCambiado,
  onReleer,
}: {
  grupo: GrupoDeportivo
  /** Motivo vigente por el que no se puede cambiar el estado; tras una relectura puede aparecer. */
  motivo: string | undefined
  onCerrar: () => void
  onCambiado: (mensaje: string) => void
  onReleer: () => void
}) {
  const [aviso, setAviso] = useState<AvisoError | null>(null)
  const { enviando, ejecutar } = useEnvio()
  const inactivando = grupo.activo

  async function confirmar() {
    setAviso(null)
    await ejecutar(async () => {
      try {
        await cambiarEstadoGrupoDeportivoRemoto(grupo.grupo_id, !inactivando)
        onCambiado(
          inactivando
            ? `Inactivaste el grupo «${grupo.grupo_nombre}». Podés reactivarlo cuando quieras.`
            : `Reactivaste el grupo «${grupo.grupo_nombre}».`
        )
      } catch (fallo) {
        setAviso(
          avisoDeError(
            fallo,
            inactivando
              ? 'No pudimos inactivar el grupo. Volvé a intentarlo.'
              : 'No pudimos reactivar el grupo. Volvé a intentarlo.'
          )
        )
        if (debeReleer(fallo)) onReleer()
      }
    })
  }

  return (
    <Dialogo
      tituloId={`grupo-estado-${grupo.grupo_id}`}
      titulo={`${inactivando ? 'Inactivar' : 'Reactivar'} el grupo ${grupo.grupo_nombre}`}
      descripcion={
        inactivando
          ? 'El grupo deja de aceptar inscripciones nuevas. Se conserva con sus horarios y su historial, y podés reactivarlo cuando quieras.'
          : 'El grupo vuelve a aceptar inscripciones, siempre que su deporte, su nivel y su profesor sigan activos.'
      }
      selectorFocoInicial="[data-foco-inicial]"
      onCerrar={() => {
        if (!enviando) onCerrar()
      }}
    >
      <div className="space-y-4">
        <AlertaError aviso={aviso} />
        {motivo && (
          <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3">
            {motivo}
          </p>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:min-h-10"
            data-foco-inicial
            onClick={onCerrar}
            disabled={enviando}
          >
            Volver sin cambios
          </Button>
          <Button
            type="button"
            variant={inactivando ? 'peligro' : 'primary'}
            className="min-h-11 sm:min-h-10"
            onClick={confirmar}
            disabled={enviando || Boolean(motivo)}
            aria-busy={enviando}
          >
            {enviando
              ? inactivando
                ? 'Inactivando…'
                : 'Reactivando…'
              : inactivando
                ? 'Sí, inactivar el grupo'
                : 'Sí, reactivar el grupo'}
          </Button>
        </div>
      </div>
    </Dialogo>
  )
}
