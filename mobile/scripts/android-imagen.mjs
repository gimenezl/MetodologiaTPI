// Adquiere solo paquetes SDK autorizados en una raíz privada y publica cada paquete completo.
import { spawnSync } from 'node:child_process'
import { accessSync, constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PAQUETE = 'system-images;android-34;google_apis;x86_64'
export const PAQUETE_NDK = 'ndk;27.1.12297006'
const paquetesPermitidos = new Map([[PAQUETE, 'sdk-imagen'], [PAQUETE_NDK, 'sdk-ndk']])
function carpetaEvidencia(paquete) {
  const carpeta = paquetesPermitidos.get(paquete)
  if (!carpeta) throw new Error('Paquete SDK no autorizado')
  return carpeta
}
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
export function validarPaquete(raiz, paquete = PAQUETE) {
  carpetaEvidencia(paquete)
  const dir = join(raiz, ...paquete.split(';'))
  const xml = readFileSync(join(dir, 'package.xml'), 'utf8')
  const properties = readFileSync(join(dir, 'source.properties'), 'utf8')
  if (!xml.includes(`path="${paquete}"`)) throw new Error('Metadata de paquete incompleta o ajena')
  if (paquete === PAQUETE_NDK) {
    if (!/^Pkg.Revision\s*=\s*27\.1\.12297006\s*$/mu.test(properties)) throw new Error('Revisión NDK distinta de la autorizada')
    for (const file of ['ndk-build', 'build/cmake/android.toolchain.cmake', 'meta/platforms.json', 'toolchains/llvm/prebuilt/linux-x86_64/bin/clang']) {
      const path = join(dir, file), actual = realpathSync(path)
      if (relative(realpathSync(dir), actual).startsWith('..') || !statSync(actual).isFile() || statSync(actual).size < 1) throw new Error('NDK parcial o ajeno, no se publica')
      if (file === 'ndk-build' || file.endsWith('/clang')) accessSync(actual, constants.X_OK)
    }
    return dir
  }
  if (!/^AndroidVersion.ApiLevel\s*=\s*34\s*$/mu.test(properties) ||
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
export function prepararPaquete({ sdk, temp, paquete = PAQUETE, ejecutar = spawnSync, ahora = () => performance.now(), presupuestoMs = 210000 }) {
  const carpeta = carpetaEvidencia(paquete), partes = paquete.split(';')
  const root = realpathSync(sdk), own = mkdtempSync(join(temp, 'ept113-sdk-'))
  const evidencia = join(temp, 'evidencia-movil-android', carpeta); mkdirSync(evidencia, { recursive: true })
  const metadata = { paquete, inicio: new Date().toISOString(), intentos: [], publicada: false }
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
    if (r.error || r.status !== 0 || !r.stdout?.includes(paquete)) throw new Error('SDK no reconoce el paquete instalado completo')
  }
  try {
    manager = localizarSdkmanager(root)
    metadata.sdkmanager = relative(root, manager)
    const source = join(dirname(dirname(manager)), 'source.properties')
    metadata.versionHerramienta = existsSync(source) ? readFileSync(source, 'utf8').match(/^Pkg.Revision\s*=\s*(.+)$/mu)?.[1]?.trim() ?? 'no-disponible' : 'no-disponible'
    const help = run(['--help'], process.env)
    const textoAyuda = `${help.stdout ?? ''}\n${help.stderr ?? ''}`
    metadata.ayuda = { exit: help.status, error: help.error?.code ?? null }
    writeFileSync(join(evidencia, 'sdkmanager-help.log'), `${JSON.stringify(metadata.ayuda)}\n${textoAyuda}`, { mode: 0o600 })
    // SDK12 imprime Usage y sale1 ante --help (ShowUsageException), no ante una instalación.
    if (help.error || ![0, 1].includes(help.status) || !/^\s*Usage:/mu.test(textoAyuda) ||
      /\b(?:Fatal\b|Error:|Exception\b|Could not|Failed to|UnsupportedClassVersionError|NoClassDefFoundError)/iu.test(textoAyuda) ||
      !['--sdk_root', '--list_installed', '--verbose'].every(flag => textoAyuda.includes(flag))) throw new Error('Ayuda de sdkmanager no confirma el contrato requerido')
    const version = run(['--version'], process.env)
    metadata.versionEjecutable = version.stdout?.trim()
    metadata.consultaVersion = { exit: version.status, error: version.error?.code ?? null }
    writeFileSync(join(evidencia, 'sdkmanager-version.log'), `${JSON.stringify(metadata.consultaVersion)}\n${version.stdout ?? ''}\n${version.stderr ?? ''}`.slice(0, 65536), { mode: 0o600 })
    if (version.error || version.status !== 0 || !/^\d+(?:\.\d+){1,3}$/u.test(metadata.versionEjecutable ?? '')) throw new Error('Versión ejecutable de sdkmanager no verificable')
    guardar()
    const target = join(root, ...partes)
    if (existsSync(target)) {
      validarPaquete(root, paquete); lista(root, process.env)
      metadata.reutilizada = true; return
    }
    let privado
    for (let intento = 1; intento <= 2; intento++) {
      privado = join(own, `intento-${intento}`); mkdirSync(privado)
      const user = join(own, `usuario-${intento}`); mkdirSync(user)
      if (existsSync(join(root, 'licenses'))) cpSync(join(root, 'licenses'), join(privado, 'licenses'), { recursive: true })
      const env = { ...process.env, ANDROID_USER_HOME: user, JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS ?? ''} -Duser.home=${user}` }
      const r = run([`--sdk_root=${privado}`, '--verbose', '--install', paquete], env, 'y\n'.repeat(30))
      writeFileSync(join(evidencia, `instalacion-${intento}.log`), `${r.stdout ?? ''}\n${r.stderr ?? ''}`, { mode: 0o600 })
      metadata.intentos.push({ intento, exit: r.status, error: r.error?.code ?? null, zip: errorZip(r) }); guardar()
      if (!r.error && r.status === 0) { validarPaquete(privado, paquete); lista(privado, env); break }
      // Nunca repetir Auth, builds o flujos. Solo repetir esta descarga si hay evidencia ZIP.
      if (intento === 2 || r.error || !errorZip(r)) throw new Error('Instalación de paquete SDK rechazada, consultar evidencia saneada')
      privado = null
    }
    if (!privado) throw new Error('Paquete SDK no disponible')
    const origen = validarPaquete(privado, paquete)
    mkdirSync(dirname(target), { recursive: true })
    const parent = realpathSync(dirname(target))
    if (relative(root, parent).startsWith('..')) throw new Error('Destino SDK fuera de raíz autorizada')
    const stage = mkdtempSync(join(parent, '.ept113-imagen-'))
    cpSync(origen, join(stage, 'paquete'), { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
    // Rename no reemplaza un paquete existente no vacío; no se borra SDK ni caché global.
    renameSync(join(stage, 'paquete'), target)
    validarPaquete(root, paquete); lista(root, process.env)
    metadata.publicada = true
  } catch (error) { metadata.error = error.message; throw error }
  finally { metadata.fin = new Date().toISOString(); guardar() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.env.RUNNER_TEMP) throw new Error('Temporal del runner requerido')
  const modo = process.argv[2] ?? 'imagen'
  if (process.argv.length > 3 || !['imagen', 'ndk'].includes(modo)) throw new Error('Modo SDK no autorizado')
  if (modo === 'ndk') {
    const gradle = readFileSync(new URL('../node_modules/react-native/gradle/libs.versions.toml', import.meta.url), 'utf8')
    if (!/^ndkVersion\s*=\s*"27\.1\.12297006"\s*$/mu.test(gradle)) throw new Error('El NDK declarado por React Native no coincide con el paquete autorizado')
  }
  prepararPaquete({ sdk: resolverSdk({ home: process.env.ANDROID_HOME, sdkRoot: process.env.ANDROID_SDK_ROOT }), temp: process.env.RUNNER_TEMP, paquete: modo === 'ndk' ? PAQUETE_NDK : PAQUETE })
}
