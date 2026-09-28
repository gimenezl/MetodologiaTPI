'use client'

import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { AccionesInscripcionAdministrativa } from './AccionesInscripcionAdministrativa'
import { AvisoAdministracion } from './AvisoAdministracion'
import { DialogoCancelarInscripcion } from './DialogoCancelarInscripcion'
import { EstadoConfirmacion } from './EstadoConfirmacion'
import { fechaHora } from './formato'
import type { ColumnaDetalle, FilaInscripcion } from './tipos'
import { useAdministracionInscripciones, useDevolverFoco } from './useAdministracionInscripciones'

type FiltroEstado = 'ACTIVAS' | 'CANCELADAS' | 'TODAS'
type FiltroConfirmacion = 'TODAS' | 'CONFIRMADAS' | 'SIN_CONFIRMAR'

const OPCIONES_CONFIRMACION: { value: FiltroConfirmacion; label: string }[] = [
  { value: 'TODAS', label: 'Todas' },
  { value: 'CONFIRMADAS', label: 'Confirmadas' },
  { value: 'SIN_CONFIRMAR', label: 'Sin confirmar' },
]

const MOTIVO_CANCELADA = 'No se puede confirmar: la inscripción está cancelada.'

/**
 * Lista administrativa de inscripciones de Dirección (EPT-62), común a comedor,
 * transporte y deportes.
 *
 * Muestra, por cada inscripción, DOS estados distintos: el vigente (Activa o
 * Cancelada) y el de confirmación (Confirmada por quién y cuándo, o Sin
 * confirmar). Una inscripción activa sin confirmar sigue siendo válida:
 * confirmar es una acción administrativa posterior al alta.
 *
 * Escritorio (desde 1280 px): tabla con encabezados asociados. Debajo de ese
 * ancho: una tarjeta por inscripción con el mismo contenido y los mismos
 * controles, sin desplazamiento horizontal.
 *
 * Los cambios viajan por la API y, cuando terminan, la pantalla vuelve a leer el
 * estado del servidor: lo que se ve es lo que quedó persistido.
 */
export function ListaInscripcionesAdministrativas({
  dominio,
  filas,
  columnas,
  caption,
  filtroEstado: configuracionEstado,
  busqueda: configuracionBusqueda,
  resumen,
  etiquetaResumen,
  vacio,
}: {
  dominio: 'comedor' | 'transporte' | 'deportes'
  filas: FilaInscripcion[]
  columnas: ColumnaDetalle[]
  caption: string
  filtroEstado: {
    etiquetaGrupo: string
    etiquetas: Record<FiltroEstado, string>
  }
  busqueda: { etiqueta: string; placeholder: string }
  resumen: (cifras: { visibles: number; total: number; activas: number }) => string
  etiquetaResumen?: string
  vacio: { icono?: ReactNode; titulo: string; ayuda: string }
}) {
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('ACTIVAS')
  const [filtroConfirmacion, setFiltroConfirmacion] = useState<FiltroConfirmacion>('TODAS')
  const [busqueda, setBusqueda] = useState('')
  const [cancelandoId, setCancelandoId] = useState<string | null>(null)
  const idBusqueda = useId()
  const region = useRef<HTMLDivElement>(null)

  const {
    aviso,
    enCurso,
    ocupado,
    refrescando,
    foco,
    limpiarFoco,
    confirmar,
    cancelar,
  } = useAdministracionInscripciones(dominio)

  useDevolverFoco(region, { refrescando, foco, limpiarFoco })

  const visibles = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase('es-AR')
    return filas
      .filter((fila) =>
        filtroEstado === 'TODAS'
          ? true
          : filtroEstado === 'ACTIVAS'
            ? fila.estado === 'ACTIVA'
            : fila.estado === 'CANCELADA'
      )
      .filter((fila) =>
        filtroConfirmacion === 'TODAS'
          ? true
          : filtroConfirmacion === 'CONFIRMADAS'
            ? fila.confirmacion.confirmada
            : !fila.confirmacion.confirmada
      )
      .filter((fila) => (termino ? fila.busqueda.includes(termino) : true))
  }, [filas, filtroEstado, filtroConfirmacion, busqueda])

  const activas = filas.filter((fila) => fila.estado === 'ACTIVA').length
  const filaACancelar = filas.find((fila) => fila.id === cancelandoId) ?? null

  function pedirConfirmacion(fila: FilaInscripcion) {
    void confirmar({ id: fila.id, alumno: fila.alumno, descripcion: fila.descripcion })
  }

  return (
    <div
      ref={region}
      tabIndex={-1}
      aria-busy={refrescando}
      className="space-y-4 focus:outline-none"
    >
      <AvisoAdministracion aviso={aviso} />

      <div className="flex flex-col xl:flex-row xl:items-end gap-3">
        <div
          role="group"
          aria-label={configuracionEstado.etiquetaGrupo}
          className="flex flex-wrap gap-2"
        >
          {(['ACTIVAS', 'CANCELADAS', 'TODAS'] as const).map((valor) => (
            <button
              key={valor}
              type="button"
              onClick={() => setFiltroEstado(valor)}
              aria-pressed={filtroEstado === valor}
              className={cn(
                'min-h-11 px-4 py-2 rounded-full text-sm font-semibold border transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
                filtroEstado === valor
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-neutral-700 border-neutral-300 hover:border-brand-400'
              )}
            >
              {configuracionEstado.etiquetas[valor]}
            </button>
          ))}
        </div>

        <div className="xl:w-56">
          <Select
            id={`${dominio}-filtro-confirmacion`}
            label="Confirmación"
            options={OPCIONES_CONFIRMACION}
            value={filtroConfirmacion}
            onChange={(evento) => setFiltroConfirmacion(evento.target.value as FiltroConfirmacion)}
            className="min-h-11 w-full"
          />
        </div>

        <div className="xl:ml-auto xl:w-80">
          <Input
            id={idBusqueda}
            label={configuracionBusqueda.etiqueta}
            placeholder={configuracionBusqueda.placeholder}
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
          />
        </div>
      </div>

      <p
        role="status"
        aria-label={etiquetaResumen}
        className="text-sm text-neutral-600"
      >
        {resumen({ visibles: visibles.length, total: filas.length, activas })}
      </p>

      {visibles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 py-12 px-5 text-center">
          {vacio.icono}
          <p className="font-semibold text-neutral-700">{vacio.titulo}</p>
          <p className="text-neutral-600 text-sm mt-1">{vacio.ayuda}</p>
        </div>
      ) : (
        <>
          {/* Escritorio: tabla con encabezados asociados a cada celda. */}
          <div className="hidden xl:block bg-white rounded-2xl border border-neutral-200 overflow-hidden">
            <table className="w-full text-sm">
              <caption className="sr-only">{caption}</caption>
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th scope="col" className="text-left font-semibold px-4 py-3">
                    Alumno
                  </th>
                  <th scope="col" className="text-left font-semibold px-4 py-3">
                    Legajo
                  </th>
                  {columnas.map((columna) => (
                    <th key={columna.clave} scope="col" className="text-left font-semibold px-4 py-3">
                      {columna.titulo}
                    </th>
                  ))}
                  <th scope="col" className="text-left font-semibold px-4 py-3">
                    Estado
                  </th>
                  <th scope="col" className="text-left font-semibold px-4 py-3">
                    Confirmación
                  </th>
                  <th scope="col" className="text-left font-semibold px-4 py-3">
                    Fechas
                  </th>
                  <th scope="col" className="text-left font-semibold px-4 py-3">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {visibles.map((fila) => (
                  <tr key={fila.id} className="align-top">
                    <th
                      scope="row"
                      tabIndex={-1}
                      data-foco-inscripcion={fila.id}
                      className="text-left font-semibold text-neutral-900 px-4 py-3 break-words focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      {fila.alumno}
                    </th>
                    <td className="px-4 py-3 text-neutral-700 break-words">{fila.legajo ?? '—'}</td>
                    {columnas.map((columna) => {
                      const detalle = fila.detalles[columna.clave]
                      return (
                        <td key={columna.clave} className="px-4 py-3 text-neutral-700 break-words">
                          {detalle?.principal ?? '—'}
                          {detalle?.secundario && (
                            <span className="block text-xs text-neutral-600">{detalle.secundario}</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-4 py-3">
                      <EstadoVigente estado={fila.estado} />
                    </td>
                    <td className="px-4 py-3">
                      <EstadoConfirmacion
                        confirmacion={fila.confirmacion}
                        motivoNoConfirmable={
                          fila.estado === 'CANCELADA' && !fila.confirmacion.confirmada
                            ? MOTIVO_CANCELADA
                            : undefined
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      <Fechas fila={fila} />
                    </td>
                    <td className="px-4 py-3">
                      <AccionesInscripcionAdministrativa
                        fila={fila}
                        ocupado={ocupado}
                        enCurso={enCurso}
                        onConfirmar={pedirConfirmacion}
                        onCancelar={(objetivo) => setCancelandoId(objetivo.id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Debajo de 1280 px: una tarjeta por inscripción, con el mismo contenido. */}
          <ul className="xl:hidden space-y-3">
            {visibles.map((fila) => (
              <li
                key={fila.id}
                className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <p
                    tabIndex={-1}
                    data-foco-inscripcion={fila.id}
                    className="font-semibold text-neutral-900 min-w-0 break-words focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    {fila.alumno}
                  </p>
                  <EstadoVigente estado={fila.estado} />
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div className="col-span-2">
                    <dt className="text-neutral-600">Legajo</dt>
                    <dd className="text-neutral-900 font-medium break-words">{fila.legajo ?? '—'}</dd>
                  </div>
                  {columnas.map((columna) => {
                    const detalle = fila.detalles[columna.clave]
                    return (
                      <div key={columna.clave} className="col-span-2">
                        <dt className="text-neutral-600">{columna.titulo}</dt>
                        <dd className="text-neutral-900 break-words">
                          {detalle?.principal ?? '—'}
                          {detalle?.secundario && (
                            <span className="block text-xs text-neutral-600">{detalle.secundario}</span>
                          )}
                        </dd>
                      </div>
                    )
                  })}
                  <div>
                    <dt className="text-neutral-600">Inscripción</dt>
                    <dd className="text-neutral-900">{fechaHora(fila.fechaAlta)}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-600">Baja</dt>
                    <dd className="text-neutral-900">{fechaHora(fila.fechaBaja)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-neutral-600 mb-1">Confirmación</dt>
                    <dd>
                      <EstadoConfirmacion
                        confirmacion={fila.confirmacion}
                        motivoNoConfirmable={
                          fila.estado === 'CANCELADA' && !fila.confirmacion.confirmada
                            ? MOTIVO_CANCELADA
                            : undefined
                        }
                      />
                    </dd>
                  </div>
                </dl>
                <AccionesInscripcionAdministrativa
                  fila={fila}
                  ocupado={ocupado}
                  enCurso={enCurso}
                  onConfirmar={pedirConfirmacion}
                  onCancelar={(objetivo) => setCancelandoId(objetivo.id)}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {filaACancelar && (
        <DialogoCancelarInscripcion
          dominio={dominio}
          fila={filaACancelar}
          enviando={enCurso?.operacion === 'cancelar'}
          onCancelar={cancelar}
          onCerrar={() => setCancelandoId(null)}
        />
      )}
    </div>
  )
}

function EstadoVigente({ estado }: { estado: 'ACTIVA' | 'CANCELADA' }) {
  return estado === 'ACTIVA' ? (
    <Badge variant="success" dot>
      Activa
    </Badge>
  ) : (
    <Badge variant="default">Cancelada</Badge>
  )
}

function Fechas({ fila }: { fila: FilaInscripcion }) {
  return (
    <>
      <span className="block">Alta: {fechaHora(fila.fechaAlta)}</span>
      {fila.fechaBaja && <span className="block">Baja: {fechaHora(fila.fechaBaja)}</span>}
    </>
  )
}
