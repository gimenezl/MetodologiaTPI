# EPT-164 — Flujo de alta de vínculos padre-hijo para la app

**Estado: propuesta con recomendación. La decisión final está PENDIENTE de Lucas Gimenez.**
La tarjeta pide expresamente no definir reglas por cuenta propia ni elegir una opción automáticamente.
Este documento ordena las alternativas con evidencia del repositorio y deja una recomendación explícita;
nada de lo descrito se implementó. Baseline: `main` en `40217f5`.

## 1. Problema

La app móvil (EPT-105 en adelante) lista los hijos de un PADRE leyendo `padres_hijos` bajo RLS
(`mobile/src/contenedores/acceso/datos-rol.ts`). Sin filas en esa tabla, un PADRE ve el estado vacío
y todo el ciclo económico (HU1, HU6, HU8, HU9, HU13, HU15) queda inalcanzable. Hoy no hay ningún
flujo de producto que cree vínculos.

## 2. Estado actual verificado en el código

| Hecho | Evidencia |
| --- | --- |
| `padres_hijos(padre_id, hijo_id, fecha_creacion)`: PK compuesta, FK a `perfiles`, `CHECK padre_id <> hijo_id`, índice inverso por `hijo_id`. Relación muchos a muchos. | `supabase/migrations/011_reconciliacion_esquema_remoto.sql` |
| Privilegios: `SELECT, INSERT, DELETE` a `authenticated`; sin `UPDATE`. RLS: INSERT y DELETE solo `rol_actual() = 'DIRECTOR'`; SELECT para DIRECTOR, el padre o el hijo involucrado. | 011 (líneas 329-348) |
| La RLS de INSERT **no valida** que `padre_id` sea PADRE ni que `hijo_id` sea ESTUDIANTE con legajo: solo exige que quien inserta sea Dirección. | 011; `supabase/tests/usuarios_permisos_rls.sql` |
| `POST /api/usuarios` rechaza `tutor_id` y `hijos_ids` con `VINCULO_NO_DISPONIBLE` antes de escribir nada, porque no existe una operación que cree cuenta, perfil y vínculo en una sola confirmación. | `src/app/api/usuarios/route.ts` (líneas 160-168) |
| El «vínculo presencial» de EPT-59 (D5) enlaza una **cuenta de acceso** a un **perfil ya existente** (`reservar_vinculo_cuenta`, desafío por correo, trigger de enlace sobre `auth.users`). **No escribe `padres_hijos`.** Está apagado salvo `EPT_VINCULO_CUENTAS=habilitado` con SMTP. | `src/services/vinculo-cuenta.service.ts`; `docs/evidence/EPT-59.md` |
| Un PADRE con hijos vinculados no puede cambiar de rol (P5910): hay que quitar los vínculos antes. | migración EPT-59, `cambiar_rol_perfil` |
| Todas las RPC económicas y de comprobantes autorizan por `padres_hijos` y el estado de acceso del padre. Quitar un vínculo oculta datos y revincular los restituye (matriz V02/V03). | migraciones EPT-108/109/113/115/116; `docs/parte3/EPT-119-121/matriz-acceso.md` |

Conclusión relevante: el criterio «solo Dirección crea o desvincula» **ya se cumple por RLS**. Lo que falta
es una superficie de producto y validaciones de dominio que la política de tabla no ofrece.

## 3. Alternativas

### (a) Pantalla de Dirección en la web + RPC nuevas

- Dirección abre el perfil de un PADRE (o de un estudiante) en `/dashboard/usuarios/[id]` y agrega o
  quita hijos/tutores.
- RPC `vincular_padre_hijo(p_padre_id, p_hijo_id)` y `desvincular_padre_hijo(...)`, con el mismo patrón
  de las RPC existentes (función privada con autorización propia y envoltorio público `SECURITY INVOKER`,
  `EXECUTE` solo a `authenticated`).
- Pros: solución durable; validaciones de dominio; reutiliza el patrón y las pruebas RLS existentes;
  es lo que habilita el uso real de la app.
- Contras: requiere migración, pantalla, pruebas y despliegue; costo no estimado ni presupuestado
  (la tarjeta aclara que no entra en las 259 h hasta que Lucas decida).

### (b) Carga inicial como datos de demostración (EPT-124)

- Un script/seed idempotente inserta vínculos para cuentas de prueba o para la carga inicial.
- Pros: barato, desbloquea pruebas de roles y demos de inmediato, sin superficie nueva.
- Contras: no es un flujo de producto; no sirve para altas posteriores; en producción implicaría
  escrituras manuales sin validación ni rastro; la política de datos reales de EPT-124 aún no está definida.

### (c) Reutilizar el vínculo presencial de EPT-59

- **Descartada por incompatibilidad, verificada en código**: ese flujo resuelve otro problema
  (cuenta ↔ perfil) y no inserta en `padres_hijos`. Además está deshabilitado en producción por
  decisión documentada en EPT-59 hasta contar con canal SMTP y autorización propios. Reutilizarlo
  obligaría a ampliar su contrato y su prueba de 103 afirmaciones sin resolver el vínculo familiar.

## 4. Recomendación (pendiente de aprobación)

**(a) como flujo definitivo, con (b) acotado a datos de demostración y entorno local/pruebas.**

Fundamento: (a) es la única que cumple a la vez los tres criterios de aceptación con validación de
dominio y es coherente con la decisión de EPT-8/EPT-59 de que Dirección es la raíz de autorización;
(b) no sustituye a (a) pero evita bloquear EPT-105/EPT-124 mientras (a) se planifica. Secuencia sugerida:
1) aprobar esta decisión; 2) EPT-124 usa (b) solo para fixtures de prueba y demo; 3) tarjeta nueva para (a),
con estimación propia.

## 5. Flujo propuesto para (a)

**Quién:** solo DIRECTOR habilitado. Ningún otro rol, ni la app móvil, crea o quita vínculos.

**Datos:** `padre_id` y `hijo_id` (ids de perfil, elegidos desde listas, no escritos a mano). Nada más:
no se capturan contraseñas, correos ni documentos en este flujo.

**Pasos:**
1. Dirección abre el perfil del PADRE y elige «Agregar hijo»; busca al estudiante por nombre, DNI o legajo.
2. La pantalla muestra una confirmación con ambos nombres y el curso del estudiante.
3. La RPC valida y escribe un solo registro; la pantalla refleja la lista actualizada.
4. Para desvincular, confirmación explícita con el efecto («dejará de ver al estudiante y sus cuotas»).

**Validaciones de la RPC (en servidor, no en la pantalla):**
- Actor: DIRECTOR con acceso HABILITADO, resuelto desde la sesión; nunca de parámetros.
- `padre_id` existe, es rol PADRE; `hijo_id` existe, tiene fila en `alumnos` (ESTUDIANTE con legajo).
- `padre_id <> hijo_id` (ya lo impone el CHECK).
- Duplicado: idempotente (mismo par ya vinculado devuelve éxito sin cambios, sin error ni fila nueva).
- Cuenta del padre bloqueada: se permite vincular (es administración), pero el padre sigue sin acceso
  mientras esté bloqueado; la RPC no modifica el estado de acceso.
- Bloqueo de filas con `FOR SHARE`/`FOR UPDATE` coherente con el criterio de EPT-103 para evitar
  escribir tras perder autorización.

**Seguridad / RLS:**
- No se agregan grants ni se cambian las políticas de `padres_hijos`; se conservan tal cual.
- Las RPC no se otorgan a `anon`; `EXECUTE` solo a `authenticated`, con autorización propia dentro.
- Se prueba con roles reales (SQL RLS y PostgREST): PADRE, ESTUDIANTE, DOCENTE y PERSONAL reciben
  denegación; DIRECTOR bloqueado también; un PADRE de prueba ve únicamente a sus hijos vinculados.
- Sin `service_role` en la ruta del actor.

**Casos de error (códigos a definir en la implementación):** no autenticado (401), sin permiso (403),
padre inexistente o con rol distinto de PADRE, hijo inexistente o sin legajo, par ya vinculado
(éxito idempotente), vínculo a desvincular inexistente (éxito idempotente), servicio no disponible.
Mensajes en español rioplatense, sin filtrar identificadores de terceros.

**Datos que la app consume, sin cambios:** `padres_hijos` + `alumnos_academicos` bajo RLS. La app móvil
no necesita cambiar: el estado vacío de HU1 se mantiene para PADRES sin vínculos.

## 6. Qué NO cambia

- La web actual y sus rutas: `POST /api/usuarios` sigue devolviendo `VINCULO_NO_DISPONIBLE` hasta que
  una tarjeta propia lo habilite (alta atómica cuenta+perfil+vínculo queda fuera de esta decisión).
- El vínculo presencial de cuentas (EPT-59, D5): sigue apagado en producción.
- Políticas RLS, grants y esquema de `padres_hijos`; reglas de cambio de rol (P5910).
- El alcance económico y las tarjetas web cerradas.

## 7. Decisiones pendientes (del equipo/dueño)

| Id | Decisión | Recomendación |
| --- | --- | --- |
| D1 | Opción elegida: (a), (b) o combinación | (a) definitiva + (b) solo demo/pruebas |
| D2 | ¿Se exige constancia presencial de la relación familiar al vincular, como en EPT-59? | No en la primera versión; reevaluar si hay disputa de tutela (riesgo de confianza ya documentado en EPT-59) |
| D3 | ¿Varios adultos por estudiante (copadre)? | Sí: la PK ya lo permite y la matriz de acceso EPT-119-121 lo prueba |
| D4 | ¿Rastro de auditoría de altas/bajas de vínculos? | Sí, con actor y fecha, reutilizando el patrón de historial de usuarios; confirmar alcance en la tarjeta de implementación |
| D5 | Estimación y presupuesto de (a) fuera de las 259 h | Lo decide Lucas |
| D6 | Fecha de EPT-124 respecto de (a) | EPT-124 no espera a (a): usa (b) acotado |

## 8. Consistencia con decisiones previas

Alineado con: Dirección como única autoridad de escritura sobre vínculos (011), RLS conservada y sin
`service_role` para actores (EPT-105/EPT-134), cuenta bloqueada sin acceso (EPT-59), revinculación
que restituye el mismo acceso (EPT-119-121), y EPT-115/116, que ya declararon el alta de vínculos
fuera de su alcance y la remitieron a EPT-164. No contradice ningún contrato vigente.
