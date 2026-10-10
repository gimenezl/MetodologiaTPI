// Registro de la aplicación móvil (EPT-102). Un archivo bajo `mobile/` sin contrato bloquea el plan:
// el paquete es código ejecutable en Android e iOS y un PASS de Next web no lo prueba.
import { readFileSync } from 'node:fs'

// Archivos exactos del paquete.
export const mobileExact = new Set([
  'mobile/package.json', 'mobile/package-lock.json', 'mobile/.npmrc', 'mobile/.gitignore', 'mobile/.env.example',
  'mobile/app.config.ts', 'mobile/tsconfig.json', 'mobile/eslint.config.js', 'mobile/jest.config.js', 'mobile/jest.setup.ts',
  'mobile/README.md',
])

// Familias de archivos: cada patrón es literal y acotado; no hay comodines sobre binarios arbitrarios.
export const mobilePatterns = [
  /^mobile\/app\/(?:[A-Za-z0-9_()-]+\/)*[A-Za-z0-9_()-]+\.tsx?$/u,
  /^mobile\/src\/(?:[a-z0-9-]+\/)*[A-Za-z0-9_.-]+\.tsx?$/u,
  /^mobile\/__tests__\/[A-Za-z0-9._-]+\.test\.tsx?$/u,
  /^mobile\/scripts\/[a-z0-9.-]+\.(?:mjs|sh)$/u,
  /^mobile\/assets\/fonts\/[A-Za-z0-9_.-]+\.(?:ttf|txt)$/u,
  /^mobile\/maestro\/[a-z0-9-]+\.ya?ml$/u,
]

// Módulos de la web que la app copia (mobile/scripts/sync-compartido.mjs): su cambio exige comprobar la copia móvil.
export const mobileCompartido = new Set(['src/lib/errores.ts', 'src/types/database.generated.ts'])

export function isMobilePath(file) {
  return mobileExact.has(file) || mobilePatterns.some(pattern => pattern.test(file))
}

/** `mobile/` entero o lo que alimenta su copia compartida y su verificación. */
export function touchesMobile(file) {
  return file.startsWith('mobile/') || mobileCompartido.has(file)
}

/** Debe llamarse con una ruta que `touchesMobile`. Lanza si el archivo bajo `mobile/` no tiene contrato. */
export function requireMobileContract(file) {
  if (file.startsWith('mobile/') && !isMobilePath(file)) throw new Error(`Ruta mobile sin contrato: ${file}`)
}

const JOBS = ['mobile', 'mobile-android', 'mobile-ios']

/** El workflow debe declarar los tres jobs móviles y el gate debe exigirlos; si no, el plan no es creíble. */
export function validateMobileWorkflow(yml) {
  for (const job of JOBS) {
    if (!new RegExp(`^  ${job}:`, 'mu').test(yml)) throw new Error(`Falta el job ${job} en .github/workflows/ci.yml`)
  }
  for (const fragmento of ['mobile: ${{ steps.impact.outputs.mobile }}', 'MOBILE: ${{ needs.mobile.result }}',
    'ANDROID: ${{ needs.mobile-android.result }}', 'IOS: ${{ needs.mobile-ios.result }}', 'PLAN_MOBILE: ${{ needs.plan.outputs.mobile }}',
    'needs: [fast, database, ui, plan, mobile, mobile-android, mobile-ios]',
    'test "$MOBILE" = success && test "$ANDROID" = success && test "$IOS" = success']) {
    if (!yml.includes(fragmento)) throw new Error(`El gate no exige el resultado móvil: falta «${fragmento}»`)
  }
  // Cada job nativo debe ejecutar la app, no solo compilarla.
  if (!yml.includes('mobile/scripts/ejecutar-android.sh') || !yml.includes('mobile/scripts/ejecutar-ios.sh')) {
    throw new Error('Los jobs Android e iOS deben ejecutar la aplicación (ejecutar-android.sh / ejecutar-ios.sh)')
  }
  return true
}

export function validateMobileWorkflowFile(path = '.github/workflows/ci.yml') {
  return validateMobileWorkflow(readFileSync(path, 'utf8'))
}
