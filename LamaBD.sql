-- Extensiones para UUID y seguridad
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ROLES DE USUARIO (Basado en requerimientos del TP)
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) UNIQUE NOT NULL -- 'DIRECTOR', 'DOCENTE', 'PADRE', 'ESTUDIANTE', 'PERSONAL'
);

-- 2. PERFILES (Información de Legajos) [cite: 305]
CREATE TABLE perfiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE, -- Relación con Auth de Supabase
    rol_id INTEGER REFERENCES roles(id),
    nombre VARCHAR(100) NOT NULL,
    apellido VARCHAR(100) NOT NULL,
    dni VARCHAR(20) UNIQUE NOT NULL,
    direccion TEXT,
    telefono VARCHAR(20),
    legajo_nro VARCHAR(50) UNIQUE, -- Para docentes y alumnos [cite: 301, 305]
    fecha_nacimiento DATE,
    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. NIVELES EDUCATIVOS [cite: 90, 92, 93, 94]
CREATE TABLE niveles (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL -- 'INICIAL', 'PRIMARIO', 'SECUNDARIO'
);

-- 4. MATERIAS Y DEPORTES (Gestión de Cupos) [cite: 111, 300, 307]
CREATE TABLE actividades (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL, -- Ej: 'Natación', 'Fútbol', 'Inglés'
    tipo VARCHAR(50), -- 'CURRICULAR', 'DEPORTE', 'TALLER'
    cupo_maximo INTEGER DEFAULT 30,
    nivel_id INTEGER REFERENCES niveles(id)
);

-- 5. INSCRIPCIONES (Capa de Lógica de Cupos) [cite: 300]
CREATE TABLE inscripciones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    estudiante_id UUID REFERENCES perfiles(id),
    actividad_id INTEGER REFERENCES actividades(id),
    fecha_inscripcion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    estado VARCHAR(20) DEFAULT 'ACTIVO' -- 'ACTIVO', 'BAJA'
);

-- 6. ASISTENCIAS (Para cálculo de %) [cite: 299, 306]
CREATE TABLE asistencias (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    estudiante_id UUID REFERENCES perfiles(id),
    fecha DATE DEFAULT CURRENT_DATE,
    estado VARCHAR(20) NOT NULL, -- 'PRESENTE', 'AUSENTE', 'JUSTIFICADO'
    docente_id UUID REFERENCES perfiles(id)
);

-- 7. SOLICITUDES DE INSCRIPCIÓN WEB (Formulario inicial) [cite: 198, 289]
CREATE TABLE solicitudes_inscripcion (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    datos_aspirante JSONB NOT NULL, -- Nombre, nivel, contacto
    estado VARCHAR(20) DEFAULT 'PENDIENTE', -- 'PENDIENTE', 'REVISADO', 'ACEPTADO'
    fecha_solicitud TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. CONTENIDO WEB (Secciones de la página) [cite: 189, 196, 307]
CREATE TABLE noticias (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(200) NOT NULL,
    contenido TEXT NOT NULL,
    imagen_url TEXT,
    fecha_publicacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE menu_escolar (
    id SERIAL PRIMARY KEY,
    dia_semana VARCHAR(20),
    descripcion TEXT, -- Detalle del menú diario [cite: 307]
    fecha_vigencia DATE
);

CREATE TABLE opiniones (
    id SERIAL PRIMARY KEY,
    nombre_usuario VARCHAR(100) DEFAULT 'Anónimo',
    comentario TEXT NOT NULL,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW() -- No requiere login [cite: 188]
);

-- 9. GALERÍA DE IMÁGENES [cite: 189]
CREATE TABLE galeria (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    descripcion VARCHAR(255),
    categoria VARCHAR(50) -- 'INSTALACIONES', 'EVENTOS'
);