import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, type ReactElement } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { nombresDeFuente } from '@/tokens'

void SplashScreen.preventAutoHideAsync()

export default function RaizLayout(): ReactElement | null {
  const [cargadas, errorDeFuentes] = useFonts({
    [nombresDeFuente['texto-400']]: require('../assets/fonts/Outfit_400Regular.ttf'),
    [nombresDeFuente['texto-500']]: require('../assets/fonts/Outfit_500Medium.ttf'),
    [nombresDeFuente['texto-600']]: require('../assets/fonts/Outfit_600SemiBold.ttf'),
    [nombresDeFuente['texto-700']]: require('../assets/fonts/Outfit_700Bold.ttf'),
    [nombresDeFuente['mono-500']]: require('../assets/fonts/GeistMono_500Medium.ttf'),
    [nombresDeFuente['mono-600']]: require('../assets/fonts/GeistMono_600SemiBold.ttf'),
  })

  useEffect(() => {
    // Si una fuente falla, la app sigue con la fuente del sistema en lugar de quedar en el splash.
    if (cargadas || errorDeFuentes) void SplashScreen.hideAsync()
  }, [cargadas, errorDeFuentes])

  if (!cargadas && !errorDeFuentes) return null

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  )
}
