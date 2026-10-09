import { spawnSync } from 'node:child_process'

export function runBounded(command, args, milliseconds, options = {}, programs = { timeout: 'timeout', shell: 'bash' }) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw new Error('Presupuesto de proceso inválido')
  // Sin --foreground: TERM afecta al grupo. El trap retiene al supervisor hasta
  // KILL aunque el wrapper termine antes; ningún cleanup de DB empieza durante la gracia.
  const argsTimeout = ['--signal=TERM', '--kill-after=5s',
    `${milliseconds / 1000}s`, programs.shell, '-c', 'trap "sleep 5; exit 124" TERM; "$@"',
    'ci-bounded', command, ...args]
  const result = spawnSync(programs.timeout, argsTimeout, { ...options, timeout: milliseconds + 7_000 })
  return { ...result, timedOut: [124, 137].includes(result.status)
    || result.signal === 'SIGKILL' || result.error?.code === 'ETIMEDOUT' }
}
