'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { Input } from '@/components/ui/Input'
import {
  diaAnterior,
  esFechaIsoReal,
  ETIQUETA_REFERENCIA,
  formatearFecha,
  formatearImporteArs,
  importeParaCampo,
  normalizarImporte,
  textoVigencia,
  TITULO_CONCEPTO,
  type ConceptoTarifa,
  type ReferenciaConTarifas,
  type VersionTarifa,
} from '@/lib/tarifas'
import {
  actualizarTarifaRemota,
  cambiarTarifaRemota,
  crearTarifaRemota,
  ErrorTarifas,
} from '@/services/tarifas.client'

export type ModoTarifa = 'crear' | 'cambiar' | 'editar'

type CampoFormulario = 'importe' | 'desde' | 'hasta'
type Errores = Partial<Record<CampoFormulario, string>>

const TITULOS: Record<ModoTarifa, string> = {
  crear: 'Nueva tarifa',
  cambiar: 'Cambiar precio',
  editar: 'Editar tarifa',
}

const DESCRIPCIONES: Record<ModoTarifa, string> = {
  crear:
    'Cargá una versión de la tarifa con su vigencia. Las fechas incluyen el primer y el último día y no pueden superponerse con otra versión.',
  cambiar:
    'El nuevo importe rige desde la fecha que elijas. La versión vigente el día anterior termina un día antes, en la misma operación.',
  editar:
    'Corregí el importe o la vigencia de esta versión. El concepto y la referencia no se pueden cambiar.',
}

/**
 * Formulario de alta, cambio de precio y edición de una versión de tarifa, con un
 * paso de revisión antes de guardar (EPT-103).
 *
 * La validación de este componente solo adelanta los mensajes: el servidor y
 * PostgreSQL vuelven a validar todo y son la autoridad. El importe nunca pasa
 * por `Number` ni por `parseFloat`: se normaliza como texto exacto y se envía
 * como texto. Un guardado exitoso solo se anuncia con lo que devolvió el
 * servidor; un conflicto o un corte de red nunca se presentan como éxito.
 */
export function DialogoTarifa({
  modo,
  concepto,
  referencia,
  version,
  onCerrar,
  onGuardado,
  onRecargar,
}: {
  modo: ModoTarifa
  concepto: ConceptoTarifa
  referencia: ReferenciaConTarifas
  /** Versión que se edita (solo en modo `editar`). */
  version?: VersionTarifa
  onCerrar: () => void
  onGuardado: (mensaje: string) => void
  /** Cierra el diálogo y vuelve a leer los datos (tras un conflicto de edición). */
  onRecargar: () => void
}) {
  const [importe, setImporte] = useState(version ? importeParaCampo(version.importe) : '')
  const [desde, setDesde] = useState(version?.desde ?? '')
  const [hasta, setHasta] = useState(version?.hasta ?? '')
  const [paso, setPaso] = useState<'formulario' | 'revision'>('formulario')
  const [errores, setErrores] = useState<Errores>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [reintento, setReintento] = useState(false)
  /** Id del elemento que debe recibir el foco cuando termine de renderizarse el cambio de estado. */
  const focoPendiente = useRef<string | null>(null)
  const enviando = useRef(false)

  // Lleva el foco al elemento que corresponde tras un cambio de paso o un error, ya renderizado:
  // sin esto el foco cae en <body> y un lector de pantalla no anuncia el cambio.
  useEffect(() => {
    if (focoPendiente.current) {
      const elemento = document.getElementById(focoPendiente.current)
      if (elemento) {
        elemento.focus()
        focoPendiente.current = null
      }
    }
  }, [errores, paso, errorGeneral, conflicto, guardando])

  const titulo = `${TITULOS[modo]} · ${referencia.nombre}`

  /** Valida lo escrito. Devuelve los valores normalizados o los errores por campo. */
  function validar():
    | { ok: true; importe: string; desde: string; hasta: string }
    | { ok: false; errores: Errores } {
    const nuevos: Errores = {}

    const resultado = normalizarImporte(importe)
    if (!resultado.ok) nuevos.importe = resultado.mensaje

    if (desde.trim() === '') nuevos.desde = 'Ingresá la fecha de inicio.'
    else if (!esFechaIsoReal(desde)) nuevos.desde = 'Ingresá una fecha de inicio válida.'

    if (hasta.trim() !== '' && !esFechaIsoReal(hasta)) {
      nuevos.hasta = 'Ingresá una fecha de fin válida o dejala vacía.'
    } else if (!nuevos.desde && hasta !== '' && hasta < desde) {
      nuevos.hasta = 'La fecha de fin no puede ser anterior a la de inicio.'
    }

    if (Object.keys(nuevos).length > 0 || !resultado.ok) return { ok: false, errores: nuevos }
    return { ok: true, importe: resultado.valor, desde, hasta }
  }

  function revisar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const validacion = validar()
    if (!validacion.ok) {
      setErrores(validacion.errores)
      setErrorGeneral(null)
      focoPendiente.current = validacion.errores.importe
        ? 'tarifa-importe'
        : validacion.errores.desde
          ? 'tarifa-desde'
          : 'tarifa-hasta'
      return
    }
    setImporte(importeParaCampo(validacion.importe))
    setErrores({})
    setErrorGeneral(null)
    setReintento(false)
    focoPendiente.current = 'tarifa-revision-titulo'
    setPaso('revision')
  }

  async function guardar() {
    if (enviando.current) return
    const validacion = validar()
    if (!validacion.ok) {
      setErrores(validacion.errores)
      setPaso('formulario')
      return
    }

    enviando.current = true
    setGuardando(true)
    setErrorGeneral(null)
    try {
      const vigencia = {
        importe: validacion.importe,
        desde: validacion.desde,
        hasta: validacion.hasta,
      }
      let mensaje: string
      if (modo === 'crear') {
        const respuesta = await crearTarifaRemota({
          concepto,
          referencia_id: referencia.referencia_id,
          ...vigencia,
        })
        mensaje = `Guardaste la tarifa de ${referencia.nombre}: ${formatearImporteArs(respuesta.tarifa.importe)}. ${textoVigencia(respuesta.tarifa.desde, respuesta.tarifa.hasta)}.`
      } else if (modo === 'cambiar') {
        const respuesta = await cambiarTarifaRemota({
          concepto,
          referencia_id: referencia.referencia_id,
          ...vigencia,
        })
        const cierre = respuesta.anterior?.hasta
          ? ` La tarifa anterior quedó vigente hasta el ${formatearFecha(respuesta.anterior.hasta)}.`
          : ''
        mensaje = `Registraste el nuevo precio de ${referencia.nombre}: ${formatearImporteArs(respuesta.nueva.importe)} ${textoVigencia(respuesta.nueva.desde, respuesta.nueva.hasta).toLowerCase()}.${cierre}`
      } else if (version) {
        const respuesta = await actualizarTarifaRemota(version.id, {
          ...vigencia,
          previo: { importe: version.importe, desde: version.desde, hasta: version.hasta },
        })
        mensaje = `Actualizaste la tarifa de ${referencia.nombre}: ${formatearImporteArs(respuesta.tarifa.importe)}. ${textoVigencia(respuesta.tarifa.desde, respuesta.tarifa.hasta)}.`
      } else {
        throw new ErrorTarifas('No pudimos identificar la tarifa que querías editar.', 400)
      }
      onGuardado(mensaje)
    } catch (problema) {
      if (!(problema instanceof ErrorTarifas)) {
        setErrorGeneral('No pudimos guardar los cambios. Volvé a intentarlo.')
        setReintento(true)
        focoPendiente.current = 'tarifa-confirmar'
      } else if (problema.codigo === 'CONFLICTO_EDICION' || problema.codigo === 'TARIFA_INEXISTENTE') {
        setConflicto(true)
        setErrorGeneral(problema.message)
        focoPendiente.current = 'tarifa-recargar'
      } else if (problema.codigo === 'SUPERPOSICION' && !problema.campo) {
        // En un cambio o una edición la causa puede ser el inicio o el fin: reintentar lo mismo
        // no sirve, hay que volver a editar las fechas.
        setErrorGeneral(problema.message)
        focoPendiente.current = 'tarifa-volver'
      } else if (
        problema.campo === 'importe' ||
        problema.campo === 'desde' ||
        problema.campo === 'hasta'
      ) {
        setErrores({ [problema.campo]: problema.message })
        setPaso('formulario')
        focoPendiente.current = `tarifa-${problema.campo}`
      } else {
        setErrorGeneral(problema.message)
        setReintento(true)
        focoPendiente.current = 'tarifa-confirmar'
      }
    } finally {
      enviando.current = false
      setGuardando(false)
    }
  }

  const versionAnterior =
    modo === 'cambiar' && esFechaIsoReal(desde)
      ? referencia.versiones.find(
          (v) => v.desde < desde && (v.hasta === null || v.hasta >= diaAnterior(desde))
        )
      : undefined

  return (
    <Dialogo
      tituloId="tarifa-dialogo-titulo"
      titulo={titulo}
      descripcion={DESCRIPCIONES[modo]}
      selectorFocoInicial="#tarifa-importe"
      onCerrar={() => {
        if (!enviando.current) onCerrar()
      }}
    >
      {errorGeneral && (
        <div
          role="alert"
          className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2 items-start text-sm text-red-800"
        >
          <WarningCircle
            size={18}
            weight="fill"
            className="text-red-500 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p>{errorGeneral}</p>
        </div>
      )}

      {paso === 'formulario' && (
        <form onSubmit={revisar} noValidate className="space-y-4">
          <p className="text-sm text-neutral-600">
            <span className="font-semibold">{ETIQUETA_REFERENCIA[concepto]}:</span>{' '}
            {referencia.nombre}
            {referencia.detalle ? ` (${referencia.detalle})` : ''} ·{' '}
            <span className="text-neutral-500">{TITULO_CONCEPTO[concepto]}</span>
          </p>
          <Input
            id="tarifa-importe"
            label={modo === 'cambiar' ? 'Nuevo importe (ARS)' : 'Importe (ARS)'}
            value={importe}
            inputMode="decimal"
            autoComplete="off"
            required
            error={errores.importe}
            helperText="Usá coma o punto para los decimales, por ejemplo 1234,50. Se admite cero."
            onChange={(evento) => setImporte(evento.target.value)}
          />
          <Input
            id="tarifa-desde"
            type="date"
            label={modo === 'cambiar' ? 'Rige desde' : 'Vigente desde'}
            value={desde}
            required
            error={errores.desde}
            helperText="Primer día en que rige, incluido."
            onChange={(evento) => setDesde(evento.target.value)}
          />
          <Input
            id="tarifa-hasta"
            type="date"
            label="Vigente hasta (opcional)"
            value={hasta}
            error={errores.hasta}
            helperText="Último día en que rige, incluido. Dejalo vacío si no tiene fecha de fin."
            onChange={(evento) => setHasta(evento.target.value)}
          />
          {modo === 'editar' && (
            <p className="text-sm text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-xl p-3">
              Las facturas ya emitidas conservan el importe con el que se emitieron: este cambio
              no las modifica.
            </p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button type="submit" className="min-h-11 sm:min-h-0">
              Revisar
            </Button>
          </div>
        </form>
      )}

      {paso === 'revision' && (
        <div className="space-y-4">
          <p
            id="tarifa-revision-titulo"
            tabIndex={-1}
            className="text-sm font-semibold text-neutral-800 focus:outline-none"
          >
            Revisá los datos antes de guardar:
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-neutral-500">{ETIQUETA_REFERENCIA[concepto]}</dt>
            <dd className="font-medium text-neutral-900">{referencia.nombre}</dd>
            <dt className="text-neutral-500">Importe</dt>
            <dd className="font-medium text-neutral-900">
              {formatearImporteArs(normalizadoOVacio(importe))}
            </dd>
            <dt className="text-neutral-500">Vigencia</dt>
            <dd className="font-medium text-neutral-900">
              {textoVigencia(desde, hasta === '' ? null : hasta)}
            </dd>
          </dl>
          {modo === 'cambiar' && (
            <p className="text-sm text-neutral-700 bg-brand-50 border border-brand-200 rounded-xl p-3">
              {versionAnterior
                ? `La tarifa de ${formatearImporteArs(versionAnterior.importe)} (${textoVigencia(versionAnterior.desde, versionAnterior.hasta).toLowerCase()}) pasará a terminar el ${formatearFecha(diaAnterior(desde))}.`
                : 'No hay una versión vigente el día anterior: se agrega la nueva sin modificar las existentes.'}
            </p>
          )}
          {modo === 'editar' && version && (
            <p className="text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-xl p-3">
              Antes: {formatearImporteArs(version.importe)} · {textoVigencia(version.desde, version.hasta)}.
              Las facturas ya emitidas conservan su importe.
            </p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            {conflicto ? (
              <Button id="tarifa-recargar" type="button" className="min-h-11 sm:min-h-0" onClick={onRecargar}>
                Recargar datos
              </Button>
            ) : (
              <>
                <Button
                  id="tarifa-volver"
                  type="button"
                  variant="outline"
                  className="min-h-11 sm:min-h-0"
                  disabled={guardando}
                  onClick={() => {
                    focoPendiente.current = 'tarifa-importe'
                    setPaso('formulario')
                    setErrorGeneral(null)
                    setReintento(false)
                  }}
                >
                  Volver a editar
                </Button>
                <Button
                  id="tarifa-confirmar"
                  type="button"
                  className="min-h-11 sm:min-h-0"
                  disabled={guardando}
                  aria-busy={guardando}
                  onClick={guardar}
                >
                  {guardando ? 'Guardando…' : reintento ? 'Reintentar guardado' : 'Confirmar y guardar'}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Dialogo>
  )
}

/** Texto canónico del importe escrito, o vacío si todavía no es válido (la revisión solo ocurre con uno válido). */
function normalizadoOVacio(importe: string): string {
  const resultado = normalizarImporte(importe)
  return resultado.ok ? resultado.valor : ''
}
