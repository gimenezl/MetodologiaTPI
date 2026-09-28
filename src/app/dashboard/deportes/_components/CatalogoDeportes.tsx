'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { PencilSimple, Plus, Power, SoccerBall } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { Input } from '@/components/ui/Input'
import {
  MENSAJE_NOMBRE_SIN_CAMBIOS,
  MENSAJE_RENOMBRAR_CON_GRUPOS,
  mensajeDeporteConGruposActivos,
  soloCambiaMayusculas,
  textoGruposActivos,
} from '@/lib/deportes-administracion'
import { cn } from '@/lib/utils'
import {
  cambiarEstadoDeporteRemoto,
  crearDeporteRemoto,
  renombrarDeporteRemoto,
} from '@/services/deportes.client'
import type { DeporteCatalogo, GrupoDeportivo } from '@/services/deportes.service'
import { AlertaError, avisoDeError, campoDeError, debeReleer, type AvisoError } from './avisos'
import { useEnvio } from './useEnvio'

interface CatalogoDeportesProps {
  deportes: DeporteCatalogo[]
  /** Todos los grupos, activos e inactivos: de acá salen los conteos por deporte. */
  grupos: GrupoDeportivo[]
  /** Operación confirmada: muestra el mensaje y vuelve a leer el estado real. */
  onCambio: (mensaje: string) => void
  /** Operación rechazada o incierta: solo vuelve a leer el estado real. */
  onReleer: () => void
  actualizando: boolean
}

type Dialogo =
  | { tipo: 'nuevo' }
  | { tipo: 'renombrar'; deporteId: string }
  | { tipo: 'estado'; deporteId: string }

type Conteo = { activos: number; inactivos: number }

const SIN_CONTEO: Conteo = { activos: 0, inactivos: 0 }

function tieneGrupos({ activos, inactivos }: Conteo): boolean {
  return activos + inactivos > 0
}

function textoGrupos(conteo: Conteo): string {
  const { activos, inactivos } = conteo
  if (!tieneGrupos(conteo)) return 'Todavía no tiene grupos.'
  const inactivosTexto = inactivos === 1 ? '1 inactivo' : `${inactivos} inactivos`
  return `${textoGruposActivos(activos)} · ${inactivosTexto}`
}

/**
 * Motivo por el que un deporte no se puede inactivar ahora, o `undefined`. Es la
 * misma regla que aplica PostgreSQL con la fila del deporte bloqueada (P5974):
 * lo que se anticipa es lo que la base decidiría con los datos de este momento.
 */
function motivoInactivar(deporte: DeporteCatalogo, conteo: Conteo): string | undefined {
  if (!deporte.activo) return undefined
  return conteo.activos > 0 ? mensajeDeporteConGruposActivos(conteo.activos) : undefined
}

/**
 * Catálogo de deportes de la dirección (EPT-61).
 *
 * Alta, renombrado y cambio de estado. Nada se borra: inactivar es una baja
 * lógica reversible. El profesor no se elige acá: es obligatorio por grupo. La
 * pantalla anticipa los motivos de rechazo (grupos activos, nombre con grupos)
 * pero la base los vuelve a decidir, así que un rechazo por una carrera se
 * muestra igual, con el mensaje del servidor.
 */
export function CatalogoDeportes({
  deportes,
  grupos,
  onCambio,
  onReleer,
  actualizando,
}: CatalogoDeportesProps) {
  const [dialogo, setDialogo] = useState<Dialogo | null>(null)

  const conteos = useMemo(() => {
    const porDeporte = new Map<string, Conteo>()
    for (const grupo of grupos) {
      const actual = porDeporte.get(grupo.deporte_id) ?? { ...SIN_CONTEO }
      if (grupo.activo) actual.activos += 1
      else actual.inactivos += 1
      porDeporte.set(grupo.deporte_id, actual)
    }
    return porDeporte
  }, [grupos])

  // Siempre se resuelve contra los datos vigentes: tras una relectura el
  // diálogo abierto ve el estado nuevo, no una copia vieja.
  const deporteDelDialogo =
    dialogo && dialogo.tipo !== 'nuevo'
      ? (deportes.find((deporte) => deporte.id === dialogo.deporteId) ?? null)
      : null

  return (
    <section aria-labelledby="catalogo-titulo" aria-busy={actualizando} className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 id="catalogo-titulo" className="text-lg font-bold text-neutral-900">
            Catálogo de deportes
          </h2>
          <p className="text-sm text-neutral-600 mt-1 max-w-[64ch]">
            Los deportes que se pueden ofrecer. El profesor responsable no se elige acá: se asigna
            en cada grupo.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="self-start sm:self-auto min-h-11 sm:min-h-10"
          onClick={() => setDialogo({ tipo: 'nuevo' })}
        >
          <Plus size={18} weight="bold" aria-hidden="true" />
          Nuevo deporte
        </Button>
      </div>

      {deportes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 py-8 px-5 text-center">
          <SoccerBall size={32} className="text-neutral-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-neutral-600 font-semibold">Todavía no hay deportes en el catálogo</p>
          <p className="text-neutral-500 text-sm mt-1">Agregá el primero con el botón «Nuevo deporte».</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {deportes.map((deporte) => {
            const conteo = conteos.get(deporte.id) ?? SIN_CONTEO
            const motivo = motivoInactivar(deporte, conteo)
            const idMotivo = `motivo-inactivar-${deporte.id}`

            return (
              <li
                key={deporte.id}
                className="bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col gap-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-neutral-900 break-words">{deporte.nombre}</h3>
                  {deporte.activo ? (
                    <Badge variant="success" dot>
                      Activo
                    </Badge>
                  ) : (
                    <Badge variant="default">Inactivo</Badge>
                  )}
                </div>
                <p className="text-sm text-neutral-700">{textoGrupos(conteo)}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-8"
                    onClick={() => setDialogo({ tipo: 'renombrar', deporteId: deporte.id })}
                    aria-label={`Renombrar el deporte ${deporte.nombre}`}
                  >
                    <PencilSimple size={16} weight="bold" aria-hidden="true" />
                    Renombrar
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
                      setDialogo({ tipo: 'estado', deporteId: deporte.id })
                    }}
                    aria-label={`${deporte.activo ? 'Inactivar' : 'Reactivar'} el deporte ${deporte.nombre}`}
                  >
                    <Power size={16} weight="bold" aria-hidden="true" />
                    {deporte.activo ? 'Inactivar' : 'Reactivar'}
                  </Button>
                </div>
                {motivo && (
                  <p id={idMotivo} className="text-xs text-neutral-700">
                    {motivo}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {dialogo?.tipo === 'nuevo' && (
        <DialogoNuevoDeporte
          onCerrar={() => setDialogo(null)}
          onCreado={(nombre) => {
            setDialogo(null)
            onCambio(`Creaste el deporte «${nombre}».`)
          }}
          onReleer={onReleer}
        />
      )}

      {dialogo?.tipo === 'renombrar' && deporteDelDialogo && (
        <DialogoRenombrarDeporte
          deporte={deporteDelDialogo}
          tieneGrupos={tieneGrupos(conteos.get(deporteDelDialogo.id) ?? SIN_CONTEO)}
          onCerrar={() => setDialogo(null)}
          onRenombrado={(anterior, nuevo) => {
            setDialogo(null)
            onCambio(
              anterior === nuevo
                ? `Actualizaste el deporte «${nuevo}».`
                : `Renombraste el deporte «${anterior}» a «${nuevo}».`
            )
          }}
          onReleer={onReleer}
        />
      )}

      {dialogo?.tipo === 'estado' && deporteDelDialogo && (
        <DialogoEstadoDeporte
          deporte={deporteDelDialogo}
          motivo={motivoInactivar(deporteDelDialogo, conteos.get(deporteDelDialogo.id) ?? SIN_CONTEO)}
          onCerrar={() => setDialogo(null)}
          onCambiado={(mensaje) => {
            setDialogo(null)
            onCambio(mensaje)
          }}
          onReleer={onReleer}
        />
      )}
    </section>
  )
}

// ----------------------------------------------------------------
// Alta
// ----------------------------------------------------------------

function DialogoNuevoDeporte({
  onCerrar,
  onCreado,
  onReleer,
}: {
  onCerrar: () => void
  onCreado: (nombre: string) => void
  onReleer: () => void
}) {
  const [nombre, setNombre] = useState('')
  const [errorNombre, setErrorNombre] = useState<string | undefined>()
  const [aviso, setAviso] = useState<AvisoError | null>(null)
  const { enviando, ejecutar } = useEnvio()

  function validar(): string | undefined {
    const recortado = nombre.trim()
    if (!recortado) return 'El nombre del deporte es requerido'
    if (recortado.length > 100) return 'El nombre del deporte no puede superar los 100 caracteres'
    return undefined
  }

  async function crear(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setAviso(null)
    const problema = validar()
    setErrorNombre(problema)
    if (problema) return

    await ejecutar(async () => {
      try {
        await crearDeporteRemoto(nombre.trim())
        onCreado(nombre.trim())
      } catch (fallo) {
        const resumen = avisoDeError(fallo, 'No pudimos crear el deporte. Volvé a intentarlo.')
        if (campoDeError(fallo) === 'nombre') setErrorNombre(resumen.texto)
        else setAviso(resumen)
        if (debeReleer(fallo)) onReleer()
      }
    })
  }

  return (
    <Dialogo
      tituloId="deportes-nuevo-deporte"
      titulo="Nuevo deporte"
      descripcion="Agregá un deporte al catálogo. Todavía no tendrá grupos: después los creás con «Nuevo grupo» y ahí elegís el profesor responsable."
      selectorFocoInicial="#deporte-nuevo-nombre"
      onCerrar={() => {
        if (!enviando) onCerrar()
      }}
    >
      <form onSubmit={crear} noValidate className="space-y-4">
        <AlertaError aviso={aviso} />
        <Input
          id="deporte-nuevo-nombre"
          label="Nombre del deporte"
          value={nombre}
          maxLength={100}
          className="min-h-11 sm:min-h-10"
          onChange={(evento) => {
            setNombre(evento.target.value)
            setErrorNombre(undefined)
          }}
          error={errorNombre}
          helperText="Entre 1 y 100 caracteres. Los espacios al principio y al final se ignoran."
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
            {enviando ? 'Creando deporte…' : 'Crear deporte'}
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}

// ----------------------------------------------------------------
// Renombrado
// ----------------------------------------------------------------

function DialogoRenombrarDeporte({
  deporte,
  tieneGrupos,
  onCerrar,
  onRenombrado,
  onReleer,
}: {
  deporte: DeporteCatalogo
  tieneGrupos: boolean
  onCerrar: () => void
  onRenombrado: (anterior: string, nuevo: string) => void
  onReleer: () => void
}) {
  const [nombre, setNombre] = useState(deporte.nombre)
  const [errorNombre, setErrorNombre] = useState<string | undefined>()
  const [aviso, setAviso] = useState<AvisoError | null>(null)
  const { enviando, ejecutar } = useEnvio()

  function validar(): string | undefined {
    const recortado = nombre.trim()
    if (!recortado) return 'El nombre del deporte es requerido'
    if (recortado.length > 100) return 'El nombre del deporte no puede superar los 100 caracteres'
    if (recortado === deporte.nombre) return MENSAJE_NOMBRE_SIN_CAMBIOS
    // Con grupos, la base solo admite mayúsculas y minúsculas: se avisa antes de
    // enviar en lugar de ofrecer un cambio que va a rechazar.
    if (tieneGrupos && !soloCambiaMayusculas(deporte.nombre, recortado)) {
      return MENSAJE_RENOMBRAR_CON_GRUPOS
    }
    return undefined
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setAviso(null)
    const problema = validar()
    setErrorNombre(problema)
    if (problema) return

    await ejecutar(async () => {
      try {
        await renombrarDeporteRemoto(deporte.id, nombre.trim())
        onRenombrado(deporte.nombre, nombre.trim())
      } catch (fallo) {
        const resumen = avisoDeError(fallo, 'No pudimos guardar el nombre. Volvé a intentarlo.')
        if (campoDeError(fallo) === 'nombre') setErrorNombre(resumen.texto)
        else setAviso(resumen)
        if (debeReleer(fallo)) onReleer()
      }
    })
  }

  return (
    <Dialogo
      tituloId="deportes-renombrar-deporte"
      titulo={`Renombrar ${deporte.nombre}`}
      selectorFocoInicial="#deporte-renombrar-nombre"
      onCerrar={() => {
        if (!enviando) onCerrar()
      }}
    >
      <form onSubmit={guardar} noValidate className="space-y-4">
        <AlertaError aviso={aviso} />
        {tieneGrupos ? (
          <p
            id="deporte-renombrar-regla"
            className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3"
          >
            {MENSAJE_RENOMBRAR_CON_GRUPOS}
          </p>
        ) : (
          <p id="deporte-renombrar-regla" className="text-sm text-neutral-700">
            Este deporte todavía no tiene grupos, así que podés cambiarle el nombre libremente.
            Cuando tenga grupos, solo se podrán cambiar las mayúsculas y minúsculas.
          </p>
        )}
        <Input
          id="deporte-renombrar-nombre"
          label="Nombre del deporte"
          value={nombre}
          maxLength={100}
          className="min-h-11 sm:min-h-10"
          onChange={(evento) => {
            setNombre(evento.target.value)
            setErrorNombre(undefined)
          }}
          error={errorNombre}
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
            {enviando ? 'Guardando…' : 'Guardar nombre'}
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}

// ----------------------------------------------------------------
// Inactivar o reactivar
// ----------------------------------------------------------------

function DialogoEstadoDeporte({
  deporte,
  motivo,
  onCerrar,
  onCambiado,
  onReleer,
}: {
  deporte: DeporteCatalogo
  /** Motivo vigente por el que no se puede inactivar; tras una relectura puede aparecer. */
  motivo: string | undefined
  onCerrar: () => void
  onCambiado: (mensaje: string) => void
  onReleer: () => void
}) {
  const [aviso, setAviso] = useState<AvisoError | null>(null)
  const { enviando, ejecutar } = useEnvio()
  const inactivando = deporte.activo

  async function confirmar() {
    setAviso(null)
    await ejecutar(async () => {
      try {
        await cambiarEstadoDeporteRemoto(deporte.id, !inactivando)
        onCambiado(
          inactivando
            ? `Inactivaste el deporte «${deporte.nombre}». Podés reactivarlo cuando quieras.`
            : `Reactivaste el deporte «${deporte.nombre}».`
        )
      } catch (fallo) {
        setAviso(
          avisoDeError(
            fallo,
            inactivando
              ? 'No pudimos inactivar el deporte. Volvé a intentarlo.'
              : 'No pudimos reactivar el deporte. Volvé a intentarlo.'
          )
        )
        if (debeReleer(fallo)) onReleer()
      }
    })
  }

  return (
    <Dialogo
      tituloId="deportes-estado-deporte"
      titulo={`${inactivando ? 'Inactivar' : 'Reactivar'} el deporte ${deporte.nombre}`}
      descripcion={
        inactivando
          ? 'El deporte deja de poder recibir grupos nuevos. Sus grupos inactivos y las inscripciones anteriores se conservan, y podés reactivarlo cuando quieras.'
          : 'El deporte vuelve a poder recibir grupos nuevos. Sus grupos inactivos siguen inactivos hasta que los reactives uno por uno.'
      }
      selectorFocoInicial="[data-foco-inicial]"
      onCerrar={() => {
        if (!enviando) onCerrar()
      }}
    >
      <div className="space-y-4">
        <AlertaError aviso={aviso} />
        {motivo && inactivando && (
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
            disabled={enviando || (inactivando && Boolean(motivo))}
            aria-busy={enviando}
          >
            {enviando
              ? inactivando
                ? 'Inactivando…'
                : 'Reactivando…'
              : inactivando
                ? 'Sí, inactivar el deporte'
                : 'Sí, reactivar el deporte'}
          </Button>
        </div>
      </div>
    </Dialogo>
  )
}
