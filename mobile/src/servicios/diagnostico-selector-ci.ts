// Fixed, non-sensitive markers for an explicitly enabled disposable CI build.
// No account, file, URL, token or provider payload is accepted here.
type EventoSelector =
  | 'montado' | 'desmontado' | 'inicio' | 'descartado-contexto' | 'aplicado'
  | 'elegido' | 'cancelado' | 'permiso_denegado' | 'sin_camara' | 'invalido' | 'error'

const EVENTOS: ReadonlySet<string> = new Set([
  'montado', 'desmontado', 'inicio', 'descartado-contexto', 'aplicado',
  'elegido', 'cancelado', 'permiso_denegado', 'sin_camara', 'invalido', 'error',
])

export function trazarSelectorCI(evento: EventoSelector, habilitado = process.env.EXPO_PUBLIC_EPT_CI_SELECTOR_DIAGNOSTICO === '1'): void {
  if (habilitado && EVENTOS.has(evento)) console.info(`EPT_CI_SELECTOR:${evento}`)
}
