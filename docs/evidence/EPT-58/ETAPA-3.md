# EPT-58 — Etapa 3 (B): privacidad de perfiles

**Estado:** candidato local listo para revisión. La aplicación de la etapa 2 ya integra `main`, pero
esta migración **no está aplicada en producción**. EPT-58 continúa En curso.

## Alcance y dependencia

B reemplaza exclusivamente la política SELECT de `public.perfiles` que daba
lectura global a Dirección y DOCENTE desde 005. La nueva política concede esa
lectura global únicamente a Dirección. Permanecen sin modificación «Perfil
propio», «Padres ven perfiles de sus hijos», INSERT/UPDATE, las tablas de
profesores, las funciones de A y las fichas e historial almacenados. No existe
superficie nueva de DELETE. La política usa `app_private.rol_actual()` para no
leer `perfiles` bajo su propio RLS, evitando la recursión `42P17`.

| Actor | Lectura directa de `perfiles` después de B |
|---|---|
| DIRECTOR | Todos |
| DOCENTE | Solo su propio perfil |
| PADRE | El propio y los hijos vinculados |
| ESTUDIANTE / PERSONAL | Solo el propio |
| Autenticado sin perfil | Ninguno |
| Anónimo | Sin privilegio SELECT |

La consulta `listar_estudiantes_para_gestion()` sigue ofreciendo solo id,
nombre, apellido y legajo al DIRECTOR y DOCENTE, con el mismo conjunto de
estudiantes que antes. Es la única fuente nueva de esas pantallas: Asistencias
y Cupos de la etapa 2 ya no dependen de leer perfiles ajenos directamente.

## Contrato y trazabilidad

La descripción aprobada de [EPT-58](https://grupo12-utn.atlassian.net/browse/EPT-58)
establece A → aplicación → B. La migración de esta etapa es
`supabase/migrations/20260926154000_ept_58_privacidad_perfiles.sql`, creada
con `supabase migration new`. No se editaron 001–A.

| Criterio | Evidencia exigida |
|---|---|
| CA-16 | `perfiles_privacidad_rls.sql`: catálogo y seis actores; `profesores_rls.sql` §8 |
| CA-17 | `perfiles_privacidad_rls.sql`: mismo conjunto por RPC; regresión autenticada de Asistencias/Cupos |
| CA-21 | Matriz SQL sin `42P17`, anónimo 42501, navegador por rol y regresión de las RPC de A |

El resto de los CA-01 a CA-15 y CA-18 a CA-20 se implementó en A o en la
aplicación; B no altera esos objetos. Se vuelven a ejecutar las regresiones
pertinentes antes de publicar.

## Plan de publicación — todavía NO ejecutado

1. Confirmar con usuarios de prueba en la **aplicación publicada de la etapa
   2**: DIRECTOR lista y modifica una ficha, DOCENTE ve sus asignaciones y
   horarios propios, y ambos gestionan Asistencias/Cupos con alumnos visibles.
   La respuesta HTTP pública y las pruebas locales **no sustituyen** este gate.
2. Revisar y mergear esta rama mediante una PR aprobada. Comprobar que
   `origin/main` contiene exactamente la migración revisada y que la
   aplicación publicada corresponde a esa versión o a una posterior.
3. Respaldar esquema e información pertinentes fuera del repositorio. Hacer
   preflight de solo lectura: historial remoto hasta A, B como **única**
   migración pendiente, políticas exactas de perfiles, conteos de fichas e
   historial, ausencia de deriva y asesores. No usar `--include-all`.
4. Solo entonces, con autorización puntual del usuario, aplicar **B** con
   `supabase db push --linked`. Verificar ledger, políticas, datos intactos,
   matriz de acceso con identidades de prueba, RPC mínima y recorridos reales
   posteriores. No usar cuentas personales en capturas ni registrar secretos.
5. Mantener EPT-58 En curso hasta completar el gate remoto. El cierre de Jira
   necesita verificar todos los CA y autorización expresa.

## Reversión sin pérdida de datos

Si B provoca una regresión, no se elimina ni edita la migración aplicada.
Preparar una **nueva migración compensatoria** que quite «Solo Dirección ve
todos los perfiles» y restituya temporalmente la política previa de 005 con
`('DIRECTOR', 'DOCENTE')`, tras evaluar el impacto de privacidad. Eso no toca
fichas, historial ni datos. Mantener la aplicación de etapa 2 mientras B esté
activa: volver primero a la aplicación anterior dejaría a DOCENTE sin alumnos
en Asistencias/Cupos. A nunca se revierte mediante DROP de tablas con datos.

## Verificación local

Los comandos deben correr exclusivamente contra el stack local descartable:

```powershell
npx.cmd supabase db reset --local
Get-Content -Raw supabase/tests/perfiles_privacidad_rls.sql | docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content -Raw supabase/tests/profesores_rls.sql | docker exec -i supabase_db_educar-para-transformar psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
node supabase/tests/profesores_postgrest.mjs
node supabase/tests/correr-autenticadas.mjs --reporter=line
npx.cmd tsc --noEmit --incremental false
npm run build
npx.cmd supabase db lint --local --level warning --fail-on error
git diff --check
```

**Resultados comprobados sobre A+B local:**

| Comprobación | Resultado |
|---|---|
| `supabase db reset --local` con la migración final B transaccional | Código 0; 001–A+B aplicadas |
| 13 archivos SQL en `supabase/tests/` | 13 con código 0; `usuarios_alta_atomica.sql` requiere `-U supabase_admin` según su cabecera; los otros 12, `-U postgres` |
| Matriz SQL nueva | B-01 a B-04 correctos: catálogo, seis actores, anónimo y RPC mínima |
| `profesores_rls.sql` | Código 0, incluida CA-16 con B; sin `42P17` |
| `profesores_postgrest.mjs` | Código 0, 44 afirmaciones con siete sesiones locales |
| `profesores_concurrencia.mjs` | Código 0, 7 carreras consistentes |
| `profesores_paridad.mjs` | Código 0, 748 textos |
| Playwright completo autenticado y de interfaz | Código 0: 662 aprobadas y 1 omitida, sin fallos |
| TypeScript y build de Next.js con URL/clave **públicas locales** | Código 0 cada uno |
| `supabase db lint --local --level warning --fail-on error` | Código 0, sin errores de esquema |
| ESLint global | Código 1: 15 errores y 108 advertencias, mismos totales de la línea base; B no modifica archivos JS/TS |
| `git diff --check` | Código 0 |

**Tipos generados.** B no cambia el esquema. El verificador
`tipos-generados.mjs` produjo dos salidas idénticas, pero devolvió código 1
al comparar bytes con `database.generated.ts` porque el worktree de Windows
tiene CRLF y la salida del CLI tiene LF. Se comprobó por separado que, tras
normalizar solo CRLF→LF, el archivo versionado es **idéntico byte a byte** a
`git show HEAD:src/types/database.generated.ts` y al hash de la salida
generada: `b4e918ae15c0840a78dae92d787c1be4672d4cbf513aa6b69c6e4bdd874a52d3`.
No se reescribieron los tipos ni se ocultó el código 1 del arnés.

**Asesores.** Seguridad: hallazgos previos sin objeto nuevo de B. Rendimiento:
la categoría `multiple_permissive_policies` sobre `perfiles` permanece porque
«Perfil propio», la lectura parental y la lectura de Dirección son tres
políticas permisivas, igual que antes de B; cambia solo el nombre de la
tercera. El aviso `auth_rls_initplan` de «Perfil propio» es previo a B.

**Incidencia de prueba, no regresión.** La primera ejecución masiva de SQL
invocó `usuarios_alta_atomica.sql` como `postgres` y recibió 42501 al asumir
`supabase_auth_admin`. Su propia cabecera exige `supabase_admin`; con ese
usuario terminó con código 0. La suite Playwright regeneró seis capturas
versionadas de EPT-13; se restauraron solamente esas capturas al terminar.

## Riesgos y límites

- Los permisos preexistentes de DOCENTE sobre asistencias/inscripciones no se
  amplían ni se corrigen aquí: corresponden a EPT-66.
- La migración restringe lectura; una aplicación anterior a etapa 2 no es
  compatible. Por eso el orden de despliegue es condición de seguridad y de
  funcionamiento, no una preferencia de proceso.
- B no crea una consulta por curso. La consulta mínima mantiene el mismo
  conjunto de estudiantes que Asistencias y Cupos ya mostraban.
- Los avisos de asesores y errores globales de lint existentes se informan
  distinguidos de regresiones de esta rama.
