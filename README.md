# Mundial Dashboard 2026

Aplicacion web sencilla para visualizar informacion del Mundial 2026 con HTML, CSS, JavaScript, Node.js y SQLite.

La app muestra tablas de fase de grupos y una llave de fase eliminatoria. Los datos se guardan en SQLite para evitar consultar la API externa en cada carga.

## Caracteristicas

- Barra lateral para cambiar entre fase de grupos y fase eliminatoria.
- Modo claro/oscuro con preferencia guardada en el navegador.
- Tarjetas visuales por grupo con barras de puntos.
- Llave eliminatoria en columnas con tarjetas de partido.
- Datos de ejemplo del Mundial 2026 con 12 grupos.
- Base de datos local SQLite.
- Boton para actualizar datos.
- Cache para evitar peticiones innecesarias.
- Integracion preparada para API-FOOTBALL.
- Archivo `.bat` para abrir la app con doble clic en Windows.
- `.gitignore` listo para no subir bases de datos ni secretos.

## Estructura del proyecto

```text
.
+-- public/
|   +-- index.html
|   +-- styles.css
|   +-- app.js
+-- .env.example
+-- .gitignore
+-- iniciar.bat
+-- package.json
+-- README.md
+-- server.js
```

> `database.db` se crea automaticamente al iniciar la app y no debe subirse al repositorio.

## Requisitos

- Windows, macOS o Linux.
- Node.js 24 o superior.

Este proyecto usa SQLite incluido en Node.js moderno, por eso no necesita instalar paquetes externos para funcionar.

## Inicio rapido en Windows

Haz doble clic en:

```text
iniciar.bat
```

El archivo hace esto automaticamente:

1. Entra a la carpeta del proyecto.
2. Crea `.env` desde `.env.example` si todavia no existe.
3. Usa el puerto `3001` por defecto.
4. Abre el navegador.
5. Inicia el servidor.

Despues visita:

```text
http://localhost:3001
```

## Ejecutar manualmente

En Windows:

```bat
copy .env.example .env
set PORT=3001
node server.js
```

En macOS/Linux:

```bash
cp .env.example .env
PORT=3001 node server.js
```

Luego abre:

```text
http://localhost:3001
```

## Configuracion de la API

Por defecto la app usa datos de ejemplo:

```env
DATA_PROVIDER=mock
```

Para consultar una API real, edita `.env`:

```env
DATA_PROVIDER=api-football
API_FOOTBALL_KEY=tu_api_key
WORLD_CUP_SEASON=2026
```

No subas tu archivo `.env` a GitHub. Ya esta protegido por `.gitignore`.

## Logica de actualizacion

- La pagina lee desde SQLite.
- No se llama a la API externa en cada carga.
- `POST /api/refresh` revisa si corresponde actualizar.
- Si un partido ya termino, se espera la duracion estimada del partido mas 30 minutos antes de consultar otra vez.
- Si todavia no corresponde actualizar, se usan los datos guardados.

## Endpoints

| Metodo | Ruta | Descripcion |
| --- | --- | --- |
| `GET` | `/api/groups` | Devuelve tablas de grupos calculadas desde SQLite. |
| `GET` | `/api/bracket` | Devuelve partidos de fase eliminatoria. |
| `GET` | `/api/meta` | Devuelve proveedor y ultima actualizacion. |
| `POST` | `/api/refresh` | Revisa cache y consulta la API externa si corresponde. |

## Preparado para GitHub

Antes de subir el proyecto, revisa que estos archivos no se agreguen:

```text
.env
database.db
*.sqlite
node_modules/
```

Comandos sugeridos:

```bash
git init
git status
git add .
git commit -m "Crear dashboard Mundial 2026"
```
