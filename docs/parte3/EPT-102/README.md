# EPT-102 — Proyecto Expo en `mobile/`

Base nativa de la aplicación móvil de Educar para Transformar. La evidencia verificable (comandos, resultados, duraciones, SHA) está en [`docs/evidence/EPT-102.md`](../../evidence/EPT-102.md); el código, en [`mobile/`](../../../mobile/README.md).

> Qué es: infraestructura (proyecto Expo, tema, catálogo, sesión cifrada, transporte, gates de CI) y un harness de desarrollo. Qué no es: login, acceso por rol ni pantallas económicas (EPT-105 y siguientes), ni una aprobación humana o docente.

## Trazabilidad: criterio → implementación → prueba → evidencia

| # | Criterio de la tarjeta | Implementación | Prueba | Evidencia |
|---|---|---|---|---|
| C1 | Expo con TypeScript y Expo Router | `mobile/package.json`, `app.config.ts`, `tsconfig.json` (estricto), `app/_layout.tsx`, `app/index.tsx` | `npm run typecheck`, `expo-doctor`, `expo install --check`, `expo export` Android e iOS | Evidencia §Verificación local y §CI |
| C2 | Cliente Supabase único | `src/servicios/supabase.ts` (`obtenerClienteSupabase`, singleton) | `__tests__/cliente-supabase.test.ts`: misma instancia, también tras reevaluar el módulo | Ídem |
| C3 | Persistencia segura de sesión | `src/servicios/almacenamiento-seguro.ts` (fragmentos cifrados por la plataforma + manifiesto) | `__tests__/almacenamiento-seguro.test.ts` (sesión de 9 KB, límite 2 KB por entrada, corrupción, fragmento faltante, fallo parcial, error nativo, concurrencia, sin filtrar valores) y verificación en dispositivo con Maestro | Ídem |
| C4 | React Hook Form y Zod | `src/contenedores/verificacion/` (esquema, contenedor, vista) | `__tests__/verificacion.test.tsx`; Maestro en emulador y simulador | Ídem |
| C5 | Tema institucional | `src/tokens/index.ts`, fuentes Outfit y Geist Mono en `assets/fonts/` (OFL 1.1) | `__tests__/componentes.test.tsx`; contraste y valores heredados de EPT-99 | Ídem |
| C6 | Build de prueba Android e iOS | Jobs `CI / móvil Android` y `CI / móvil iOS` (`.github/workflows/ci.yml`) | Instalación y ejecución con Maestro en emulador API 34 y simulador iOS | Evidencia §Builds nativos |
| C7 | Transporte HTTP con base URL y sesión del dispositivo | `src/servicios/transporte-http.ts`, `src/servicios/api.ts`, `src/servicios/sesion.ts` | `__tests__/transporte-http.test.ts` | Ídem |
| C8 | Sin base paralela, secretos privilegiados, importaciones del servidor Next, DOM, `supabase.server`/`supabase.admin`, `next/headers`/`next/cache` | `scripts/verificar-importaciones.mjs`, guarda de `src/configuracion/entorno.ts` | `scripts/aislamiento.test.mjs` (15 negativas), `__tests__/supabase.test.ts`, escaneo de bundles exportados | Ídem |

## Decisiones

| # | Decisión | Motivo |
|---|---|---|
| D1 | SDK 57 (`expo@~57.0.27`, React Native 0.86.3, React 19.2.3), fijado con `expo install` | Versiones que declara el propio SDK; no se copió un tutorial. `npm view expo` y la documentación oficial se contrastaron el 10/10/2026 |
| D2 | `mobile/.npmrc` con `legacy-peer-deps=true` | El resolvedor de npm elige `react-dom@19.3.0` para un peer opcional de `expo`, incompatible con React 19.2.3. `react-dom` no es dependencia de la app |
| D3 | Sesión en fragmentos de SecureStore, no `AsyncStorage` + clave AES | El tutorial de Supabase cifra con una clave en SecureStore y guarda el valor en `AsyncStorage`; aquí todo el contenido queda cifrado por la plataforma y no hay criptografía propia |
| D4 | Copia generada de `errores.ts` y `database.generated.ts` | Estrategia reproducible sin enlaces simbólicos: Metro solo ve archivos de `mobile/`. `compartido:check` falla si hay deriva o la fuente deja de ser pura |
| D5 | Maestro 2.11.0 con suma SHA-256 fijada | Misma herramienta para Android e iOS; evita dos arneses distintos |
| D6 | Plan móvil en un job `plan` aparte del job `fast` | Los builds nativos no esperan los 8 min de la web; el job `fast` no cambia |
| D7 | Íconos de insignias como glifos de texto decorativos | La biblioteca de SVG está pendiente de decisión (EPT-99 §traducción); el estado se comunica por texto y trazo |

## Puntos abiertos A1–A11 del catálogo (EPT-99): disposición

| # | Disposición en EPT-102 | Quién completa |
|---|---|---|
| A1 | **Resuelto técnicamente** en `Boton`: presionado con fondo `primario600` (primario) o `primario50` (secundario); cargando con `ActivityIndicator`, `busy` y bloqueo del toque. Es una propuesta de EPT-99, sin lámina del diseño | Confirmación visual del equipo |
| A2 | Diferido: depende de la pantalla de selección de pago | Unidad de la pantalla de pago |
| A3 | `Centavos` entero y `formatearImporte` puro implementados; la conversión desde `NUMERIC(12,2)` se define con los servicios | Implementación de servicios |
| A4 | Diferido: origen de `CapacidadesPago` y `puedeAbrirOriginal` | Servicios y contenedores |
| A5 | Se conserva 15 px (token de EPT-95); el texto no limita `allowFontScaling`. **No verificado** en dispositivo con texto ampliado | Revisión de accesibilidad |
| A6 | `Importe` sin `numberOfLines`, `flexShrink: 0` y filas con `flexWrap`; **no verificado** con escalado real del sistema | Verificación en dispositivo |
| A7 | Diferido: agregados del servidor o suma de centavos | Servicios |
| A8 | No aplica a esta base: no se declaran endpoints ni RPC funcionales | EPT-98 al implementar |
| A9 | `Importe` expone `accessibilityLabel` «pesos argentinos …»; **no verificado** con TalkBack ni VoiceOver | Verificación con lectores de pantalla |
| A10 | Diferido: bloqueo por banco no configurado es del prototipo | Pantalla de pago |
| A11 | El harness usa `inputMode="numeric"` para un entero; el modo de entrada de `dd/mm/aaaa` queda pendiente. El teclado numérico de iOS no ofrece `/` | Verificación en dispositivo con la pantalla de comprobantes |

Los supuestos S1–S3 del prototipo de EPT-96 (número de operación, fecha futura, deuda por vencimiento) **no** se convirtieron en reglas.

## Endpoints

El transporte no registra rutas. Ninguna ruta `/api` acepta hoy `Authorization: Bearer` (adaptador nuevo de EPT-98/EPT-119); por eso no se declara funcional ningún endpoint.

## Límites

- TalkBack y VoiceOver no se ejecutaron: solo hay verificación automatizada de existencia de roles, estados y etiquetas en pruebas de componentes y flujo con Maestro.
- El comportamiento del teclado (`KeyboardAvoidingView`) se ejerció solo con el flujo de Maestro; no hay evaluación manual en dispositivos físicos.
- Los builds son de prueba: Android release firmado con la clave de depuración del proyecto generado (x86_64); iOS para simulador sin firma. No se publican ni se distribuyen.
- La configuración de CI usa valores públicos de relleno: no se probó contra el Supabase real.
- No hay aprobación docente.

## Rollback

Revertir el commit de integración elimina `mobile/`, `docs/parte3/EPT-102/`, `docs/evidence/EPT-102.md` y los jobs móviles de `ci.yml`, y restaura `tsconfig.json`, `eslint.config.mjs` y el selector. No toca base de datos, Storage, producción ni la aplicación web.
