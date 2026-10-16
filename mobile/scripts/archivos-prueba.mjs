// Escribe los archivos sintéticos (PDF y PNG válidos, sin datos personales) que el flujo de Maestro de
// EPT-109 elige con el selector real del sistema. No hay binarios versionados: se generan acá.
//
//   node mobile/scripts/archivos-prueba.mjs <directorio>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { PNG, pdfMinimo } from './integracion-comprobantes.mjs'

const destino = process.argv[2]
if (!destino) {
  console.error('Falta el directorio de destino.')
  process.exit(1)
}
mkdirSync(resolve(destino), { recursive: true })
writeFileSync(join(resolve(destino), 'comprobante-ci.pdf'), pdfMinimo('maestro'))
writeFileSync(join(resolve(destino), 'comprobante-ci.png'), PNG)
console.log('Archivos de prueba generados.')
