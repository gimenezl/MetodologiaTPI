'use client'

import { useId, useMemo, useState } from 'react'
import { ForkKnife } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import type {
  InscripcionServicio,
  ServicioEscolar,
} from '@/services/comedor.service'

interface InscriptosComedorProps {
  servicio: ServicioEscolar | null
  inscripciones: InscripcionServicio[]
}

type Filtro = 'ACTIVAS' | 'CANCELADAS' | 'TODAS'

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'ACTIVAS', etiqueta: 'Inscriptos' },
  { valor: 'CANCELADAS', etiqueta: 'Bajas' },
  { valor: 'TODAS', etiqueta: 'Todas' },
]

/**
 * Formato de fecha estable entre el servidor y el navegador.
 *
 * `timeZone` explícito: sin él, el servidor formatea en la zona del proceso y
 * el navegador en la de la persona, así que una misma inscripción se vería con
 * dos horas distintas según el dispositivo y React descartaría el árbol
 * hidratado. El centro educativo está en Argentina, que es la referencia
 * correcta para todas las fechas del servicio.
 *
 * `hour12: false`: en formato de 12 horas, Node y los navegadores separan el
 * «a. m.» con caracteres de espacio distintos (uno usa el espacio estrecho sin
 * separación U+202F). La diferencia es invisible en pantalla, pero React la ve
 * y vuelve a generar el árbol. El horario de 24 horas evita el problema de
 * raíz y además es el uso corriente en el país.
 */
const FORMATO_FECHA = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Argentina/Buenos_Aires',
})

function fecha(valor: string | null) {
  if (!valor) return '—'
  const momento = new Date(valor)
  return Number.isNaN(momento.getTime()) ? '—' : FORMATO_FECHA.format(momento)
}

function nombreCompleto(inscripcion: InscripcionServicio) {
  return `${inscripcion.alumno_apellido}, ${inscripcion.alumno_nombre}`
}

/**
 * Consulta administrativa de inscriptos al comedor (EPT-28).
 *
 * Es de solo lectura por decisión explícita: ni Jira ni el plan le atribuyen al
 * DIRECTOR la facultad de inscribir o cancelar en nombre del alumno, así que
 * esta pantalla no inventa controles de escritura. Las filas que se ven son
 * exactamente las que RLS devuelve; no hay ningún filtro de autorización acá.
 */
export function InscriptosComedor({
  servicio,
  inscripciones,
}: InscriptosComedorProps) {
  const [filtro, setFiltro] = useState<Filtro>('ACTIVAS')
  const [busqueda, setBusqueda] = useState('')
  const idBusqueda = useId()

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
        const legajo = (inscripcion.legajo_nro ?? '').toLocaleLowerCase('es-AR')
        return (
          nombreCompleto(inscripcion).toLocaleLowerCase('es-AR').includes(termino) ||
          legajo.includes(termino)
        )
      })
  }, [inscripciones, filtro, busqueda])

  const activas = inscripciones.filter((i) => i.estado === 'ACTIVA').length

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
          Servicios escolares
        </p>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
          Comedor
        </h1>
        <p className="text-neutral-500 text-sm mt-1 max-w-[72ch]">
          Alumnos inscriptos a {servicio?.nombre ?? 'el comedor escolar'}, con su legajo
          y el estado de cada inscripción. Esta consulta es de solo lectura: la
          inscripción y la baja las realiza el propio alumno.
        </p>
      </div>

      <p
        aria-live="polite"
        aria-label="Resumen de inscripciones al comedor"
        className="text-sm text-neutral-600"
      >
        {activas === 1
          ? '1 alumno con inscripción activa.'
          : `${activas} alumnos con inscripción activa.`}{' '}
        Se muestran {visibles.length} de {inscripciones.length} registros.
      </p>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div
          role="group"
          aria-label="Filtrar inscripciones por estado"
          className="flex gap-2 flex-wrap"
        >
          {FILTROS.map((opcion) => (
            <button
              key={opcion.valor}
              type="button"
              onClick={() => setFiltro(opcion.valor)}
              aria-pressed={filtro === opcion.valor}
              className={cn(
                'px-3 py-1.5 rounded-xl text-sm font-semibold transition-colors',
                filtro === opcion.valor
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-50'
              )}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </div>

        <div className="sm:ml-auto sm:w-72">
          <Input
            id={idBusqueda}
            label="Buscar por apellido o legajo"
            placeholder="Apellido o número de legajo"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
          />
        </div>
      </div>

      {visibles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 py-16 px-5 text-center">
          <ForkKnife size={40} className="text-neutral-300 mx-auto mb-3" />
          <p className="font-semibold text-neutral-700">
            No hay inscripciones que coincidan
          </p>
          <p className="text-neutral-400 text-sm mt-1">
            Probá con otro estado o con otro término de búsqueda.
          </p>
        </div>
      ) : (
        <>
          {/* Escritorio: tabla con encabezados asociados a cada celda. */}
          <div className="hidden md:block bg-white rounded-2xl border border-neutral-200 overflow-hidden">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Alumnos inscriptos al comedor con legajo, estado y fechas
              </caption>
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th scope="col" className="text-left font-semibold px-4 py-3">
                    Alumno
                  </th>
                  <th scope="col" className="text-left font-semibold px-4 py-3">
                    Legajo
                  </th>
                  <th scope="col" className="text-left font-semibold px-4 py-3">
                    Estado
                  </th>
                  <th scope="col" className="text-left font-semibold px-4 py-3">
                    Inscripción
                  </th>
                  <th scope="col" className="text-left font-semibold px-4 py-3">
                    Baja
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {visibles.map((inscripcion) => (
                  <tr key={inscripcion.id}>
                    <th
                      scope="row"
                      className="text-left font-semibold text-neutral-900 px-4 py-3"
                    >
                      {nombreCompleto(inscripcion)}
                    </th>
                    <td className="px-4 py-3 text-neutral-700">
                      {inscripcion.legajo_nro ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <EstadoInscripcion estado={inscripcion.estado} />
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {fecha(inscripcion.fecha_inscripcion)}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {fecha(inscripcion.fecha_cancelacion)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Móvil: una tarjeta por inscripción, con el mismo contenido. */}
          <ul className="md:hidden space-y-3">
            {visibles.map((inscripcion) => (
              <li
                key={inscripcion.id}
                className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-neutral-900 min-w-0 break-words">
                    {nombreCompleto(inscripcion)}
                  </p>
                  <EstadoInscripcion estado={inscripcion.estado} />
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div className="col-span-2">
                    <dt className="text-neutral-500">Legajo</dt>
                    <dd className="text-neutral-900 font-medium break-words">
                      {inscripcion.legajo_nro ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Inscripción</dt>
                    <dd className="text-neutral-900">
                      {fecha(inscripcion.fecha_inscripcion)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Baja</dt>
                    <dd className="text-neutral-900">
                      {fecha(inscripcion.fecha_cancelacion)}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function EstadoInscripcion({ estado }: { estado: 'ACTIVA' | 'CANCELADA' }) {
  return estado === 'ACTIVA' ? (
    <Badge variant="success" dot>
      Activa
    </Badge>
  ) : (
    <Badge variant="default">Cancelada</Badge>
  )
}
