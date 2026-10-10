/* eslint-disable @typescript-eslint/no-require-imports */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

const mockMemoria = new Map<string, string>()

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockMemoria.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (new TextEncoder().encode(v).length > 2048) throw new Error('demasiado grande')
    mockMemoria.set(k, v)
  }),
  deleteItemAsync: jest.fn(async (k: string) => void mockMemoria.delete(k)),
}))

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native')
  return { SafeAreaView: View, SafeAreaProvider: View }
})

describe('contenedor de verificación (React Hook Form + Zod)', () => {
  beforeEach(() => {
    mockMemoria.clear()
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://proyecto.supabase.co'
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_abcdefghij'
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://app.educarparatransformar.example'
  })

  async function montar() {
    const { VerificacionContenedor } = require('@/contenedores/verificacion/VerificacionContenedor') as typeof import('@/contenedores/verificacion/VerificacionContenedor')
    await render(<VerificacionContenedor />)
  }

  it('guarda, lee y borra una carga de varios KB y lo informa', async () => {
    await montar()
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar y leer' }))
    await waitFor(() => expect(screen.getByText('Almacenamiento seguro: correcto')).toBeTruthy())
    expect(mockMemoria.size).toBe(0)
  })

  it('valida con Zod y no ejecuta con un tamaño fuera de rango', async () => {
    await montar()
    await fireEvent.changeText(screen.getByTestId('campo-tamano'), '0')
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar y leer' }))
    await waitFor(() => expect(screen.getByText('Ingresá un tamaño entre 1 y 32 KB.')).toBeTruthy())
    expect(screen.getByText('Revisá los datos marcados para continuar.')).toBeTruthy()
    expect(screen.queryByText('Almacenamiento seguro: correcto')).toBeNull()
  })

  it('rechaza texto no numérico', async () => {
    await montar()
    await fireEvent.changeText(screen.getByTestId('campo-tamano'), 'abc')
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar y leer' }))
    await waitFor(() => expect(screen.getByText('Ingresá un tamaño entre 1 y 32 KB.')).toBeTruthy())
  })

  it('con configuración inválida muestra el aviso y no crea cliente', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = ''
    await montar()
    expect(screen.getByText('Configuración pública incompleta')).toBeTruthy()
    expect(screen.getByText('Sin configurar')).toBeTruthy()
  })
})
