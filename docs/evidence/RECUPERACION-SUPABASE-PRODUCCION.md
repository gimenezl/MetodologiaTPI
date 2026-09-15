# Recuperación de Supabase de producción

## Estado

**Candidato listo para revisión; producción permanece sin cambios.**

Este documento define y prueba la reconciliación necesaria para llevar el
proyecto `ycvrpmrogvjnntnoosbh` desde su esquema histórico hasta las migraciones
canónicas `001`–`011`. Ningún comando de mutación remota fue ejecutado durante
la preparación de este candidato.

## Alcance y exclusiones

- Se incorporan de forma canónica `public.padres_hijos` y
  `public.opiniones.aprobado`, ya existentes en producción.
- Se eliminan políticas `ALL`, funciones privilegiadas expuestas y grants
  amplios encontrados en el remoto.
- Se preservan todas las filas históricas, incluidas las relaciones familiares,
  opiniones y actividades duplicadas.
- Se agrega un procedimiento controlado para el único punto que no puede
  aplicar el runner normal: la migración `008` sobre perfiles existentes.
- No se implementa EPT-56. Después de esta reconciliación, EPT-56 debe comenzar
  en la migración `012`.

## Línea base e identidad

- Repositorio: `gimenezl/MetodologiaTPI`.
- Rama de recuperación: `codex/db-production-recovery`.
- Línea base: `8926ea96ec2ae001d329305045e92b8f6ade1caa`.
- Worktree exclusivo: `E:/Escritorio/codigo/MetodologiaTPI-db-recovery`.
- Proyecto remoto: `ycvrpmrogvjnntnoosbh`.
- Perfil de CLI: predeterminado, autenticado con acceso al proyecto objetivo.
- El checkout original no fue limpiado, actualizado ni utilizado para editar.

## Respaldo de preflight

Directorio local protegido:

`E:/Escritorio/codigo/MetodologiaTPI-db-backups/20260914-235344`

| Archivo | Bytes | SHA-256 |
| --- | ---: | --- |
| `schema.sql` | 32.028 | `4F7AA4B8685AE3D4C1485D80447ED08AFB9D0396624B677C80C975C0FB8DF94F` |
| `roles.sql` | 358 | `4350A72B5EC109888E740C17F3EB4DA2FCD95AB73AF26499538ED0BF615DB543` |
| `data.sql` | 40.018 | `2CAD16B7A12B9D1F3096139F502C4D38DAD8964B66EE0E090931129C05580914` |

`data.sql` contiene información sensible de `auth`, `public` y `storage`. No se
versiona ni debe compartirse. La ACL del directorio permite acceso únicamente
al usuario local y a `SYSTEM`.

## Ledger remoto recuperado

Producción registra siete migraciones incrementales que no estaban en Git. Sus
archivos se conservaron únicamente dentro del respaldo protegido.

| Versión | SHA-256 |
| --- | --- |
| `20260618220833` | `FC711644C0C2FDC1B2D1148CFD54ED3DFA88A7F7B21B518070228822DC132EF7` |
| `20260618223803` | `B46A3AA4088C326FBEA0342202288C5F3CDF0A0E986A7B4BA7C49E6701B12323` |
| `20260619030640` | `EFE2A8FBF087A9C0FB3C9DC9AAA948AB705BB28B62B8D195562448B55C237365` |
| `20260619031241` | `428618DE912AFC0EC740ED1867CCF9036F2422A20C1A44F932458B27FE6993C2` |
| `20260619032638` | `5D885051DF668B255CD547EB59640BA7AFAEBE585FB0430FC7079F2D9970E799` |
| `20260619032842` | `A2977A2B6F1C60FDA04A1F1EAE0E2F884480F48BEFDC276885EB82832F966256` |
| `20260619145152` | `C80DE251A70B3C3B9E8A160D965980CF7EEA0505FE172DBB1533CDD8E519652F` |

El esquema remoto contiene estructuralmente `001` y `002`, pero esas versiones
nunca se registraron. Los siete cambios anteriores son posteriores y no son
equivalentes a `001`/`002`.

## Inventario sin datos personales

Antes del ensayo: 5 roles, 12 perfiles, 3 niveles, 22 actividades, 4
inscripciones, 20 asistencias, 4 opiniones, 4 vínculos familiares y 3
postulaciones. Había 3 opiniones aprobadas y 7 grupos de actividades duplicadas
por tipo, nivel y nombre normalizado.

Después de aplicar `003`–`011`: todos esos conteos permanecieron iguales. Se
agregaron 5 filas académicas `alumnos` en estado inicial coherente y 0
matrículas, sin inventar cursos ni legajos. No se fusionó ni eliminó ninguna
actividad duplicada.

## Causa y tratamiento especial de `008`

La migración publicada
`supabase/migrations/008_alumnos_estado_academico.sql` tiene SHA-256
`006E7ADF87228172BA80CAEC4DF42AFC1D14BCC9C9DE7A8CB2560D706B4CDFE1`.
Se mantiene INMUTABLE.

Sobre una base poblada, `008` crea triggers de constraint
`DEFERRABLE INITIALLY DEFERRED` y luego incorpora los perfiles ESTUDIANTE en
`public.alumnos`. Esos inserts dejan eventos pendientes. Más adelante, dentro
de la misma transacción, ejecuta:

```sql
ALTER TABLE public.alumnos ENABLE ROW LEVEL SECURITY;
```

PostgreSQL lo rechaza con SQLSTATE `55006`:

```text
cannot ALTER TABLE "alumnos" because it has pending trigger events
```

En una base limpia no aparece porque el backfill inserta cero filas. Por eso un
reset limpio no demostró que el push remoto fuera aplicable.

La solución operacional NO cambia `008`: genera una copia auditada que agrega
`BEGIN`, `SET CONSTRAINTS ALL IMMEDIATE` inmediatamente antes del primer
`ALTER TABLE public.alumnos`, y `COMMIT`. Su SHA-256 determinista es:

`53A0E2D0BC8FA626A35C8705DB1C1B77C57E2C02873159E2A300B0C5B6C1600D`

El script versionado
`supabase/recovery/Preparar-RecuperacionProduccion.ps1` verifica los hashes de
`001`–`011`, prepara un workdir limitado a `001`–`007` y genera el derivado. No
se conecta a ninguna base y falla cerrado ante cualquier byte inesperado.

## Migración `011`

`011_reconciliacion_esquema_remoto.sql`:

SHA-256: `F010EFD7983F7211649931FED478B31F8C18C252B49422399CAB295F717099D1`.

- crea o valida `padres_hijos`, sus FKs, PK, check e índice inverso;
- crea `opiniones.aprobado` solo cuando falta y preserva los estados remotos;
- mueve `mis_hijos_ids()` a `app_private` con `search_path = ''`;
- elimina las funciones SECURITY DEFINER históricas del esquema expuesto;
- retira políticas `ALL` y grants residuales;
- limita `actividades` a SELECT y UPDATE de `cupo_maximo` para staff;
- limita el INSERT público de opiniones a nombre y comentario;
- permite a DIRECTOR editar únicamente datos personales del perfil, sin
  cambiar `id`, `user_id` ni `rol_id`; el cambio de rol queda para EPT-59 y su
  transición atómica con `alumnos`;
- conserva las reglas funcionales remotas de asistencias, inscripciones,
  moderación y vínculos familiares;
- autoverifica privilegios y preservación de conteos.

La eliminación física de actividades quedó denegada. También se retiró el botón
de borrado de la pantalla de cupos para no ofrecer una acción que la base rechaza
y que eliminaba inscripciones en cascada. EPT-56 definirá la baja lógica de las
materias sin reabrir ese borrado.

## Ensayo 1: base limpia

```powershell
npx.cmd supabase db reset --local --no-seed
```

Resultado: código `0`; aplicó `001`–`011`.

| Verificación | Resultado |
| --- | --- |
| Reconciliación 011 | 42 avisos `OK`, código 0 |
| Cursos | 39 avisos `OK`, código 0 |
| Niveles | 73 avisos `OK`, código 0 |
| Alumnos | 69 avisos `OK`, código 0 |
| Alta atómica/Auth | 23 avisos `OK`, código 0 |

La suite Auth debe ejecutarse como `supabase_admin`; ejecutarla como `postgres`
falla correctamente al intentar `SET ROLE supabase_auth_admin`, porque el rol
local `postgres` no es miembro. Esto es una condición del arnés, no del producto.

## Ensayo 2: copia representativa del remoto

El segundo ensayo reconstruyó `001`/`002`, aplicó en orden los siete archivos
remotos y los objetos observados en el dump, vació la semilla local y restauró
el `data.sql` protegido. Luego simuló exactamente el ledger remoto.

1. Se reparó el ledger simulado a `001`/`002` canónico.
2. Un workdir acotado aplicó solamente `003`–`007`.
3. El `008` original reprodujo SQLSTATE `55006` en un ensayo separado.
4. El derivado auditado aplicó completo dentro de una transacción.
5. Se registró `008` y el runner aplicó `009`–`011` normalmente.
6. `migration list` terminó con coincidencia exacta `001`–`011`.

Resultado sobre datos restaurados:

| Verificación | Resultado |
| --- | --- |
| Preservación de conteos remotos | PASS |
| Reconciliación 011 | 42 avisos `OK`, código 0 |
| Cursos | 39 avisos `OK`, código 0 |
| Niveles | 73 avisos `OK`, código 0 |
| Alumnos | 69 avisos `OK`, código 0 |
| Alta atómica/Auth | 23 avisos `OK`, código 0 |
| Concurrencia de Niveles | 4 escenarios, código 0 |
| Concurrencia de Alumnos | 8 escenarios, código 0 |
| Colisiones de migración 009 | PASS, código 0 |
| Tipos generados | dos generaciones deterministas y diff 0 |
| `supabase db lint` | sin errores, código 0 |
| Advisor de seguridad | 4 warnings preexistentes, ninguno de 011 |
| Advisor de rendimiento | 7 hallazgos en el ensayo usado, ninguno nuevo de 011 |

Los cuatro warnings de seguridad restantes corresponden a dos funciones
históricas con `search_path` mutable y a los formularios públicos de
postulaciones/solicitudes con `WITH CHECK (true)`. No se amplió su superficie.

## Verificación de la aplicación

| Verificación | Resultado |
| --- | --- |
| `git diff --check` | código 0 |
| TypeScript | código 0 |
| ESLint focalizado | código 0; una advertencia preexistente del compilador React |
| Build de Next.js con variables públicas de relleno | código 0; 20 páginas generadas |
| Usuarios con Auth y PostgreSQL reales | 62 pruebas correctas, código 0 |

La primera corrida autenticada detectó que el formulario de alta y el modal de
edición reutilizaban identificadores HTML. El navegador asociaba ambas etiquetas
al primer control y el modal enviaba el valor anterior aunque mostrara éxito. Se
asignaron identificadores únicos al modal y la corrida completa posterior quedó
en verde, incluyendo persistencia directa verificada en PostgreSQL.

La edición de Usuarios y Legajos muestra el rol como dato de solo lectura. El
servicio filtra una lista explícita de campos personales y la base deniega
`rol_id` incluso al DIRECTOR. Las pruebas autenticadas confirman que un DOCENTE
no puede convertirse en ESTUDIANTE y que un ESTUDIANTE no puede convertirse en
DOCENTE; `public.alumnos` permanece coherente en ambos intentos.

## Procedimiento remoto propuesto

Este procedimiento está DOCUMENTADO, no ejecutado. Requiere una autorización
separada inmediatamente antes del primer cambio remoto.

### Fase A — reversible: identidad, respaldo y ledger

1. Con el perfil predeterminado de la CLI, confirmar que `projects list` muestra
   exactamente `ycvrpmrogvjnntnoosbh` como `linked: true`, que
   `supabase/.temp/project-ref` contiene esa misma referencia y que
   `migration list` todavía muestra únicamente las siete versiones históricas.
   Esta comprobación se repite antes de cada fase; no se usa el perfil roto
   `ept-production`.
2. Crear un respaldo fresco de schema, roles y datos; aplicar ACL restrictiva y
   calcular SHA-256 antes de continuar.
3. Preparar el paquete sin conexión remota:

```powershell
$paquete = "E:\Escritorio\codigo\MetodologiaTPI-db-operacion-$(Get-Date -Format yyyyMMdd-HHmmss)"
.\supabase\recovery\Preparar-RecuperacionProduccion.ps1 -DirectorioSalida $paquete
```

4. Registrar `001` y `002` como aplicadas. Retirar del ledger las siete
   versiones históricas usando como `--workdir` su copia protegida. Esto modifica
   solo el historial, no el esquema.
5. Ejecutar `db push --dry-run` contra el workdir `fase-1-003-a-007`. Debe listar
   exactamente `003`–`007`. Cualquier otra versión o diferencia detiene el plan.

Hasta este punto el ledger se puede restaurar marcando `001`/`002` como
`reverted` y las siete versiones históricas como `applied`.

### Fase B — cambios de esquema: recuperación por respaldo

6. Aplicar `003`–`007` desde el workdir acotado. El runner registra sus versiones.
7. Verificar nuevamente conteos e invariantes.
8. Ejecutar el derivado `008` con `psql`, `ON_ERROR_STOP=1` y contraseña pedida
   de forma oculta. No usar `supabase db query`: CLI 2.117.0 rechaza el archivo
   multi-sentencia con `cannot insert multiple commands into a prepared statement`.
9. Solo si `psql` devuelve código `0`, marcar `008` como `applied`.
10. Ejecutar un dry-run desde el repositorio normal. Debe listar exclusivamente
    `009`, `010` y `011`.
11. Aplicar esas tres migraciones con el runner normal.
12. Verificar `migration list`, conteos, funciones, RLS, grants y tipos.
13. Ejecutar smoke tests autenticados de Niveles, Cursos y Alumnos.

Desde el paso 6 no existe un down automático confiable. Ante una falla se debe
detener el tráfico de escritura, conservar logs y restaurar el respaldo/PITR;
NO se deben editar migraciones publicadas ni borrar objetos manualmente a ciegas.

## Comandos remotos de referencia

Los comandos siguientes no deben copiarse parcialmente. Deben ejecutarse desde
el worktree de recuperación y únicamente tras la autorización final.

```powershell
$ref = 'ycvrpmrogvjnntnoosbh'
$historico = 'E:\Escritorio\codigo\MetodologiaTPI-db-backups\20260914-235344\remote-ledger-fetch'

function Confirmar-ProyectoObjetivo {
  $salida = & npx.cmd supabase projects list --output-format json
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar la cuenta predeterminada de Supabase.' }
  $respuesta = $salida | ConvertFrom-Json
  $proyectos = @($respuesta.projects | Where-Object { $_.id -eq $ref })
  if ($proyectos.Count -ne 1 -or -not $proyectos[0].linked) {
    throw 'El proyecto objetivo no aparece exactamente una vez y vinculado en projects list.'
  }
  $vinculo = (Get-Content .\supabase\.temp\project-ref -Raw).Trim()
  if ($vinculo -ne $ref) { throw 'El vínculo local no coincide con el proyecto objetivo.' }
}

Confirmar-ProyectoObjetivo # Fase A: ledger
npx.cmd supabase migration repair 001 002 --status applied --project-ref $ref
if ($LASTEXITCODE -ne 0) { throw 'Falló el registro de 001/002; detener la fase A.' }
npx.cmd supabase migration repair 20260618220833 20260618223803 20260619030640 20260619031241 20260619032638 20260619032842 20260619145152 --status reverted --project-ref $ref --workdir $historico
if ($LASTEXITCODE -ne 0) { throw 'Falló el retiro del ledger histórico; restaurar el ledger.' }

Confirmar-ProyectoObjetivo # Fase B.1: migraciones 003–007
npx.cmd supabase db push --dry-run --project-ref $ref --workdir (Join-Path $paquete 'fase-1-003-a-007')
if ($LASTEXITCODE -ne 0) { throw 'Falló el dry-run de 003–007; no aplicar.' }
npx.cmd supabase migration up --project-ref $ref --workdir (Join-Path $paquete 'fase-1-003-a-007')
if ($LASTEXITCODE -ne 0) { throw 'Falló la aplicación de 003–007; detener y evaluar restauración.' }
```

Para `008`, el archivo se pasa por stdin al cliente PostgreSQL del contenedor.
La contraseña solo vive en el entorno durante ese bloque:

```powershell
Confirmar-ProyectoObjetivo # Fase B.2: migración operacional 008
$archivo008 = Join-Path $paquete '008_alumnos_estado_academico_operacional.sql'
$hash008 = (Get-FileHash $archivo008 -Algorithm SHA256).Hash
if ($hash008 -ne '53A0E2D0BC8FA626A35C8705DB1C1B77C57E2C02873159E2A300B0C5B6C1600D') {
  throw 'El hash del derivado 008 no coincide; no continuar.'
}
$url = (Get-Content .\supabase\.temp\pooler-url -Raw).Trim()
$env:PGPASSWORD = Read-Host 'Contraseña PostgreSQL' -MaskInput
try {
  Get-Content -Raw $archivo008 |
    docker run --rm -i -e PGPASSWORD postgres:17-alpine `
      psql $url -v ON_ERROR_STOP=1
  $codigoPsql = $LASTEXITCODE
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

if ($codigoPsql -ne 0) { throw '008 falló: no reparar el ledger ni continuar.' }
npx.cmd supabase migration repair 008 --status applied --project-ref $ref
if ($LASTEXITCODE -ne 0) { throw 'No se pudo registrar 008; no continuar.' }

Confirmar-ProyectoObjetivo # Fase B.3: migraciones 009–011
npx.cmd supabase db push --dry-run --project-ref $ref
if ($LASTEXITCODE -ne 0) { throw 'Falló el dry-run de 009–011; no aplicar.' }
npx.cmd supabase migration up --project-ref $ref
if ($LASTEXITCODE -ne 0) { throw 'Falló la aplicación de 009–011; detener y evaluar restauración.' }
```

Antes de reparar `008` se debe comprobar además que el SHA-256 del archivo es
exactamente el documentado. Después de la ejecución se debe registrar el código
de salida, nunca la contraseña ni la URL completa.

## Rollback y puntos de decisión

| Punto | Reversibilidad |
| --- | --- |
| Preparar paquete, backups y dry-runs | Total; no toca producción |
| Reparar ledger antes de `003` | Reversible con estados opuestos |
| Aplicar `003`–`007` | No tiene down automático; restauración/PITR |
| Ejecutar derivado `008` | Atómico: error revierte toda 008 |
| Reparar ledger de `008` | Reversible solo mientras el esquema 008 permanezca aplicado |
| Aplicar `009`–`011` | No tiene down automático; restauración/PITR |

## Riesgos abiertos

- Las 22 actividades remotas contienen 7 grupos duplicados normalizados. EPT-56
  debe resolver su identidad antes de agregar unicidad.
- `calcular_porcentaje_asistencia` y `verificar_cupo_actividad` conservan
  `search_path` mutable; son deuda previa para EPT-66.
- Los formularios públicos de solicitudes y postulaciones conservan políticas
  de alta abierta por requisito existente; requieren controles antiabuso fuera
  de esta reconciliación.
- La lectura global de inscripciones para calcular cupos y sus políticas
  permisivas múltiples son deuda previa de rendimiento/privacidad.
- El procedimiento remoto sigue bloqueado hasta una autorización explícita y un
  backup fresco inmediatamente anterior.

## Definition of Done de la recuperación

- [x] Identidad y enlace verificados.
- [x] Backups y hashes existentes.
- [x] Siete migraciones remotas recuperadas y hasheadas.
- [x] Migración 011 aditiva, fail-closed y sin pérdida.
- [x] Error 55006 reproducido y explicado.
- [x] Derivado 008 determinista, transaccional y probado.
- [x] Base limpia `001`–`011` verificada.
- [x] Copia representativa del remoto `003`–`011` verificada.
- [x] SQL, concurrencia, tipos, lint y advisors ejecutados.
- [ ] Autorización final para mutar producción.
- [ ] Backup fresco inmediatamente anterior.
- [ ] Ejecución remota y smoke tests de producción.
