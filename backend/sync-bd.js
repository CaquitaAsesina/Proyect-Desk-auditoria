/* =========================================================
   sync-bd.js — Copia TODA la base de datos entre MySQL local y Aiven.
   Uso:  node sync-bd.js <origen> <destino>
   donde <origen> y <destino> son: local | aiven
     node sync-bd.js aiven local  → copia la nube a tu PC
     node sync-bd.js local aiven  → copia tu PC a la nube
   ADVERTENCIA: reemplaza por completo la base de destino.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { ESQUEMA } = require('./db');

const DIR = __dirname;
const PERFILES = { local: '.env.local', aiven: '.env.aiven' };

const ORDEN_TABLAS = ['areas', 'productos', 'auditorias', 'detalle_auditoria', 'usuarios'];

function leerPerfil(nombre) {
    const archivo = path.join(DIR, PERFILES[nombre]);
    if (!fs.existsSync(archivo)) {
        console.error(`No existe ${PERFILES[nombre]}.`);
        process.exit(1);
    }
    const env = {};
    for (const linea of fs.readFileSync(archivo, 'utf8').split('\n')) {
        const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
        if (m) env[m[1]] = m[2];
    }
    return {
        host: env.DB_HOST || '127.0.0.1',
        port: Number(env.DB_PORT || 3306),
        user: env.DB_USER || 'root',
        password: env.DB_PASSWORD || '',
        database: env.DB_NAME || 'auditoria_db',
        ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    };
}

/* conBase=true: selecciona la base al conectar (origen).
   conBase=false: conecta sin base para poder crearla (destino). */
async function conectar(config, conBase) {
    const params = {
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        dateStrings: true
    };
    if (config.ssl) params.ssl = config.ssl;
    if (conBase) params.database = config.database;
    return mysql.createConnection(params);
}

async function asegurarDestino(conexion, config) {
    try {
        await conexion.query(
            `CREATE DATABASE IF NOT EXISTS \`${config.database.replace(/[^A-Za-z0-9_]/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
    } catch (e) {
        console.log(`  (aviso: no se pudo crear la base de destino: ${e.message})`);
    }
    await conexion.changeUser({ database: config.database });
    for (const sentencia of ESQUEMA) {
        await conexion.query(sentencia);
    }
}

async function columnasDe(conexion, tabla) {
    const [cols] = await conexion.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [tabla]
    );
    return cols.map(c => c.COLUMN_NAME);
}

async function copiarTabla(conOrigen, conDestino, tabla) {
    const columnas = await columnasDe(conOrigen, tabla);
    if (columnas.length === 0) return 0;
    await conDestino.query(`DELETE FROM \`${tabla}\``);
    const [filas] = await conOrigen.query(`SELECT * FROM \`${tabla}\``);
    if (filas.length === 0) return 0;
    const lista = columnas.map(c => `\`${c}\``).join(', ');
    const marcadores = columnas.map(() => '?').join(', ');
    for (const fila of filas) {
        await conDestino.query(
            `INSERT INTO \`${tabla}\` (${lista}) VALUES (${marcadores})`,
            columnas.map(c => fila[c])
        );
    }
    return filas.length;
}

(async () => {
    const origen = (process.argv[2] || '').toLowerCase();
    const destino = (process.argv[3] || '').toLowerCase();

    if (!PERFILES[origen] || !PERFILES[destino]) {
        console.log('Uso: node sync-bd.js <origen> <destino>   (local | aiven)');
        console.log('  node sync-bd.js aiven local  → copia la nube a tu PC');
        console.log('  node sync-bd.js local aiven  → copia tu PC a la nube');
        process.exit(1);
    }

    const cfgOrigen = leerPerfil(origen);
    const cfgDestino = leerPerfil(destino);

    console.log(`Sincronizando  ${origen.toUpperCase()} → ${destino.toUpperCase()}`);
    console.log(`  Origen : ${cfgOrigen.host}/${cfgOrigen.database}`);
    console.log(`  Destino: ${cfgDestino.host}/${cfgDestino.database}`);

    const conOrigen = await conectar(cfgOrigen, true);
    const conDestino = await conectar(cfgDestino, false);

    await asegurarDestino(conDestino, cfgDestino);

    await conDestino.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const tabla of ORDEN_TABLAS) {
        const n = await copiarTabla(conOrigen, conDestino, tabla);
        console.log(`  ${tabla}: ${n} registros copiados`);
    }
    await conDestino.query('SET FOREIGN_KEY_CHECKS = 1');

    await conOrigen.end();
    await conDestino.end();
    console.log('✔ Sincronización completada.');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
