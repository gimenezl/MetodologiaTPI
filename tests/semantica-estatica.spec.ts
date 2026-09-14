import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { expect, test } from '@playwright/test'

/**
 * Guardia estática de controles interactivos anidados en la superficie de EPT-9.
 *
 * Las pruebas en el navegador miran el DOM de los estados a los que se puede
 * llegar. Algunos estados defensivos —por ejemplo, la vista propia cuando el
 * servidor no reconoce la sesión pero el panel sí— no tienen un camino de
 * navegación reproducible. Esta guardia recorre el árbol sintáctico de cada
 * archivo y rechaza cualquier control interactivo dentro de otro, llegue o no
 * la interfaz a ese estado.
 *
 * No reemplaza a las pruebas en el navegador: las complementa. Un componente
 * externo que renderizara un botón por dentro no se ve desde acá; se ve en el
 * DOM, que es lo que miran `tests/_semantica.ts` y `alumnos-auth.spec.ts`.
 */

const RAIZ = path.resolve(__dirname, '..')

/** Superficie de EPT-9: pantallas, componentes compartidos y banco visual. */
const DIRECTORIOS = [
  'src/app/dashboard/alumnos',
  'src/app/dashboard/mi-legajo',
  'src/app/dashboard/usuarios',
  'src/app/pruebas-ui/alumnos',
  'src/components/ui',
]
const ARCHIVOS_SUELTOS = ['src/app/dashboard/layout.tsx']

/** Componentes y etiquetas que son un control interactivo. */
const CONTROLES = new Set([
  'a', 'Link', 'EnlaceBoton', 'button', 'Button', 'input', 'Input', 'select', 'Select', 'textarea',
])
/** Controles que no pueden tener otro control adentro. */
const CONTENEDORES = new Set(['a', 'Link', 'EnlaceBoton', 'button', 'Button'])

function archivosTsx(directorio: string): string[] {
  const absoluto = path.join(RAIZ, directorio)
  if (!fs.existsSync(absoluto)) return []
  return fs.readdirSync(absoluto, { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile() && entrada.name.endsWith('.tsx'))
    .map((entrada) => path.join(entrada.parentPath, entrada.name))
}

/** Hallazgos `archivo:línea — control dentro de contenedor` en un código fuente. */
function buscarControlesAnidados(nombreArchivo: string, fuente: string): string[] {
  const archivo = ts.createSourceFile(nombreArchivo, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hallazgos: string[] = []

  const etiqueta = (nodo: ts.JsxElement | ts.JsxSelfClosingElement) =>
    (ts.isJsxElement(nodo) ? nodo.openingElement.tagName : nodo.tagName).getText(archivo)

  function recorrer(nodo: ts.Node, contenedores: string[]) {
    if (ts.isJsxElement(nodo) || ts.isJsxSelfClosingElement(nodo)) {
      const nombre = etiqueta(nodo)
      if (CONTROLES.has(nombre) && contenedores.length > 0) {
        const { line } = archivo.getLineAndCharacterOfPosition(nodo.getStart(archivo))
        hallazgos.push(
          `${path.relative(RAIZ, nombreArchivo)}:${line + 1} — <${nombre}> dentro de <${contenedores.at(-1)}>`
        )
      }
      const siguientes = CONTENEDORES.has(nombre) ? [...contenedores, nombre] : contenedores
      ts.forEachChild(nodo, (hijo) => recorrer(hijo, siguientes))
      return
    }
    ts.forEachChild(nodo, (hijo) => recorrer(hijo, contenedores))
  }

  recorrer(archivo, [])
  return hallazgos
}

test.describe('Guardia estática de controles interactivos anidados', () => {
  test('la superficie de EPT-9 no anida controles interactivos', () => {
    const archivos = [
      ...DIRECTORIOS.flatMap(archivosTsx),
      ...ARCHIVOS_SUELTOS.map((archivo) => path.join(RAIZ, archivo)),
    ]
    expect(archivos.length, 'la guardia tiene que revisar archivos reales').toBeGreaterThan(10)

    const hallazgos = archivos.flatMap((archivo) =>
      buscarControlesAnidados(archivo, fs.readFileSync(archivo, 'utf8'))
    )
    expect(hallazgos, `controles anidados:\n  ${hallazgos.join('\n  ')}`).toEqual([])
  })

  test('la guardia detecta un botón dentro de un enlace y un enlace dentro de un botón', () => {
    const hallazgos = buscarControlesAnidados(
      path.join(RAIZ, 'caso-sintetico.tsx'),
      `export function Caso() {
         return (
           <div>
             <Link href="/dashboard" className="inline-block">
               <Button>Volver al panel</Button>
             </Link>
             <button type="button"><a href="/x">Ir</a></button>
             <EnlaceBoton href="/dashboard">Volver</EnlaceBoton>
           </div>
         )
       }`
    )
    expect(hallazgos).toEqual([
      'caso-sintetico.tsx:5 — <Button> dentro de <Link>',
      'caso-sintetico.tsx:7 — <a> dentro de <button>',
    ])
  })
})
