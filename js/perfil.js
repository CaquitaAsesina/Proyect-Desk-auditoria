/* =========================================================
   perfil.js — Mi perfil: datos personales, foto,
   nombre de usuario y contraseña.
   El admin edita directo; el usuario de consulta debe
   confirmar cada cambio con la contraseña del administrador.
   ========================================================= */

'use strict';

const Perfil = {

    fotoActual: null,
    pendienteGuardar: null,

    init() {
        document.getElementById('btnCambiarFoto').addEventListener('click', () => {
            document.getElementById('campoFotoPerfil').click();
        });

        document.getElementById('btnQuitarFoto').addEventListener('click', () => {
            this.fotoActual = null;
            document.getElementById('imgFotoPerfil').src = 'assets/img/logo.svg';
            document.getElementById('campoFotoPerfil').value = '';
        });

        document.getElementById('campoFotoPerfil').addEventListener('change', e => {
            const archivo = e.target.files && e.target.files[0];
            if (!archivo) return;
            if (!archivo.type.startsWith('image/')) {
                App.mostrarToast('Selecciona un archivo de imagen (JPG o PNG).', 'warning');
                e.target.value = '';
                return;
            }
            if (archivo.size > 1024 * 1024) {
                App.mostrarToast('La foto no puede superar 1 MB.', 'warning');
                e.target.value = '';
                return;
            }
            const lector = new FileReader();
            lector.onload = ev => {
                this.fotoActual = ev.target.result;
                document.getElementById('imgFotoPerfil').src = this.fotoActual;
            };
            lector.readAsDataURL(archivo);
        });

        document.getElementById('formPerfil').addEventListener('submit', e => {
            e.preventDefault();
            this.enviarFormulario();
        });

        /* Confirmación de la clave del administrador (usuario de consulta) */
        document.getElementById('btnConfirmarClaveAdmin').addEventListener('click', () => {
            const clave = document.getElementById('campoClaveAdmin').value;
            if (!clave) {
                App.mostrarToast('Ingresa la contraseña del administrador.', 'warning');
                return;
            }
            const datos = this.pendienteGuardar;
            this.pendienteGuardar = null;
            App.cerrarModal(document.getElementById('modalClaveAdmin'));
            document.getElementById('campoClaveAdmin').value = '';
            if (datos) {
                datos.contrasenaAdmin = clave;
                this.guardar(datos);
            }
        });

        /* Al cerrar el modal sin confirmar, se descarta el cambio pendiente. */
        document.getElementById('modalClaveAdmin').addEventListener('hidden.bs.modal', () => {
            document.getElementById('campoClaveAdmin').value = '';
            this.pendienteGuardar = null;
        });
    },

    /** Carga los datos del usuario en el formulario (se llama al navegar a la sección). */
    actualizar() {
        const u = StorageManager.obtenerUsuario() || {};
        const esAdmin = App.esAdmin();

        document.getElementById('campoPerfilNombre').value = u.nombre || '';
        document.getElementById('campoPerfilEmail').value = u.email || '';
        document.getElementById('campoPerfilTelefono').value = u.telefono || '';
        document.getElementById('campoPerfilUsuario').value = u.usuario || '';
        document.getElementById('campoPerfilRol').value = esAdmin ? 'Administrador' : 'Solo lectura';
        document.getElementById('campoPerfilNuevaContrasena').value = '';
        document.getElementById('campoPerfilConfirmarContrasena').value = '';
        document.getElementById('avisoClaveAdmin').classList.toggle('d-none', esAdmin);

        this.fotoActual = u.foto || null;
        document.getElementById('imgFotoPerfil').src = this.fotoActual || 'assets/img/logo.svg';
        document.getElementById('campoFotoPerfil').value = '';
    },

    /** Recoge y valida el formulario; decide si hace falta la clave del administrador. */
    enviarFormulario() {
        const datos = {
            nombre: document.getElementById('campoPerfilNombre').value.trim(),
            email: document.getElementById('campoPerfilEmail').value.trim(),
            telefono: document.getElementById('campoPerfilTelefono').value.trim(),
            nuevoUsuario: document.getElementById('campoPerfilUsuario').value.trim()
        };
        if (this.fotoActual) datos.foto = this.fotoActual;

        const clave = document.getElementById('campoPerfilNuevaContrasena').value;
        const confirmacion = document.getElementById('campoPerfilConfirmarContrasena').value;
        if (clave || confirmacion) {
            if (clave.length < 6) {
                App.mostrarToast('La nueva contraseña debe tener al menos 6 caracteres.', 'warning');
                return;
            }
            if (clave !== confirmacion) {
                App.mostrarToast('Las contraseñas no coinciden.', 'warning');
                return;
            }
            datos.nuevaContrasena = clave;
        }

        if (App.esAdmin()) {
            this.guardar(datos);
        } else {
            // Usuario de consulta: cada guardado requiere la contraseña del administrador.
            this.pendienteGuardar = datos;
            App.abrirModal(document.getElementById('modalClaveAdmin'));
        }
    },

    async guardar(datos) {
        try {
            await StorageManager.apiActualizarPerfil(datos);
            App.aplicarRol();
            this.actualizar();
            App.mostrarToast('Perfil actualizado correctamente.', 'success');
        } catch (error) {
            App.mostrarToast(error.message || 'No se pudo guardar el perfil.', 'danger');
        }
    }
};
