-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Alta atómica de cuenta y perfil (EPT-9)
-- ============================================================
-- Migración aditiva. No modifica 001 a 009.
--
-- ============================================================
-- QUÉ PROBLEMA CIERRA
-- ============================================================
--
-- `POST /api/usuarios` creaba la cuenta en Auth y después, en una segunda
-- petición, insertaba el perfil por PostgREST. Eran dos confirmaciones
-- independientes. Cuando la segunda devolvía un error de transporte, la ruta
-- leía una vez por `user_id`, no encontraba nada y borraba la cuenta.
--
-- Esa lectura vacía no probaba nada: el INSERT podía seguir en vuelo y
-- confirmarse un instante después. El resultado era una cuenta borrada y un
-- perfil —con su legajo académico— huérfano, reservando para siempre un DNI y
-- un número de legajo. Se reprodujo con un intermediario que devuelve el error
-- antes de reenviar la escritura.
--
-- Ninguna combinación de lecturas desde fuera puede distinguir «todavía no
-- llegó» de «no va a llegar nunca». La única forma de eliminar el problema es
-- que no existan dos confirmaciones.
--
-- ============================================================
-- LA DECISIÓN
-- ============================================================
--
-- El perfil nace dentro de la MISMA transacción de PostgreSQL que crea la
-- cuenta. Se verificó sobre GoTrue v2.196.0 (la versión de la pila local):
--
--   * `auth.admin.createUser` ejecuta el INSERT en `auth.users` y las
--     actualizaciones posteriores —rol, `raw_app_meta_data`, confirmación del
--     correo— dentro de una sola transacción.
--   * Si un trigger lanza una excepción, GoTrue revierte todo y responde 500
--     `unexpected_failure`. No queda ni la cuenta ni su identidad.
--   * Dos altas con el mismo `id` se serializan por la clave primaria: la
--     segunda espera a que la primera termine y falla si la primera confirmó.
--
-- Por lo tanto la cuenta y el perfil se confirman juntos o no se confirma
-- ninguno. Esto sí es atomicidad: una sola transacción, no una compensación.
-- La ruta ya no borra cuentas en ningún camino.
--
-- La pauta de usar un trigger sobre `auth.users` para crear el perfil está
-- documentada por Supabase («Managing user data»), y la restricción de abril
-- de 2025 sobre los esquemas `auth`, `storage` y `realtime` permite
-- expresamente crear triggers sobre `auth.users`; lo que prohíbe es crear
-- tablas o funciones dentro de esos esquemas. La función vive en `app_private`.
--
-- ============================================================
-- SEGURIDAD: POR QUÉ `raw_app_meta_data` Y NUNCA `raw_user_meta_data`
-- ============================================================
--
-- `raw_user_meta_data` lo escribe cualquiera: el autorregistro público manda
-- `options.data` ahí, y un usuario puede modificar el suyo. Se comprobó que un
-- `signUp` anónimo con `{ ept_alta: … }` lo deja en `raw_user_meta_data`. Si el
-- trigger leyera ese campo, cualquier visitante podría fabricarse un perfil con
-- el rol que quisiera.
--
-- `raw_app_meta_data` solo lo escribe la API administrativa de GoTrue, que exige
-- la clave `service_role`. Ni `anon`, ni `authenticated`, ni `service_role`
-- tienen UPDATE sobre `auth.users` por SQL. El mismo `signUp` anónimo no logra
-- escribir ahí.
--
-- La clave `ept_alta` se retira de la fila antes de escribirla. Los datos
-- personales no quedan en `auth.users` ni viajan en el JWT (`app_metadata`).
--
-- ============================================================
-- LÍMITES QUE CONVIENE DECIR
-- ============================================================
--
-- * La atomicidad cubre la cuenta y el perfil. No cubre la respuesta HTTP: si
--   la respuesta de GoTrue se pierde, la ruta no sabe si la transacción
--   confirmó. Lo que sí sabe es que no hay un estado intermedio, y que un
--   reintento con el mismo `id` es seguro. Ver `src/app/api/usuarios/route.ts`.
-- * GoTrue oculta la causa del rechazo detrás de «Database error creating new
--   user». La ruta vuelve a consultar el DNI y el legajo para explicar un
--   duplicado; los demás rechazos se informan con una referencia.
-- * El trigger depende de que GoTrue escriba `raw_app_meta_data` dentro de la
--   transacción de alta. Si una versión futura lo moviera fuera, el alta
--   dejaría de crear el perfil y la ruta lo detectaría como estado
--   inconsistente, sin borrar nada. `supabase/tests/usuarios_alta_atomica.sql`
--   y `supabase/tests/usuarios_reconciliacion.mjs` lo verifican contra la pila.
-- ============================================================


-- ================================================================
-- 1. LA FUNCIÓN QUE CREA EL PERFIL DENTRO DE LA TRANSACCIÓN DE ALTA
-- ================================================================
-- Errores propios:
--   P5520  el pedido de alta no respeta el contrato del objeto `ept_alta`.
--   P5521  la cuenta ya tiene un perfil con otros datos.
-- Nunca llegan al navegador: GoTrue los reemplaza por un error genérico y la
-- ruta los traduce a mensajes de dominio.
CREATE OR REPLACE FUNCTION app_private.registrar_perfil_de_alta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_alta      JSONB;
    v_clave     TEXT;
    v_rol_id    INTEGER;
    v_existente RECORD;
BEGIN
    v_alta := NEW.raw_app_meta_data -> 'ept_alta';

    -- Primero se retira la clave, pase lo que pase después: los datos
    -- personales no se persisten en `auth.users` ni en el JWT.
    NEW.raw_app_meta_data := NEW.raw_app_meta_data - 'ept_alta';

    -- Contrato exacto del objeto. Una clave desconocida o un tipo distinto es
    -- un error de programación, y se rechaza en lugar de ignorarse.
    IF pg_catalog.jsonb_typeof(v_alta) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5520',
            MESSAGE = 'El pedido de alta no trae un perfil con el formato esperado.';
    END IF;

    FOR v_clave IN SELECT pg_catalog.jsonb_object_keys(v_alta) LOOP
        IF v_clave <> ALL (ARRAY[
            'nombre', 'apellido', 'dni', 'rol_id', 'telefono', 'direccion', 'legajo_nro'
        ]) THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5520',
                MESSAGE = 'El pedido de alta trae un dato que el perfil no admite.';
        END IF;
    END LOOP;

    IF pg_catalog.jsonb_typeof(v_alta -> 'nombre') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_alta -> 'apellido') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_alta -> 'dni') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_alta -> 'rol_id') IS DISTINCT FROM 'number'
       OR COALESCE(pg_catalog.jsonb_typeof(v_alta -> 'telefono'), 'null') NOT IN ('string', 'null')
       OR COALESCE(pg_catalog.jsonb_typeof(v_alta -> 'direccion'), 'null') NOT IN ('string', 'null')
       OR COALESCE(pg_catalog.jsonb_typeof(v_alta -> 'legajo_nro'), 'null') NOT IN ('string', 'null')
    THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5520',
            MESSAGE = 'El pedido de alta trae un dato con un tipo que el perfil no admite.';
    END IF;

    v_rol_id := (v_alta ->> 'rol_id')::INTEGER;

    -- Una cuenta tiene como máximo un perfil (`perfiles.user_id` es UNIQUE).
    -- Si ya lo tiene con exactamente los mismos datos, no hay nada que hacer:
    -- es el mismo alta que vuelve a pasar por acá. Con otros datos, se rechaza
    -- y la transacción entera se revierte; nunca se pisa un perfil existente.
    SELECT p.nombre, p.apellido, p.dni, p.rol_id, p.telefono, p.direccion, p.legajo_nro
    INTO v_existente
    FROM public.perfiles p
    WHERE p.user_id = NEW.id;

    IF FOUND THEN
        IF v_existente.nombre = v_alta ->> 'nombre'
           AND v_existente.apellido = v_alta ->> 'apellido'
           AND v_existente.dni = v_alta ->> 'dni'
           AND v_existente.rol_id IS NOT DISTINCT FROM v_rol_id
           AND v_existente.telefono IS NOT DISTINCT FROM NULLIF(v_alta ->> 'telefono', '')
           AND v_existente.direccion IS NOT DISTINCT FROM NULLIF(v_alta ->> 'direccion', '')
           AND v_existente.legajo_nro IS NOT DISTINCT FROM NULLIF(v_alta ->> 'legajo_nro', '')
        THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION USING
            ERRCODE = 'P5521',
            MESSAGE = 'La cuenta ya tiene un perfil registrado con otros datos.';
    END IF;

    -- Las restricciones de `perfiles` (DNI y legajo válidos y únicos, rol
    -- existente) y el trigger de 008 que crea la fila de `alumnos` corren acá
    -- adentro. Cualquier rechazo revierte también la cuenta.
    INSERT INTO public.perfiles (
        user_id, nombre, apellido, dni, rol_id, telefono, direccion, legajo_nro
    )
    VALUES (
        NEW.id,
        v_alta ->> 'nombre',
        v_alta ->> 'apellido',
        v_alta ->> 'dni',
        v_rol_id,
        NULLIF(v_alta ->> 'telefono', ''),
        NULLIF(v_alta ->> 'direccion', ''),
        NULLIF(v_alta ->> 'legajo_nro', '')
    );

    RETURN NEW;
END;
$$;

-- Un trigger no necesita EXECUTE para dispararse. Nadie tiene por qué poder
-- invocar esta función directamente.
REVOKE ALL ON FUNCTION app_private.registrar_perfil_de_alta()
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 2. EL TRIGGER SOBRE `auth.users`
-- ================================================================
-- BEFORE, para poder retirar la clave de la fila antes de escribirla.
--
-- INSERT y UPDATE de `raw_app_meta_data`: la versión verificada de GoTrue
-- agrega el `app_metadata` del administrador con un UPDATE posterior al INSERT,
-- dentro de la misma transacción. Se cubre también el INSERT para que una
-- versión que lo escriba desde el principio siga funcionando igual.
--
-- La condición WHEN mantiene el costo en cero para cualquier otra escritura en
-- `auth.users`: inicios de sesión, confirmaciones o altas públicas.
DROP TRIGGER IF EXISTS registrar_perfil_al_crear_cuenta ON auth.users;

CREATE TRIGGER registrar_perfil_al_crear_cuenta
    BEFORE INSERT OR UPDATE OF raw_app_meta_data ON auth.users
    FOR EACH ROW
    WHEN (NEW.raw_app_meta_data ? 'ept_alta')
    EXECUTE FUNCTION app_private.registrar_perfil_de_alta();


-- ================================================================
-- 3. AUTOVERIFICACIÓN
-- ================================================================
-- No escribe datos: comprueba que lo que se acaba de crear tiene las
-- propiedades de seguridad de las que depende el razonamiento de arriba. Las
-- pruebas de comportamiento viven en `supabase/tests/usuarios_alta_atomica.sql`.
DO $$
DECLARE
    v_config TEXT[];
BEGIN
    SELECT p.proconfig INTO v_config
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private' AND p.proname = 'registrar_perfil_de_alta';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Autoverificación 010: no se creó app_private.registrar_perfil_de_alta.';
    END IF;

    IF v_config IS DISTINCT FROM ARRAY['search_path=""'] THEN
        RAISE EXCEPTION
            'Autoverificación 010: la función debe fijar search_path vacío y fija %.', v_config;
    END IF;

    IF pg_catalog.has_function_privilege('anon', 'app_private.registrar_perfil_de_alta()', 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', 'app_private.registrar_perfil_de_alta()', 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', 'app_private.registrar_perfil_de_alta()', 'EXECUTE')
    THEN
        RAISE EXCEPTION 'Autoverificación 010: un rol de aplicación puede invocar la función.';
    END IF;

    -- La premisa de seguridad: ningún rol de aplicación escribe `auth.users`
    -- por SQL, de modo que `raw_app_meta_data` solo llega por la API
    -- administrativa de GoTrue.
    IF pg_catalog.has_table_privilege('anon', 'auth.users', 'INSERT, UPDATE')
       OR pg_catalog.has_table_privilege('authenticated', 'auth.users', 'INSERT, UPDATE')
       OR pg_catalog.has_table_privilege('service_role', 'auth.users', 'INSERT, UPDATE')
    THEN
        RAISE EXCEPTION
            'Autoverificación 010: un rol de aplicación puede escribir auth.users; el trigger no sería una frontera segura.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'auth.users'::regclass
          AND t.tgname = 'registrar_perfil_al_crear_cuenta'
          AND NOT t.tgisinternal
          AND t.tgenabled = 'O'
    ) THEN
        RAISE EXCEPTION 'Autoverificación 010: el trigger no quedó habilitado sobre auth.users.';
    END IF;
END;
$$;
