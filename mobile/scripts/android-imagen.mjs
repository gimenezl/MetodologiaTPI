// Instala una sola imagen en un SDK privado y publica únicamente un paquete completo.
import { spawnSync } from 'node:child_process'
import { accessSync, constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PAQUETE = 'system-images;android-34;google_apis;x86_64'
const partes = PAQUETE.split(';')
export function resolverSdk({ home, sdkRoot }) {
  const roots = [home, sdkRoot].filter(Boolean).map(p => realpathSync(p))
  if (!roots.length || new Set(roots).size !== 1) throw new Error('Raíz SDK ausente o ambigua')
  return roots[0]
}
export function localizarSdkmanager(root) {
  for (const parts of [['cmdline-tools', 'latest', 'bin', 'sdkmanager'], ['tools', 'bin', 'sdkmanager']]) {
    const candidate = join(root, ...parts)
    if (!existsSync(candidate)) continue
    const actual = realpathSync(candidate)
    if (relative(root, actual).startsWith('..') || !statSync(actual).isFile()) throw new Error('sdkmanager fuera de la raíz SDK autorizada')
    accessSync(actual, constants.X_OK)
    return actual
  }
  throw new Error('SDK sin sdkmanager existente, no se instala otra versión implícitamente')
}
export function validarImagen(raiz) {
  const dir = join(raiz, ...partes)
  const xml = readFileSync(join(dir, 'package.xml'), 'utf8')
  const properties = readFileSync(join(dir, 'source.properties'), 'utf8')
  if (!xml.includes(`path="${PAQUETE}"`) || !/^AndroidVersion.ApiLevel\s*=\s*34\s*$/mu.test(properties) ||
    !/^SystemImage.Abi\s*=\s*x86_64\s*$/mu.test(properties) || !/^SystemImage.TagId\s*=\s*google_apis\s*$/mu.test(properties)) throw new Error('Metadata de imagen incompleta o ajena')
  for (const file of ['system.img', 'userdata.img', 'kernel-ranchu', 'ramdisk.img']) {
    const path = join(dir, file)
    if (!statSync(path).isFile() || statSync(path).size < (file === 'system.img' ? 1048576 : 1)) throw new Error('Imagen parcial, no se publica')
  }
  return dir
}
export function errorZip(r) {
  return /(?:Error on ZipFile|invalid (?:zip|archive)|zip END header|zip file is empty|not a ZIP archive)/iu.test(`${r.stdout ?? ''}\n${r.stderr ?? ''}`)
}
export function prepararImagen({ sdk, temp, ejecutar = spawnSync, ahora = () => performance.now(), presupuestoMs = 210000 }) {
  const root = realpathSync(sdk), own = mkdtempSync(join(temp, 'ept113-sdk-'))
  const evidencia = join(temp, 'evidencia-movil-android', 'sdk-imagen'); mkdirSync(evidencia, { recursive: true })
  const metadata = { paquete: PAQUETE, inicio: new Date().toISOString(), intentos: [], publicada: false }
  const guardar = () => writeFileSync(join(evidencia, 'resultado.json'), JSON.stringify(metadata), { mode: 0o600 })
  const limite = ahora() + presupuestoMs
  let manager
  const run = (args, env, input) => {
    const restante = Math.floor(limite - ahora())
    if (restante <= 0) throw new Error('Presupuesto SDK agotado')
    return ejecutar(manager, args, { encoding: 'utf8', timeout: restante, maxBuffer: 4194304, input, env })
  }
  const lista = (root, env) => {
    const r = run([`--sdk_root=${root}`, '--list_installed'], env)
    if (r.error || r.status !== 0 || !r.stdout?.includes(PAQUETE)) throw new Error('SDK no reconoce el paquete instalado completo')
  }
  try {
    manager = localizarSdkmanager(root)
    metadata.sdkmanager = relative(root, manager)
    const source = join(dirname(dirname(manager)), 'source.properties')
    metadata.versionHerramienta = existsSync(source) ? readFileSync(source, 'utf8').match(/^Pkg.Revision\s*=\s*(.+)$/mu)?.[1]?.trim() ?? 'no-disponible' : 'no-disponible'
    const help = run(['--help'], process.env)
    writeFileSync(join(evidencia, 'sdkmanager-help.log'), `${help.stdout ?? ''}\n${help.stderr ?? ''}`, { mode: 0o600 })
    if (help.error || help.status !== 0 || !['--sdk_root', '--list_installed', '--verbose'].every(flag => `${help.stdout ?? ''}${help.stderr ?? ''}`.includes(flag))) throw new Error('Ayuda de sdkmanager no confirma el contrato requerido')
    guardar()
    const target = join(root, ...partes)
    if (existsSync(target)) {
      validarImagen(root); lista(root, process.env)
      metadata.reutilizada = true; return
    }
    let privado
    for (let intento = 1; intento <= 2; intento++) {
      privado = join(own, `intento-${intento}`); mkdirSync(privado)
      const user = join(own, `usuario-${intento}`); mkdirSync(user)
      if (existsSync(join(root, 'licenses'))) cpSync(join(root, 'licenses'), join(privado, 'licenses'), { recursive: true })
      const env = { ...process.env, ANDROID_USER_HOME: user, JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS ?? ''} -Duser.home=${user}` }
      const r = run([`--sdk_root=${privado}`, '--verbose', '--install', PAQUETE], env, 'y\n'.repeat(30))
      writeFileSync(join(evidencia, `instalacion-${intento}.log`), `${r.stdout ?? ''}\n${r.stderr ?? ''}`, { mode: 0o600 })
      metadata.intentos.push({ intento, exit: r.status, error: r.error?.code ?? null, zip: errorZip(r) }); guardar()
      if (!r.error && r.status === 0) { validarImagen(privado); lista(privado, env); break }
      // Nunca repetir Auth, builds o flujos. Solo repetir esta descarga si hay evidencia ZIP.
      if (intento === 2 || r.error || !errorZip(r)) throw new Error('Instalación de imagen rechazada, consultar evidencia saneada')
      privado = null
    }
    if (!privado) throw new Error('Imagen no disponible')
    const origen = validarImagen(privado)
    mkdirSync(dirname(target), { recursive: true })
    const parent = realpathSync(dirname(target))
    if (relative(root, parent).startsWith('..')) throw new Error('Destino SDK fuera de raíz autorizada')
    const stage = mkdtempSync(join(parent, '.ept113-imagen-'))
    cpSync(origen, join(stage, 'paquete'), { recursive: true, errorOnExist: true, force: false })
    // Rename no reemplaza un paquete existente no vacío; no se borra SDK ni caché global.
    renameSync(join(stage, 'paquete'), target)
    validarImagen(root); lista(root, process.env)
    metadata.publicada = true
  } catch (error) { metadata.error = error.message; throw error }
  finally { metadata.fin = new Date().toISOString(); guardar() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.env.RUNNER_TEMP) throw new Error('Temporal del runner requerido')
  prepararImagen({ sdk: resolverSdk({ home: process.env.ANDROID_HOME, sdkRoot: process.env.ANDROID_SDK_ROOT }), temp: process.env.RUNNER_TEMP })
}
