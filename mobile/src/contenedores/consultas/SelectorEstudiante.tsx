import type { ReactElement } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Avatar } from '@/catalogo'
import { borde, color, espacio, estiloDeTexto, radio } from '@/tokens'

import type { AlumnoSelector } from '../cuotas/CuotasVista'

export interface SelectorEstudianteProps {
  alumnos: AlumnoSelector[]
  alumnoId: string | null
  /** Hijo elegido, sobre el que opera toda la pantalla. */
  onSeleccionar: (id: string) => void
  pista: string
  prefijoId: string
}

/**
 * Selector de hijo del padre, en chips con avatar. El estudiante nunca lo ve: su pantalla recibe un único
 * alumno propio. Deja inequívoco sobre quién se consulta, también con un solo hijo.
 */
export function SelectorEstudiante({ alumnos, alumnoId, onSeleccionar, pista, prefijoId }: SelectorEstudianteProps): ReactElement {
  return (
    <View accessibilityRole="tablist" style={{ gap: espacio.sm }}>
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Estudiante</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm }}>
        {alumnos.map(alumno => {
          const elegido = alumno.id === alumnoId
          return (
            <Pressable
              key={alumno.id}
              testID={`${prefijoId}-${alumno.id}`}
              accessibilityRole="tab"
              accessibilityLabel={alumno.etiqueta}
              accessibilityHint={elegido ? 'Seleccionado' : pista}
              accessibilityState={{ selected: elegido }}
              onPress={() => onSeleccionar(alumno.id)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: espacio.sm,
                minHeight: 48,
                paddingVertical: espacio.xs,
                paddingLeft: espacio.xs,
                paddingRight: espacio.lg,
                borderRadius: radio.pastilla,
                borderWidth: elegido ? 2 : borde.fino,
                borderColor: elegido ? color.primario500 : color.neutro200,
                backgroundColor: elegido ? color.primario100 : color.superficie,
              }}
            >
              <Avatar nombre={alumno.etiqueta} tamano={36} />
              <Text style={[estiloDeTexto('boton'), { color: elegido ? color.primario700 : color.neutro800, flexShrink: 1 }]}>
                {elegido ? '✓ ' : ''}
                {alumno.etiqueta}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
