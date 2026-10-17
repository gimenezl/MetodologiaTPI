import { olvidarEnlaceEntrante, useEnlaceEntrante } from '@/servicios/enlace-entrante'

const mockUsar = jest.fn()
const mockLimpiar = jest.fn()

jest.mock('expo-linking', () => ({ useLinkingURL: () => mockUsar(), clearInitialURL: () => mockLimpiar() }))

describe('enlace entrante', () => {
  it('entrega el último enlace profundo que conserva el sistema', () => {
    mockUsar.mockReturnValueOnce('educarparatransformar://restablecer?code=abc')
    expect(useEnlaceEntrante()).toBe('educarparatransformar://restablecer?code=abc')
    mockUsar.mockReturnValueOnce(null)
    expect(useEnlaceEntrante()).toBeNull()
  })

  it('olvidar el enlace limpia el que el sistema conserva', () => {
    olvidarEnlaceEntrante()
    expect(mockLimpiar).toHaveBeenCalledTimes(1)
  })
})
