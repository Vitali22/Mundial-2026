# Futbol Dashboard

Aplicacion web sencilla para consultar datos de futbol con HTML, CSS, JavaScript, Node.js, SQLite y TheSportsDB.

La app muestra tres torneos en la barra lateral:

- Mundial 2026
- Champions League
- Liga MX

Dentro de cada torneo puedes cambiar entre:

- `Tabla`
- `Fase final`

## Caracteristicas

- Interfaz en modo oscuro.
- Una sola API externa: TheSportsDB.
- Cache local en SQLite para evitar peticiones innecesarias.
- Tabla visual con barras de puntos.
- Fase final, liguilla o eliminatoria segun el torneo.
- Selector de grupos para el Mundial.
- Series con ida, vuelta y marcador global cuando el torneo lo requiere.
- Archivo `.bat` para abrir la app con doble clic en Windows.
- `.gitignore` listo para no subir `.env` ni bases de datos.

## Fuente De Datos

La app usa TheSportsDB v1.

```text
https://www.thesportsdb.com/api/v1/json
```

La key gratuita oficial es:

```env
THESPORTSDB_KEY=123
```

IDs usados:

| Torneo | ID TheSportsDB | Temporada |
| --- | ---: | --- |
| Mundial | `4429` | `2026` |
| Champions League | `4480` | `2025-2026` |
| Liga MX / Mexican Primera League | `4350` | `2025-2026` |

## Configuracion

Copia `.env.example` a `.env` o ejecuta:

```text
configurar-api.bat
```

Configuracion esperada:

```env
PORT=3001
THESPORTSDB_KEY=123
THESPORTSDB_BASE_URL=https://www.thesportsdb.com/api/v1/json
THESPORTSDB_WORLD_CUP_LEAGUE_ID=4429
THESPORTSDB_CHAMPIONS_LEAGUE_ID=4480
THESPORTSDB_LIGA_MX_LEAGUE_ID=4350
WORLD_CUP_SEASON=2026
CHAMPIONS_SEASON=2025-2026
LIGA_MX_SEASON=2025-2026
COMPETITION_CACHE_MINUTES=180
```

## Inicio Rapido En Windows

Haz doble clic en:

```text
iniciar.bat
```

Despues abre:

```text
http://localhost:3001
```

## Ejecutar Manualmente

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

## Endpoints

| Metodo | Ruta | Descripcion |
| --- | --- | --- |
| `GET` | `/api/tournament/worldcup` | Tabla y fase final del Mundial. |
| `GET` | `/api/tournament/champions` | Tabla y knockout de Champions League. |
| `GET` | `/api/tournament/ligamx` | Tabla y liguilla de Liga MX. |
| `POST` | `/api/refresh` | Actualiza los torneos desde TheSportsDB y guarda cache. |

## Formatos

Mundial 2026:

- 48 selecciones.
- 12 grupos de cuatro.
- Avanzan los dos primeros de cada grupo y los ocho mejores terceros.
- Eliminatoria desde dieciseisavos hasta final, con partido por tercer lugar.

Champions League:

- Fase liga con 36 clubes en una sola tabla.
- Puestos 1-8 avanzan directo a octavos.
- Puestos 9-24 juegan play-off para entrar a octavos.
- Despues sigue eliminatoria a ida y vuelta hasta semifinales, y final unica.

Liga MX:

- Torneo corto con tabla general.
- Para Clausura 2026, por calendario mundialista, los ocho mejores avanzan directo a cuartos.
- Cuartos, semifinales y final se juegan a ida y vuelta.

## GitHub

No subas estos archivos:

```text
.env
database.db
*.sqlite
node_modules/
```

Ya estan cubiertos por `.gitignore`.
