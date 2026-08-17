/* =========================================================
   auditorias.js — Auditorías, Historial y Comparaciones
   ========================================================= */

'use strict';

const Auditorias = {

    /* ================= CONSULTAS ================= */

    /** Lista las auditorías de más reciente a más antigua. */
    listarAuditorias() {
        return StorageManager.obtenerDatos().auditorias
            .slice()
            .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
    },

    obtenerAuditoria(id) {
        return this.listarAuditorias().find(a => a.id === id) || null;
    },

    ultimaAuditoriaDeArea(areaId) {
        return this.listarAuditorias().find(a => a.areaId === areaId) || null;
    },

    ultimaAuditoriaDeProducto(productoId) {
        let mejor = null;
        this.listarAuditorias().forEach(a => {
            const detalle = a.detalles.find(d => d.productoId === productoId);
            if (detalle && (!mejor || (a.fecha + a.hora) > (mejor.fecha + mejor.hora))) {
                mejor = a;
            }
        });
        if (!mejor) return null;
        const detalle = mejor.detalles.find(d => d.productoId === productoId);
        return { fecha: mejor.fecha, hora: mejor.hora, cantidad: detalle ? detalle.cantidadAuditada : null };
    },

    filtrarAuditorias({ busqueda = '', areaId = '', fecha = '', mes = '' } = {}) {
        const termino = Utiles.normalizar(busqueda);
        return this.listarAuditorias().filter(a => {
            if (areaId && a.areaId !== areaId) return false;
            if (fecha && a.fecha !== fecha) return false;
            if (mes && !a.fecha.startsWith(mes)) return false;
            if (termino) {
                const texto = Utiles.normalizar(
                    (a.areaNombre || '') + ' ' + (a.responsable || '') + ' ' + (a.observacion || '')
                );
                if (!texto.includes(termino)) return false;
            }
            return true;
        });
    },

    /* ================= CREACIÓN ================= */

    /**
     * Crea una auditoría (snapshot histórico). El backend guarda la auditoría,
     * sus detalles y actualiza las cantidades actuales en una transacción.
     * Devuelve la auditoría creada.
     */
    async crearAuditoria({ areaId, fecha, hora, responsable, observacion, cantidades }) {
        const datos = StorageManager.obtenerDatos();
        const area = datos.areas.find(a => a.id === areaId);
        if (!area) throw new Error('El área seleccionada no es válida.');

        const productos = datos.productos.filter(p => p.areaId === areaId);
        if (productos.length === 0) throw new Error('El área no tiene productos para auditar.');

        const segundos = String(new Date().getSeconds()).padStart(2, '0');
        const horaConSegundos = hora.length === 5 ? `${hora}:${segundos}` : hora;

        const detalles = productos.map(p => {
            const auditada = Math.max(0, Number(cantidades[p.id]) || 0);
            return {
                productoId: p.id,
                productoNombre: p.nombre,
                cantidadAuditada: auditada
            };
        });

        const auditoria = {
            id: Utiles.generarId('aud'),
            areaId,
            areaNombre: area.nombre,
            fecha,
            hora: horaConSegundos,
            responsable: (responsable || '').trim(),
            observacion: (observacion || '').trim(),
            detalles,
            creadoEn: new Date().toISOString()
        };

        await StorageManager.apiCrearAuditoria(auditoria);
        return auditoria;
    },

    async eliminarAuditoria(id) {
        await StorageManager.apiEliminarAuditoria(id);
    },

    /* ================= NUEVA AUDITORÍA (captura) ================= */

    cargarTablaAuditoria(areaId) {
        const tbody = document.getElementById('tablaAuditoriaProductos');
        const vacio = document.getElementById('estadoVacioAuditoriaProductos');
        const badge = document.getElementById('badgeConteoAuditoria');

        if (!areaId) {
            tbody.innerHTML = '';
            vacio.classList.remove('d-none');
            badge.textContent = '0 productos';
            document.getElementById('tituloAuditoriaProductos').innerHTML =
                '<i class="bi bi-box-seam me-2 text-success"></i>Productos del área';
            return;
        }

        const area = Inventario.obtenerArea(areaId);
        const productos = Inventario.productosPorArea(areaId);
        vacio.classList.add('d-none');
        badge.textContent = `${productos.length} producto(s)`;
        document.getElementById('tituloAuditoriaProductos').innerHTML =
            `<i class="bi bi-box-seam me-2 text-success"></i>Auditoría — ${Utiles.escapeHtml(area ? area.nombre.toUpperCase() : '')}`;

        if (productos.length === 0) {
            tbody.innerHTML = '';
            vacio.classList.remove('d-none');
            vacio.innerHTML = '<i class="bi bi-inbox"></i><p>Esta área no tiene productos.<br><small class="text-muted">Agrega productos desde el módulo Productos.</small></p>';
            return;
        }

        tbody.innerHTML = productos.map(p => `
            <tr>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <div class="avatar bg-success-subtle text-success"><i class="bi bi-box-seam"></i></div>
                        <strong>${Utiles.escapeHtml(p.nombre)}</strong>
                    </div>
                </td>
                <td class="text-center d-none d-sm-table-cell text-muted">${Utiles.escapeHtml(p.unidad || 'unidades')}</td>
                <td class="text-center">
                    <input type="number" class="form-control form-control-sm input-cantidad mx-auto" min="0" step="1"
                           data-producto-id="${p.id}" value="" placeholder="0" aria-label="Cantidad encontrada de ${Utiles.escapeHtml(p.nombre)}">
                </td>
            </tr>`).join('');
    },

    async guardarAuditoriaDesdeFormulario() {
        if (!App.esAdmin()) {
            App.mostrarToast('No tienes permisos para realizar auditorías.', 'warning');
            return;
        }
        const areaId = document.getElementById('campoAudArea').value;
        const fecha = document.getElementById('campoAudFecha').value;
        const hora = document.getElementById('campoAudHora').value;

        if (!areaId) {
            App.mostrarToast('Selecciona un área para auditar.', 'warning');
            return;
        }
        if (!fecha) {
            App.mostrarToast('Selecciona la fecha de la auditoría.', 'warning');
            return;
        }
        if (!hora) {
            App.mostrarToast('Selecciona la hora de la auditoría.', 'warning');
            return;
        }

        const inputs = Array.from(document.querySelectorAll('#tablaAuditoriaProductos .input-cantidad'));
        if (inputs.length === 0) {
            App.mostrarToast('El área seleccionada no tiene productos para auditar.', 'warning');
            return;
        }

        const cantidades = {};
        for (const input of inputs) {
            const valor = input.value === '' ? 0 : Number(input.value);
            if (Number.isNaN(valor) || valor < 0) {
                input.classList.add('is-invalid');
                App.mostrarToast('Revisa las cantidades encontradas: deben ser números iguales o mayores a cero.', 'danger');
                input.focus();
                return;
            }
            input.classList.remove('is-invalid');
            cantidades[input.dataset.productoId] = valor;
        }

        try {
            const auditoria = await this.crearAuditoria({
                areaId,
                fecha,
                hora,
                responsable: document.getElementById('campoAudResponsable').value,
                observacion: document.getElementById('campoAudObservacion').value,
                cantidades
            });
            App.mostrarToast(`Auditoría guardada correctamente (#${this.numeroDeAuditoria(auditoria.id)}).`, 'success');
            this.resetearFormularioAuditoria();
            App.refrescarTodo();
        } catch (error) {
            App.mostrarToast(error.message || 'No se pudo guardar la auditoría.', 'danger');
        }
    },

    resetearFormularioAuditoria() {
        document.getElementById('campoAudArea').value = '';
        document.getElementById('campoAudFecha').value = Utiles.hoyISO();
        document.getElementById('campoAudHora').value = Utiles.ahoraHora();
        document.getElementById('campoAudResponsable').value = '';
        document.getElementById('campoAudObservacion').value = '';
        this.cargarTablaAuditoria('');
    },

    numeroDeAuditoria(id) {
        const lista = this.listarAuditorias();
        const indice = lista.findIndex(a => a.id === id);
        return indice >= 0 ? String(indice + 1).padStart(4, '0') : '0000';
    },

    /* ================= HISTORIAL ================= */

    renderHistorial() {
        const busqueda = document.getElementById('buscarHistorial').value;
        const areaId = document.getElementById('filtroHistorialArea').value;
        const fecha = document.getElementById('filtroHistorialFecha').value;
        const mes = document.getElementById('filtroHistorialMes').value;

        const auditorias = this.filtrarAuditorias({ busqueda, areaId, fecha, mes });
        const tbody = document.getElementById('tablaHistorial');
        const vacio = document.getElementById('estadoVacioHistorial');

        if (auditorias.length === 0) {
            tbody.innerHTML = '';
            vacio.classList.remove('d-none');
            return;
        }
        vacio.classList.add('d-none');

        const posiciones = {};
        this.listarAuditorias().forEach((a, i) => { posiciones[a.id] = i + 1; });

        tbody.innerHTML = auditorias.map(a => {
            const totalUnidades = a.detalles.reduce((s, d) => s + Number(d.cantidadAuditada || 0), 0);
            return `
            <tr>
                <td class="text-muted">#${String(posiciones[a.id] || '').padStart(4, '0')}</td>
                <td class="fw-semibold">${Utiles.formatearFecha(a.fecha)}</td>
                <td>${Utiles.formatearHora(a.hora)}</td>
                <td><span class="badge bg-primary-subtle text-primary">${Utiles.escapeHtml(a.areaNombre || '—')}</span></td>
                <td class="d-none d-md-table-cell">${Utiles.escapeHtml(a.responsable || '—')}</td>
                <td class="text-center d-none d-lg-table-cell">${a.detalles.length}</td>
                <td class="text-center">${Utiles.formatearNumero(totalUnidades)}</td>
                <td class="d-none d-xl-table-cell text-muted small" style="max-width:180px;">
                    <span class="d-inline-block text-truncate w-100">${Utiles.escapeHtml(a.observacion || '—')}</span>
                </td>
                <td class="text-end text-nowrap">
                    <button class="accion-boton" title="Ver detalle" data-accion="verAuditoria" data-id="${a.id}"><i class="bi bi-eye"></i></button>
                    <button class="accion-boton" title="Comparar" data-accion="compararAuditoria" data-id="${a.id}"><i class="bi bi-arrow-left-right"></i></button>
                    <button class="accion-boton" title="Imprimir" data-accion="imprimirAuditoria" data-id="${a.id}"><i class="bi bi-printer"></i></button>
                    <button class="accion-boton danger solo-admin" title="Eliminar" data-accion="eliminarAuditoria" data-id="${a.id}"><i class="bi bi-trash"></i></button>
                </td>
            </tr>`;
        }).join('');
    },

    /* ================= DETALLE ================= */

    mostrarDetalle(id) {
        const a = this.obtenerAuditoria(id);
        if (!a) return;
        document.getElementById('tituloDetalleAuditoria').innerHTML =
            `<i class="bi bi-clipboard2-check me-2 text-primary"></i>AUDITORÍA #${this.numeroDeAuditoria(a.id)}`;

        document.getElementById('cuerpoDetalleAuditoria').innerHTML = `
            <div class="detalle-auditoria">
                <div class="detalle-header">
                    <div class="row g-2">
                        <div class="col-sm-4 detalle-item"><small class="text-muted d-block">Área</small><strong>${Utiles.escapeHtml(a.areaNombre || '—')}</strong></div>
                        <div class="col-sm-4 detalle-item"><small class="text-muted d-block">Fecha</small><strong>${Utiles.formatearFecha(a.fecha)}</strong></div>
                        <div class="col-sm-4 detalle-item"><small class="text-muted d-block">Hora</small><strong>${Utiles.escapeHtml(a.hora || '—')}</strong></div>
                        <div class="col-sm-4 detalle-item"><small class="text-muted d-block">Responsable</small><strong>${Utiles.escapeHtml(a.responsable || 'No indicado')}</strong></div>
                        <div class="col-sm-8 detalle-item"><small class="text-muted d-block">Observación</small><strong>${Utiles.escapeHtml(a.observacion || 'Sin observación')}</strong></div>
                    </div>
                </div>
                <table class="table table-sm align-middle">
                    <thead>
                        <tr><th>Producto</th><th class="text-center">Cantidad encontrada</th></tr>
                    </thead>
                    <tbody>
                        ${a.detalles.map(d => `
                            <tr>
                                <td>${Utiles.escapeHtml(d.productoNombre)}</td>
                                <td class="text-center fw-bold">${Utiles.formatearNumero(d.cantidadAuditada)}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;

        // Guarda el id para la impresión del detalle.
        document.getElementById('btnImprimirDetalle').dataset.auditoriaId = id;
        App.abrirModal(document.getElementById('modalDetalleAuditoria'));
    },

    badgeDiferencia(diferencia) {
        const d = Number(diferencia) || 0;
        if (d > 0) return `<span class="badge bg-success-subtle text-success diferencia-badge">Aumento +${d}</span>`;
        if (d < 0) return `<span class="badge bg-danger-subtle text-danger diferencia-badge">Disminución ${d}</span>`;
        return `<span class="badge bg-secondary-subtle text-secondary diferencia-badge">Sin cambios</span>`;
    },

    /* ================= COMPARACIÓN ================= */

    abrirComparacion(id) {
        const auditoriaActual = this.obtenerAuditoria(id);
        if (!auditoriaActual) return;

        const auditoriasArea = this.listarAuditorias().filter(a => a.areaId === auditoriaActual.areaId);
        if (auditoriasArea.length < 2) {
            App.mostrarToast('Se necesitan al menos dos auditorías del mismo área para comparar.', 'warning');
            return;
        }

        const selectActual = document.getElementById('selectAudActual');
        const selectAnterior = document.getElementById('selectAudAnterior');
        selectActual.innerHTML = '';
        selectAnterior.innerHTML = '';

        auditoriasArea.forEach((a, i) => {
            const texto = `#${String(i + 1).padStart(4, '0')} — ${Utiles.formatearFecha(a.fecha)} ${Utiles.formatearHora(a.hora)}`;
            selectActual.insertAdjacentHTML('beforeend', `<option value="${a.id}">${texto}</option>`);
            selectAnterior.insertAdjacentHTML('beforeend', `<option value="${a.id}">${texto}</option>`);
        });

        selectActual.value = auditoriaActual.id;
        // Preselecciona la auditoría inmediatamente anterior (si existe).
        const indice = auditoriasArea.findIndex(a => a.id === auditoriaActual.id);
        selectAnterior.value = indice > 0 ? auditoriasArea[indice - 1].id : auditoriasArea[auditoriasArea.length - 1].id;

        this.renderComparacion();
        App.abrirModal(document.getElementById('modalComparar'));
    },

    renderComparacion() {
        const idActual = document.getElementById('selectAudActual').value;
        const idAnterior = document.getElementById('selectAudAnterior').value;
        const actual = this.obtenerAuditoria(idActual);
        const anterior = this.obtenerAuditoria(idAnterior);

        const contenedor = document.getElementById('cuerpoComparacion');
        if (!actual || !anterior) {
            contenedor.innerHTML = '<div class="estado-vacio"><i class="bi bi-inbox"></i><p>Selecciona dos auditorías para comparar.</p></div>';
            return;
        }

        const filas = actual.detalles.map(dActual => {
            const dAnterior = (anterior.detalles || []).find(d => d.productoId === dActual.productoId);
            const cantidadAnterior = dAnterior ? dAnterior.cantidadAuditada : 0;
            const diferencia = dActual.cantidadAuditada - cantidadAnterior;
            return `
                <tr>
                    <td>${Utiles.escapeHtml(dActual.productoNombre)}</td>
                    <td class="text-center">${Utiles.formatearNumero(cantidadAnterior)}</td>
                    <td class="text-center fw-bold">${Utiles.formatearNumero(dActual.cantidadAuditada)}</td>
                    <td class="text-center">${this.badgeDiferencia(diferencia)}</td>
                </tr>`;
        }).join('');

        const totalAnterior = anterior.detalles.reduce((s, d) => s + Number(d.cantidadAuditada || 0), 0);
        const totalActual = actual.detalles.reduce((s, d) => s + Number(d.cantidadAuditada || 0), 0);

        contenedor.innerHTML = `
            <div class="d-flex flex-wrap gap-2 mb-3">
                <span class="badge bg-secondary-subtle text-secondary">Anterior: ${Utiles.formatearFecha(anterior.fecha)}</span>
                <span class="badge bg-primary-subtle text-primary">Actual: ${Utiles.formatearFecha(actual.fecha)}</span>
            </div>
            <div class="table-responsive">
                <table class="table table-sm align-middle">
                    <thead>
                        <tr><th>Producto</th><th class="text-center">Anterior</th><th class="text-center">Actual</th><th class="text-center">Diferencia</th></tr>
                    </thead>
                    <tbody>${filas}</tbody>
                    <tfoot>
                        <tr class="table-light fw-bold">
                            <td>TOTAL</td>
                            <td class="text-center">${Utiles.formatearNumero(totalAnterior)}</td>
                            <td class="text-center">${Utiles.formatearNumero(totalActual)}</td>
                            <td class="text-center">${this.badgeDiferencia(totalActual - totalAnterior)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>`;
    },

    /* ================= EXPORTACIONES ================= */

    exportarCSVHistorial() {
        const busqueda = document.getElementById('buscarHistorial').value;
        const areaId = document.getElementById('filtroHistorialArea').value;
        const fecha = document.getElementById('filtroHistorialFecha').value;
        const mes = document.getElementById('filtroHistorialMes').value;

        const auditorias = this.filtrarAuditorias({ busqueda, areaId, fecha, mes });
        if (auditorias.length === 0) {
            App.mostrarToast('No hay auditorías para exportar con los filtros actuales.', 'warning');
            return;
        }

        const encabezados = ['Nro', 'Fecha', 'Hora', 'Área', 'Responsable', 'Productos', 'Unidades', 'Observación'];
        const filas = auditorias.map(a => {
            const total = a.detalles.reduce((s, d) => s + Number(d.cantidadAuditada || 0), 0);
            return [this.numeroDeAuditoria(a.id), Utiles.formatearFecha(a.fecha), a.hora, a.areaNombre, a.responsable || '', a.detalles.length, total, a.observacion || ''];
        });
        App.descargarCSV('historial_auditorias.csv', encabezados, filas);
        App.mostrarToast(`${auditorias.length} auditoría(s) exportadas a CSV.`, 'success');
    },

    imprimirAuditoria(id) {
        const a = this.obtenerAuditoria(id);
        if (!a) return;

        const filas = a.detalles.map(d => `
            <tr>
                <td>${Utiles.escapeHtml(d.productoNombre)}</td>
                <td class="text-center">${Utiles.formatearNumero(d.cantidadAuditada)}</td>
            </tr>`).join('');

        const cuerpo = `
            <p><strong>Área:</strong> ${Utiles.escapeHtml(a.areaNombre)} &nbsp;|&nbsp; <strong>Fecha:</strong> ${Utiles.formatearFecha(a.fecha)} &nbsp;|&nbsp; <strong>Hora:</strong> ${Utiles.escapeHtml(a.hora)}</p>
            <p><strong>Responsable:</strong> ${Utiles.escapeHtml(a.responsable || 'No indicado')} &nbsp;|&nbsp; <strong>Observación:</strong> ${Utiles.escapeHtml(a.observacion || '—')}</p>
            <table class="tabla-reporte">
                <thead><tr><th>Producto</th><th>Encontrado</th></tr></thead>
                <tbody>${filas}</tbody>
            </table>`;

        App.imprimirReporte(`Auditoría #${this.numeroDeAuditoria(a.id)} — ${a.areaNombre}`, cuerpo);
    },

    imprimirHistorial() {
        const busqueda = document.getElementById('buscarHistorial').value;
        const areaId = document.getElementById('filtroHistorialArea').value;
        const fecha = document.getElementById('filtroHistorialFecha').value;
        const mes = document.getElementById('filtroHistorialMes').value;

        const auditorias = this.filtrarAuditorias({ busqueda, areaId, fecha, mes });
        if (auditorias.length === 0) {
            App.mostrarToast('No hay auditorías para imprimir con los filtros actuales.', 'warning');
            return;
        }

        const filas = auditorias.map(a => {
            const total = a.detalles.reduce((s, d) => s + Number(d.cantidadAuditada || 0), 0);
            return `<tr>
                <td>${Utiles.formatearFecha(a.fecha)}</td>
                <td>${Utiles.formatearHora(a.hora)}</td>
                <td>${Utiles.escapeHtml(a.areaNombre)}</td>
                <td>${Utiles.escapeHtml(a.responsable || '—')}</td>
                <td class="text-center">${a.detalles.length}</td>
                <td class="text-center">${Utiles.formatearNumero(total)}</td>
                <td>${Utiles.escapeHtml(a.observacion || '—')}</td>
            </tr>`;
        }).join('');

        const cuerpo = `
            <table class="tabla-reporte">
                <thead><tr><th>Fecha</th><th>Hora</th><th>Área</th><th>Responsable</th><th>Productos</th><th>Unidades</th><th>Observación</th></tr></thead>
                <tbody>${filas}</tbody>
            </table>`;

        App.imprimirReporte('Historial de auditorías', cuerpo);
    },

    imprimirComparacion() {
        const idActual = document.getElementById('selectAudActual').value;
        const idAnterior = document.getElementById('selectAudAnterior').value;
        const actual = this.obtenerAuditoria(idActual);
        const anterior = this.obtenerAuditoria(idAnterior);
        if (!actual || !anterior) return;

        const filas = actual.detalles.map(dActual => {
            const dAnterior = (anterior.detalles || []).find(d => d.productoId === dActual.productoId);
            const cantAnterior = dAnterior ? dAnterior.cantidadAuditada : 0;
            const diferencia = dActual.cantidadAuditada - cantAnterior;
            return `<tr>
                <td>${Utiles.escapeHtml(dActual.productoNombre)}</td>
                <td class="text-center">${Utiles.formatearNumero(cantAnterior)}</td>
                <td class="text-center">${Utiles.formatearNumero(dActual.cantidadAuditada)}</td>
                <td class="text-center">${diferencia > 0 ? '+' : ''}${diferencia}</td>
            </tr>`;
        }).join('');

        const cuerpo = `
            <p><strong>Auditoría anterior:</strong> ${Utiles.formatearFecha(anterior.fecha)} ${Utiles.formatearHora(anterior.hora)} &nbsp;|&nbsp;
               <strong>Auditoría actual:</strong> ${Utiles.formatearFecha(actual.fecha)} ${Utiles.formatearHora(actual.hora)}</p>
            <table class="tabla-reporte">
                <thead><tr><th>Producto</th><th>Anterior</th><th>Actual</th><th>Diferencia</th></tr></thead>
                <tbody>${filas}</tbody>
            </table>`;

        App.imprimirReporte(`Comparación — ${actual.areaNombre}`, cuerpo);
    },

    /* ================= EVENTOS / INIT ================= */

    init() {
        // Nueva auditoría
        document.getElementById('campoAudArea').addEventListener('change', e => this.cargarTablaAuditoria(e.target.value));
        document.getElementById('btnGuardarAuditoria').addEventListener('click', () => this.guardarAuditoriaDesdeFormulario());
        document.getElementById('btnCancelarAuditoria').addEventListener('click', () => {
            this.resetearFormularioAuditoria();
            App.mostrarToast('Auditoría cancelada.', 'info');
        });

        // Filtros del historial
        ['buscarHistorial', 'filtroHistorialFecha', 'filtroHistorialMes'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.renderHistorial());
        });
        document.getElementById('filtroHistorialArea').addEventListener('change', () => this.renderHistorial());

        // Exportaciones del historial
        document.getElementById('btnExportarHistorial').addEventListener('click', () => this.exportarCSVHistorial());
        document.getElementById('btnImprimirHistorial').addEventListener('click', () => this.imprimirHistorial());

        // Detalle e impresión
        document.getElementById('btnImprimirDetalle').addEventListener('click', () => {
            const id = document.getElementById('btnImprimirDetalle').dataset.auditoriaId;
            if (id) this.imprimirAuditoria(id);
        });

        // Comparación
        document.getElementById('selectAudActual').addEventListener('change', () => this.renderComparacion());
        document.getElementById('selectAudAnterior').addEventListener('change', () => this.renderComparacion());
        document.getElementById('btnImprimirComparacion').addEventListener('click', () => this.imprimirComparacion());

        // Acciones de la tabla de historial (delegación)
        document.getElementById('tablaHistorial').addEventListener('click', e => {
            const boton = e.target.closest('[data-accion]');
            if (!boton) return;
            const accion = boton.dataset.accion;
            const id = boton.dataset.id;

            switch (accion) {
                case 'verAuditoria':
                    this.mostrarDetalle(id);
                    break;
                case 'compararAuditoria':
                    this.abrirComparacion(id);
                    break;
                case 'imprimirAuditoria':
                    this.imprimirAuditoria(id);
                    break;
                case 'eliminarAuditoria':
                    App.confirmar({
                        titulo: 'Eliminar auditoría',
                        mensaje: '¿Eliminar este registro de auditoría? Esta acción no se puede deshacer.',
                        textoBoton: 'Eliminar',
                        onConfirmar: async () => {
                            try {
                                await this.eliminarAuditoria(id);
                                App.mostrarToast('Auditoría eliminada.', 'success');
                                App.refrescarTodo();
                            } catch (error) {
                                App.mostrarToast(error.message, 'danger');
                            }
                        }
                    });
                    break;
            }
        });
    }
};
