import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import networkSecurityPlugin from '../plugins/with-auth-integration-network-security'

type NetworkSecurityPlugin = ((config: unknown) => unknown) & {
  habilitarHttpAndroidIntegracion(config: { extra?: { eptAuthIntegration?: boolean } }, env: Record<string, string>): boolean
  configurarManifestAndroid(manifest: { manifest: { application: { $?: Record<string, string> }[] } }, integracion: boolean): unknown
  networkSecurityXml(integracion: boolean): string
  escribirConfigRedAndroid(raizNativa: string, integracion: boolean): Promise<void>
}
const { habilitarHttpAndroidIntegracion, configurarManifestAndroid, networkSecurityXml, escribirConfigRedAndroid } = networkSecurityPlugin as NetworkSecurityPlugin

const envLocal = {
  EPT_MOBILE_AUTH_INTEGRATION: '1',
  EXPO_PUBLIC_SUPABASE_URL: 'http://10.0.2.2:54321',
}

describe('plugin de Network Security para integración Android', () => {
  it('exporta una función de plugin callable para Expo', () => {
    expect(typeof networkSecurityPlugin).toBe('function')
  })

  it('solo habilita HTTP para el modo explícito y el host local exacto', () => {
    expect(habilitarHttpAndroidIntegracion({ extra: { eptAuthIntegration: true } }, envLocal)).toBe(true)
    expect(habilitarHttpAndroidIntegracion({ extra: { eptAuthIntegration: false } }, envLocal)).toBe(false)
    expect(habilitarHttpAndroidIntegracion({ extra: { eptAuthIntegration: true } }, {
      ...envLocal, EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    })).toBe(false)
    expect(() => habilitarHttpAndroidIntegracion({ extra: { eptAuthIntegration: true } }, {
      ...envLocal, EXPO_PUBLIC_SUPABASE_URL: 'http://example.invalid:54321',
    })).toThrow('endpoint local exacto')
  })

  it('genera el manifiesto y XML prebuild con denegación base y una sola excepción /32', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'ept105-network-security-'))
    try {
      const manifest = { manifest: { application: [{ $: {} }] } }
      configurarManifestAndroid(manifest, true)
      expect(manifest.manifest.application[0].$).toEqual({
        'android:usesCleartextTraffic': 'false',
        'android:networkSecurityConfig': '@xml/ept_mobile_auth_integration_network_security',
      })

      await escribirConfigRedAndroid(raiz, true)
      const xml = readFileSync(join(raiz, 'app/src/main/res/xml/ept_mobile_auth_integration_network_security.xml'), 'utf8')
      expect(xml).toBe(networkSecurityXml(true))
      expect(xml).toContain('<base-config cleartextTrafficPermitted="false" />')
      expect(xml).toContain('<domain includeSubdomains="false">10.0.2.2</domain>')
      expect(xml.match(/cleartextTrafficPermitted="true"/gu)).toHaveLength(1)
      expect(xml).not.toContain('127.0.0.1')
      expect(xml).not.toContain('includeSubdomains="true"')
    } finally {
      rmSync(raiz, { recursive: true, force: true })
    }
  })

  it('no integración conserva tráfico claro denegado y elimina una excepción anterior', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'ept105-network-security-'))
    const archivo = join(raiz, 'app/src/main/res/xml/ept_mobile_auth_integration_network_security.xml')
    try {
      const manifest = { manifest: { application: [{ $: { 'android:networkSecurityConfig': '@xml/ept_mobile_auth_integration_network_security' } }] } }
      configurarManifestAndroid(manifest, false)
      expect(manifest.manifest.application[0].$).toEqual({ 'android:usesCleartextTraffic': 'false' })
      await escribirConfigRedAndroid(raiz, true)
      await escribirConfigRedAndroid(raiz, false)
      expect(existsSync(archivo)).toBe(false)
      expect(networkSecurityXml(false)).toContain('<base-config cleartextTrafficPermitted="false" />')
      expect(networkSecurityXml(false)).not.toContain('cleartextTrafficPermitted="true"')
    } finally {
      rmSync(raiz, { recursive: true, force: true })
    }
  })
})
