/* =========================================================
   storage.js — Capa de datos
   Utilidades generales, acceso a la API (Express + MySQL)
   y generación de datos de demostración.
   ========================================================= */

'use strict';

/* ---------- Utilidades compartidas ---------- */
const Utiles = {

    /** Genera un id único con prefijo legible. */
    generarId(prefijo) {
        return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    /** Fecha de hoy en formato local YYYY-MM-DD. */
    hoyISO() {
        return this.aISO(new Date());
    },

    /** Convierte un Date a YYYY-MM-DD usando la hora local (no UTC). */
    aISO(fecha) {
        const y = fecha.getFullYear();
        const m = String(fecha.getMonth() + 1).padStart(2, '0');
        const d = String(fecha.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    /** Hora actual HH:MM. */
    ahoraHora() {
        const h = new Date();
        return String(h.getHours()).padStart(2, '0') + ':' + String(h.getMinutes()).padStart(2, '0');
    },

    /** Suma/resta días a una fecha y devuelve un Date. */
    sumarDias(fecha, dias) {
        const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
        d.setDate(d.getDate() + dias);
        return d;
    },

    /** Formatea YYYY-MM-DD a DD/MM/YYYY. */
    formatearFecha(iso) {
        if (!iso) return '—';
        const partes = String(iso).split('T')[0].split('-');
        if (partes.length !== 3) return iso;
        return `${partes[2]}/${partes[1]}/${partes[0]}`;
    },

    /** Formatea una hora (HH:MM:SS o HH:MM) a HH:MM. */
    formatearHora(hora) {
        if (!hora) return '—';
        const partes = String(hora).split(':');
        return partes.length >= 2 ? `${partes[0]}:${partes[1]}` : hora;
    },

    /** Número con separador de miles. */
    formatearNumero(n) {
        return Number(n || 0).toLocaleString('es');
    },

    /** Normaliza texto para búsquedas (minúsculas, sin tildes). */
    normalizar(texto) {
        return String(texto || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    },

    /** Escapa HTML para evitar inyección al renderizar datos del usuario. */
    escapeHtml(texto) {
        const d = document.createElement('div');
        d.textContent = texto === null || texto === undefined ? '' : String(texto);
        return d.innerHTML;
    },

    /** Rango de fechas según el periodo seleccionado. */
    periodoRango(periodo, desde, hasta) {
        const hoy = new Date();
        switch (periodo) {
            case 'hoy': {
                const s = this.aISO(hoy);
                return { desde: s, hasta: s };
            }
            case 'ayer': {
                const s = this.aISO(this.sumarDias(hoy, -1));
                return { desde: s, hasta: s };
            }
            case 'semana': {
                const d = new Date(hoy);
                const dia = (d.getDay() + 6) % 7; // lunes = 0
                d.setDate(d.getDate() - dia);
                return { desde: this.aISO(d), hasta: this.aISO(hoy) };
            }
            case 'mes': {
                const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
                const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
                return { desde: this.aISO(ini), hasta: this.aISO(fin) };
            }
            case 'mesAnterior': {
                const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
                const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
                return { desde: this.aISO(ini), hasta: this.aISO(fin) };
            }
            case 'personalizado':
            default: {
                return {
                    desde: desde || this.aISO(hoy),
                    hasta: hasta || this.aISO(hoy)
                };
            }
        }
    },

    /** Indica si una fecha ISO está dentro del rango [desde, hasta]. */
    enRango(fechaISO, desde, hasta) {
        const f = String(fechaISO || '').split('T')[0];
        return f >= desde && f <= hasta;
    },

    /** Etiqueta legible para el periodo seleccionado. */
    etiquetaPeriodo(periodo) {
        const etiquetas = {
            hoy: 'hoy',
            ayer: 'ayer',
            semana: 'esta semana',
            mes: 'este mes',
            mesAnterior: 'el mes anterior',
            personalizado: 'en el periodo'
        };
        return etiquetas[periodo] || 'en el periodo';
    }
};

/* ---------- Acceso a la API (backend Express + MySQL) ---------- */

// Si la app se abre desde el servidor (http://localhost:3000) usa rutas relativas.
// Si se abre como archivo local (file://), apunta al backend local.
const API_BASE = (typeof window !== 'undefined' && window.API_BASE)
    ? window.API_BASE
    : (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:')
        ? 'http://localhost:3000'
        : '';

/** Petición fetch con token de sesión y manejo de errores JSON. */
async function peticion(ruta, opciones = {}) {
    const token = localStorage.getItem('auditoria_token');
    const config = { headers: { 'Content-Type': 'application/json' }, ...opciones };
    if (token) config.headers.Authorization = 'Bearer ' + token;

    const res = await fetch(API_BASE + ruta, config);

    // Sesión inválida o expirada: limpia y avisa (excepto en el login).
    if (res.status === 401 && !opciones.sinSesion) {
        StorageManager.cerrarSesion();
        document.dispatchEvent(new CustomEvent('auditoria:logout'));
    }

    if (!res.ok) {
        let mensaje = 'Error de comunicación con el servidor.';
        try {
            const cuerpo = await res.json();
            mensaje = cuerpo.error || mensaje;
        } catch (e) { /* respuesta sin cuerpo JSON */ }
        throw new Error(mensaje);
    }
    return res.json();
}

const StorageManager = {

    /** Caché en memoria: los módulos leen los datos de forma síncrona. */
    cache: { areas: [], productos: [], auditorias: [] },

    /** Devuelve los datos actuales en memoria. */
    obtenerDatos() {
        return this.cache;
    },

    /** Carga el dataset completo desde la API y actualiza la caché. */
    async cargarTodo() {
        const datos = await peticion('/api/datos');
        this.cache = {
            areas: Array.isArray(datos.areas) ? datos.areas : [],
            productos: Array.isArray(datos.productos) ? datos.productos : [],
            auditorias: Array.isArray(datos.auditorias) ? datos.auditorias : []
        };
        return this.cache;
    },

    /** ¿Existe información guardada? (para la pantalla de bienvenida) */
    tieneDatos() {
        return this.cache.areas.length > 0 || this.cache.productos.length > 0 || this.cache.auditorias.length > 0;
    },

    /* ---------- Áreas ---------- */
    async apiCrearArea(datos) {
        await peticion('/api/areas', { method: 'POST', body: JSON.stringify(datos) });
        await this.cargarTodo();
    },
    async apiActualizarArea(id, cambios) {
        await peticion('/api/areas/' + id, { method: 'PUT', body: JSON.stringify(cambios) });
        await this.cargarTodo();
    },
    async apiEliminarArea(id) {
        await peticion('/api/areas/' + id, { method: 'DELETE' });
        await this.cargarTodo();
    },

    /* ---------- Productos ---------- */
    async apiCrearProducto(datos) {
        await peticion('/api/productos', { method: 'POST', body: JSON.stringify(datos) });
        await this.cargarTodo();
    },
    async apiActualizarProducto(id, cambios) {
        await peticion('/api/productos/' + id, { method: 'PUT', body: JSON.stringify(cambios) });
        await this.cargarTodo();
    },
    async apiEliminarProducto(id) {
        await peticion('/api/productos/' + id, { method: 'DELETE' });
        await this.cargarTodo();
    },

    /* ---------- Auditorías ---------- */
    async apiCrearAuditoria(auditoria) {
        const creada = await peticion('/api/auditorias', { method: 'POST', body: JSON.stringify(auditoria) });
        await this.cargarTodo();
        return creada;
    },
    async apiEliminarAuditoria(id) {
        await peticion('/api/auditorias/' + id, { method: 'DELETE' });
        await this.cargarTodo();
    },

    /* ---------- Perfil del usuario ---------- */
    async apiActualizarPerfil(datos) {
        const res = await peticion('/api/usuarios/me', { method: 'PUT', body: JSON.stringify(datos) });
        // Mantiene la sesión local sincronizada con los datos del perfil.
        // Si cambió el usuario o la contraseña, el backend devuelve un token nuevo.
        const actual = this.obtenerUsuario() || {};
        const token = res.token || this.obtenerToken();
        this.guardarSesion(token, { ...actual, ...res.usuario });
        return res.usuario;
    },

    /* ---------- Sesión (token JWT + usuario) ---------- */
    guardarSesion(token, usuario) {
        localStorage.setItem('auditoria_token', token);
        localStorage.setItem('auditoria_usuario', JSON.stringify(usuario));
    },
    obtenerToken() {
        return localStorage.getItem('auditoria_token');
    },
    obtenerUsuario() {
        try {
            return JSON.parse(localStorage.getItem('auditoria_usuario') || 'null');
        } catch (e) {
            return null;
        }
    },
    cerrarSesion() {
        localStorage.removeItem('auditoria_token');
        localStorage.removeItem('auditoria_usuario');
    },
    haySesion() {
        return !!this.obtenerToken();
    },

};
