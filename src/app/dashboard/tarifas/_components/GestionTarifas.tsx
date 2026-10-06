'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, PencilSimple } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  estadoDeVersion,
  ETIQUETA_REFERENCIA,
  formatearImporteArs,
  textoVigencia,
  type ConceptoTarifa,
  type GrupoTarifas,
  type ReferenciaConTarifas,
  type VersionTarifa,
} from '@/lib/tarifas'
import { DialogoTarifa, type ModoTarifa } from './DialogoTarifa'

const AYUDA_CONCEPTO: Record<ConceptoTarifa, string> = {
  CUOTA: 'Una cuota mensual por cada nivel educativo.',
  DEPORTE: 'Un importe mensual por cada deporte del catálogo.',
  TRANSPORTE: 'Un importe mensual por cada uno de los cuatro recorridos.',
  COMEDOR: 'El importe mensual del servicio de comedor.',
}

type DialogoAbierto = {
  modo: ModoTarifa
  concepto: ConceptoTarifa
  referencia: ReferenciaConTarifas
  version?: VersionTarifa
}

/**
 * Administración de tarifas mensuales (EPT-103).
 *
 * Muestra, por concepto y referencia, la tarifa vigente hoy y el historial
 * completo de versiones, sin borrar nada. Cada guardado pasa por una RPC que
 * valida el importe antes del cast, mantiene la vigencia cerrada
 * `[desde, hasta]` y se rechaza si se superpone con otra versión. Tras guardar,
 * la pantalla vuelve a leer los datos: lo que se ve es lo que quedó en la base.
 */
export function GestionTarifas({ grupos, hoy }: { grupos: GrupoTarifas[]; hoy: string }) {
  const router = useRouter()
  const [refrescando, iniciarRefresco] = useTransition()
  const [dialogo, setDialogo] = useState<DialogoAbierto | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const franjaAviso = useRef<HTMLDivElement>(null)

  // El aviso queda arriba de la página: si se guardó al pie, se lo trae a la vista.
  useEffect(() => {
    if (aviso) franjaAviso.current?.scrollIntoView({ block: 'nearest' })
  }, [aviso])

  function abrir(abierto: DialogoAbierto) {
    setAviso(null)
    setDialogo(abierto)
  }

  function alGuardar(mensaje: string) {
    setDialogo(null)
    setAviso(mensaje)
    iniciarRefresco(() => router.refresh())
  }

  function alRecargar() {
    setDialogo(null)
    setAviso('Volvimos a leer las tarifas. Revisá los valores actuales antes de editar de nuevo.')
    iniciarRefresco(() => router.refresh())
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
          Facturación
        </p>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Tarifas</h1>
        <p className="text-neutral-500 text-sm mt-1 max-w-[70ch]">
          Definí el importe mensual en pesos argentinos de la cuota, los deportes, el transporte
          y el comedor. Cada tarifa tiene una vigencia: las fechas incluyen el primer y el último
          día, y al cambiar el precio el día D la anterior termina el día D−1. La factura de cada
          mes usa la tarifa vigente el primer día del período; las facturas ya emitidas no se
          modifican.
        </p>
      </header>

      <div
        ref={franjaAviso}
        role="status"
        aria-live="polite"
        className={
          aviso
            ? 'bg-green-50 border border-green-200 rounded-2xl p-4 flex gap-3 items-start'
            : 'sr-only'
        }
      >
        {aviso && (
          <>
            <CheckCircle
              size={20}
              weight="fill"
              className="text-green-600 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-sm text-green-800">{aviso}</p>
          </>
        )}
      </div>

      {grupos.map((grupo) => (
        <section
          key={grupo.concepto}
          aria-labelledby={`tarifas-${grupo.concepto}`}
          aria-busy={refrescando}
          className="space-y-3"
        >
          <div>
            <h2 id={`tarifas-${grupo.concepto}`} className="text-lg font-bold text-neutral-900">
              {grupo.titulo}
            </h2>
            <p className="text-sm text-neutral-500">{AYUDA_CONCEPTO[grupo.concepto]}</p>
          </div>

          {grupo.referencias.length === 0 ? (
            <p className="text-sm text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-2xl p-4">
              No hay elementos en el catálogo para este concepto.
            </p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {grupo.referencias.map((referencia) => (
                <TarjetaReferencia
                  key={referencia.referencia_id}
                  concepto={grupo.concepto}
                  referencia={referencia}
                  hoy={hoy}
                  alAbrir={abrir}
                />
              ))}
            </ul>
          )}
        </section>
      ))}

      {dialogo && (
        <DialogoTarifa
          modo={dialogo.modo}
          concepto={dialogo.concepto}
          referencia={dialogo.referencia}
          version={dialogo.version}
          onCerrar={() => setDialogo(null)}
          onGuardado={alGuardar}
          onRecargar={alRecargar}
        />
      )}
    </div>
  )
}

function TarjetaReferencia({
  concepto,
  referencia,
  hoy,
  alAbrir,
}: {
  concepto: ConceptoTarifa
  referencia: ReferenciaConTarifas
  hoy: string
  alAbrir: (abierto: DialogoAbierto) => void
}) {
  const { versiones } = referencia
  const vigente = versiones.find((v) => estadoDeVersion(v, hoy) === 'VIGENTE')
  const proxima = versiones.filter((v) => estadoDeVersion(v, hoy) === 'FUTURA').at(-1)
  const tituloId = `ref-${concepto}-${referencia.referencia_id}`

  return (
    <li
      aria-labelledby={tituloId}
      className="bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={tituloId} className="font-bold text-neutral-900 break-words">
            {referencia.nombre}
          </h3>
          <p className="text-xs text-neutral-500">
            {ETIQUETA_REFERENCIA[concepto]}
            {referencia.detalle ? ` · ${referencia.detalle}` : ''}
          </p>
        </div>
        {!referencia.activa && <Badge variant="default">Inactivo</Badge>}
      </div>

      {vigente ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Vigente hoy
          </p>
          <p className="text-2xl font-extrabold text-neutral-900 tabular-nums">
            {formatearImporteArs(vigente.importe)}
          </p>
          <p className="text-sm text-neutral-600">{textoVigencia(vigente.desde, vigente.hasta)}</p>
        </div>
      ) : (
        <div className="space-y-1">
          <Badge variant="warning" dot>
            Sin tarifa vigente hoy
          </Badge>
          <p className="text-sm text-neutral-600">
            {proxima
              ? `Próxima: ${formatearImporteArs(proxima.importe)}. ${textoVigencia(proxima.desde, proxima.hasta)}.`
              : versiones.length > 0
                ? 'Todas las versiones cargadas ya terminaron.'
                : 'Todavía no se cargó ninguna tarifa.'}
          </p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        {versiones.length > 0 && (
          <Button
            variant="primary"
            className="min-h-11 sm:min-h-0"
            aria-label={`Cambiar precio de ${referencia.nombre}`}
            onClick={() => alAbrir({ modo: 'cambiar', concepto, referencia })}
          >
            Cambiar precio
          </Button>
        )}
        <Button
          variant="outline"
          className="min-h-11 sm:min-h-0"
          aria-label={`Nueva tarifa de ${referencia.nombre}`}
          onClick={() => alAbrir({ modo: 'crear', concepto, referencia })}
        >
          Nueva tarifa
        </Button>
      </div>

      {versiones.length > 0 && (
        <details className="border-t border-neutral-100 pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-700 min-h-11 sm:min-h-0 flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
            Historial ({versiones.length} {versiones.length === 1 ? 'versión' : 'versiones'})
          </summary>
          <ul className="mt-2 divide-y divide-neutral-100">
            {versiones.map((version) => {
              const estado = estadoDeVersion(version, hoy)
              return (
                <li key={version.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-neutral-900 tabular-nums">
                    {formatearImporteArs(version.importe)}
                  </span>
                  <span className="text-sm text-neutral-600 flex-1 min-w-[12rem]">
                    {textoVigencia(version.desde, version.hasta)}
                  </span>
                  <Badge
                    variant={estado === 'VIGENTE' ? 'success' : estado === 'FUTURA' ? 'info' : 'default'}
                  >
                    {estado === 'VIGENTE' ? 'Vigente' : estado === 'FUTURA' ? 'Futura' : 'Finalizada'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 sm:min-h-0"
                    aria-label={`Editar la tarifa de ${referencia.nombre}: ${textoVigencia(version.desde, version.hasta)}`}
                    onClick={() => alAbrir({ modo: 'editar', concepto, referencia, version })}
                  >
                    <PencilSimple size={16} weight="bold" aria-hidden="true" />
                    Editar
                  </Button>
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </li>
  )
}
