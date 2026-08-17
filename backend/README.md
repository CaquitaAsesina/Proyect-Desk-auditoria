# Auditoria — Backend (Express + MySQL + JWT)

API REST y servidor estático para la aplicación de gestión y auditoría de inventarios.

## Requisitos

- **Node.js 18+** (probado con Node 24)
- **MySQL 8** corriendo en local (o remoto)

## Configuración

1. Copia `.env.example` como `.env` y ajusta las credenciales:

```bash
cp .env.example .env
```

```env
PORT=3000
HOST=0.0.0.0
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_contraseña
DB_NAME=auditoria_db
ADMIN_USUARIO=admin
ADMIN_CONTRASENA=admin123
LECTURA_USUARIO=lectura
LECTURA_CONTRASENA=lectura123
JWT_SECRET=un_secreto_largo_y_aleatorio
```

2. Instala las dependencias:

```bash
npm install
```

## Usar MySQL en la nube (Aiven)

Aiven te da un **MySQL administrado en la nube**, ideal para que todas las PCs compartan los mismos datos sin instalar MySQL en cada una. Para conectarlo:

1. En el [Aiven Console](https://console.aiven.io/) crea un servicio **MySQL** (el plan gratuito `Startup-4` o el que prefieras).
2. En la pestaña **Overview** del servicio copia el **Host** (algo como `proyecto-mysql-xxxx.a.aivencloud.com`), el **Puerto**, el usuario **avnadmin** y la contraseña.
3. Crea la base de datos en el console (**Databases** → *Create database*, por ejemplo `auditoria_db`) o déjala que la cree el propio backend.
4. En `backend/.env` usa esos datos. **Aiven exige TLS**, así que deja `DB_SSL=true`:

```env
HOST=0.0.0.0
DB_HOST=proyecto-mysql-xxxx.a.aivencloud.com
DB_PORT=21067
DB_USER=avnadmin
DB_PASSWORD=tu_password_de_aiven
DB_NAME=auditoria_db
DB_SSL=true
JWT_SECRET=un_secreto_largo_y_aleatorio
```

   > Opcional: para verificar el certificado, descarga `ca.pem` del console y usa `DB_SSL_CA=/ruta/a/ca.pem` en lugar de `DB_SSL=true`.

5. Arranca con `npm start`. El backend crea las tablas y los usuarios iniciales automáticamente la primera vez.

> **Importante:** al estar la base en la nube, cambia las contraseñas iniciales (`admin123`, `lectura123`) en la tabla `usuarios` antes de compartir el acceso.

## Ejecutar

```bash
npm start        # producción
npm run dev      # desarrollo (reinicia al guardar)
```

El servidor:

- Crea automáticamente la base de datos `auditoria_db` y sus tablas si no existen.
- Crea los usuarios iniciales si la tabla está vacía.
- Sirve la aplicación frontend en **http://localhost:3000** (carpeta `../inventario`).
- Expone la API REST en `/api/*`, protegida con token JWT.

## Usuarios iniciales

Se crean automáticamente **solo la primera vez** (cuando la tabla `usuarios` está vacía), usando variables de entorno:

| Variable            | Valor por defecto | Rol          | Permisos |
|---------------------|-------------------|--------------|----------|
| `ADMIN_USUARIO` / `ADMIN_CONTRASENA` | `admin` / `admin123` | Administrador | Todo (crear, editar, eliminar, auditar) |
| `LECTURA_USUARIO` / `LECTURA_CONTRASENA` | `lectura` / `lectura123` | Solo lectura | Solo consultar (dashboard, listas, reportes, exportar) |

> Si la tabla ya tiene usuarios, la siembra no se repite. Para cambiar las credenciales de un usuario existente, actualízalo en la base de datos (o vacía la tabla `usuarios` y reinicia el backend para que se vuelvan a crear desde las variables).

## Autenticación

- `POST /api/auth/login` con `{ usuario, contrasena }` → `{ token, usuario }`.
- Envía el token en el encabezado de cada petición: `Authorization: Bearer <token>`.
- Las rutas de escritura (`POST`, `PUT`, `DELETE`) requieren rol **admin**; las de lectura están disponibles para ambos roles.
- El token expira a las 12 horas.

## API

| Método | Ruta                  | Rol      | Descripción |
|--------|-----------------------|----------|-------------|
| POST   | `/api/auth/login`     | público  | Inicia sesión |
| GET    | `/api/auth/me`        | ambos    | Datos de la sesión |
| GET    | `/api/datos`          | ambos    | Dataset completo (áreas, productos, auditorías con detalles) |
| POST   | `/api/datos`          | admin    | Reemplaza todo el dataset (datos demo / empezar de cero) |
| POST   | `/api/areas`          | admin    | Crea un área |
| PUT    | `/api/areas/:id`      | admin    | Actualiza un área |
| DELETE | `/api/areas/:id`      | admin    | Elimina un área (cascada a productos) |
| POST   | `/api/productos`      | admin    | Crea un producto (nombre + código + unidad; sin cantidad) |
| PUT    | `/api/productos/:id`  | admin    | Actualiza producto (la cantidad solo cambia con una auditoría) |
| DELETE | `/api/productos/:id`  | admin    | Elimina un producto |
| POST   | `/api/auditorias`     | admin    | Crea una auditoría (transacción: guarda detalles y actualiza stock) |
| DELETE | `/api/auditorias/:id` | admin    | Elimina una auditoría |

## Acceder desde cualquier PC

Como el backend sirve la aplicación (frontend + API) y los datos viven en Aiven, las demás PCs **solo necesitan un navegador**. Tienes dos caminos:

### Opción A — Red local (rápida, sin gastos)

1. Deja `HOST=0.0.0.0` en `.env` y arranca el backend en la PC que siempre esté encendida.
2. Abre el puerto `3000` en el firewall de esa PC (Windows: *Firewall de Windows* → *Reglas de entrada* → *Nueva regla* → Puerto `TCP 3000`).
3. Cada PC de la red entra a `http://IP_DE_LA_PC_SERVIDOR:3000`. Al arrancar, el backend imprime esa IP (ej. `http://192.168.1.10:3000`).

Solo funciona dentro de la misma red/Wi-Fi. Para internet desde cualquier lugar usa la Opción B.

### Opción B — Desplegar en Render (acceso desde internet 24/7)

Render ejecuta el backend en la nube con una URL pública, sin depender de que tu PC esté encendida. La base ya está en Aiven, así que el host solo corre el código.

#### 1. Sube el proyecto a GitHub

Desde la carpeta `inventario/` (raíz de la app):

```bash
git init
git add .
git commit -m "Primera versión"
# crea un repositorio vacío en github.com y luego:
git remote add origin https://github.com/TU_USUARIO/auditoria.git
git branch -M main
git push -u origin main
```

> El `.gitignore` ya excluye `node_modules/` y los archivos `.env*` con credenciales — no se subirán.

#### 2. Crea el servicio en Render

1. Crea una cuenta gratis en [render.com](https://render.com) (puedes entrar con GitHub).
2. **New → Blueprint** y selecciona tu repositorio: Render lee `backend/render.yaml`, que ya define el servicio con `rootDir: backend`, build `npm install` y start `node server.js`.
3. **Agrega las variables secretas** en *Dashboard → tu servicio → Environment* (no van en el repo):

```env
DB_PASSWORD=tu_password_de_aiven
JWT_SECRET=un_secreto_largo_y_aleatorio
ADMIN_CONTRASENA=saltamonteXD2003*
LECTURA_CONTRASENA=lectura123
```

   Las demás variables (host, puerto, usuario, `DB_SSL=true`, etc.) ya están en `render.yaml`.
4. **Deploy**. En unos minutos Render te da la URL `https://auditoria-app.onrender.com`.

> Si prefieres el asistente manual: **New → Web Service** → conecta el repo → `Root Directory: backend` → Build `npm install` → Start `node server.js` → agrega TODAS las variables de entorno (las de `.env.aiven` + las 4 secretas de arriba).

#### 3. Usar la app desplegada

- Cualquier PC del mundo entra a `https://auditoria-app.onrender.com` con los mismos usuarios (`FP76270486` admin, `lectura` consulta).
- Los datos son los mismos de Aiven; todo lo que cambies en la web queda guardado en la nube.

> **Plan gratis:** Render apaga el servicio tras ~15 minutos sin uso; la primera visita después del apagado tarda ~50 segundos en responder (arranque en frío). Para evitar esto se usa el plan pagado (~7 USD/mes) o un servicio alterno como **Railway** o **Fly.io**.

## Tener la base en tu PC y en la nube (local + Aiven)

Puedes usar la misma aplicación contra **dos bases de datos**: la de Aiven (nube, para compartir con otras PCs) y una copia local en tu computador (funciona sin internet y sirve de respaldo).

Hay dos perfiles guardados:

- `.env.aiven` → MySQL en la nube (`defaultdb`).
- `.env.local` → MySQL de tu PC (`auditoria_db`).

### Cambiar entre una y otra

```bash
npm run bd:aiven    # usa la base de la nube
npm run bd:local    # usa la base de tu PC
npm start           # reinicia el servidor para aplicar
```

Esto copia el perfil elegido a `.env` y es todo.

### Sincronizar los datos (copiar una base a la otra)

```bash
npm run sync:cloud-a-local    # copia la nube → tu PC
npm run sync:local-a-cloud    # copia tu PC → la nube
```

> ⚠️ La sincronización **reemplaza por completo** la base de destino con los datos de la de origen (áreas, productos, auditorías, usuarios). Úsala cuando quieras llevar los datos de un lado al otro.

### Preparar el MySQL local (solo la primera vez)

Con el MySQL instalado y corriendo en tu PC, crea el usuario de la aplicación:

```sql
CREATE USER 'auditoria'@'localhost' IDENTIFIED BY 'tu_password_local';
GRANT ALL PRIVILEGES ON auditoria_db.* TO 'auditoria'@'localhost';
FLUSH PRIVILEGES;
```

Ajusta `DB_USER` y `DB_PASSWORD` en `.env.local` con ese usuario, y luego corre `npm run sync:cloud-a-local` para traer los datos de la nube por primera vez.

## Base de datos

Tablas: `areas`, `productos`, `auditorias`, `detalle_auditoria`, `usuarios`.

- `productos.codigo` es obligatorio y único.
- `productos.cantidad_actual` solo se modifica al registrar una auditoría.
- `productos.area_id` → FK a `areas` con `ON DELETE CASCADE`.
- `auditorias.area_id` → FK a `areas` con `ON DELETE SET NULL` (las auditorías son snapshots históricos y se conservan aunque se elimine el área).
- `detalle_auditoria.auditoria_id` → FK a `auditorias` con `ON DELETE CASCADE`.
- `usuarios.contrasena` se guarda con hash (scrypt + salt).
