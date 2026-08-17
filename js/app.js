/* =========================================================
   app.js — Inicialización, navegación y utilidades globales
   ========================================================= */

'use strict';

const App = {

    seccionActual: 'dashboard',
    confirmarCallback: null,

    SECCIONES: {
        dashboard: { id: 'vistaDashboard', titulo: 'Dashboard' },
        areas: { id: 'vistaAreas', titulo: 'Áreas' },
        inventarioArea: { id: 'vistaInventarioArea', titulo: 'Inventario del área' },
        productos: { id: 'vistaProductos', titulo: 'Productos' },
        auditoria: { id: 'vistaAuditoria', titulo: 'Nueva Auditoría' },
        historial: { id: 'vistaHistorial', titulo: 'Historial de Auditorías' },
        reportes: { id: 'vistaReportes', titulo: 'Reportes' },
        perfil: { id: 'vistaPerfil', titulo: 'Mi Perfil' }
    },

    /* ================= INICIALIZACIÓN ================= */

    async init() {
        this.configurarLogin();
        this.inicializado = true;
        this.configurarTooltips();
        this.configurarNavegacion();
        this.configurarPantallaInicial();
        this.configurarVistaInventarioArea();
        this.configurarReportes();
        this.configurarModalConfirmar();

        Inventario.init();
        Auditorias.init();
        Dashboard.init();
        Perfil.init();

        // Sin sesión: muestra el login y no carga datos.
        if (!StorageManager.haySesion()) {
            this.mostrarLogin(true);
            return;
        }
        this.ocultarLogin();

        await this.cargarDatosIniciales();

        this.aplicarRol();
        this.navegar('dashboard');
        this.mostrarPantallaInicial();
        this.refrescarTodo();

        // Resincroniza los datos al volver a la pestaña.
        window.addEventListener('focus', () => {
            StorageManager.cargarTodo().catch(() => {});
        });
    },

    /* ---------- Sesión / Login ---------- */

    esAdmin() {
        const usuario = StorageManager.obtenerUsuario();
        return !!(usuario && usuario.rol === 'admin');
    },

    configurarLogin() {
        document.getElementById('formLogin').addEventListener('submit', e => {
            e.preventDefault();
            this.iniciarSesion();
        });
        document.getElementById('btnCerrarSesion').addEventListener('click', () => this.cerrarSesion());
        const btnCerrarMovil = document.getElementById('btnCerrarSesionMovil');
        if (btnCerrarMovil) btnCerrarMovil.addEventListener('click', () => this.cerrarSesion());

        // Sesión expirada o token inválido (401 desde la API).
        document.addEventListener('auditoria:logout', () => {
            this.mostrarToast('Tu sesión expiró. Vuelve a iniciar sesión.', 'warning');
            this.mostrarLogin(true);
        });
    },

    mostrarLogin(limpiar = false) {
        if (limpiar) {
            document.getElementById('formLogin').reset();
            document.getElementById('alertaLogin').classList.add('d-none');
        }
        document.getElementById('vistaLogin').classList.remove('d-none');
        document.getElementById('overlayCarga').classList.add('d-none');
        setTimeout(() => document.getElementById('campoLoginUsuario').focus(), 150);
    },

    ocultarLogin() {
        document.getElementById('vistaLogin').classList.add('d-none');
    },

    async iniciarSesion() {
        const formulario = document.getElementById('formLogin');
        if (!formulario.checkValidity()) {
            formulario.classList.add('was-validated');
            return;
        }
        const alerta = document.getElementById('alertaLogin');
        alerta.classList.add('d-none');
        const boton = document.getElementById('btnLogin');
        boton.disabled = true;
        boton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Ingresando...';

        try {
            const resultado = await peticion('/api/auth/login', {
                method: 'POST',
                sinSesion: true,
                body: JSON.stringify({
                    usuario: document.getElementById('campoLoginUsuario').value,
                    contrasena: document.getElementById('campoLoginContrasena').value
                })
            });
            StorageManager.guardarSesion(resultado.token, resultado.usuario);
            this.ocultarLogin();
            this.aplicarRol();
            await this.cargarDatosIniciales();
            this.navegar('dashboard');
            this.mostrarPantallaInicial();
            this.refrescarTodo();
            this.mostrarToast(`Bienvenido, ${resultado.usuario.nombre || resultado.usuario.usuario}.`, 'success');
        } catch (error) {
            alerta.textContent = error.message || 'No se pudo iniciar sesión.';
            alerta.classList.remove('d-none');
        } finally {
            boton.disabled = false;
            boton.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Ingresar';
        }
    },

    cerrarSesion() {
        StorageManager.cerrarSesion();
        this.mostrarLogin(true);
        this.mostrarToast('Sesión cerrada.', 'info');
    },

    /** Aplica la vista según el rol del usuario (oculta acciones de administrador). */
    aplicarRol() {
        const usuario = StorageManager.obtenerUsuario();
        const esAdmin = this.esAdmin();
        document.body.classList.toggle('modo-lectura', !esAdmin);

        const txtNombre = document.getElementById('txtUsuarioNombre');
        const txtRol = document.getElementById('txtUsuarioRol');
        if (txtNombre) txtNombre.textContent = usuario ? (usuario.nombre || usuario.usuario) : '—';
        if (txtRol) txtRol.textContent = esAdmin ? 'Administrador' : 'Solo lectura';

        // Versión móvil (offcanvas)
        const txtNombreMovil = document.getElementById('txtUsuarioNombreMovil');
        const txtRolMovil = document.getElementById('txtUsuarioRolMovil');
        if (txtNombreMovil) txtNombreMovil.textContent = usuario ? (usuario.nombre || usuario.usuario) : '—';
        if (txtRolMovil) txtRolMovil.textContent = esAdmin ? 'Administrador' : 'Solo lectura';

        this.renderAvatar('avatarTopbar', usuario && usuario.foto, 'bi-person-fill');
        this.renderAvatar('avatarSidebar', usuario && usuario.foto, 'bi-person');
        this.renderAvatar('avatarSidebarMovil', usuario && usuario.foto, 'bi-person');
    },

    /** Muestra la foto del usuario en un avatar circular, o el ícono si no tiene. */
    renderAvatar(id, foto, icono) {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = foto
            ? `<img src="${foto}" alt="Foto de perfil" class="avatar-img">`
            : `<i class="bi ${icono}"></i>`;
    },

    /** Carga el dataset desde la API; muestra un spinner mientras tanto. */
    async cargarDatosIniciales() {
        const overlay = document.getElementById('overlayCarga');
        try {
            await StorageManager.cargarTodo();
            this.actualizarBadgeConexion(true);
        } catch (error) {
            console.error('Error de conexión con el backend:', error);
            this.actualizarBadgeConexion(false);
            this.mostrarToast('No se pudo conectar con el servidor. Verifica que el backend esté en ejecución (npm start en backend/).', 'danger');
        } finally {
            if (overlay) overlay.classList.add('d-none');
        }
    },

    /** Muestra el estado de la conexión con MySQL en la barra superior. */
    actualizarBadgeConexion(conectado) {
        const badge = document.getElementById('badgeDatos');
        if (!badge) return;
        if (conectado) {
            badge.className = 'badge bg-success-subtle text-success d-none d-md-inline-flex align-items-center gap-1 border';
            badge.innerHTML = '<i class="bi bi-database-check"></i> MySQL · Conectado';
        } else {
            badge.className = 'badge bg-danger-subtle text-danger d-none d-md-inline-flex align-items-center gap-1 border';
            badge.innerHTML = '<i class="bi bi-database-x"></i> Sin conexión';
        }
    },

    configurarTooltips() {
        document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el));
    },

    /* ================= NAVEGACIÓN ================= */

    configurarNavegacion() {
        document.querySelectorAll('[data-seccion]').forEach(enlace => {
            enlace.addEventListener('click', e => {
                e.preventDefault();
                this.navegar(enlace.dataset.seccion);
            });
        });
    },

    navegar(seccion) {
        const config = this.SECCIONES[seccion];
        if (!config) return;

        this.seccionActual = seccion;

        // Muestra la sección correspondiente.
        document.querySelectorAll('.seccion').forEach(s => s.classList.remove('active'));
        const destino = document.getElementById(config.id);
        if (destino) destino.classList.add('active');

        document.getElementById('pageTitle').textContent = config.titulo;

        // Resalta el enlace activo en sidebar y offcanvas.
        document.querySelectorAll('[data-seccion]').forEach(a =>
            a.classList.toggle('active', a.dataset.seccion === seccion)
        );

        // Cierra el menú offcanvas en móviles.
        const oc = bootstrap.Offcanvas.getInstance(document.getElementById('offcanvasMenu'));
        if (oc) oc.hide();

        // Renderiza el contenido según la sección.
        switch (seccion) {
            case 'dashboard':
                Dashboard.actualizar();
                break;
            case 'areas':
                Inventario.renderAreas();
                break;
            case 'inventarioArea':
                if (Inventario.areaVisibleId) {
                    Inventario.mostrarInventarioArea(Inventario.areaVisibleId);
                } else {
                    this.navegar('areas');
                    return;
                }
                break;
            case 'productos':
                Inventario.renderProductos();
                break;
            case 'auditoria':
                if (!this.esAdmin()) {
                    this.mostrarToast('No tienes permisos para realizar auditorías.', 'warning');
                    this.navegar('historial');
                    return;
                }
                if (!document.getElementById('campoAudFecha').value) {
                    document.getElementById('campoAudFecha').value = Utiles.hoyISO();
                }
                if (!document.getElementById('campoAudHora').value) {
                    document.getElementById('campoAudHora').value = Utiles.ahoraHora();
                }
                Auditorias.cargarTablaAuditoria(document.getElementById('campoAudArea').value);
                break;
            case 'historial':
                Auditorias.renderHistorial();
                break;
            case 'reportes':
                this.renderReportes();
                break;
            case 'perfil':
                Perfil.actualizar();
                break;
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    setNavActiva(seccion) {
        document.querySelectorAll('[data-seccion]').forEach(a =>
            a.classList.toggle('active', a.dataset.seccion === seccion)
        );
    },

    /** Refresca todos los módulos tras cualquier cambio de datos (dashboard en tiempo real). */
    refrescarTodo() {
        Dashboard.actualizar();
        Inventario.renderAreas();
        Inventario.renderProductos();
        Auditorias.renderHistorial();
        this.renderReportes();

        if (this.seccionActual === 'inventarioArea' && Inventario.areaVisibleId) {
            Inventario.mostrarInventarioArea(Inventario.areaVisibleId);
        }

        // Refresca los selectores de áreas conservando las selecciones actuales.
        this.refrescarSelect('filtroAreaProductos', { opcionTodas: true, textoOpcionTodas: 'Todas las áreas' });
        this.refrescarSelect('filtroHistorialArea', { opcionTodas: true, textoOpcionTodas: 'Todas' });
        this.refrescarSelect('filtroReporteArea', { opcionTodas: true, textoOpcionTodas: 'Todas las áreas' });
        this.refrescarSelect('campoAudArea', { opcionTodas: false });
    },

    refrescarSelect(idSelect, opciones) {
        const sel = document.getElementById(idSelect);
        if (!sel) return;
        const valor = sel.value;
        Inventario.llenarSelectAreas(sel, opciones);
        if (valor && Array.from(sel.options).some(o => o.value === valor)) {
            sel.value = valor;
        }
    },

    /* ================= PANTALLA INICIAL ================= */

    configurarPantallaInicial() {
        const btnIrAreas = document.getElementById('btnIrAreas');
        if (btnIrAreas) {
            btnIrAreas.addEventListener('click', () => this.navegar('areas'));
        }

        // Acceso rápido al perfil desde el avatar de la barra superior y de los sidebars.
        document.getElementById('avatarTopbar').addEventListener('click', () => this.navegar('perfil'));
        const bloqueUsuario = document.getElementById('bloqueUsuarioSidebar');
        if (bloqueUsuario) {
            bloqueUsuario.addEventListener('click', () => this.navegar('perfil'));
        }
        const bloqueUsuarioMovil = document.getElementById('bloqueUsuarioSidebarMovil');
        if (bloqueUsuarioMovil) {
            bloqueUsuarioMovil.addEventListener('click', () => this.navegar('perfil'));
        }
    },

    /** Muestra la pantalla de bienvenida si la base de datos está vacía. */
    mostrarPantallaInicial() {
        const sinDatos = !StorageManager.tieneDatos();
        const vistaVacia = document.getElementById('vistaVacia');
        vistaVacia.classList.toggle('active', sinDatos);
        if (sinDatos) {
            document.querySelectorAll('.seccion').forEach(s => {
                if (s.id !== 'vistaVacia') s.classList.remove('active');
            });
            this.setNavActiva('');
            document.getElementById('pageTitle').textContent = 'Bienvenido';
        }
    },

    /* ================= VISTA: INVENTARIO DEL ÁREA ================= */

    configurarVistaInventarioArea() {
        document.getElementById('btnVolverAreas').addEventListener('click', () => this.navegar('areas'));

        document.getElementById('btnAuditarArea').addEventListener('click', () => {
            const areaId = Inventario.areaVisibleId;
            this.navegar('auditoria');
            const select = document.getElementById('campoAudArea');
            select.value = areaId || '';
            Auditorias.cargarTablaAuditoria(select.value);
            document.getElementById('campoAudFecha').value = Utiles.hoyISO();
            document.getElementById('campoAudHora').value = Utiles.ahoraHora();
        });

        document.getElementById('btnExportarInventarioArea').addEventListener('click', () => this.exportarInventarioAreaCSV());
        document.getElementById('btnImprimirInventarioArea').addEventListener('click', () => this.imprimirInventarioArea());
    },

    exportarInventarioAreaCSV() {
        const areaId = Inventario.areaVisibleId;
        const area = Inventario.obtenerArea(areaId);
        if (!area) return;
        const productos = Inventario.productosPorArea(areaId);
        if (productos.length === 0) {
            this.mostrarToast('El área no tiene productos para exportar.', 'warning');
            return;
        }
        const encabezados = ['Producto', 'Código', 'Unidad', 'Cantidad', 'Última auditoría'];
        const filas = productos.map(p => {
            const ult = Auditorias.ultimaAuditoriaDeProducto(p.id);
            return [p.nombre, p.codigo || '', p.unidad || 'unidades', p.cantidadActual, ult ? Utiles.formatearFecha(ult.fecha) : ''];
        });
        this.descargarCSV(`inventario_${area.nombre}.csv`, encabezados, filas);
        this.mostrarToast('Inventario del área exportado a CSV.', 'success');
    },

    imprimirInventarioArea() {
        const areaId = Inventario.areaVisibleId;
        const area = Inventario.obtenerArea(areaId);
        if (!area) return;
        const productos = Inventario.productosPorArea(areaId);
        const ultima = Auditorias.ultimaAuditoriaDeArea(areaId);
        const filas = productos.map(p => `
            <tr>
                <td>${Utiles.escapeHtml(p.nombre)}</td>
                <td>${Utiles.escapeHtml(p.codigo || '—')}</td>
                <td>${Utiles.escapeHtml(p.unidad || 'unidades')}</td>
                <td class="text-center">${Utiles.formatearNumero(p.cantidadActual)}</td>
            </tr>`).join('');

        const cuerpo = `
            <p><strong>Área:</strong> ${Utiles.escapeHtml(area.nombre)} &nbsp;|&nbsp;
               <strong>Descripción:</strong> ${Utiles.escapeHtml(area.descripcion || '—')} &nbsp;|&nbsp;
               <strong>Última auditoría:</strong> ${ultima ? Utiles.formatearFecha(ultima.fecha) + ' — ' + Utiles.formatearHora(ultima.hora) : 'Sin auditorías'}</p>
            <table class="tabla-reporte">
                <thead><tr><th>Producto</th><th>Código</th><th>Unidad</th><th>Cantidad</th></tr></thead>
                <tbody>${filas}</tbody>
                <tfoot><tr><th>TOTAL</th><th></th><th></th><th>${Utiles.formatearNumero(Inventario.productosPorArea(areaId).reduce((s, p) => s + Number(p.cantidadActual || 0), 0))}</th></tr></tfoot>
            </table>`;

        this.imprimirReporte(`Inventario — ${area.nombre}`, cuerpo);
    },

    /* ================= VISTA: REPORTES ================= */

    configurarReportes() {
        document.getElementById('buscarInventario').addEventListener('input', () => this.renderReportes());
        document.getElementById('filtroReporteArea').addEventListener('change', () => this.renderReportes());
        document.getElementById('btnExportarInventario').addEventListener('click', () => this.exportarInventarioCSV());
        document.getElementById('btnImprimirInventario').addEventListener('click', () => this.imprimirInventario());

        // Eliminar un producto directamente desde el reporte (solo administrador).
        document.getElementById('tablaInventario').addEventListener('click', e => {
            const boton = e.target.closest('[data-accion]');
            if (!boton) return;
            if (boton.dataset.accion !== 'eliminarProductoReporte') return;
            const id = boton.dataset.id;
            const nombre = boton.dataset.nombre || 'este producto';
            this.confirmar({
                titulo: 'Eliminar producto',
                mensaje: `¿Eliminar «${nombre}» del inventario? Esta acción no se puede deshacer.`,
                textoBoton: 'Eliminar',
                onConfirmar: async () => {
                    try {
                        await StorageManager.apiEliminarProducto(id);
                        this.mostrarToast('Producto eliminado del inventario.', 'success');
                        this.renderReportes();
                        this.refrescarTodo();
                    } catch (error) {
                        this.mostrarToast(error.message, 'danger');
                    }
                }
            });
        });
    },

    obtenerInventarioFiltrado() {
        const termino = Utiles.normalizar(document.getElementById('buscarInventario').value);
        const areaFiltro = document.getElementById('filtroReporteArea').value;

        const filas = [];
        Inventario.inventarioActual().forEach(grupo => {
            if (areaFiltro && grupo.area.id !== areaFiltro) return;
            grupo.productos.forEach(p => {
                const coincide = !termino ||
                    Utiles.normalizar(p.nombre + ' ' + (p.codigo || '') + ' ' + grupo.area.nombre).includes(termino);
                if (coincide) filas.push({ area: grupo.area, producto: p });
            });
        });
        return filas;
    },

    renderReportes() {
        const filas = this.obtenerInventarioFiltrado();
        const tbody = document.getElementById('tablaInventario');
        const vacio = document.getElementById('estadoVacioInventario');
        const esAdmin = this.esAdmin();

        if (filas.length === 0) {
            tbody.innerHTML = '';
            vacio.classList.remove('d-none');
            return;
        }
        vacio.classList.add('d-none');

        // La columna de acciones (eliminar) solo la ve el administrador.
        const colAcciones = esAdmin ? '<th class="text-end">Acciones</th>' : '';
        const encabezado = document.getElementById('encabezadoTablaInventario');
        if (encabezado) encabezado.innerHTML =
            '<tr><th>Área</th><th>Producto</th><th class="d-none d-md-table-cell">Código</th>' +
            '<th class="d-none d-md-table-cell">Unidad</th><th class="text-center">Cantidad</th>' +
            '<th class="d-none d-lg-table-cell">Actualizado</th>' + colAcciones + '</tr>';

        tbody.innerHTML = filas.map(({ area, producto: p }) => `
            <tr>
                <td><span class="badge bg-primary-subtle text-primary">${Utiles.escapeHtml(area.nombre)}</span></td>
                <td><div class="d-flex align-items-center gap-2"><i class="bi bi-box-seam text-success"></i><strong>${Utiles.escapeHtml(p.nombre)}</strong></div></td>
                <td class="d-none d-md-table-cell"><span class="badge text-bg-light border">${Utiles.escapeHtml(p.codigo || '—')}</span></td>
                <td class="d-none d-md-table-cell">${Utiles.escapeHtml(p.unidad || 'unidades')}</td>
                <td class="text-center"><span class="badge text-bg-light border fs-6">${Utiles.formatearNumero(p.cantidadActual)}</span></td>
                <td class="d-none d-lg-table-cell small text-muted">${Utiles.formatearFecha(String(p.fechaActualizacion || '').split('T')[0])}</td>
                ${esAdmin ? `<td class="text-end text-nowrap">
                    <button class="accion-boton danger" title="Eliminar producto" data-accion="eliminarProductoReporte" data-id="${p.id}" data-nombre="${Utiles.escapeHtml(p.nombre)}"><i class="bi bi-trash"></i></button>
                </td>` : ''}
            </tr>`).join('');
    },

    exportarInventarioCSV() {
        const filas = this.obtenerInventarioFiltrado();
        if (filas.length === 0) {
            this.mostrarToast('No hay productos para exportar con los filtros actuales.', 'warning');
            return;
        }
        const encabezados = ['Área', 'Producto', 'Código', 'Unidad', 'Cantidad', 'Actualizado'];
        const datos = filas.map(({ area, producto: p }) => [
            area.nombre, p.nombre, p.codigo || '', p.unidad || 'unidades', p.cantidadActual,
            Utiles.formatearFecha(String(p.fechaActualizacion || '').split('T')[0])
        ]);
        this.descargarCSV('inventario_actual.csv', encabezados, datos);
        this.mostrarToast(`Inventario exportado (${filas.length} producto(s)).`, 'success');
    },

    imprimirInventario() {
        const filas = this.obtenerInventarioFiltrado();
        if (filas.length === 0) {
            this.mostrarToast('No hay productos para imprimir con los filtros actuales.', 'warning');
            return;
        }
        const filasHtml = filas.map(({ area, producto: p }) => `
            <tr>
                <td>${Utiles.escapeHtml(area.nombre)}</td>
                <td>${Utiles.escapeHtml(p.nombre)}</td>
                <td>${Utiles.escapeHtml(p.codigo || '—')}</td>
                <td>${Utiles.escapeHtml(p.unidad || 'unidades')}</td>
                <td class="text-center">${Utiles.formatearNumero(p.cantidadActual)}</td>
            </tr>`).join('');
        const total = filas.reduce((s, f) => s + Number(f.producto.cantidadActual || 0), 0);

        const cuerpo = `
            <table class="tabla-reporte">
                <thead><tr><th>Área</th><th>Producto</th><th>Código</th><th>Unidad</th><th>Cantidad</th></tr></thead>
                <tbody>${filasHtml}</tbody>
                <tfoot><tr><th>TOTAL</th><th></th><th></th><th></th><th>${Utiles.formatearNumero(total)}</th></tr></tfoot>
            </table>`;

        this.imprimirReporte('Inventario actual', cuerpo);
    },

    /* ================= MODALES / TOASTS / CONFIRMACIÓN ================= */

    abrirModal(modalEl) {
        const instancia = bootstrap.Modal.getOrCreateInstance(modalEl);
        instancia.show();
    },

    cerrarModal(modalEl) {
        const instancia = bootstrap.Modal.getInstance(modalEl);
        if (instancia) instancia.hide();
    },

    configurarModalConfirmar() {
        document.getElementById('btnConfirmarModal').addEventListener('click', () => {
            const callback = this.confirmarCallback;
            this.confirmarCallback = null;
            this.cerrarModal(document.getElementById('modalConfirmar'));
            if (typeof callback === 'function') callback();
        });
    },

    confirmar({ titulo, mensaje, textoBoton = 'Eliminar', onConfirmar }) {
        document.getElementById('tituloConfirmar').innerHTML =
            `<i class="bi bi-exclamation-triangle me-2 text-danger"></i>${Utiles.escapeHtml(titulo)}`;
        document.getElementById('mensajeConfirmar').textContent = mensaje;
        document.getElementById('btnConfirmarModal').innerHTML =
            `<i class="bi bi-trash me-1"></i>${Utiles.escapeHtml(textoBoton)}`;
        this.confirmarCallback = onConfirmar;
        this.abrirModal(document.getElementById('modalConfirmar'));
    },

    mostrarToast(mensaje, tipo = 'success') {
        const colores = {
            success: 'text-bg-success',
            danger: 'text-bg-danger',
            warning: 'text-bg-warning',
            info: 'text-bg-info',
            primary: 'text-bg-primary'
        };
        const iconos = {
            success: 'bi-check-circle-fill',
            danger: 'bi-x-circle-fill',
            warning: 'bi-exclamation-triangle-fill',
            info: 'bi-info-circle-fill',
            primary: 'bi-info-circle-fill'
        };
        const color = colores[tipo] || colores.info;
        const icono = iconos[tipo] || iconos.info;

        const contenedor = document.getElementById('toastContainer');
        const el = document.createElement('div');
        el.className = `toast align-items-center ${color} border-0`;
        el.setAttribute('role', 'alert');
        el.setAttribute('aria-live', 'assertive');
        el.innerHTML = `
            <div class="d-flex">
                <div class="toast-body d-flex align-items-center gap-2">
                    <i class="bi ${icono}"></i>
                    <span>${Utiles.escapeHtml(mensaje)}</span>
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button>
            </div>`;
        contenedor.appendChild(el);

        const toast = new bootstrap.Toast(el, { delay: 3500 });
        toast.show();
        el.addEventListener('hidden.bs.toast', () => el.remove());
    },

    /* ================= EXPORTACIÓN CSV / IMPRESIÓN ================= */

    descargarCSV(nombreArchivo, encabezados, filas) {
        const escapar = valor => {
            const s = String(valor === null || valor === undefined ? '' : valor);
            return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const lineas = [
            encabezados.map(escapar).join(';'),
            ...filas.map(f => f.map(escapar).join(';'))
        ];
        const blob = new Blob(['\uFEFF' + lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const enlace = document.createElement('a');
        enlace.href = URL.createObjectURL(blob);
        enlace.download = nombreArchivo;
        document.body.appendChild(enlace);
        enlace.click();
        document.body.removeChild(enlace);
        URL.revokeObjectURL(enlace.href);
    },

    imprimirReporte(titulo, cuerpoHtml) {
        const win = window.open('', '_blank', 'width=920,height=680');
        if (!win) {
            this.mostrarToast('Permite las ventanas emergentes para poder imprimir.', 'warning');
            return;
        }
        const fechaGeneracion = new Date().toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' });
        win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${Utiles.escapeHtml(titulo)}</title>
<style>
    body { font-family: "Segoe UI", Arial, sans-serif; color: #111827; margin: 24px; font-size: 13px; }
    .encabezado { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #2563eb; padding-bottom: 10px; margin-bottom: 16px; }
    .encabezado h1 { font-size: 20px; margin: 0; color: #2563eb; }
    .encabezado small { color: #6b7280; }
    h2 { font-size: 16px; margin: 0 0 12px; }
    p { margin: 4px 0; }
    .tabla-reporte { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
    .tabla-reporte th, .tabla-reporte td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    .tabla-reporte thead th { background: #eef2f8; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; }
    .tabla-reporte tfoot th { background: #eef2f8; }
    .text-center { text-align: center !important; }
    @media print { body { margin: 10mm; } }
</style>
</head>
<body>
    <div class="encabezado">
        <div>
            <h1>Auditoria</h1>
            <small>Reporte de inventario y auditorías</small>
        </div>
        <div style="text-align:right;">
            <strong>${Utiles.escapeHtml(titulo)}</strong><br>
            <small>Generado: ${Utiles.escapeHtml(fechaGeneracion)}</small>
        </div>
    </div>
    <h2>${Utiles.escapeHtml(titulo)}</h2>
    ${cuerpoHtml}
    <script>window.onload = function () { window.focus(); window.print(); };<\/script>
</body>
</html>`);
        win.document.close();
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
