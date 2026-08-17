/* =========================================================
   db.js — Conexión a MySQL, esquema, usuarios y mapeos
   ========================================================= */

const fs = require('fs');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const CONFIG = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'auditoria_db'
};

/* ---------- Configuración TLS (requerida por MySQL en la nube, p. ej. Aiven) ---------- */
function configurarSSL() {
    // Si indicas DB_SSL_CA, se verifica contra el certificado de Aiven (descárgalo del console).
    const rutaCA = process.env.DB_SSL_CA;
    if (rutaCA) {
        try {
            return { ca: fs.readFileSync(rutaCA) };
        } catch (e) {
            console.warn(`[db] No se pudo leer DB_SSL_CA (${rutaCA}): ${e.message}`);
        }
    }
    // DB_SSL=true cifra la conexión sin verificar el certificado (suficiente para Aiven).
    if (process.env.DB_SSL === 'true' || process.env.DB_SSL === '1') {
        return { rejectUnauthorized: false };
    }
    return undefined;
}

const SSL = configurarSSL();

// Solo se permiten caracteres seguros en el nombre de la base de datos.
const NOMBRE_DB = CONFIG.database.replace(/[^A-Za-z0-9_]/g, '');

const ESQUEMA = [
    `CREATE TABLE IF NOT EXISTS areas (
        id VARCHAR(40) PRIMARY KEY,
        nombre VARCHAR(80) NOT NULL,
        descripcion TEXT,
        fecha_creacion DATETIME NOT NULL,
        estado VARCHAR(20) NOT NULL DEFAULT 'activo'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS productos (
        id VARCHAR(40) PRIMARY KEY,
        area_id VARCHAR(40) NOT NULL,
        nombre VARCHAR(100) NOT NULL,
        codigo VARCHAR(50) NOT NULL,
        unidad VARCHAR(30) NOT NULL DEFAULT 'unidades',
        cantidad_actual INT NOT NULL DEFAULT 0,
        fecha_actualizacion DATETIME,
        UNIQUE KEY uq_productos_codigo (codigo),
        CONSTRAINT fk_productos_area FOREIGN KEY (area_id)
            REFERENCES areas (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS auditorias (
        id VARCHAR(40) PRIMARY KEY,
        area_id VARCHAR(40),
        area_nombre VARCHAR(80),
        fecha DATE NOT NULL,
        hora TIME NOT NULL,
        responsable VARCHAR(100),
        observacion TEXT,
        creado_en DATETIME,
        CONSTRAINT fk_auditorias_area FOREIGN KEY (area_id)
            REFERENCES areas (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS detalle_auditoria (
        id INT AUTO_INCREMENT PRIMARY KEY,
        auditoria_id VARCHAR(40) NOT NULL,
        producto_id VARCHAR(40),
        producto_nombre VARCHAR(100) NOT NULL,
        cantidad_auditada INT NOT NULL DEFAULT 0,
        CONSTRAINT fk_detalle_auditoria FOREIGN KEY (auditoria_id)
            REFERENCES auditorias (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS usuarios (
        id VARCHAR(40) PRIMARY KEY,
        usuario VARCHAR(50) NOT NULL UNIQUE,
        contrasena VARCHAR(200) NOT NULL,
        nombre VARCHAR(100),
        rol VARCHAR(20) NOT NULL DEFAULT 'lectura',
        email VARCHAR(100),
        telefono VARCHAR(30),
        foto LONGTEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

let pool = null;

/**
 * Crea la base de datos si no existe, inicializa el pool de conexiones,
 * crea las tablas y siembra los usuarios iniciales.
 */
async function inicializar() {
    // Conexión inicial solo para asegurar que la base de datos exista.
    const base = {
        host: CONFIG.host,
        port: CONFIG.port,
        user: CONFIG.user,
        password: CONFIG.password
    };
    if (SSL) base.ssl = SSL;

    // En hosts administrados (Aiven) el usuario suele poder crear la base; si no,
    // seguimos adelante y nos conectamos a la base que ya exista (p. ej. creada en el console).
    try {
        const conexion = await mysql.createConnection(base);
        await conexion.query(
            `CREATE DATABASE IF NOT EXISTS \`${NOMBRE_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        await conexion.end();
    } catch (err) {
        console.warn(`[db] No se pudo crear la base «${NOMBRE_DB}» (${err.message}). Intentando conectar a una base ya existente...`);
    }

    const poolConfig = {
        ...CONFIG,
        database: NOMBRE_DB,
        waitForConnections: true,
        connectionLimit: 10,
        dateStrings: true
    };
    if (SSL) poolConfig.ssl = SSL;
    pool = mysql.createPool(poolConfig);

    for (const sentencia of ESQUEMA) {
        await pool.query(sentencia);
    }

    await asegurarColumnasUsuarios();
    await sembrarUsuarios();
    return pool;
}

function obtenerPool() {
    if (!pool) throw new Error('La base de datos aún no está inicializada.');
    return pool;
}

/* ---------- Usuarios y contraseñas ---------- */

/** Agrega columnas nuevas del perfil a instalaciones existentes (MySQL no soporta ADD COLUMN IF NOT EXISTS). */
async function asegurarColumnasUsuarios() {
    const [columnas] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'usuarios'`,
        [NOMBRE_DB]
    );
    const existentes = new Set(columnas.map(c => c.COLUMN_NAME));
    const nuevas = [
        ['email', 'VARCHAR(100)'],
        ['telefono', 'VARCHAR(30)'],
        ['foto', 'LONGTEXT']
    ];
    for (const [nombre, definicion] of nuevas) {
        if (!existentes.has(nombre)) {
            await pool.query(`ALTER TABLE usuarios ADD COLUMN ${nombre} ${definicion} NULL`);
            console.log(`[db] Columna agregada a usuarios: ${nombre}`);
        }
    }
}

function hashContrasena(contrasena) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(contrasena, salt, 32).toString('hex');
    return `${salt}:${hash}`;
}

function verificarContrasena(contrasena, almacenado) {
    try {
        const [salt, hash] = String(almacenado).split(':');
        const test = crypto.scryptSync(contrasena, salt, 32).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
    } catch (e) {
        return false;
    }
}

/** Crea los usuarios iniciales si la tabla está vacía (configurables por variables de entorno). */
async function sembrarUsuarios() {
    const [filas] = await pool.query('SELECT COUNT(*) AS n FROM usuarios');
    if (filas[0].n > 0) return;

    const admin = {
        usuario: process.env.ADMIN_USUARIO || 'admin',
        contrasena: process.env.ADMIN_CONTRASENA || 'admin123',
        nombre: process.env.ADMIN_NOMBRE || 'Administrador'
    };
    const lectura = {
        usuario: process.env.LECTURA_USUARIO || 'lectura',
        contrasena: process.env.LECTURA_CONTRASENA || 'lectura123',
        nombre: process.env.LECTURA_NOMBRE || 'Usuario de consulta'
    };

    await pool.query(
        'INSERT INTO usuarios (id, usuario, contrasena, nombre, rol) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
        [
            crypto.randomUUID(), admin.usuario, hashContrasena(admin.contrasena), admin.nombre, 'admin',
            crypto.randomUUID(), lectura.usuario, hashContrasena(lectura.contrasena), lectura.nombre, 'lectura'
        ]
    );
    console.log('Usuarios iniciales creados:');
    console.log(`  ${admin.usuario}   (Administrador)`);
    console.log(`  ${lectura.usuario} (Solo lectura)`);
}

/* ---------- Conversión de fechas ---------- */

/** Convierte un ISO (u otro formato) al DATETIME de MySQL: 'YYYY-MM-DD HH:MM:SS'. */
function aDatetime(valor) {
    if (!valor) return null;
    let s = String(valor).replace('T', ' ').replace('Z', '');
    if (s.length === 10) s += ' 00:00:00';
    else if (s.length === 16) s += ':00';
    return s.slice(0, 19);
}

/** Convierte un DATETIME de MySQL a ISO local: 'YYYY-MM-DDTHH:MM:SS'. */
function aIso(valor) {
    return valor ? String(valor).replace(' ', 'T') : null;
}

/** Fecha-hora local actual en formato MySQL. */
function ahoraLocal() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ---------- Mapeos fila de BD -> JSON (camelCase) ---------- */

function mapearArea(f) {
    return {
        id: f.id,
        nombre: f.nombre,
        descripcion: f.descripcion,
        fechaCreacion: aIso(f.fecha_creacion),
        estado: f.estado || 'activo'
    };
}

function mapearProducto(f) {
    return {
        id: f.id,
        areaId: f.area_id,
        nombre: f.nombre,
        codigo: f.codigo,
        unidad: f.unidad || 'unidades',
        cantidadActual: f.cantidad_actual,
        fechaActualizacion: aIso(f.fecha_actualizacion)
    };
}

function mapearAuditoria(f, detalles) {
    return {
        id: f.id,
        areaId: f.area_id,
        areaNombre: f.area_nombre,
        fecha: f.fecha,
        hora: f.hora,
        responsable: f.responsable,
        observacion: f.observacion,
        detalles: detalles || [],
        creadoEn: aIso(f.creado_en)
    };
}

module.exports = {
    inicializar,
    obtenerPool,
    ESQUEMA,
    aDatetime,
    aIso,
    ahoraLocal,
    hashContrasena,
    verificarContrasena,
    mapearArea,
    mapearProducto,
    mapearAuditoria
};
