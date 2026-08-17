/* =========================================================
   server.js — API REST + servidor estático (Express + MySQL)
   Autenticación JWT con roles: admin (escribe) / lectura (solo ve)
   ========================================================= */

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const {
    inicializar,
    obtenerPool,
    aDatetime,
    ahoraLocal,
    hashContrasena,
    verificarContrasena,
    mapearArea,
    mapearProducto,
    mapearAuditoria
} = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Sirve la aplicación frontend (carpeta padre de backend/, es decir /inventario)
app.use(express.static(path.join(__dirname, '..')));

const PORT = Number(process.env.PORT) || 3000;
// 0.0.0.0 = accesible desde cualquier PC de la red (LAN / VPN).
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'auditoria_cambiar_este_secreto';

/* IP local de la máquina, para que otras PCs de la red puedan acceder. */
function ipLocal() {
    const interfaces = require('os').networkInterfaces();
    for (const nombre of Object.keys(interfaces)) {
        for (const itf of interfaces[nombre] || []) {
            if (itf.family === 'IPv4' && !itf.internal) return itf.address;
        }
    }
    return null;
}

/* Envuelve manejadores asíncronos y devuelve errores como JSON */
const manejar = fn => (req, res) => {
    Promise.resolve(fn(req, res)).catch(err => {
        console.error('[API]', err.message);
        res.status(500).json({ error: err.message || 'Error interno del servidor' });
    });
};

/* =========================================================
   AUTENTICACIÓN
   ========================================================= */
function autenticar(req, res, next) {
    const cabecera = req.headers.authorization || '';
    const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: 'No autenticado. Inicia sesión primero.' });
    }
    try {
        req.usuario = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Sesión inválida o expirada. Vuelve a iniciar sesión.' });
    }
}

function requiereAdmin(req, res, next) {
    if (!req.usuario || req.usuario.rol !== 'admin') {
        return res.status(403).json({ error: 'No tienes permisos para realizar esta acción.' });
    }
    next();
}

/* Login (público) */
app.post('/api/auth/login', manejar(async (req, res) => {
    const { usuario, contrasena } = req.body || {};
    if (!usuario || !contrasena) {
        return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
    }
    const [filas] = await obtenerPool().query('SELECT * FROM usuarios WHERE usuario = ?', [String(usuario)]);
    const u = filas[0];
    if (!u || !verificarContrasena(String(contrasena), u.contrasena)) {
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    const token = jwt.sign({ id: u.id, usuario: u.usuario, rol: u.rol }, JWT_SECRET, { expiresIn: '12h' });
    res.json({
        token,
        usuario: { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, email: u.email, telefono: u.telefono, foto: u.foto }
    });
}));

/* A partir de aquí, todas las rutas /api requieren autenticación */
app.use('/api', autenticar);

/* Perfil del usuario autenticado (datos + foto) */
async function perfilPorId(id) {
    const [filas] = await obtenerPool().query(
        'SELECT id, usuario, nombre, rol, email, telefono, foto FROM usuarios WHERE id = ?',
        [id]
    );
    return filas[0] || null;
}

app.get('/api/auth/me', manejar(async (req, res) => {
    const u = await perfilPorId(req.usuario.id);
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json({ usuario: u });
}));

/* El usuario de consulta solo puede modificar su perfil presentando la contraseña del administrador. */
async function verificarClaveAdmin(contrasena) {
    const [filas] = await obtenerPool().query("SELECT contrasena FROM usuarios WHERE rol = 'admin' LIMIT 1");
    const fila = filas[0];
    return fila ? verificarContrasena(contrasena, fila.contrasena) : false;
}

/* Actualiza datos, foto, usuario (nombre de usuario) y contraseña del propio perfil.
   - El admin puede editar todo sin clave adicional.
   - El usuario de consulta puede editar, pero cada guardado exige la contraseña del administrador. */
app.put('/api/usuarios/me', manejar(async (req, res) => {
    const { nombre, email, telefono, foto, nuevoUsuario, nuevaContrasena, contrasenaAdmin } = req.body || {};

    if (foto && typeof foto === 'string' && foto.length > 1500000) {
        return res.status(400).json({ error: 'La foto es demasiado grande (máx. ~1 MB).' });
    }

    const esAdmin = req.usuario.rol === 'admin';
    if (!esAdmin) {
        if (!contrasenaAdmin) {
            return res.status(403).json({ error: 'Para modificar tu perfil debes ingresar la contraseña del administrador.' });
        }
        const claveValida = await verificarClaveAdmin(String(contrasenaAdmin));
        if (!claveValida) {
            return res.status(403).json({ error: 'La contraseña del administrador es incorrecta.' });
        }
    }

    // Lee la fila completa (incluye el hash actual de contraseña, que perfilPorId excluye por seguridad).
    const [filas] = await obtenerPool().query('SELECT * FROM usuarios WHERE id = ?', [req.usuario.id]);
    const u = filas[0];
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });

    // Nombre de usuario nuevo (opcional)
    const usuarioFinal = nuevoUsuario && String(nuevoUsuario).trim()
        ? String(nuevoUsuario).trim().slice(0, 50)
        : u.usuario;

    // Contraseña nueva (opcional)
    let contrasenaFinal = u.contrasena;
    if (nuevaContrasena) {
        if (String(nuevaContrasena).length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
        }
        contrasenaFinal = hashContrasena(String(nuevaContrasena));
    }

    try {
        await obtenerPool().query(
            'UPDATE usuarios SET nombre = ?, email = ?, telefono = ?, foto = ?, usuario = ?, contrasena = ? WHERE id = ?',
            [
                nombre ? String(nombre).trim().slice(0, 100) : null,
                email ? String(email).trim().slice(0, 100) : null,
                telefono ? String(telefono).trim().slice(0, 30) : null,
                foto || null,
                usuarioFinal,
                contrasenaFinal,
                req.usuario.id
            ]
        );
    } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: `El usuario «${usuarioFinal}» ya está en uso.` });
        }
        throw err;
    }

    const actualizado = await perfilPorId(req.usuario.id);
    if (!actualizado) return res.status(404).json({ error: 'Usuario no encontrado.' });

    // Si cambió el usuario o la contraseña, emite un token nuevo para mantener la sesión válida.
    let token = null;
    if (usuarioFinal !== u.usuario || contrasenaFinal !== u.contrasena) {
        token = jwt.sign(
            { id: actualizado.id, usuario: actualizado.usuario, rol: actualizado.rol },
            JWT_SECRET,
            { expiresIn: '12h' }
        );
    }

    res.json({ usuario: actualizado, token });
}));

/* =========================================================
   GET /api/datos — dataset completo (areas, productos, auditorias)
   ========================================================= */
app.get('/api/datos', manejar(async (req, res) => {
    const pool = obtenerPool();
    const [areas] = await pool.query('SELECT * FROM areas ORDER BY fecha_creacion, nombre');
    const [productos] = await pool.query('SELECT * FROM productos ORDER BY nombre');
    const [auditorias] = await pool.query('SELECT * FROM auditorias ORDER BY fecha DESC, hora DESC');
    const [detalles] = await pool.query('SELECT * FROM detalle_auditoria ORDER BY id');

    const detallesPorAuditoria = {};
    detalles.forEach(d => {
        if (!detallesPorAuditoria[d.auditoria_id]) detallesPorAuditoria[d.auditoria_id] = [];
        detallesPorAuditoria[d.auditoria_id].push({
            productoId: d.producto_id,
            productoNombre: d.producto_nombre,
            cantidadAuditada: d.cantidad_auditada
        });
    });

    res.json({
        areas: areas.map(mapearArea),
        productos: productos.map(mapearProducto),
        auditorias: auditorias.map(a => mapearAuditoria(a, detallesPorAuditoria[a.id] || []))
    });
}));

/* =========================================================
   POST /api/datos — reemplazo total (datos demo / empezar de cero)
   [Solo administrador]
   ========================================================= */
app.post('/api/datos', requiereAdmin, manejar(async (req, res) => {
    const datos = req.body || {};
    const areas = Array.isArray(datos.areas) ? datos.areas : [];
    const productos = Array.isArray(datos.productos) ? datos.productos : [];
    const auditorias = Array.isArray(datos.auditorias) ? datos.auditorias : [];

    const pool = obtenerPool();
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('DELETE FROM detalle_auditoria');
        await conn.query('DELETE FROM auditorias');
        await conn.query('DELETE FROM productos');
        await conn.query('DELETE FROM areas');

        for (const area of areas) {
            await conn.query(
                'INSERT INTO areas (id, nombre, descripcion, fecha_creacion, estado) VALUES (?, ?, ?, ?, ?)',
                [area.id, area.nombre, area.descripcion || '', aDatetime(area.fechaCreacion || ahoraLocal()), area.estado || 'activo']
            );
        }
        for (const p of productos) {
            await conn.query(
                'INSERT INTO productos (id, area_id, nombre, codigo, unidad, cantidad_actual, fecha_actualizacion) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [p.id, p.areaId, p.nombre, p.codigo, p.unidad || 'unidades', Number(p.cantidadActual) || 0, aDatetime(p.fechaActualizacion || ahoraLocal())]
            );
        }
        for (const aud of auditorias) {
            await conn.query(
                'INSERT INTO auditorias (id, area_id, area_nombre, fecha, hora, responsable, observacion, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [aud.id, aud.areaId, aud.areaNombre || null, aud.fecha, aud.hora, aud.responsable || null, aud.observacion || null, aDatetime(aud.creadoEn || ahoraLocal())]
            );
            for (const d of aud.detalles || []) {
                await conn.query(
                    'INSERT INTO detalle_auditoria (auditoria_id, producto_id, producto_nombre, cantidad_auditada) VALUES (?, ?, ?, ?)',
                    [aud.id, d.productoId || null, d.productoNombre, Number(d.cantidadAuditada) || 0]
                );
            }
        }

        await conn.commit();
        res.json({ ok: true, areas: areas.length, productos: productos.length, auditorias: auditorias.length });
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}));

/* =========================================================
   ÁREAS  [Solo administrador para escribir]
   ========================================================= */
app.post('/api/areas', requiereAdmin, manejar(async (req, res) => {
    const { id, nombre, descripcion, estado } = req.body || {};
    if (!nombre || !String(nombre).trim()) {
        return res.status(400).json({ error: 'El nombre del área es obligatorio.' });
    }
    const pool = obtenerPool();
    const areaId = id || crypto.randomUUID();
    await pool.query(
        'INSERT INTO areas (id, nombre, descripcion, fecha_creacion, estado) VALUES (?, ?, ?, ?, ?)',
        [areaId, String(nombre).trim(), descripcion || '', ahoraLocal(), estado || 'activo']
    );
    res.status(201).json({ id: areaId });
}));

app.put('/api/areas/:id', requiereAdmin, manejar(async (req, res) => {
    const { nombre, descripcion, estado } = req.body || {};
    if (!nombre || !String(nombre).trim()) {
        return res.status(400).json({ error: 'El nombre del área es obligatorio.' });
    }
    const pool = obtenerPool();
    const [resultado] = await pool.query(
        'UPDATE areas SET nombre = ?, descripcion = ?, estado = ? WHERE id = ?',
        [String(nombre).trim(), descripcion || '', estado || 'activo', req.params.id]
    );
    if (resultado.affectedRows === 0) return res.status(404).json({ error: 'Área no encontrada.' });
    res.json({ ok: true });
}));

app.delete('/api/areas/:id', requiereAdmin, manejar(async (req, res) => {
    const pool = obtenerPool();
    await pool.query('DELETE FROM areas WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
}));

/* =========================================================
   PRODUCTOS
   - El código es obligatorio y único.
   - La cantidad NO se edita aquí: solo la registra una auditoría.
   [Solo administrador para escribir]
   ========================================================= */
function esCodigoDuplicado(err) {
    return err && err.code === 'ER_DUP_ENTRY';
}

app.post('/api/productos', requiereAdmin, manejar(async (req, res) => {
    const { id, areaId, nombre, codigo, unidad } = req.body || {};
    if (!areaId || !nombre || !String(nombre).trim() || !codigo || !String(codigo).trim()) {
        return res.status(400).json({ error: 'El área, el nombre y el código del producto son obligatorios.' });
    }
    const pool = obtenerPool();
    const productoId = id || crypto.randomUUID();
    try {
        await pool.query(
            'INSERT INTO productos (id, area_id, nombre, codigo, unidad, cantidad_actual, fecha_actualizacion) VALUES (?, ?, ?, ?, ?, 0, ?)',
            [productoId, areaId, String(nombre).trim(), String(codigo).trim(), unidad || 'unidades', ahoraLocal()]
        );
    } catch (err) {
        if (esCodigoDuplicado(err)) {
            return res.status(400).json({ error: `Ya existe un producto con el código «${codigo}».` });
        }
        throw err;
    }
    res.status(201).json({ id: productoId });
}));

app.put('/api/productos/:id', requiereAdmin, manejar(async (req, res) => {
    const { areaId, nombre, codigo, unidad } = req.body || {};
    if (!areaId || !nombre || !String(nombre).trim() || !codigo || !String(codigo).trim()) {
        return res.status(400).json({ error: 'El área, el nombre y el código del producto son obligatorios.' });
    }
    const pool = obtenerPool();
    try {
        // La cantidad_actual NO se modifica aquí: solo cambia con una auditoría.
        const [resultado] = await pool.query(
            'UPDATE productos SET area_id = ?, nombre = ?, codigo = ?, unidad = ? WHERE id = ?',
            [areaId, String(nombre).trim(), String(codigo).trim(), unidad || 'unidades', req.params.id]
        );
        if (resultado.affectedRows === 0) return res.status(404).json({ error: 'Producto no encontrado.' });
    } catch (err) {
        if (esCodigoDuplicado(err)) {
            return res.status(400).json({ error: `Ya existe un producto con el código «${codigo}».` });
        }
        throw err;
    }
    res.json({ ok: true });
}));

app.delete('/api/productos/:id', requiereAdmin, manejar(async (req, res) => {
    const pool = obtenerPool();
    await pool.query('DELETE FROM productos WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
}));

/* =========================================================
   AUDITORÍAS  [Solo administrador para escribir]
   ========================================================= */
app.post('/api/auditorias', requiereAdmin, manejar(async (req, res) => {
    const a = req.body || {};
    if (!a.areaId || !a.fecha || !a.hora) {
        return res.status(400).json({ error: 'Faltan datos de la auditoría (área, fecha, hora).' });
    }
    if (!Array.isArray(a.detalles) || a.detalles.length === 0) {
        return res.status(400).json({ error: 'La auditoría no tiene productos registrados.' });
    }

    const pool = obtenerPool();
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        await conn.query(
            'INSERT INTO auditorias (id, area_id, area_nombre, fecha, hora, responsable, observacion, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [a.id, a.areaId, a.areaNombre || null, a.fecha, a.hora, a.responsable || null, a.observacion || null, ahoraLocal()]
        );
        for (const d of a.detalles) {
            await conn.query(
                'INSERT INTO detalle_auditoria (auditoria_id, producto_id, producto_nombre, cantidad_auditada) VALUES (?, ?, ?, ?)',
                [a.id, d.productoId || null, d.productoNombre, Number(d.cantidadAuditada) || 0]
            );
            // La auditoría actualiza el inventario actual (el registro histórico queda inmutable).
            await conn.query(
                'UPDATE productos SET cantidad_actual = ?, fecha_actualizacion = ? WHERE id = ?',
                [Math.max(0, Number(d.cantidadAuditada) || 0), ahoraLocal(), d.productoId]
            );
        }

        await conn.commit();
        res.status(201).json({ id: a.id });
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}));

app.delete('/api/auditorias/:id', requiereAdmin, manejar(async (req, res) => {
    const pool = obtenerPool();
    await pool.query('DELETE FROM auditorias WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
}));

/* Rutas API desconocidas */
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

/* =========================================================
   Arranque
   ========================================================= */
inicializar()
    .then(() => {
        app.listen(PORT, HOST, () => {
            const ip = ipLocal();
            console.log('================================================');
            console.log('  Auditoria — backend listo');
            console.log(`  Aplicación:  http://localhost:${PORT}`);
            if (HOST === '0.0.0.0' && ip) {
                console.log(`  Desde otras PCs (red local): http://${ip}:${PORT}`);
            }
            console.log(`  API datos:   http://localhost:${PORT}/api/datos`);
            console.log('================================================');
        });
    })
    .catch(err => {
        console.error('No se pudo conectar con MySQL:', err.message);
        console.error('Revisa las credenciales en backend/.env');
        process.exit(1);
    });
