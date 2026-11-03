import { useSyncExternalStore } from 'react'

const eventos = ['montado', 'desmontado', 'inicio', 'cancelado', 'elegido', 'aplicado', 'descartado', 'otro'] as const
type Evento = (typeof eventos)[number]
const activo = process.env.EXPO_PUBLIC_DIAGNOSTICO_SELECTOR === '1'
let historial = 'sin_eventos'
const oyentes = new Set<() => void>()

export function registrarSelector(evento: Evento): void {
  if (!activo || !eventos.includes(evento)) return
  historial = `${historial},${evento}`.split(',').slice(-12).join(',')
  oyentes.forEach(oyente => oyente())
}

export function useDiagnosticoSelector(): string | null {
  return useSyncExternalStore(
    oyente => { oyentes.add(oyente); return () => { oyentes.delete(oyente) } },
    () => activo ? historial : null,
    () => null,
  )
}
