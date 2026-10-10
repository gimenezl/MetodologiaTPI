# Aplicación móvil — Educar para Transformar

Paquete Expo (React Native, TypeScript estricto, Expo Router) independiente del monolito Next.js. Es un **cliente más del mismo Supabase**: no hay base de datos ni backend paralelos (EPT-97).

> Estado (EPT-102): base de infraestructura. La única pantalla es un harness de desarrollo que comprueba tema, componentes, formulario y almacenamiento seguro. El acceso por rol y las pantallas económicas pertenecen a EPT-105 y posteriores.

## Estructura

| Carpeta | Contenido |
|---|---|
| `app/` | Rutas de Expo Router (solo componen contenedores) |
| `src/tokens/` | Tokens institucionales (EPT-95/99) y resolución de fuentes |
| `src/catalogo/` | Piezas presentacionales (`Boton`, `CampoTexto`, `Aviso`, `InsigniaEstado`, `Importe`, `Tarjeta`, `Formulario`, `EstadoPantalla`) |
| `src/contenedores/` | Contenedor + vista por pantalla; el contenedor obtiene datos, la vista solo dibuja |
| `src/servicios/` | Único lugar con `supabase-js`, almacenamiento seguro y transporte HTTP |
| `src/configuracion/` | Lectura y validación de la configuración pública |
| `src/compartido/` | Copia **generada** de módulos puros de la web (`npm run compartido:sync`) |
| `maestro/` | Flujo de verificación ejecutado en emulador y simulador |

## Configuración pública

Copiar `.env.example` a `.env.local` (no versionado). Solo valores públicos:

| Variable | Uso |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | URL del proyecto (https) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Clave pública. Se rechaza cualquier clave con rol distinto de `anon` |
| `EXPO_PUBLIC_API_BASE_URL` | Origen de los Route Handlers de Next (camino B de EPT-98) |

## Comandos

```bash
npm ci                       # instalación reproducible (usa .npmrc con legacy-peer-deps)
npm run typecheck            # tsc --noEmit
npm run lint
npm test                     # Jest (componentes, sesión, almacenamiento, transporte) + node:test (aislamiento)
npm run compartido:check     # la copia compartida coincide con la web
npm run verificar:importaciones
npm run verificar:expo       # expo install --check
npm run bundle:android && npm run bundle:ios
node scripts/verificar-importaciones.mjs --bundle dist/android --bundle dist/ios
```

Los builds nativos y su ejecución corren en `CI / móvil Android` y `CI / móvil iOS` (`.github/workflows/ci.yml`).

## Reglas de aislamiento

- Sin `next/*`, `react-dom`, `@supabase/ssr`, clientes `supabase.server` / `supabase.admin` ni importaciones fuera de `mobile/`.
- Sin claves privilegiadas en `EXPO_PUBLIC_*`, fuentes ni bundles (lo verifica `scripts/verificar-importaciones.mjs`).
- Un único cliente Supabase (`obtenerClienteSupabase`) y un único listener de ciclo de vida.
- La sesión se guarda cifrada por la plataforma (Keychain/Keystore) en fragmentos; nunca en texto plano.
