'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Info, WarningCircle } from '@phosphor-icons/react'
import { Skeleton } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { mensajeParaMostrar } from '@/lib/errores'
import {
  cancelarVinculo,
  consultarVinculo,
  obtenerHistorial,
  obtenerUsuario,
  sincronizarAcceso,
  type CambioDeAcceso,
  type DetalleDeUsuario,
  type EntradaDeHistorial,
} from '@/services/usuarios-admin.client'
import {
  estadoDeCuenta,
  formatearFechaHora,
  formatearHora,
  InsigniaAcceso,
  InsigniaCuenta,
  InsigniaRol,
} from '../../_components/etiquetas'
import { AsistenteVinculo, estadoInicialDelAsistente, type EstadoAsistente } from './AsistenteVinculo'
import { DialogoAcceso } from './DialogoAcceso'
import { DialogoCambioRol } from './DialogoCambioRol'
import { HistorialUsuario } from './HistorialUsuario'
import { SeccionDatosPersonales } from './SeccionDatosPersonales'

const MENSAJE_CARGA = 'No pudimos cargar los datos de la persona. Intentá nuevamente.'
const MENSAJE_SINCRONIZACION = 'No pudimos sincronizar la cuenta. Volvé a intentarlo en unos minutos.'

type Datos = { detalle: DetalleDeUsuario; historial: EntradaDeHistorial[] }
type Carga = { clave: number; datos?: Datos; error?: string }

/**
 * Detalle de una persona para la dirección (EPT-59).
 *
 * Secciones: datos personales, rol, acceso, cuenta e historial. Cada acción
 * vuelve a leer el detalle y el historial después de confirmar, de modo que lo
 * que se ve es siempre lo que quedó en la base. Los avisos de estado y de error
 * se anuncian con regiones vivas; los diálogos devuelven el foco al control que
 * los abrió.
 */
export function DetalleUsuario({ perfilId, esPropio }: { perfilId: string; esPropio: boolean }) {
  const [version, setVersion] = useState(0)
  const [carga, setCarga] = useState<Carga | null>(null)
  const [dialogo, setDialogo] = useState<'rol' | 'acceso' | null>(null)
  const [asistente, setAsistente] = useState<EstadoAsistente | null>(null)
  const [asistenteAbierto, setAsistenteAbierto] = useState(false)
  const [anuncio, setAnuncio] = useState<string | null>(null)
  const [alerta, setAlerta] = useState<string | null>(null)
  const [authPendiente, setAuthPendiente] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [operandoVinculo, setOperandoVinculo] = useState(false)
  const botonVincular = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let vigente = true
    Promise.all([obtenerUsuario(perfilId), obtenerHistorial(perfilId)])
      .then(([detalle, historial]) => {
        if (vigente) setCarga({ clave: version, datos: { detalle, historial } })
      })
      .catch((error: unknown) => {
        if (vigente) setCarga({ clave: version, error: mensajeParaMostrar(error, MENSAJE_CARGA) })
      })
    return () => {
      vigente = false
    }
  }, [perfilId, version])

  const recargar = useCallback(() => setVersion((v) => v + 1), [])

  const datos = carga?.datos
  const cargando = carga?.clave !== version

  if (!datos) {
    if (carga?.error && !cargando) {
      return (
        <div className="max-w-4xl mx-auto space-y-6 min-w-0">
          <EnlaceVolver />
          <div role="alert" className="bg-red-50 border border-red-200 rounded-2xl p-5 flex flex-wrap gap-3 items-start">
            <WarningCircle size={22} weight="fill" className="text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-red-800">No pudimos mostrar a esta persona</p>
              <p className="text-sm text-red-700 mt-1">{carga.error}</p>
            </div>
            <Button size="sm" variant="outline" onClick={recargar}>
              Reintentar
            </Button>
          </div>
        </div>
      )
    }
    return <EsqueletoDelDetalle />
  }

  const { detalle, historial } = datos
  const nombre = `${detalle.nombre} ${detalle.apellido}`
  const cuenta = estadoDeCuenta(detalle)
  // La base y la cuenta de ingreso no coinciden: bloqueo pendiente de aplicar
  // en la cuenta, o una cuenta que sigue bloqueada con el acceso habilitado.
  const desincronizado =
    authPendiente ||
    (detalle.tiene_cuenta &&
      detalle.cuenta_existente &&
      (detalle.estado_acceso === 'BLOQUEADO') !== detalle.bloqueo_auth)
  const vinculoEnCurso = asistente && asistente.paso < 4 ? asistente : null

  function alCambiarAcceso(cambio: CambioDeAcceso) {
    setDialogo(null)
    setAlerta(null)
    setAuthPendiente(!cambio.auth_sincronizado)
    setAnuncio(
      cambio.estado_acceso === 'BLOQUEADO'
        ? `Acceso de ${nombre} bloqueado.`
        : `Acceso de ${nombre} reactivado.`
    )
    recargar()
  }

  function alQuedarObsoleto(mensaje: string) {
    setDialogo(null)
    setAnuncio(null)
    setAlerta(mensaje)
    recargar()
  }

  async function reintentarSincronizacion() {
    if (sincronizando) return
    setSincronizando(true)
    setAlerta(null)
    try {
      const resultado = await sincronizarAcceso(perfilId)
      setAuthPendiente(!resultado.auth_sincronizado)
      setAnuncio(
        resultado.auth_sincronizado
          ? 'La cuenta quedó sincronizada con el estado de acceso.'
          : null
      )
      if (!resultado.auth_sincronizado) setAlerta(MENSAJE_SINCRONIZACION)
      recargar()
    } catch (error) {
      setAlerta(mensajeParaMostrar(error, MENSAJE_SINCRONIZACION))
    } finally {
      setSincronizando(false)
    }
  }

  function abrirAsistente() {
    setAsistente((previo) => (previo && previo.paso < 4 ? previo : estadoInicialDelAsistente()))
    setAsistenteAbierto(true)
  }

  /** Retoma una vinculación iniciada antes de recargar la página. */
  async function continuarPendiente(operacion: string) {
    if (operandoVinculo) return
    setOperandoVinculo(true)
    setAlerta(null)
    try {
      const vinculo = await consultarVinculo(operacion)
      if (vinculo.estado !== 'PENDIENTE') {
        setAnuncio('La vinculación en curso ya no está vigente.')
        recargar()
        return
      }
      setAsistente({
        operacionId: operacion,
        paso: vinculo.desafio_emitido ? 3 : 2,
        reservado: true,
        venceEn: vinculo.vence_en,
        correo: '',
        correoEnmascarado: vinculo.correo_enmascarado,
        desafioVenceEn: null,
      })
      setAsistenteAbierto(true)
    } catch (error) {
      setAlerta(mensajeParaMostrar(error, 'No pudimos retomar la vinculación en curso.'))
    } finally {
      setOperandoVinculo(false)
    }
  }

  async function cancelarPendiente(operacion: string) {
    if (operandoVinculo) return
    setOperandoVinculo(true)
    setAlerta(null)
    try {
      await cancelarVinculo(operacion)
      setAsistente(null)
      setAnuncio('La vinculación en curso quedó cancelada.')
      recargar()
    } catch (error) {
      setAlerta(mensajeParaMostrar(error, 'No pudimos cancelar la vinculación en curso.'))
    } finally {
      setOperandoVinculo(false)
    }
  }

  function terminarAsistente() {
    const vinculada = asistente?.paso === 4
    setAsistenteAbierto(false)
    setAsistente(null)
    setAnuncio(vinculada ? `La cuenta de ${nombre} quedó vinculada.` : 'La vinculación quedó cancelada.')
    recargar()
    // El botón que abrió el asistente puede desaparecer al vincular: el foco
    // vuelve al título de la sección de cuenta.
    requestAnimationFrame(() => {
      document.getElementById('titulo-seccion-cuenta')?.focus()
    })
  }

  const pendienteEnBase = detalle.vinculo_pendiente_operacion
  const esEstudiante = detalle.rol === 'ESTUDIANTE'

  return (
    <div className="max-w-4xl mx-auto space-y-6 min-w-0" aria-busy={cargando}>
      <EnlaceVolver />

      <header className="space-y-2 min-w-0">
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight break-words">{nombre}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
          <span>DNI {detalle.dni}</span>
          <InsigniaRol rol={detalle.rol} />
          <InsigniaAcceso estado={detalle.estado_acceso} />
          <InsigniaCuenta usuario={detalle} />
        </div>
        {esPropio && (
          <p className="text-sm text-neutral-700 flex gap-2 items-start">
            <Info size={18} weight="fill" className="text-brand-700 shrink-0 mt-0.5" aria-hidden="true" />
            Este es tu propio perfil. Tu rol y tu acceso los administra otra persona de Dirección.
          </p>
        )}
      </header>

      <div role="status" aria-live="polite" className="empty:hidden">
        {anuncio && (
          <p className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{anuncio}</p>
        )}
      </div>
      <div role="alert" aria-live="assertive" className="empty:hidden">
        {alerta && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{alerta}</p>
        )}
      </div>

      <Seccion id="seccion-datos" titulo="Datos personales">
        <SeccionDatosPersonales key={detalle.id} detalle={detalle} onGuardado={recargar} />
      </Seccion>

      <Seccion id="seccion-rol" titulo="Rol">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-neutral-700 flex items-center gap-2">
            Rol actual: <InsigniaRol rol={detalle.rol} />
          </p>
          {!esPropio && !esEstudiante && (
            <Button variant="outline" onClick={() => setDialogo('rol')}>
              Cambiar rol
            </Button>
          )}
        </div>
        {esEstudiante && (
          <p className="text-sm text-neutral-700 mt-3">
            El rol ESTUDIANTE depende del legajo académico: no se cambia desde Usuarios. Gestionalo
            desde Alumnos.
          </p>
        )}
      </Seccion>

      <Seccion id="seccion-acceso" titulo="Acceso">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-neutral-700 flex items-center gap-2">
            Estado: <InsigniaAcceso estado={detalle.estado_acceso} />
          </p>
          {!esPropio && (
            detalle.estado_acceso === 'HABILITADO' ? (
              <Button variant="peligro" onClick={() => setDialogo('acceso')}>
                Bloquear acceso
              </Button>
            ) : (
              <Button onClick={() => setDialogo('acceso')}>Reactivar acceso</Button>
            )
          )}
        </div>
        {desincronizado && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-wrap gap-3 items-start">
            <WarningCircle size={20} weight="fill" className="text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm text-amber-900">
              <p className="font-semibold">La cuenta de ingreso todavía no refleja este estado</p>
              <p className="mt-1">
                {detalle.estado_acceso === 'BLOQUEADO'
                  ? 'La persona ya no ve ningún dato del panel, pero su cuenta todavía no quedó bloqueada para ingresar.'
                  : 'El acceso está habilitado, pero la cuenta sigue bloqueada para ingresar.'}{' '}
                Reintentá la sincronización.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={reintentarSincronizacion} loading={sincronizando}>
              Reintentar sincronización
            </Button>
          </div>
        )}
      </Seccion>

      <Seccion id="seccion-cuenta" titulo="Cuenta" tituloId="titulo-seccion-cuenta">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Dato termino="Cuenta"><InsigniaCuenta usuario={detalle} /></Dato>
          <Dato termino="Correo">{detalle.correo_enmascarado ?? '—'}</Dato>
          <Dato termino="Correo confirmado">
            {detalle.tiene_cuenta ? (detalle.correo_confirmado ? 'Sí' : 'No') : '—'}
          </Dato>
          <Dato termino="Último ingreso">{formatearFechaHora(detalle.ultimo_ingreso)}</Dato>
        </dl>

        {cuenta === 'SIN_CUENTA' && (
          <div className="mt-4 space-y-3">
            {pendienteEnBase && !vinculoEnCurso && (
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
                <p className="text-sm text-neutral-800">
                  Hay una vinculación de cuenta en curso que vence a las{' '}
                  {formatearHora(detalle.vinculo_pendiente_vence_en)}.
                </p>
                <div className="flex flex-wrap gap-2">
                  {detalle.vinculo_disponible && (
                    <Button size="sm" onClick={() => continuarPendiente(pendienteEnBase)} disabled={operandoVinculo}>
                      Continuar vinculación
                    </Button>
                  )}
                  {detalle.vinculo_disponible && (
                    <Button size="sm" variant="outline" onClick={() => cancelarPendiente(pendienteEnBase)} disabled={operandoVinculo}>
                      Cancelar vinculación en curso
                    </Button>
                  )}
                </div>
              </div>
            )}

            {detalle.puede_vincular && detalle.vinculo_disponible && (!pendienteEnBase || vinculoEnCurso) && (
              <div className="flex flex-wrap items-center gap-3">
                <Button ref={botonVincular} onClick={abrirAsistente}>
                  {vinculoEnCurso ? 'Continuar vinculación' : 'Vincular cuenta'}
                </Button>
                <p className="text-sm text-neutral-700">
                  La persona tiene que estar presente con su documento.
                </p>
              </div>
            )}

            {detalle.puede_vincular && !detalle.vinculo_disponible && (
              <p className="text-sm text-neutral-700 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                La vinculación presencial de cuentas no está disponible: el envío de correos para el
                código de verificación no está configurado en este servidor. Pedile al equipo técnico
                que lo active.
              </p>
            )}

            {!detalle.puede_vincular && (
              <p className="text-sm text-neutral-700">
                {detalle.estado_acceso === 'BLOQUEADO'
                  ? 'Para vincular una cuenta, primero reactivá el acceso de la persona.'
                  : detalle.rol === 'DIRECTOR'
                    ? 'Una cuenta de Dirección se crea con el alta con cuenta, en Usuarios.'
                    : 'Para vincular una cuenta, la persona necesita un rol asignado.'}
              </p>
            )}
          </div>
        )}
      </Seccion>

      <Seccion id="seccion-historial" titulo="Historial">
        <HistorialUsuario entradas={historial} />
      </Seccion>

      {dialogo === 'rol' && (
        <DialogoCambioRol
          perfilId={perfilId}
          rolActual={detalle.rol}
          puedeSerDirector={cuenta === 'ACTIVA'}
          onCerrar={() => setDialogo(null)}
          onCambiado={(cambio) => {
            setDialogo(null)
            setAlerta(null)
            setAnuncio(`Rol de ${nombre} cambiado a ${cambio.rol}.`)
            recargar()
          }}
          onObsoleto={alQuedarObsoleto}
        />
      )}

      {dialogo === 'acceso' && (
        <DialogoAcceso
          perfilId={perfilId}
          estadoActual={detalle.estado_acceso}
          nombre={nombre}
          onCerrar={() => setDialogo(null)}
          onCambiado={alCambiarAcceso}
          onObsoleto={alQuedarObsoleto}
        />
      )}

      {asistenteAbierto && asistente && (
        <AsistenteVinculo
          perfilId={perfilId}
          nombre={nombre}
          estado={asistente}
          onCambio={(cambio) => setAsistente((previo) => (previo ? cambio(previo) : previo))}
          onCerrar={() => setAsistenteAbierto(false)}
          onTerminado={terminarAsistente}
        />
      )}
    </div>
  )
}

function EnlaceVolver() {
  return (
    <Link
      href="/dashboard/usuarios"
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
    >
      <ArrowLeft size={16} aria-hidden="true" />
      Volver a Usuarios
    </Link>
  )
}

function Seccion({
  id,
  titulo,
  tituloId,
  children,
}: {
  id: string
  titulo: string
  tituloId?: string
  children: React.ReactNode
}) {
  const idDelTitulo = tituloId ?? `${id}-titulo`
  return (
    <section id={id} aria-labelledby={idDelTitulo} className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-6 min-w-0">
      <h2
        id={idDelTitulo}
        tabIndex={-1}
        className="font-bold text-neutral-900 mb-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded w-fit"
      >
        {titulo}
      </h2>
      {children}
    </section>
  )
}

function Dato({ termino, children }: { termino: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">{termino}</dt>
      <dd className="mt-1 text-neutral-900 break-words">{children}</dd>
    </div>
  )
}

function EsqueletoDelDetalle() {
  return (
    <div className="max-w-4xl mx-auto space-y-6" aria-busy="true">
      <p className="sr-only" role="status">Cargando los datos de la persona…</p>
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-8 w-72 max-w-full" />
      {Array.from({ length: 4 }).map((_, indice) => (
        <Skeleton key={indice} className="h-40 w-full rounded-2xl" />
      ))}
    </div>
  )
}
