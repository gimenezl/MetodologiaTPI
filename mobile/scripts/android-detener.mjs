import { spawnSync } from 'node:child_process'
import { setTimeout as pausa } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const APP = 'org.educarparatransformar.app'

/** No relanza: espera la desaparición observada de proceso y actividad antes de pm clear. */
export async function detenerAppAndroid({ ejecutar = (args) => spawnSync('adb', args, { encoding: 'utf8', timeout: 4000 }), ahora = () => performance.now(), esperar = () => pausa(100), limiteMs = 15000 } = {}) {
  const exigir = (args, permitidos = [0]) => {
    const resultado = ejecutar(args)
    if (resultado.error || !permitidos.includes(resultado.status)) throw new Error('No se pudo observar la detención Android')
    return resultado
  }
  exigir(['shell', 'am', 'force-stop', APP])
  const limite = ahora() + limiteMs
  do {
    const proceso = exigir(['shell', 'pidof', APP], [0, 1])
    const actividad = exigir(['shell', 'dumpsys', 'activity', 'activities']).stdout ?? ''
    if (!actividad.includes('ACTIVITY MANAGER ACTIVITIES')) throw new Error('Diagnóstico de actividades Android no disponible')
    const activa = actividad.split(/\r?\n/u).some((linea) => linea.includes('ActivityRecord{') && linea.includes(APP))
    if (proceso.status === 1 && !proceso.stdout?.trim() && !activa) return
    await esperar()
  } while (ahora() < limite)
  throw new Error('La actividad o el proceso Android siguen presentes; no se inicia otro flujo')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await detenerAppAndroid()
  console.log('Android detenido: sin proceso ni ActivityRecord de la aplicación')
}
