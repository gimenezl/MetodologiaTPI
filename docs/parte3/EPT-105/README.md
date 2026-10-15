# EPT-105 — Acceso móvil y autorización por rol

La aplicación utiliza Supabase Auth nativo con el cliente singleton y almacenamiento seguro existentes. Identidad, estado y rol se revalidan mediante Auth y RPC/PostgREST usando el JWT de la sesión; metadatos editables del usuario no conceden permisos. RLS sigue siendo la barrera efectiva para cada lectura.

## Contrato visible

| Resultado del servidor | Comportamiento móvil |
|---|---|
| Sin sesión | Formulario nativo de correo y contraseña; el error de credenciales no revela si existe la cuenta. |
| Cuenta autorizada | PADRE consulta solo sus vínculos visibles por RLS y puede ver el estado vacío sin vínculos; ESTUDIANTE consulta su propio contexto académico bajo RLS. La navegación móvil solo ofrece esas secciones y la cuenta. |
| Perfil faltante, bloqueado o rol desconocido | Cierre seguro; no se presenta una vista protegida. |
| Falla temporal al revalidar | Sin autorización basada en caché; se preserva la sesión potencialmente válida y se ofrece reintentar. |
| DIRECTOR, DOCENTE o PERSONAL | Orientación al canal web institucional, sin menús/rutas protegidas móviles ni tokens en la URL. |

Cerrar sesión limpia sesión y contexto local de este dispositivo. No equivale a revocar instantáneamente un JWT ya emitido en otro dispositivo; expiración, refresh y revocación remota son conceptos distintos. La app no transfiere credenciales ni sesión a Route Handlers web: el adaptador Bearer de EPT-98/Path B no está implementado y no se simula con WebView ni cabeceras paralelas.

## Matriz de aceptación, código, prueba y evidencia

| Criterio | Código | Prueba automatizada | Evidencia |
|---|---|---|---|
| EPT-105: login real, error genérico, sesión persistente, logout, carreras y estados seguros | `mobile/src/servicios/autenticacion.ts`; `mobile/src/contenedores/acceso/AccesoContenedor.tsx` | `mobile/__tests__/autenticacion.test.ts`; Auth local real | `docs/evidence/EPT-105.md`; CI Android (E2E real) e iOS (smoke) |
| EPT-129: cliente Auth/PostgREST y almacenamiento seguro | `mobile/src/servicios/supabase.ts` (singleton existente); `mobile/src/configuracion/entorno.ts`; `mobile/plugins/with-auth-integration-network-security.js` | `mobile/__tests__/supabase.test.ts`; `mobile/__tests__/network-security-plugin.test.ts`; importaciones/secretos; bundles | CI móvil; plugin Android solo en test permite `10.0.2.2`, base cleartext denegada, nunca service-role en bundle/app |
| EPT-130: pantalla nativa validada | `AccesoContenedor.tsx` y catálogo de formulario existente | pruebas de componentes; Maestro credencial inválida genérica y login real por actor local | JUnit de CI, retenido en runner temporal |
| EPT-131: rol y navegación segura | `autenticacion.ts`; RPC `mi_estado_acceso()` y `rol_actual()` | `mobile/scripts/integracion-auth-local.mjs`: roles, perfil ausente, rol desconocido y metadata manipulada | `docs/evidence/EPT-105.md` y resultado CI |
| EPT-132: orientación web solo para roles soportados | `AccesoContenedor.tsx` | unidad + Maestro de PADRE, ESTUDIANTE y DOCENTE (orientación web sin menú móvil) | Maestro Android con backend real; iOS verifica arranque y formulario |
| EPT-133: logout/refresh/expiración/reapertura | `autenticacion.ts`; SecureStore/AppState existentes | integración real refresh/expiración/logout; Maestro stop/launch con y sin estado | CI; el cierre local no afirma revocar JWT ya emitidos |
| EPT-134: aislamiento RLS | `mobile/scripts/integracion-auth-local.mjs` (fixtures locales solamente) | JWT actor para RPC/PostgREST; dos familias, vínculo/no vínculo, alumno propio; cuenta bloqueada | CI Android; no se usa service-role para lecturas de actor |

## Integración descartable

El job Android API 34 inicia un proyecto Supabase aislado desde las migraciones versionadas y lo apaga al finalizar. El job iOS Simulator compila la app y ejecuta un smoke sin backend: los runners macOS ARM de GitHub no tienen Docker, y la lógica de Auth/RLS que se prueba en Android es la misma en ambas plataformas. Fixture Auth sintético usa `.invalid` y credenciales aleatorias; la clave service-role solo se consume en el proceso host para sembrar/borrar fixture, nunca se exporta a Expo ni se imprime. Las comprobaciones de lectura y autorización usan JWT de cada actor. La app acepta HTTP exclusivamente con el indicador explícito `EPT_MOBILE_AUTH_INTEGRATION=1` y host/puerto local exacto del emulador/simulador; fuera de ese modo se exige HTTPS. Para Android, el plugin nativo de integración conserva `cleartextTrafficPermitted=false` como base y permite solo `10.0.2.2` sin subdominios; las builds no integradas no adjuntan esta excepción. El controlador atribuye el `SIGNED_IN` síncrono de `signInWithPassword` a su transacción activa, compara el usuario devuelto con el evento, invalida respuestas tardías y revalida al volver la app a primer plano.

El runner crea fixture de sesión `PADRE` para Maestro y entrega sus variables únicamente en el entorno del job. Salida JUnit/capturas viven bajo `RUNNER_TEMP`; no se suben logs, capturas ni credenciales. El teardown se ejecuta incluso ante fallo.

## Alcance excluido

No se agregan recuperación de contraseña (EPT-106), pagos, cuotas, autorizaciones web con Bearer ni menús futuros. No se alteran políticas o infraestructura existentes. No hay acceso a producción ni fixtures reales.
