/* =========================================================
   dashboard.js — Estadísticas, filtros y gráficos
   ========================================================= */

'use strict';

const Dashboard = {

    estado: {
        periodo: 'mes',
        areaId: '',
        desde: '',
        hasta: '',
        areaEvolucion: ''
    },

    graficos: {},

    PALETA: ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b'],

    /* ================= FILTROS ================= */

    poblarSelectores() {
        const selArea = document.getElementById('filtroArea');
        const valorAnterior = this.estado.areaId;
        Inventario.llenarSelectAreas(selArea, { opcionTodas: true, textoOpcionTodas: 'Todas las áreas' });
        selArea.value = valorAnterior;

        const selEvolucion = document.getElementById('selectAreaEvolucion');
        const valorEvolucion = this.estado.areaEvolucion;
        Inventario.llenarSelectAreas(selEvolucion);
        selEvolucion.insertAdjacentHTML('afterbegin', '<option value="">Seleccionar área</option>');
        selEvolucion.value = valorEvolucion;
    },

    actualizarControlesRango() {
        const esPersonalizado = this.estado.periodo === 'personalizado';
        document.getElementById('filtroDesdeWrap').classList.toggle('d-none', !esPersonalizado);
        document.getElementById('filtroHastaWrap').classList.toggle('d-none', !esPersonalizado);
    },

    /** Recalcula el rango según el periodo y valida el rango personalizado. */
    obtenerRango() {
        let rango = Utiles.periodoRango(this.estado.periodo, this.estado.desde, this.estado.hasta);
        if (this.estado.periodo === 'personalizado') {
            if (rango.desde > rango.hasta) {
                rango = { desde: rango.hasta, hasta: rango.desde };
            }
        }
        return rango;
    },

    /* ================= ESTADÍSTICAS ================= */

    calcularEstadisticas() {
        const datos = StorageManager.obtenerDatos();
        const rango = this.obtenerRango();
        const areaId = this.estado.areaId;

        const areas = areaId ? datos.areas.filter(a => a.id === areaId) : datos.areas;
        const productos = areaId
            ? datos.productos.filter(p => p.areaId === areaId)
            : datos.productos;

        const auditorias = datos.auditorias.filter(a =>
            Utiles.enRango(a.fecha, rango.desde, rango.hasta) && (!areaId || a.areaId === areaId)
        );
        auditorias.sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));

        const areasAuditadas = new Set(auditorias.map(a => a.areaId)).size;
        const productosAuditados = auditorias.reduce((s, a) => s + a.detalles.length, 0);
        const unidadesRegistradas = auditorias.reduce(
            (s, a) => s + a.detalles.reduce((x, d) => x + Number(d.cantidadAuditada || 0), 0), 0
        );

        return {
            totalAreas: areas.length,
            totalProductos: productos.length,
            totalUnidades: productos.reduce((s, p) => s + Number(p.cantidadActual || 0), 0),
            nAuditorias: auditorias.length,
            ultima: auditorias[0] || null,
            areasAuditadas,
            productosAuditados,
            unidadesRegistradas,
            rango
        };
    },

    renderTarjetas(estadisticas) {
        const e = estadisticas;

        document.getElementById('statAreas').textContent = Utiles.formatearNumero(e.totalAreas);
        document.getElementById('statProductos').textContent = Utiles.formatearNumero(e.totalProductos);
        document.getElementById('statUnidades').textContent = Utiles.formatearNumero(e.totalUnidades);
        document.getElementById('statAuditorias').textContent = Utiles.formatearNumero(e.nAuditorias);
        document.getElementById('statAreasAuditadas').textContent = Utiles.formatearNumero(e.areasAuditadas);

        const etiqueta = Utiles.etiquetaPeriodo(this.estado.periodo);
        document.getElementById('lblAuditorias').textContent = `Auditorías ${etiqueta}`;

        const txtUltima = document.getElementById('statUltimaAuditoria');
        if (e.ultima) {
            txtUltima.textContent = Utiles.formatearHora(e.ultima.hora);
            txtUltima.parentElement.title = `${Utiles.formatearFecha(e.ultima.fecha)} — ${Utiles.escapeHtml(e.ultima.areaNombre || '')}`;
        } else {
            txtUltima.textContent = '—';
            txtUltima.parentElement.removeAttribute('title');
        }

        document.getElementById('statP_auditorias').textContent = Utiles.formatearNumero(e.nAuditorias);
        document.getElementById('statP_areas').textContent = Utiles.formatearNumero(e.areasAuditadas);
        document.getElementById('statP_productos').textContent = Utiles.formatearNumero(e.productosAuditados);
        document.getElementById('statP_unidades').textContent = Utiles.formatearNumero(e.unidadesRegistradas);
    },

    /* ================= GRÁFICOS ================= */

    crearGrafico(clave, canvasId, config) {
        if (this.graficos[clave]) {
            this.graficos[clave].destroy();
            delete this.graficos[clave];
        }
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        canvas.classList.remove('d-none');
        this.graficos[clave] = new Chart(canvas.getContext('2d'), config);
    },

    mostrarVacio(idDiv, mostrar) {
        const div = document.getElementById(idDiv);
        if (!div) return;
        div.classList.toggle('d-none', !mostrar);
        const canvas = div.nextElementSibling;
        if (canvas && canvas.tagName === 'CANVAS') {
            canvas.classList.toggle('d-none', mostrar);
        }
    },

    /** Muestra los productos de cada área con su cantidad (en vez de totales). */
    renderInventarioPorArea(areaIdFiltro) {
        const datos = StorageManager.obtenerDatos();
        const areas = areaIdFiltro ? datos.areas.filter(a => a.id === areaIdFiltro) : datos.areas;
        const productos = datos.productos.filter(p => areas.some(a => a.id === p.areaId));

        const tbody = document.getElementById('tablaInventarioAreaDashboard');
        const vacio = document.getElementById('vacioG1');
        if (!tbody) return;

        if (productos.length === 0) {
            tbody.innerHTML = '';
            if (vacio) vacio.classList.remove('d-none');
            return;
        }
        if (vacio) vacio.classList.add('d-none');

        const nombreArea = {};
        areas.forEach(a => { nombreArea[a.id] = a.nombre; });

        tbody.innerHTML = productos.map(p => `
            <tr>
                <td><span class="badge bg-primary-subtle text-primary">${Utiles.escapeHtml(nombreArea[p.areaId] || '—')}</span></td>
                <td class="fw-semibold">${Utiles.escapeHtml(p.nombre)}</td>
                <td class="text-center"><span class="badge text-bg-light border">${Utiles.formatearNumero(p.cantidadActual)}</span></td>
            </tr>`).join('');
    },

    graficoAuditoriasPorDia(areaIdFiltro, rango) {
        const datos = StorageManager.obtenerDatos();
        const auditorias = datos.auditorias.filter(a =>
            Utiles.enRango(a.fecha, rango.desde, rango.hasta) && (!areaIdFiltro || a.areaId === areaIdFiltro)
        );

        // Genera la secuencia de fechas del rango.
        const fechas = [];
        let f = new Date(rango.desde + 'T00:00:00');
        const fin = new Date(rango.hasta + 'T00:00:00');
        let guardia = 0;
        while (f <= fin && guardia < 400) {
            fechas.push(Utiles.aISO(f));
            f = Utiles.sumarDias(f, 1);
            guardia++;
        }

        const conteoPorFecha = {};
        auditorias.forEach(a => { conteoPorFecha[a.fecha] = (conteoPorFecha[a.fecha] || 0) + 1; });

        let etiquetas, valores;
        if (fechas.length > 45) {
            // Agrupa por mes cuando el rango es muy amplio.
            const conteoPorMes = {};
            auditorias.forEach(a => {
                const mes = a.fecha.slice(0, 7);
                conteoPorMes[mes] = (conteoPorMes[mes] || 0) + 1;
            });
            const meses = fechas.map(iso => iso.slice(0, 7)).filter((m, i, arr) => arr.indexOf(m) === i);
            etiquetas = meses.map(m => {
                const [y, mo] = m.split('-');
                return new Date(y, Number(mo) - 1, 1).toLocaleDateString('es', { month: 'short', year: 'numeric' });
            });
            valores = meses.map(m => conteoPorMes[m] || 0);
        } else {
            etiquetas = fechas.map(iso => {
                const [y, m, d] = iso.split('-');
                return new Date(y, Number(m) - 1, Number(d)).toLocaleDateString('es', { day: 'numeric', month: 'short' });
            });
            valores = fechas.map(iso => conteoPorFecha[iso] || 0);
        }

        const total = valores.reduce((s, v) => s + v, 0);
        if (total === 0) {
            this.mostrarVacio('vacioG2', true);
            return;
        }
        this.mostrarVacio('vacioG2', false);

        this.crearGrafico('g2', 'graficoAuditoriasDia', {
            type: 'bar',
            data: {
                labels: etiquetas,
                datasets: [{
                    label: 'Auditorías',
                    data: valores,
                    backgroundColor: '#2563eb99',
                    borderColor: '#2563eb',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eef2f8' } },
                    x: { grid: { display: false }, ticks: { maxRotation: 45 } }
                }
            }
        });
    },

    graficoProductosPorArea(areaIdFiltro) {
        const datos = StorageManager.obtenerDatos();
        const areas = areaIdFiltro ? datos.areas.filter(a => a.id === areaIdFiltro) : datos.areas;

        if (areas.length === 0) {
            this.mostrarVacio('vacioG3', true);
            return;
        }
        this.mostrarVacio('vacioG3', false);

        const etiquetas = areas.map(a => a.nombre);
        const valores = areas.map(a => datos.productos.filter(p => p.areaId === a.id).length);

        this.crearGrafico('g3', 'graficoProductosArea', {
            type: 'doughnut',
            data: {
                labels: etiquetas,
                datasets: [{
                    data: valores,
                    backgroundColor: this.PALETA,
                    borderColor: '#ffffff',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } }
                }
            }
        });
    },

    renderGraficoEvolucion() {
        const areaId = this.estado.areaEvolucion;
        if (!areaId) {
            this.mostrarVacio('vacioG4', true);
            return;
        }

        const auditorias = Auditorias.listarAuditorias()
            .filter(a => a.areaId === areaId)
            .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));

        if (auditorias.length === 0) {
            this.mostrarVacio('vacioG4', true);
            document.getElementById('vacioG4').innerHTML =
                '<i class="bi bi-inbox"></i><p>Este área aún no tiene auditorías registradas.</p>';
            return;
        }
        this.mostrarVacio('vacioG4', false);

        const etiquetas = auditorias.map(a => `${Utiles.formatearFecha(a.fecha)} ${Utiles.formatearHora(a.hora)}`);
        const valores = auditorias.map(a =>
            a.detalles.reduce((s, d) => s + Number(d.cantidadAuditada || 0), 0)
        );

        this.crearGrafico('g4', 'graficoEvolucion', {
            type: 'line',
            data: {
                labels: etiquetas,
                datasets: [{
                    label: 'Total de unidades',
                    data: valores,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    fill: true,
                    tension: 0.35,
                    pointBackgroundColor: '#f59e0b',
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: '#eef2f8' } },
                    x: { grid: { display: false }, ticks: { maxRotation: 45 } }
                }
            }
        });
    },

    /* ================= RENDER COMPLETO ================= */

    render() {
        const estadisticas = this.calcularEstadisticas();
        this.renderTarjetas(estadisticas);
        this.renderGraficos(estadisticas);
    },

    renderGraficos(estadisticas) {
        const e = estadisticas;
        this.renderInventarioPorArea(this.estado.areaId);
        this.graficoAuditoriasPorDia(this.estado.areaId, e.rango);
        this.graficoProductosPorArea(this.estado.areaId);
        this.renderGraficoEvolucion();
    },

    /** Refresca filtros, tarjetas y gráficos (se llama tras cada cambio de datos). */
    actualizar() {
        this.poblarSelectores();
        this.actualizarControlesRango();
        this.render();
    },

    /* ================= EVENTOS / INIT ================= */

    init() {
        document.getElementById('filtroPeriodo').addEventListener('change', e => {
            this.estado.periodo = e.target.value;
            this.actualizarControlesRango();
            this.render();
        });

        document.getElementById('filtroArea').addEventListener('change', e => {
            this.estado.areaId = e.target.value;
            this.render();
        });

        document.getElementById('filtroDesde').addEventListener('change', e => {
            this.estado.desde = e.target.value;
            if (this.estado.periodo === 'personalizado') this.render();
        });

        document.getElementById('filtroHasta').addEventListener('change', e => {
            this.estado.hasta = e.target.value;
            if (this.estado.periodo === 'personalizado') this.render();
        });

        document.getElementById('selectAreaEvolucion').addEventListener('change', e => {
            this.estado.areaEvolucion = e.target.value;
            this.renderGraficoEvolucion();
        });

        this.actualizar();
    }
};
