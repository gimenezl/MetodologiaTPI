import type { ExpoConfig } from 'expo/config'

// Solo configuración pública. Las variables EXPO_PUBLIC_* se incrustan en el bundle:
// nunca deben contener claves privadas (lo verifica `npm run verificar:importaciones`).
const config: ExpoConfig = {
  name: 'Educar para Transformar',
  slug: 'educar-para-transformar',
  scheme: 'educarparatransformar',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'org.educarparatransformar.app',
    supportsTablet: false,
  },
  android: {
    package: 'org.educarparatransformar.app',
    allowBackup: false,
  },
  plugins: [
    'expo-router',
    ['expo-secure-store', { configureAndroidBackup: true }],
    'expo-font',
    './plugins/with-auth-integration-network-security',
  ],
  experiments: { typedRoutes: false },
  extra: {
    // Flag booleana no secreta. Sin esta opción explícita, HTTP local se rechaza en runtime.
    eptAuthIntegration: process.env.EPT_MOBILE_AUTH_INTEGRATION === '1',
  },
}

export default config
