/* =========================================================
   inventario.js — Áreas, Productos e Inventario actual
   ========================================================= */

'use strict';

const Inventario = {

    areaEditandoId: null,
    productoEditandoId: null,
    areaVisibleId: null,

    /* ================= ÁREAS ================= */

    listarAreas() {
        return StorageManager.obtenerDatos().areas;
    },

    obtenerArea(id) {
        return this.listarAreas().find(a => a.id === id) || null;
    },

    async crearArea(nombre, descripcion) {
        await StorageManager.apiCrearArea({ nombre, descripcion });
    },

    async actualizarArea(id, cambios) {
        await StorageManager.apiActualizarArea(id, cambios);
    },

    /** Elimina un área y sus productos (cascada en BD). Las auditorías históricas se conservan. */
    async eliminarArea(id) {
        await StorageManager.apiEliminarArea(id);
    },

    /* ================= PRODUCTOS ================= */

    listarProductos() {
        return StorageManager.obtenerDatos().productos;
    },

    productosPorArea(areaId) {
        return this.listarProductos().filter(p => p.areaId === areaId);
    },

    obtenerProducto(id) {
        return this.listarProductos().find(p => p.id === id) || null;
    },

    async crearProducto(datos) {
        await StorageManager.apiCrearProducto(datos);
    },

    async actualizarProducto(id, cambios) {
        await StorageManager.apiActualizarProducto(id, cambios);
    },

    async eliminarProducto(id) {
        await StorageManager.apiEliminarProducto(id);
    },

    /* ================= CONSULTAS DE INVENTARIO ================= */

    totalProductos() {
        return this.listarProductos().length;
    },

    totalUnidades() {
        return this.listarProductos().reduce((suma, p) => suma + Number(p.cantidadActual || 0), 0);
    },

    /** Inventario actual agrupado por área (para reportes). */
    inventarioActual() {
        const areas = this.listarAreas();
        return areas.map(area => ({
            area,
            productos: this.productosPorArea(area.id),
            totalUnidades: this.productosPorArea(area.id).reduce((s, p) => s + Number(p.cantidadActual || 0), 0)
        }));
    },

    /* ================= SELECTORES ================= */

    /** Llena un <select> con las áreas. Con opción "Todas" si se indica. */
    llenarSelectAreas(select, { opcionTodas = false, textoOpcionTodas = 'Todas las áreas' } = {}) {
        const areas = this.listarAreas();
        select.innerHTML = '';
        if (opcionTodas) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = textoOpcionTodas;
            select.appendChild(opt);
        }
        areas.forEach(area => {
            const opt = document.createElement('option');
            opt.value = area.id;
            opt.textContent = area.nombre;
            select.appendChild(opt);
        });
    },

    /* ================= RENDERIZADO: ÁREAS ================= */

    renderAreas() {
        const termino = Utiles.normalizar(document.getElementById('buscarArea').value);
        const areas = this.listarAreas().filter(a =>
            !termino || Utiles.normalizar(a.nombre + ' ' + (a.descripcion || '')).includes(termino)
        );

        const tbody = document.getElementById('tablaAreas');
        const vacio = document.getElementById('estadoVacioAreas');

        if (areas.length === 0) {
            tbody.innerHTML = '';
            vacio.classList.remove('d-none');
            return;
        }
        vacio.classList.add('d-none');

        const esAdmin = App.esAdmin();
        tbody.innerHTML = areas.map(area => {
            const nProductos = this.productosPorArea(area.id).length;
            const ultima = Auditorias.ultimaAuditoriaDeArea(area.id);
            const acciones = esAdmin ? `
                <button class="accion-boton" title="Editar" data-accion="editarArea" data-id="${area.id}"><i class="bi bi-pencil"></i></button>
                <button class="accion-boton danger" title="Eliminar" data-accion="eliminarArea" data-id="${area.id}"><i class="bi bi-trash"></i></button>` : '';
            return `
            <tr>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <div class="avatar bg-primary-subtle text-primary"><i class="bi bi-buildings"></i></div>
                        <div>
                            <strong>${Utiles.escapeHtml(area.nombre)}</strong>
                            <small class="text-muted d-block d-md-none">${Utiles.escapeHtml(area.descripcion || 'Sin descripción')}</small>
                        </div>
                    </div>
                </td>
                <td class="d-none d-md-table-cell text-muted small">${Utiles.escapeHtml(area.descripcion || '—')}</td>
                <td class="text-center"><span class="badge text-bg-light border">${nProductos}</span></td>
                <td><span class="badge bg-success-subtle text-success">Activo</span></td>
                <td class="d-none d-lg-table-cell small">
                    ${ultima ? `<i class="bi bi-clock me-1 text-muted"></i>${Utiles.formatearFecha(ultima.fecha)} — ${Utiles.formatearHora(ultima.hora)}` : '<span class="text-muted">Sin auditorías</span>'}
                </td>
                <td class="text-end text-nowrap">
                    <button class="accion-boton" title="Ver inventario" data-accion="verArea" data-id="${area.id}"><i class="bi bi-eye"></i></button>
                    ${acciones}
                </td>
            </tr>`;
        }).join('');
    },

    /* ================= RENDERIZADO: PRODUCTOS ================= */

    renderProductos() {
        const termino = Utiles.normalizar(document.getElementById('buscarProducto').value);
        const areaFiltro = document.getElementById('filtroAreaProductos').value;
        const areas = this.listarAreas();

        let productos = this.listarProductos().filter(p => {
            const area = areas.find(a => a.id === p.areaId);
            const coincideArea = !areaFiltro || p.areaId === areaFiltro;
            const coincideTexto = !termino || Utiles.normalizar(p.nombre + ' ' + (p.codigo || '') + ' ' + (area ? area.nombre : '')).includes(termino);
            return coincideArea && coincideTexto;
        });

        const tbody = document.getElementById('tablaProductos');
        const vacio = document.getElementById('estadoVacioProductos');

        if (productos.length === 0) {
            tbody.innerHTML = '';
            vacio.classList.remove('d-none');
            return;
        }
        vacio.classList.add('d-none');

        const esAdmin = App.esAdmin();
        tbody.innerHTML = productos.map(p => {
            const area = areas.find(a => a.id === p.areaId);
            const acciones = esAdmin ? `
                <button class="accion-boton" title="Editar" data-accion="editarProducto" data-id="${p.id}"><i class="bi bi-pencil"></i></button>
                <button class="accion-boton danger" title="Eliminar" data-accion="eliminarProducto" data-id="${p.id}"><i class="bi bi-trash"></i></button>` : '';
            return `
            <tr>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <div class="avatar bg-success-subtle text-success"><i class="bi bi-box-seam"></i></div>
                        <strong>${Utiles.escapeHtml(p.nombre)}</strong>
                    </div>
                </td>
                <td><span class="badge text-bg-light border">${Utiles.escapeHtml(p.codigo || '—')}</span></td>
                <td>${area ? `<span class="badge bg-primary-subtle text-primary">${Utiles.escapeHtml(area.nombre)}</span>` : '<span class="text-muted">—</span>'}</td>
                <td class="d-none d-md-table-cell">${Utiles.escapeHtml(p.unidad || 'unidades')}</td>
                <td class="text-center"><span class="badge text-bg-light border fs-6">${Utiles.formatearNumero(p.cantidadActual)}</span></td>
                <td class="d-none d-lg-table-cell small text-muted">${Utiles.formatearFecha(String(p.fechaActualizacion || '').split('T')[0])}</td>
                <td class="text-end text-nowrap">${acciones}</td>
            </tr>`;
        }).join('');
    },

    /* ================= RENDERIZADO: INVENTARIO DE UN ÁREA ================= */

    mostrarInventarioArea(areaId) {
        this.areaVisibleId = areaId;
        const area = this.obtenerArea(areaId);
        if (!area) {
            App.mostrarToast('El área no existe.', 'danger');
            App.navegar('areas');
            return;
        }

        document.getElementById('tituloInventarioArea').textContent = `INVENTARIO — ${area.nombre.toUpperCase()}`;
        document.getElementById('subtituloInventarioArea').textContent = area.descripcion || 'Sin descripción';

        const ultima = Auditorias.ultimaAuditoriaDeArea(areaId);
        document.getElementById('txtUltimaAuditoriaArea').textContent =
            ultima ? `${Utiles.formatearFecha(ultima.fecha)} — ${Utiles.formatearHora(ultima.hora)}` : 'Sin auditorías aún';

        const productos = this.productosPorArea(areaId);
        const tbody = document.getElementById('tablaInventarioArea');
        const vacio = document.getElementById('estadoVacioInventarioArea');

        if (productos.length === 0) {
            tbody.innerHTML = '';
            vacio.classList.remove('d-none');
            return;
        }
        vacio.classList.add('d-none');

        const esAdmin = App.esAdmin();
        tbody.innerHTML = productos.map(p => {
            const ultimaProducto = Auditorias.ultimaAuditoriaDeProducto(p.id);
            const acciones = esAdmin ? `
                <button class="accion-boton" title="Editar producto" data-accion="editarProducto" data-id="${p.id}"><i class="bi bi-pencil"></i></button>
                <button class="accion-boton danger" title="Eliminar producto" data-accion="eliminarProducto" data-id="${p.id}"><i class="bi bi-trash"></i></button>` : '';
            return `
            <tr>
                <td><div class="d-flex align-items-center gap-2"><div class="avatar bg-success-subtle text-success"><i class="bi bi-box-seam"></i></div><strong>${Utiles.escapeHtml(p.nombre)}</strong></div></td>
                <td><span class="badge text-bg-light border">${Utiles.escapeHtml(p.codigo || '—')}</span></td>
                <td class="d-none d-md-table-cell">${Utiles.escapeHtml(p.unidad || 'unidades')}</td>
                <td class="text-center"><span class="badge text-bg-light border fs-6">${Utiles.formatearNumero(p.cantidadActual)}</span></td>
                <td class="d-none d-lg-table-cell small">
                    ${ultimaProducto ? `${Utiles.formatearFecha(ultimaProducto.fecha)}` : '<span class="text-muted">—</span>'}
                </td>
                <td class="text-end text-nowrap">${acciones}</td>
            </tr>`;
        }).join('');
    },

    /* ================= MODALES ================= */

    abrirModalArea(id = null) {
        if (!App.esAdmin()) {
            App.mostrarToast('No tienes permisos para modificar áreas.', 'warning');
            return;
        }
        this.areaEditandoId = id;
        const modal = document.getElementById('modalArea');
        const formulario = document.getElementById('formArea');
        formulario.reset();
        formulario.classList.remove('was-validated');

        document.getElementById('tituloModalArea').textContent = id ? 'Editar Área' : 'Nueva Área';
        if (id) {
            const area = this.obtenerArea(id);
            if (!area) return;
            document.getElementById('campoAreaNombre').value = area.nombre;
            document.getElementById('campoAreaDescripcion').value = area.descripcion || '';
        }
        App.abrirModal(modal);
        setTimeout(() => document.getElementById('campoAreaNombre').focus(), 150);
    },

    abrirModalProducto(id = null) {
        if (!App.esAdmin()) {
            App.mostrarToast('No tienes permisos para modificar productos.', 'warning');
            return;
        }
        this.productoEditandoId = id;
        const modal = document.getElementById('modalProducto');
        const formulario = document.getElementById('formProducto');
        formulario.reset();
        formulario.classList.remove('was-validated');

        const selectArea = document.getElementById('campoProductoArea');
        this.llenarSelectAreas(selectArea, { opcionTodas: false });
        if (this.listarAreas().length === 0) {
            App.mostrarToast('Primero crea un área para poder registrar productos.', 'warning');
            App.navegar('areas');
            App.abrirModalArea();
            return;
        }

        document.getElementById('tituloModalProducto').textContent = id ? 'Editar Producto' : 'Nuevo Producto';

        if (id) {
            const producto = this.obtenerProducto(id);
            if (!producto) return;
            selectArea.value = producto.areaId;
            document.getElementById('campoProductoNombre').value = producto.nombre;
            document.getElementById('campoProductoCodigo').value = producto.codigo || '';
            document.getElementById('campoProductoUnidad').value = producto.unidad || 'unidades';
        }
        App.abrirModal(modal);
        setTimeout(() => document.getElementById('campoProductoNombre').focus(), 150);
    },

    async guardarAreaDesdeFormulario() {
        if (!App.esAdmin()) {
            App.mostrarToast('No tienes permisos para modificar áreas.', 'warning');
            return;
        }
        const formulario = document.getElementById('formArea');
        if (!formulario.checkValidity()) {
            formulario.classList.add('was-validated');
            return;
        }
        const nombre = document.getElementById('campoAreaNombre').value;
        const descripcion = document.getElementById('campoAreaDescripcion').value;

        try {
            if (this.areaEditandoId) {
                await this.actualizarArea(this.areaEditandoId, { nombre, descripcion });
                App.mostrarToast('Área actualizada correctamente.', 'success');
            } else {
                await this.crearArea(nombre, descripcion);
                App.mostrarToast('Área creada correctamente.', 'success');
            }
            App.cerrarModal(document.getElementById('modalArea'));
            App.refrescarTodo();
        } catch (error) {
            App.mostrarToast(error.message || 'No se pudo guardar el área.', 'danger');
        }
    },

    async guardarProductoDesdeFormulario() {
        if (!App.esAdmin()) {
            App.mostrarToast('No tienes permisos para modificar productos.', 'warning');
            return;
        }
        const formulario = document.getElementById('formProducto');
        if (!formulario.checkValidity()) {
            formulario.classList.add('was-validated');
            return;
        }
        const datos = {
            areaId: document.getElementById('campoProductoArea').value,
            nombre: document.getElementById('campoProductoNombre').value,
            codigo: document.getElementById('campoProductoCodigo').value,
            unidad: document.getElementById('campoProductoUnidad').value
        };

        try {
            if (this.productoEditandoId) {
                await this.actualizarProducto(this.productoEditandoId, datos);
                App.mostrarToast('Producto actualizado correctamente.', 'success');
            } else {
                await this.crearProducto(datos);
                App.mostrarToast('Producto creado correctamente.', 'success');
            }
            App.cerrarModal(document.getElementById('modalProducto'));
            App.refrescarTodo();
        } catch (error) {
            App.mostrarToast(error.message || 'No se pudo guardar el producto.', 'danger');
        }
    },

    /* ================= EVENTOS / INIT ================= */

    init() {
        // Búsqueda instantánea de áreas
        document.getElementById('buscarArea').addEventListener('input', () => this.renderAreas());
        document.getElementById('btnNuevaArea').addEventListener('click', () => this.abrirModalArea());

        // Búsqueda instantánea y filtro de productos
        document.getElementById('buscarProducto').addEventListener('input', () => this.renderProductos());
        document.getElementById('filtroAreaProductos').addEventListener('change', () => this.renderProductos());
        document.getElementById('btnNuevoProducto').addEventListener('click', () => this.abrirModalProducto());

        // Formularios de los modales
        document.getElementById('formArea').addEventListener('submit', e => {
            e.preventDefault();
            this.guardarAreaDesdeFormulario();
        });
        document.getElementById('formProducto').addEventListener('submit', e => {
            e.preventDefault();
            this.guardarProductoDesdeFormulario();
        });

        // Acciones de las tablas (delegación de eventos)
        document.querySelectorAll('tbody').forEach(tbody => {
            tbody.addEventListener('click', e => {
                const boton = e.target.closest('[data-accion]');
                if (!boton) return;
                const accion = boton.dataset.accion;
                const id = boton.dataset.id;

                switch (accion) {
                    case 'verArea':
                        App.navegar('inventarioArea');
                        this.mostrarInventarioArea(id);
                        break;
                    case 'editarArea':
                        this.abrirModalArea(id);
                        break;
                    case 'eliminarArea': {
                        const area = this.obtenerArea(id);
                        const nProductos = this.productosPorArea(id).length;
                        App.confirmar({
                            titulo: 'Eliminar área',
                            mensaje: `¿Eliminar el área «${area ? area.nombre : ''}»? Se eliminarán también sus ${nProductos} producto(s). Las auditorías históricas se conservarán.`,
                            textoBoton: 'Eliminar',
                            onConfirmar: async () => {
                                try {
                                    await this.eliminarArea(id);
                                    App.mostrarToast('Área eliminada.', 'success');
                                    App.refrescarTodo();
                                } catch (error) {
                                    App.mostrarToast(error.message, 'danger');
                                }
                            }
                        });
                        break;
                    }
                    case 'editarProducto':
                        this.abrirModalProducto(id);
                        break;
                    case 'eliminarProducto': {
                        const prod = this.obtenerProducto(id);
                        App.confirmar({
                            titulo: 'Eliminar producto',
                            mensaje: `¿Eliminar el producto «${prod ? prod.nombre : ''}»?`,
                            textoBoton: 'Eliminar',
                            onConfirmar: async () => {
                                try {
                                    await this.eliminarProducto(id);
                                    App.mostrarToast('Producto eliminado.', 'success');
                                    App.refrescarTodo();
                                } catch (error) {
                                    App.mostrarToast(error.message, 'danger');
                                }
                            }
                        });
                        break;
                    }
                }
            });
        });
    }
};
