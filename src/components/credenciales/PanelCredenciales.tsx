'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { MagnifyingGlass, Student } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import type { FilaPanel } from '@/lib/credenciales-qr/tipos'
import { estilosDeBoton } from '@/components/ui/estilosDeBoton'

/**
 * Listado de Dirección con el estado de la credencial de cada alumno (EPT-64).
 * El filtro es de presentación; los datos ya llegaron restringidos por RLS.
 */

type FiltroEstado = 'TODOS' | FilaPanel['credencial']

const ETIQUETA: Record<FilaPanel['credencial'], { texto: string; variante: 'success' | 'default' | 'warning' }> = {
  VIGENTE: { texto: 'Vigente', variante: 'success' },
  REVOCADA: { texto: 'Revocada', variante: 'default' },
  SIN_CREDENCIAL: { texto: 'Sin credencial', variante: 'warning' },
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function PanelCredenciales({ filas }: { filas: readonly FilaPanel[] }) {
  const [busqueda, setBusqueda] = useState('')
  const [estado, setEstado] = useState<FiltroEstado>('TODOS')

  const visibles = useMemo(() => {
    const aguja = normalizar(busqueda.trim())
    return filas.filter((fila) => {
      if (estado !== 'TODOS' && fila.credencial !== estado) return false
      if (!aguja) return true
      return normalizar(`${fila.nombre} ${fila.apellido} ${fila.legajo_nro ?? ''}`).includes(aguja)
    })
  }, [filas, busqueda, estado])

  if (filas.length === 0) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white px-5 py-16 text-center">
        <Student size={40} className="mx-auto mb-3 text-neutral-400" aria-hidden="true" />
        <p className="font-semibold text-neutral-800">Todavía no hay alumnos registrados</p>
        <p className="mt-1 text-sm text-neutral-600">
          Cuando se den de alta alumnos, vas a poder emitir sus credenciales desde acá.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <label htmlFor="buscar-credenciales" className="sr-only">
            Buscar por nombre, apellido o legajo
          </label>
          <MagnifyingGlass
            size={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
            aria-hidden="true"
          />
          <input
            id="buscar-credenciales"
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, apellido o legajo"
            className="h-11 w-full rounded-lg border border-neutral-300 bg-white pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
        </div>
        <div className="sm:w-56">
          <label htmlFor="filtrar-estado-credencial" className="sr-only">
            Filtrar por estado de la credencial
          </label>
          <select
            id="filtrar-estado-credencial"
            value={estado}
            onChange={(e) => setEstado(e.target.value as FiltroEstado)}
            className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          >
            <option value="TODOS">Todos los estados</option>
            <option value="VIGENTE">Con credencial vigente</option>
            <option value="SIN_CREDENCIAL">Sin credencial</option>
            <option value="REVOCADA">Con credencial revocada</option>
          </select>
        </div>
      </div>

      <p role="status" className="text-sm text-neutral-600">
        {visibles.length === filas.length
          ? `${filas.length} ${filas.length === 1 ? 'alumno' : 'alumnos'}`
          : `${visibles.length} de ${filas.length} alumnos`}
      </p>

      {visibles.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white px-5 py-12 text-center">
          <p className="font-semibold text-neutral-800">No hay alumnos que coincidan</p>
          <p className="mt-1 text-sm text-neutral-600">Probá con otro nombre, legajo o estado.</p>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white" aria-label="Alumnos y estado de su credencial">
          {visibles.map((fila) => {
            const etiqueta = ETIQUETA[fila.credencial]
            return (
              <li key={fila.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-neutral-900 break-words">
                    {fila.apellido}, {fila.nombre}
                  </p>
                  <p className="text-sm text-neutral-600">
                    Legajo: {fila.legajo_nro ?? 'sin legajo'}
                    {fila.curso ? ` · ${fila.curso}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant={etiqueta.variante} dot>
                      {etiqueta.texto}
                    </Badge>
                    {fila.estado === 'INACTIVO' && <Badge variant="outline">Alumno inactivo</Badge>}
                  </div>
                </div>
                <Link
                  href={`/dashboard/credenciales/${fila.id}`}
                  className={estilosDeBoton({ variante: 'outline', className: 'min-h-11 justify-center self-start sm:self-center' })}
                  aria-label={`Ver la credencial de ${fila.nombre} ${fila.apellido}`}
                >
                  Ver credencial
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
