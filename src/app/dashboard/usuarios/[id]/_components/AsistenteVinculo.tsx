'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle, Timer, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { Input } from '@/components/ui/Input'
import { mensajeParaMostrar } from '@/lib/errores'
import { cn } from '@/lib/utils'
import { CONTRASENA_VINCULO_MAXIMO, CONTRASENA_VINCULO_MINIMO } from '@/lib/validations'
import {
  cancelarVinculo,
  consultarVinculo,
  enviarCodigo,
  ErrorDeUsuarios,
  reservarVinculo,
  verificarCodigo,
} from '@/services/usuarios-admin.client'
import { nuevoIdentificadorDeOperacion } from '@/services/usuarios.service'
import { formatearHora } from '../../_components/etiquetas'

/**
 * Asistente «Vincular cuenta» (EPT-59, D5).
 *
 * Cuatro pasos explícitos, en el dispositivo de la escuela y con la persona
 * presente:
 *
 *   1. Identidad presencial: se reingresa el DNI del documento, se indica si
 *      el trámite lo hace la persona titular o un representante y se deja
 *      constancia de la verificación. Reserva la operación.
 *   2. Correo: la persona dicta o escribe su correo y se le envía un código.
 *   3. La persona escribe el código que recibió y elige su contraseña. Recién
 *      acá se crea la cuenta, ya enlazada al perfil.
 *   4. Resultado.
 *
 * `operacionId` se genera una sola vez por operación y se conserva entre
 * reintentos: la API es idempotente por esa clave, así que un reintento
 * después de un corte nunca duplica la reserva ni la cuenta. El código nunca
 * se muestra ni se registra: lo escribe la persona en un campo enmascarado.
 */

export type EstadoAsistente = {
  operacionId: string
  paso: 1 | 2 | 3 | 4
  reservado: boolean
  venceEn: string | null
  /** Correo que escribió la persona; solo vive en memoria para poder reenviar. */
  correo: string
  correoEnmascarado: string | null
  desafioVenceEn: string | null
}

export function estadoInicialDelAsistente(): EstadoAsistente {
  return {
    operacionId: nuevoIdentificadorDeOperacion(),
    paso: 1,
    reservado: false,
    venceEn: null,
    correo: '',
    correoEnmascarado: null,
    desafioVenceEn: null,
  }
}

const TITULO_ID = 'titulo-asistente-vinculo'
const PASO_ID = 'titulo-paso-vinculo'

const PASOS = [
  'Identidad presencial',
  'Correo de la persona',
  'Código y contraseña',
  'Resultado',
] as const

const PATRON_DNI = /^\d{7,8}$/u
const PATRON_CODIGO = /^\d{6}$/u
const PATRON_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

const MENSAJE_FALLO = 'No pudimos completar este paso. Volvé a intentarlo en unos minutos.'

/** Códigos después de los cuales solo sirve pedir un código nuevo. */
const CODIGOS_PARA_REENVIAR = new Set(['CODIGO_VENCIDO', 'CODIGO_SIN_INTENTOS', 'SIN_CODIGO_VIGENTE'])
/** Códigos que dejan la operación inservible: hay que cerrarla. */
const CODIGOS_TERMINALES = new Set([
  'RESERVA_VENCIDA',
  'RESERVA_NO_VIGENTE',
  'RESERVA_DE_OTRO_DIRECTOR',
  'LIMITE_DE_ENVIOS',
  'VINCULO_RECHAZADO',
])

function tiempoRestante(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutos = Math.floor(total / 60)
  const segundos = total % 60
  return `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`
}

export function AsistenteVinculo({
  perfilId,
  nombre,
  estado,
  onCambio,
  onCerrar,
  onTerminado,
}: {
  perfilId: string
  nombre: string
  estado: EstadoAsistente
  onCambio: (cambio: (previo: EstadoAsistente) => EstadoAsistente) => void
  /** Cierra el diálogo y conserva la operación para continuarla después. */
  onCerrar: () => void
  /** La operación terminó (vinculada o cancelada): quien llama descarta el estado y recarga. */
  onTerminado: () => void
}) {
  const tituloPaso = useRef<HTMLHeadingElement>(null)
  const primerRender = useRef(true)
  const [ahora, setAhora] = useState<number | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<string | null>(null)
  const [terminal, setTerminal] = useState(false)

  // Paso 1
  const [dni, setDni] = useState('')
  const [modalidad, setModalidad] = useState<'TITULAR' | 'REPRESENTANTE'>('TITULAR')
  const [dniRepresentante, setDniRepresentante] = useState('')
  const [verificado, setVerificado] = useState(false)
  // Paso 2
  const [correo, setCorreo] = useState(estado.correo)
  // Paso 3
  const [codigo, setCodigo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [sugerirReenvio, setSugerirReenvio] = useState(false)

  // El foco va al título de cada paso nuevo. En el primero lo pone el diálogo,
  // que además recuerda qué control lo abrió para devolverle el foco.
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false
      return
    }
    tituloPaso.current?.focus()
  }, [estado.paso])

  // Reloj de la reserva: se actualiza cada segundo, fuera del render.
  useEffect(() => {
    const marcar = () => setAhora(Date.now())
    const inicial = setTimeout(marcar, 0)
    const intervalo = setInterval(marcar, 1000)
    return () => {
      clearTimeout(inicial)
      clearInterval(intervalo)
    }
  }, [])

  const restanteMs =
    estado.venceEn && ahora !== null ? new Date(estado.venceEn).getTime() - ahora : null
  const vencida = restanteMs !== null && restanteMs <= 0
  const bloqueado = enviando || vencida || terminal

  function limpiarMensajes() {
    setErrorGeneral(null)
    setErrores({})
    setAviso(null)
  }

  function manejarError(error: unknown, campos: Record<string, string> = {}) {
    const mensaje = mensajeParaMostrar(error, MENSAJE_FALLO)
    if (error instanceof ErrorDeUsuarios) {
      if (error.campo && campos[error.campo]) {
        setErrores({ [campos[error.campo]]: mensaje })
        return
      }
      if (CODIGOS_TERMINALES.has(error.codigo)) setTerminal(true)
    }
    setErrorGeneral(mensaje)
  }

  // ---- Paso 1: identidad presencial y reserva ----
  async function reservar(evento: React.FormEvent) {
    evento.preventDefault()
    if (bloqueado) return
    limpiarMensajes()
    const nuevos: Record<string, string> = {}
    if (!PATRON_DNI.test(dni.trim())) nuevos.dni = 'Ingresá el DNI del documento: 7 u 8 dígitos, sin puntos.'
    if (modalidad === 'REPRESENTANTE' && !PATRON_DNI.test(dniRepresentante.trim())) {
      nuevos.dniRepresentante = 'Ingresá el DNI del representante: 7 u 8 dígitos, sin puntos.'
    }
    if (!verificado) nuevos.verificado = 'Confirmá que verificaste presencialmente el documento.'
    if (Object.keys(nuevos).length > 0) {
      setErrores(nuevos)
      return
    }

    setEnviando(true)
    try {
      const reserva = await reservarVinculo({
        operacion_id: estado.operacionId,
        perfil_id: perfilId,
        dni: dni.trim(),
        modalidad,
        representante_dni: modalidad === 'REPRESENTANTE' ? dniRepresentante.trim() : null,
        documento_verificado: true,
      })
      onCambio((previo) => ({
        ...previo,
        reservado: true,
        venceEn: reserva.vence_en,
        correoEnmascarado: reserva.correo_enmascarado,
        paso: reserva.correo_verificado || reserva.desafio_emitido ? 3 : 2,
      }))
    } catch (error) {
      if (error instanceof ErrorDeUsuarios && error.codigo === 'RESERVA_REUTILIZADA') {
        // La clave ya se usó con otros datos: la próxima vez se usa una nueva.
        onCambio((previo) => ({ ...previo, operacionId: nuevoIdentificadorDeOperacion() }))
      }
      manejarError(error, {
        dni: 'dni',
        representante_dni: 'dniRepresentante',
        documento_verificado: 'verificado',
      })
    } finally {
      setEnviando(false)
    }
  }

  // ---- Paso 2: correo y envío del código ----
  async function enviar(correoAEnviar: string) {
    if (bloqueado) return
    limpiarMensajes()
    setSugerirReenvio(false)
    const normalizado = correoAEnviar.trim().toLowerCase()
    if (!PATRON_CORREO.test(normalizado) || normalizado.length > 254) {
      if (estado.paso === 2) setErrores({ correo: 'Ingresá un correo válido.' })
      else setErrorGeneral('Ingresá un correo válido.')
      return
    }
    setEnviando(true)
    try {
      const envio = await enviarCodigo(estado.operacionId, normalizado)
      onCambio((previo) => ({
        ...previo,
        correo: normalizado,
        correoEnmascarado: envio.correo_enmascarado,
        desafioVenceEn: envio.desafio_vence_en,
        paso: 3,
      }))
      setCodigo('')
      // En el primer envío el paso 3 ya lo explica; el aviso es para un reenvío.
      if (estado.paso === 3) setAviso(
        `Enviamos un código nuevo a ${envio.correo_enmascarado ?? 'la dirección indicada'}. ` +
          `Vence a las ${formatearHora(envio.desafio_vence_en)}.`
      )
    } catch (error) {
      manejarError(error, estado.paso === 2 ? { correo: 'correo' } : {})
    } finally {
      setEnviando(false)
    }
  }

  // ---- Paso 3: código, contraseña y creación de la cuenta ----
  async function verificar(evento: React.FormEvent) {
    evento.preventDefault()
    if (bloqueado) return
    limpiarMensajes()
    const nuevos: Record<string, string> = {}
    if (!PATRON_CODIGO.test(codigo)) nuevos.codigo = 'El código tiene exactamente 6 dígitos.'
    if (contrasena.length < CONTRASENA_VINCULO_MINIMO || contrasena.length > CONTRASENA_VINCULO_MAXIMO) {
      nuevos.contrasena = `La contraseña debe tener entre ${CONTRASENA_VINCULO_MINIMO} y ${CONTRASENA_VINCULO_MAXIMO} caracteres.`
    }
    if (confirmacion !== contrasena) nuevos.confirmacion = 'Las contraseñas no coinciden.'
    if (Object.keys(nuevos).length > 0) {
      setErrores(nuevos)
      return
    }

    setEnviando(true)
    try {
      await verificarCodigo(estado.operacionId, codigo, contrasena)
      terminarConExito()
    } catch (error) {
      if (
        error instanceof ErrorDeUsuarios &&
        (error.sinRespuesta ||
          error.codigo === 'VINCULO_SIN_CONFIRMAR' ||
          error.codigo === 'SERVICIO_NO_DISPONIBLE')
      ) {
        // Resultado desconocido: se lee el estado antes de decir nada.
        if (await quedoVinculado()) {
          terminarConExito()
          return
        }
        setErrorGeneral(
          'No pudimos confirmar si la cuenta quedó vinculada. No se borró ningún dato: volvé a ' +
            'intentarlo con el mismo código, la cuenta no se duplica.'
        )
        return
      }
      if (error instanceof ErrorDeUsuarios && error.codigo === 'CODIGO_INCORRECTO') {
        setCodigo('')
        if (error.intentosRestantes === 0) setSugerirReenvio(true)
      }
      if (error instanceof ErrorDeUsuarios && CODIGOS_PARA_REENVIAR.has(error.codigo)) {
        setCodigo('')
        setSugerirReenvio(true)
      }
      manejarError(error, { codigo: 'codigo', contrasena: 'contrasena' })
    } finally {
      setEnviando(false)
    }
  }

  async function quedoVinculado(): Promise<boolean> {
    try {
      const vinculo = await consultarVinculo(estado.operacionId)
      return vinculo.vinculado === true || vinculo.estado === 'COMPLETADA'
    } catch {
      return false
    }
  }

  function terminarConExito() {
    setCodigo('')
    setContrasena('')
    setConfirmacion('')
    onCambio((previo) => ({ ...previo, paso: 4, correo: '' }))
  }

  async function cancelarOperacion() {
    if (enviando) return
    limpiarMensajes()
    if (!estado.reservado) {
      onTerminado()
      return
    }
    setEnviando(true)
    try {
      await cancelarVinculo(estado.operacionId)
      onTerminado()
    } catch (error) {
      manejarError(error)
      setEnviando(false)
    }
  }

  function reenviar() {
    if (estado.correo) void enviar(estado.correo)
    else {
      limpiarMensajes()
      onCambio((previo) => ({ ...previo, paso: 2 }))
    }
  }

  const paso = estado.paso

  return (
    <Dialogo
      tituloId={TITULO_ID}
      titulo={`Vincular cuenta de ${nombre}`}
      selectorFocoInicial={`#${PASO_ID}`}
      onCerrar={() => {
        if (enviando) return
        if (paso === 4) onTerminado()
        else onCerrar()
      }}
    >
      <ol className="flex flex-wrap gap-x-3 gap-y-1 mb-4 text-xs" aria-label="Pasos de la vinculación">
        {PASOS.map((titulo, indice) => {
          const numero = indice + 1
          const actual = numero === paso
          return (
            <li
              key={titulo}
              aria-current={actual ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5',
                actual ? 'font-semibold text-brand-700' : numero < paso ? 'text-neutral-700' : 'text-neutral-600'
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'inline-flex w-5 h-5 items-center justify-center rounded-full border text-[11px]',
                  actual ? 'border-brand-600 bg-brand-50' : 'border-neutral-300'
                )}
              >
                {numero}
              </span>
              {titulo}
            </li>
          )
        })}
      </ol>

      <h3
        id={PASO_ID}
        ref={tituloPaso}
        tabIndex={-1}
        className="font-bold text-neutral-900 mb-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
      >
        Paso {paso} de 4: {PASOS[paso - 1]}
      </h3>

      {estado.venceEn && paso < 4 && (
        <p
          className={cn(
            'mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
            vencida ? 'bg-red-50 text-red-800' : 'bg-neutral-100 text-neutral-800'
          )}
        >
          <Timer size={16} aria-hidden="true" />
          {vencida ? (
            'La operación venció. Cerrala e iniciá una vinculación nueva.'
          ) : (
            <span>
              La operación vence en{' '}
              <span role="timer" aria-live="off" className="font-mono font-semibold">
                {restanteMs === null ? '--:--' : tiempoRestante(restanteMs)}
              </span>
            </span>
          )}
        </p>
      )}

      <div aria-live="polite" role="status" className="empty:hidden mb-3">
        {aviso && (
          <p className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{aviso}</p>
        )}
      </div>
      <div aria-live="assertive" role="alert" className="empty:hidden mb-3">
        {errorGeneral && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex gap-2 items-start">
            <WarningCircle size={18} weight="fill" className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>{errorGeneral}</span>
          </p>
        )}
      </div>

      {paso === 1 && (
        <form onSubmit={reservar} noValidate className="space-y-4">
          <p className="text-sm text-neutral-700">
            Pedile el documento a quien realiza el trámite y reingresá el DNI de {nombre} tal como
            figura en el documento.
          </p>
          <Input
            id="vinculo-dni"
            label="DNI de la persona"
            required
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={dni}
            onChange={(e) => setDni(e.target.value)}
            error={errores.dni}
            disabled={bloqueado}
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-neutral-700">¿Quién realiza el trámite?</legend>
            {(
              [
                ['TITULAR', 'La persona titular'],
                ['REPRESENTANTE', 'Un representante autorizado'],
              ] as const
            ).map(([valor, etiqueta]) => (
              <label key={valor} className="flex items-center gap-2 text-sm text-neutral-800 cursor-pointer w-fit">
                <input
                  type="radio"
                  name="vinculo-modalidad"
                  value={valor}
                  checked={modalidad === valor}
                  onChange={() => setModalidad(valor)}
                  disabled={bloqueado}
                  className="w-4 h-4 accent-brand-600"
                />
                {etiqueta}
              </label>
            ))}
          </fieldset>
          {modalidad === 'REPRESENTANTE' && (
            <Input
              id="vinculo-dni-representante"
              label="DNI del representante"
              required
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              value={dniRepresentante}
              onChange={(e) => setDniRepresentante(e.target.value)}
              error={errores.dniRepresentante}
              disabled={bloqueado}
            />
          )}
          <div className="space-y-1">
            <label className="flex items-start gap-2 text-sm text-neutral-800 cursor-pointer">
              <input
                id="vinculo-verificado"
                type="checkbox"
                checked={verificado}
                onChange={(e) => setVerificado(e.target.checked)}
                required
                aria-invalid={errores.verificado ? true : undefined}
                aria-describedby={errores.verificado ? 'vinculo-verificado-error' : undefined}
                disabled={bloqueado}
                className="w-4 h-4 mt-0.5 accent-brand-600 shrink-0"
              />
              <span>
                Verifiqué presencialmente el documento de la persona que realiza el trámite
                <span className="text-red-600 ml-0.5">*</span>
              </span>
            </label>
            {errores.verificado && (
              <p id="vinculo-verificado-error" role="alert" className="text-xs text-red-700">
                {errores.verificado}
              </p>
            )}
          </div>
          <Acciones>
            <Button type="button" variant="ghost" onClick={cancelarOperacion} disabled={enviando}>
              Cancelar operación
            </Button>
            <Button type="submit" loading={enviando} disabled={bloqueado}>
              Continuar
            </Button>
          </Acciones>
        </form>
      )}

      {paso === 2 && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void enviar(correo)
          }}
          noValidate
          className="space-y-4"
        >
          <p className="text-sm text-neutral-700">
            Pedile a la persona que escriba o dicte su correo electrónico. Le enviaremos un código de
            6 dígitos que solo ella va a ver.
          </p>
          <Input
            id="vinculo-correo"
            label="Correo electrónico de la persona"
            type="email"
            required
            autoComplete="off"
            maxLength={254}
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            error={errores.correo}
            disabled={bloqueado}
          />
          <Acciones>
            <Button type="button" variant="ghost" onClick={cancelarOperacion} disabled={enviando}>
              Cancelar operación
            </Button>
            <Button type="submit" loading={enviando} disabled={bloqueado}>
              Enviar código
            </Button>
          </Acciones>
        </form>
      )}

      {paso === 3 && (
        <form onSubmit={verificar} noValidate className="space-y-4">
          <p className="text-sm text-neutral-700">
            {estado.correoEnmascarado
              ? `Enviamos un código a ${estado.correoEnmascarado}.`
              : 'Enviamos un código al correo indicado.'}{' '}
            {estado.desafioVenceEn &&
              `El código vence a las ${formatearHora(estado.desafioVenceEn)}. `}
            Pedile a la persona que escriba el código que recibió y que elija su contraseña.
          </p>
          <Input
            id="vinculo-codigo"
            label="Código de verificación"
            type="password"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/gu, ''))}
            error={errores.codigo}
            helperText="6 dígitos. El código no se muestra en pantalla."
            disabled={bloqueado}
          />
          <Input
            id="vinculo-contrasena"
            label="Contraseña nueva"
            type="password"
            required
            autoComplete="new-password"
            maxLength={CONTRASENA_VINCULO_MAXIMO}
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            error={errores.contrasena}
            helperText={`Entre ${CONTRASENA_VINCULO_MINIMO} y ${CONTRASENA_VINCULO_MAXIMO} caracteres.`}
            disabled={bloqueado}
          />
          <Input
            id="vinculo-confirmacion"
            label="Repetí la contraseña"
            type="password"
            required
            autoComplete="new-password"
            maxLength={CONTRASENA_VINCULO_MAXIMO}
            value={confirmacion}
            onChange={(e) => setConfirmacion(e.target.value)}
            error={errores.confirmacion}
            disabled={bloqueado}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={sugerirReenvio ? 'primary' : 'outline'}
              onClick={reenviar}
              disabled={bloqueado}
            >
              Reenviar código
            </Button>
            {sugerirReenvio && (
              <p className="text-xs text-neutral-700">Pedí un código nuevo para seguir.</p>
            )}
          </div>
          <Acciones>
            <Button type="button" variant="ghost" onClick={cancelarOperacion} disabled={enviando}>
              Cancelar operación
            </Button>
            <Button type="submit" loading={enviando} disabled={bloqueado}>
              Verificar y crear la cuenta
            </Button>
          </Acciones>
        </form>
      )}

      {paso === 4 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex gap-3 items-start">
            <CheckCircle size={22} weight="fill" className="text-green-700 shrink-0" aria-hidden="true" />
            <div className="text-sm text-green-900">
              <p className="font-semibold">La cuenta quedó vinculada.</p>
              <p className="mt-1">
                {nombre} ya puede ingresar con su correo y la contraseña que eligió. Sus datos, su
                rol y su historial no cambiaron.
              </p>
            </div>
          </div>
          <Acciones>
            <Button type="button" onClick={onTerminado}>
              Cerrar
            </Button>
          </Acciones>
        </div>
      )}

      {(vencida || terminal) && paso < 4 && (
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" onClick={onTerminado}>
            Cerrar la operación
          </Button>
        </div>
      )}
    </Dialogo>
  )
}

function Acciones({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 pt-2">{children}</div>
}
