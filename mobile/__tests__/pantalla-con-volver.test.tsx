import { Text } from 'react-native'
import { fireEvent, render, screen } from '@testing-library/react-native'

import { PantallaConVolver } from '@/catalogo'

const toque = (x: number, y: number) => ({ nativeEvent: { pageX: x, pageY: y } })

async function montar(opciones: { deshabilitado?: boolean; activo?: boolean } = {}) {
  const onVolver = jest.fn()
  await render(
    <PantallaConVolver onVolver={onVolver} deshabilitado={opciones.deshabilitado} activo={opciones.activo}>
      <Text>Contenido</Text>
    </PantallaConVolver>,
  )
  const marco = screen.getByTestId('pantalla-con-volver')
  /** Un arrastre completo: toque inicial, captura al moverse y soltar. Devuelve si el marco lo capturó. */
  const arrastrar = (desde: [number, number], hasta: [number, number]) => {
    marco.props.onTouchStart(toque(desde[0], desde[1]))
    const capturado = marco.props.onMoveShouldSetResponderCapture(toque(hasta[0], hasta[1])) as boolean
    if (capturado) marco.props.onResponderRelease(toque(hasta[0], hasta[1]))
    return capturado
  }
  return { onVolver, arrastrar }
}

describe('PantallaConVolver', () => {
  it('muestra el contenido y una flecha accesible llamada «Volver»', async () => {
    await montar()
    expect(screen.getByText('Contenido')).toBeTruthy()
    expect(screen.getByLabelText('Volver')).toBeTruthy()
  })

  it('tocar la flecha vuelve una vez', async () => {
    const { onVolver } = await montar()
    await fireEvent.press(screen.getByTestId('volver-flecha'))
    expect(onVolver).toHaveBeenCalledTimes(1)
  })

  it('deslizar hacia la derecha desde el borde izquierdo vuelve', async () => {
    const { onVolver, arrastrar } = await montar()
    expect(arrastrar([10, 300], [120, 310])).toBe(true)
    expect(onVolver).toHaveBeenCalledTimes(1)
  })

  it('no vuelve si el gesto no nace en el borde, es corto o es vertical', async () => {
    const { onVolver, arrastrar } = await montar()
    expect(arrastrar([200, 300], [320, 305])).toBe(false) // empezó en el medio de la pantalla
    expect(arrastrar([10, 300], [40, 300])).toBe(true) // se captura, pero es demasiado corto
    expect(arrastrar([10, 300], [30, 500])).toBe(false) // arrastre vertical
    expect(onVolver).not.toHaveBeenCalled()
  })

  it('con una operación en curso, ni la flecha ni el gesto hacen nada', async () => {
    const { onVolver, arrastrar } = await montar({ deshabilitado: true })
    await fireEvent.press(screen.getByTestId('volver-flecha'))
    expect(arrastrar([10, 300], [160, 300])).toBe(false)
    expect(onVolver).not.toHaveBeenCalled()
    expect(screen.getByTestId('volver-flecha').props.accessibilityState).toMatchObject({ disabled: true })
  })

  it('inactivo: no muestra flecha ni captura el gesto, pero el contenido sigue ahí', async () => {
    const { onVolver, arrastrar } = await montar({ activo: false })
    expect(screen.getByText('Contenido')).toBeTruthy()
    expect(screen.queryByTestId('volver-flecha')).toBeNull()
    expect(arrastrar([10, 300], [160, 300])).toBe(false)
    expect(onVolver).not.toHaveBeenCalled()
  })
})
