const fs = require('node:fs/promises')
const path = require('node:path')
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins')

const URL_LOCAL_ANDROID = 'http://10.0.2.2:54321'
const URL_LOCAL_IOS = 'http://127.0.0.1:54321'
const RECURSO_XML = 'ept_mobile_auth_integration_network_security'

function habilitarHttpAndroidIntegracion(config, env = process.env) {
  if (config.extra?.eptAuthIntegration !== true) return false
  if (env.EPT_MOBILE_AUTH_INTEGRATION !== '1') {
    throw new Error('La excepción HTTP Android requiere el modo explícito de integración.')
  }
  if (env.EXPO_PUBLIC_SUPABASE_URL === URL_LOCAL_ANDROID) return true
  // El plugin también se carga durante prebuild iOS: loopback iOS no debe activar ninguna
  // excepción Android (y la configuración ATS de iOS es independiente).
  if (env.EXPO_PUBLIC_SUPABASE_URL === URL_LOCAL_IOS) return false
  throw new Error('La excepción HTTP Android requiere el endpoint local exacto de Android o iOS.')
}

function configurarManifestAndroid(manifest, integracion) {
  const aplicacion = manifest.manifest.application?.[0]
  if (!aplicacion) throw new Error('No se encontró el elemento application del AndroidManifest.')
  aplicacion.$ ??= {}
  // Mantener el permiso global denegado; Network Security Config permite la única excepción local.
  aplicacion.$['android:usesCleartextTraffic'] = 'false'
  if (integracion) aplicacion.$['android:networkSecurityConfig'] = `@xml/${RECURSO_XML}`
  else delete aplicacion.$['android:networkSecurityConfig']
  return manifest
}

function networkSecurityXml(integracion) {
  const excepcion = integracion
    ? `\n    <domain-config cleartextTrafficPermitted="true">\n        <domain includeSubdomains="false">10.0.2.2</domain>\n    </domain-config>`
    : ''
  return `<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n    <base-config cleartextTrafficPermitted="false" />${excepcion}\n</network-security-config>\n`
}

async function escribirConfigRedAndroid(raizNativa, integracion) {
  const carpetaXml = path.join(raizNativa, 'app', 'src', 'main', 'res', 'xml')
  const destino = path.join(carpetaXml, `${RECURSO_XML}.xml`)
  if (integracion) {
    await fs.mkdir(carpetaXml, { recursive: true })
    await fs.writeFile(destino, networkSecurityXml(true), 'utf8')
  } else {
    await fs.rm(destino, { force: true })
  }
}

function withAuthIntegrationNetworkSecurity(config) {
  const integracion = habilitarHttpAndroidIntegracion(config)
  config = withAndroidManifest(config, modConfig => {
    modConfig.modResults = configurarManifestAndroid(modConfig.modResults, integracion)
    return modConfig
  })
  return withDangerousMod(config, ['android', async modConfig => {
    await escribirConfigRedAndroid(modConfig.modRequest.platformProjectRoot, integracion)
    return modConfig
  }])
}

module.exports = withAuthIntegrationNetworkSecurity
module.exports.habilitarHttpAndroidIntegracion = habilitarHttpAndroidIntegracion
module.exports.configurarManifestAndroid = configurarManifestAndroid
module.exports.networkSecurityXml = networkSecurityXml
module.exports.escribirConfigRedAndroid = escribirConfigRedAndroid
