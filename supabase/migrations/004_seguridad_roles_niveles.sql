-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Cierre de la escalada de privilegios (EPT-17)
-- ============================================================
-- Migración correctiva aditiva. No modifica 001, 002 ni 003.
--
-- Se agrega como migración nueva en lugar de editar `003_cursos.sql` porque el
-- proyecto Supabase que usa este repositorio no es alcanzable desde este
-- entorno, no existe ninguna base local ni tabla de historial de migraciones
-- que se pueda inspeccionar, y el flujo documentado del repositorio es aplicar
-- el SQL a mano en el editor de Supabase. En ese escenario no se puede probar
-- que `003` no haya sido aplicado, y un archivo de migración mutado divergiría
-- en silencio. Una migración hacia adelante es correcta en los dos casos.
--
-- ============================================================
-- QUÉ PROBLEMA CIERRA
-- ============================================================
-- La migración 001 dejó dos huecos que se combinan en una escalada de
-- privilegios completa:
--
--   1. `GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated` (001:312)
--      le dio a cualquier usuario autenticado TODOS los privilegios sobre
--      `public.roles`, incluido UPDATE.
--   2. `public.roles` nunca recibió RLS, así que no había ninguna política que
--      frenara esa escritura.
--
-- La autorización de cursos deriva el rol de `roles.nombre = 'DIRECTOR'`. Por
-- lo tanto, un ESTUDIANTE autenticado podía ejecutar
--
--     UPDATE public.roles SET nombre = 'DIRECTOR' WHERE nombre = 'ESTUDIANTE';
--
-- y a partir de ese momento `public.es_director_actual()` devolvía true para él
-- y para todos los estudiantes, habilitando la administración de cursos. El
-- control del servidor tampoco lo detenía, porque consulta exactamente la misma
-- fuente. La tabla del catálogo de roles tiene que ser de solo lectura para los
-- roles de aplicación.
--
-- El segundo arreglo es más chico: `003` revocó de `niveles` solo INSERT,
-- UPDATE, DELETE y TRUNCATE. `GRANT ALL` también incluye REFERENCES y TRIGGER,
-- que quedaron en pie y contradecían la afirmación de "solo lectura".
--
-- Ninguna de estas revocaciones rompe la aplicación: en todo el repositorio no
-- hay una sola escritura sobre `roles` ni sobre `niveles`. Solo hay lecturas,
-- directas (`roles.service.ts`, `inscripciones.service.ts`, `cursos.service.ts`)
-- y embebidas (`rol:roles(nombre)`, `nivel:niveles(nombre)`). La administración
-- privilegiada sigue funcionando porque `service_role` no está sujeto a RLS ni a
-- estas revocaciones.
-- ============================================================

-- ================================================================
-- 1. CATÁLOGO DE ROLES: SOLO LECTURA PARA LOS ROLES DE APLICACIÓN
-- ================================================================
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

-- Se parte de cero: `GRANT ALL` incluye SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES y TRIGGER. Revocar solo las de escritura habituales
-- dejaría REFERENCES y TRIGGER en pie.
REVOKE ALL ON public.roles FROM PUBLIC, anon, authenticated;

-- Lo único que la aplicación necesita es leer el catálogo.
GRANT SELECT ON public.roles TO authenticated;

DROP POLICY IF EXISTS "Roles visibles para usuarios autenticados" ON public.roles;
CREATE POLICY "Roles visibles para usuarios autenticados" ON public.roles
    FOR SELECT TO authenticated USING (true);

-- Sin política de escritura: RLS deniega INSERT, UPDATE y DELETE aunque alguien
-- volviera a otorgar el privilegio por error.

-- 001 también hizo `GRANT ALL ON ALL SEQUENCES ... TO authenticated`.
REVOKE ALL ON SEQUENCE public.roles_id_seq FROM PUBLIC, anon, authenticated;

-- ================================================================
-- 2. NIVELES: CERRAR REFERENCES Y TRIGGER RESIDUALES
-- ================================================================
-- `003` ya habilitó RLS y creó la política de lectura. Acá se completan los
-- privilegios y se reafirma todo de forma idempotente, para que el estado final
-- no dependa del orden en que se hayan aplicado las migraciones.
ALTER TABLE public.niveles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.niveles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.niveles TO authenticated;

DROP POLICY IF EXISTS "Niveles visibles para usuarios autenticados" ON public.niveles;
CREATE POLICY "Niveles visibles para usuarios autenticados" ON public.niveles
    FOR SELECT TO authenticated USING (true);

REVOKE ALL ON SEQUENCE public.niveles_id_seq FROM PUBLIC, anon, authenticated;

-- La administración completa de niveles sigue siendo una tarea aparte (EPT-55).
-- Esta migración no agrega políticas de escritura: cuando esa tarea se
-- implemente, deberá definir las suyas.

-- ================================================================
-- 3. CURSOS: REAFIRMAR LOS PRIVILEGIOS MÍNIMOS
-- ================================================================
-- `003` ya dejó cursos en el estado correcto. Se reafirma para que una base que
-- solo haya recibido 001 y 002 quede igual que una que recibió toda la cadena,
-- y para que el conjunto de privilegios quede explícito en un único lugar.
REVOKE ALL ON public.cursos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cursos TO authenticated;

-- Sin DELETE, sin TRUNCATE, sin REFERENCES, sin TRIGGER y sin nada para `anon`.
