import * as fs from 'fs'
import * as path from 'path'
import { act, renderHook } from '@testing-library/react-native'

const fichero = path.join(__dirname, '../src/contenedores/comprobantes/diagnostico-selector.ts')

describe('diagnóstico del selector', () => {
  test('solo admite eventos fijos y exige activación explícita', () => {
    const fuente = fs.readFileSync(fichero, 'utf8')
    expect(fuente).toContain("process.env.EXPO_PUBLIC_DIAGNOSTICO_SELECTOR === '1'")
    expect(fuente).toContain('!eventos.includes(evento)')
    expect(fuente).toContain('slice(-12)')
  })

  test('notifica únicamente eventos permitidos, sin guardar valores arbitrarios', async () => {
    process.env.EXPO_PUBLIC_DIAGNOSTICO_SELECTOR = '1'
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registrarSelector, useDiagnosticoSelector } = require('@/contenedores/comprobantes/diagnostico-selector')
    const { result, unmount } = await renderHook(() => useDiagnosticoSelector())
    await act(() => { registrarSelector('montado'); registrarSelector('inicio'); registrarSelector('valor-prohibido'); registrarSelector('cancelado') })
    expect(result.current).toBe('sin_eventos,montado,inicio,cancelado')
    unmount()
    delete process.env.EXPO_PUBLIC_DIAGNOSTICO_SELECTOR
  })
})
