'use client'

import type { EntradaDeHistorial } from '@/services/usuarios-admin.client'
import { formatearFechaHora } from '../../_components/etiquetas'

const TIPOS: Record<EntradaDeHistorial['tipo'], string> = {
  ROL: 'Rol',
  ACCESO: 'Acceso',
  VINCULO: 'Cuenta',
}

const VALORES: Record<string, string> = {
  HABILITADO: 'Habilitado',
  BLOQUEADO: 'Bloqueado',
  SIN_CUENTA: 'Sin cuenta',
  CUENTA_VINCULADA: 'Cuenta vinculada',
}

function valor(texto: string | null) {
  if (texto === null || texto === '') return 'Sin valor'
  return VALORES[texto] ?? texto
}

function actor(entrada: EntradaDeHistorial) {
  return `${entrada.actor_nombre} ${entrada.actor_apellido}`.trim() || '—'
}

/**
 * Historial de rol, acceso y vínculo de cuenta (EPT-59), del más reciente al
 * más antiguo. Es de solo agregado en la base: acá solo se lee.
 */
export function HistorialUsuario({ entradas }: { entradas: EntradaDeHistorial[] }) {
  if (entradas.length === 0) {
    return <p className="text-sm text-neutral-600">Todavía no hay cambios de rol, acceso o cuenta registrados.</p>
  }

  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm" aria-label="Historial de cambios">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-100">
              {['Fecha', 'Tipo', 'Cambio', 'Motivo', 'Realizado por'].map((columna) => (
                <th
                  key={columna}
                  scope="col"
                  className="text-left px-3 py-2.5 text-xs font-semibold text-neutral-600 uppercase tracking-wider"
                >
                  {columna}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {entradas.map((entrada) => (
              <tr key={entrada.id}>
                <td className="px-3 py-2.5 whitespace-nowrap text-neutral-700">{formatearFechaHora(entrada.fecha)}</td>
                <td className="px-3 py-2.5 text-neutral-800">{TIPOS[entrada.tipo] ?? entrada.tipo}</td>
                <td className="px-3 py-2.5 text-neutral-800">
                  {valor(entrada.valor_anterior)} <span aria-hidden="true">→</span>
                  <span className="sr-only"> a </span> {valor(entrada.valor_nuevo)}
                </td>
                <td className="px-3 py-2.5 text-neutral-700 break-words max-w-xs">{entrada.motivo}</td>
                <td className="px-3 py-2.5 text-neutral-700">{actor(entrada)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden space-y-3" aria-label="Historial de cambios">
        {entradas.map((entrada) => (
          <li key={entrada.id} className="rounded-xl border border-neutral-200 p-3 text-sm space-y-1 min-w-0">
            <p className="font-semibold text-neutral-900">
              {TIPOS[entrada.tipo] ?? entrada.tipo}: {valor(entrada.valor_anterior)}{' '}
              <span aria-hidden="true">→</span>
              <span className="sr-only"> a </span> {valor(entrada.valor_nuevo)}
            </p>
            <p className="text-neutral-700 break-words">{entrada.motivo}</p>
            <p className="text-xs text-neutral-600">
              {formatearFechaHora(entrada.fecha)} · {actor(entrada)}
            </p>
          </li>
        ))}
      </ul>
    </>
  )
}
