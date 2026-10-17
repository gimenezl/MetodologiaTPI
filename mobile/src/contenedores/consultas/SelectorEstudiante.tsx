import type { ReactElement } from 'react'
import { Text, View } from 'react-native'

import { Boton } from '@/catalogo'
import { color, espacio, estiloDeTexto } from '@/tokens'

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
 * Selector de hijo del padre. El estudiante nunca lo ve: su pantalla recibe un único alumno propio.
 * Deja inequívoco sobre quién se consulta, también con un solo hijo.
 */
export function SelectorEstudiante({ alumnos, alumnoId, onSeleccionar, pista, prefijoId }: SelectorEstudianteProps): ReactElement {
  return (
    <View accessibilityRole="tablist" style={{ gap: espacio.sm }}>
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Estudiante</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm }}>
        {alumnos.map(alumno => (
          <Boton
            key={alumno.id}
            etiqueta={alumno.etiqueta}
            variante={alumno.id === alumnoId ? 'primario' : 'secundario'}
            onPress={() => onSeleccionar(alumno.id)}
            pistaAccesible={alumno.id === alumnoId ? 'Seleccionado' : pista}
            testID={`${prefijoId}-${alumno.id}`}
          />
        ))}
      </View>
    </View>
  )
}
