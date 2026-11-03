import { trazarSelectorCI } from '@/servicios/diagnostico-selector-ci'

test('el diagnóstico de selección solo emite marcadores fijos cuando está habilitado', () => {
  const salida = jest.spyOn(console, 'info').mockImplementation(() => {})
  try {
    trazarSelectorCI('inicio', false)
    expect(salida).not.toHaveBeenCalled()
    trazarSelectorCI('cancelado', true)
    trazarSelectorCI('aplicado', true)
    trazarSelectorCI('valor-no-permitido' as never, true)
    expect(salida.mock.calls).toEqual([
      ['EPT_CI_SELECTOR:cancelado'],
      ['EPT_CI_SELECTOR:aplicado'],
    ])
  } finally {
    salida.mockRestore()
  }
})

test('sin la variable de CI el diagnóstico permanece apagado', () => {
  const anterior = process.env.EXPO_PUBLIC_EPT_CI_SELECTOR_DIAGNOSTICO
  delete process.env.EXPO_PUBLIC_EPT_CI_SELECTOR_DIAGNOSTICO
  const salida = jest.spyOn(console, 'info').mockImplementation(() => {})
  try {
    trazarSelectorCI('inicio')
    expect(salida).not.toHaveBeenCalled()
  } finally {
    if (anterior === undefined) delete process.env.EXPO_PUBLIC_EPT_CI_SELECTOR_DIAGNOSTICO
    else process.env.EXPO_PUBLIC_EPT_CI_SELECTOR_DIAGNOSTICO = anterior
    salida.mockRestore()
  }
})
