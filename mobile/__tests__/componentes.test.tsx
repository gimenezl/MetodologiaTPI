/* eslint-disable @typescript-eslint/no-require-imports */
import { fireEvent, render, screen } from '@testing-library/react-native'

import { Aviso, Boton, CampoTexto, EstadoPantalla, Importe, InsigniaEstado, formatearImporte } from '@/catalogo'

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native')
  return { SafeAreaView: View, SafeAreaProvider: View }
})

describe('formatearImporte', () => {
  it.each([
    [0, 'ARS 0,00'],
    [5, 'ARS 0,05'],
    [100, 'ARS 1,00'],
    [6360665, 'ARS 63.606,65'],
    [123456789012, 'ARS 1.234.567.890,12'],
    [-2550, '-ARS 25,50'],
  ])('%i → %s', (centavos, esperado) => {
    expect(formatearImporte(centavos)).toBe(esperado)
  })

  it('rechaza valores no enteros', () => {
    expect(() => formatearImporte(10.5)).toThrow(RangeError)
    expect(() => formatearImporte(Number.NaN)).toThrow(RangeError)
  })
})

describe('Boton', () => {
  it('dispara onPress una vez por toque', async () => {
    const onPress = jest.fn()
    await render(<Boton etiqueta="Ingresar" onPress={onPress} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Ingresar' }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('no dispara onPress cuando está deshabilitado y lo anuncia como deshabilitado', async () => {
    const onPress = jest.fn()
    await render(<Boton etiqueta="Registrar pago" onPress={onPress} deshabilitado pistaAccesible="Faltan ítems" />)
    const boton = screen.getByRole('button', { name: 'Registrar pago' })
    await fireEvent.press(boton)
    expect(onPress).not.toHaveBeenCalled()
    expect(boton.props.accessibilityState).toMatchObject({ disabled: true })
    expect(boton.props.accessibilityHint).toBe('Faltan ítems')
  })

  it('no dispara onPress mientras carga y se anuncia ocupado', async () => {
    const onPress = jest.fn()
    await render(<Boton etiqueta="Enviar comprobante" onPress={onPress} cargando />)
    const boton = screen.getByRole('button', { name: 'Enviar comprobante' })
    await fireEvent.press(boton)
    expect(onPress).not.toHaveBeenCalled()
    expect(boton.props.accessibilityState).toMatchObject({ busy: true })
  })

  it('el enlace usa el rol link', async () => {
    await render(<Boton etiqueta="Ver cuotas" variante="enlace" onPress={jest.fn()} />)
    expect(screen.getByRole('link', { name: 'Ver cuotas' })).toBeTruthy()
  })
})

describe('CampoTexto', () => {
  it('muestra etiqueta, ayuda y error asociado al campo', async () => {
    await render(
      <CampoTexto etiqueta="Número de operación" valor="" onChangeText={jest.fn()} ayuda="Hasta 30 caracteres" error="Es obligatorio." />
    )
    expect(screen.getByText('Número de operación')).toBeTruthy()
    expect(screen.getByText('Es obligatorio.')).toBeTruthy()
    const campo = screen.getByLabelText('Número de operación')
    expect(campo.props.accessibilityHint).toBe('Es obligatorio. Hasta 30 caracteres')
  })

  it('propaga los cambios de texto', async () => {
    const onChangeText = jest.fn()
    await render(<CampoTexto etiqueta="Correo" valor="" onChangeText={onChangeText} teclado="correo" />)
    await fireEvent.changeText(screen.getByLabelText('Correo'), 'a@b.c')
    expect(onChangeText).toHaveBeenCalledWith('a@b.c')
  })

  it('oculta el texto secreto y permite mostrarlo con el control', async () => {
    const onToggle = jest.fn()
    const { rerender } = await render(
      <CampoTexto etiqueta="Contraseña" valor="x" onChangeText={jest.fn()} secreto controlMostrar={{ visible: false, onToggle }} />
    )
    expect(screen.getByLabelText('Contraseña').props.secureTextEntry).toBe(true)
    await fireEvent.press(screen.getByRole('button', { name: 'Mostrar contraseña' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    await rerender(
      <CampoTexto etiqueta="Contraseña" valor="x" onChangeText={jest.fn()} secreto controlMostrar={{ visible: true, onToggle }} />
    )
    expect(screen.getByLabelText('Contraseña').props.secureTextEntry).toBe(false)
  })

  it('no es editable cuando está deshabilitado', async () => {
    await render(<CampoTexto etiqueta="Fecha" valor="" onChangeText={jest.fn()} deshabilitado />)
    expect(screen.getByLabelText('Fecha').props.editable).toBe(false)
  })
})

describe('piezas de estado', () => {
  it('Aviso de error se anuncia como alerta', async () => {
    await render(<Aviso tipo="error" titulo="No pudimos continuar." mensaje="Intentá nuevamente." anuncio="alerta" />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('No pudimos continuar.')).toBeTruthy()
  })

  it('InsigniaEstado comunica el estado con texto, no solo con color', async () => {
    await render(
      <>
        <InsigniaEstado dominio="factura" estado="parcial" />
        <InsigniaEstado dominio="pago" estado="pendiente" />
      </>
    )
    expect(screen.getByText('Pago parcial')).toBeTruthy()
    expect(screen.getByText('Pendiente de verificación')).toBeTruthy()
  })

  it('Importe nunca recorta la cifra y la lee con unidad', async () => {
    await render(<Importe centavos={6360665} total />)
    const nodo = screen.getByText('ARS 63.606,65')
    expect(nodo.props.numberOfLines).toBeUndefined()
    expect(nodo.props.accessibilityLabel).toBe('pesos argentinos 63.606,65')
  })

  it('EstadoPantalla de error ofrece reintentar solo si se le da la acción', async () => {
    const onReintentar = jest.fn()
    const { rerender } = await render(<EstadoPantalla tipo="error" titulo="No pudimos cargar." descripcion="Revisá tu conexión." />)
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
    await rerender(
      <EstadoPantalla tipo="error" titulo="No pudimos cargar." descripcion="Revisá tu conexión." onReintentar={onReintentar} />
    )
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onReintentar).toHaveBeenCalledTimes(1)
  })
})
