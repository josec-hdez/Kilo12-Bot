# Kilo 12 Bot

Bot de Telegram para las operaciones de **Kilo 12**. Toma el IPV diario (Excel), arma la hoja del día en el cuadre de Google Sheets con sus fórmulas y avisa de los errores en los datos antes de que afecten los números.

Las reglas de negocio (fórmulas, equivalencias IPV ↔ cuadre, validaciones) están en [`CLAUDE.md`](CLAUDE.md).

## Qué hace esta versión (MVP)

| Comando                 | Qué hace                                                                                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/ipv`                  | Cargar el IPV: se envía o reenvía el `.xlsx` al bot. El día puede ir en el pie del archivo (`3oct`); si el archivo trae varios días, el bot ofrece botones para elegir. Muestra una vista previa y pide confirmación antes de crear la pestaña. |
| `/validar [03\|semana]` | Revisa el cuadre y agrupa los hallazgos por severidad 🔴 (afecta la ganancia), 🟡 (inventario o inversión) y ⚪ (cosmético).                                                                                                                    |
| `/tc 780 [03]`          | Fija la tasa de cambio del día (celda Q18), con confirmación.                                                                                                                                                                                   |
| `/deshacer`             | Revierte la última escritura en la hoja, con confirmación.                                                                                                                                                                                      |
| `/ayuda`                | Lista de comandos según el rol.                                                                                                                                                                                                                 |
| `/cancelar`             | Abandona una acción en curso (por ejemplo, cuando el bot espera el motivo de "⚠️ Confirmar igual").                                                                                                                                             |

**Roles**

| Rol           | Puede                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- |
| `dueno`       | Todo, incluido "⚠️ Confirmar igual" para forzar una carga bloqueada (con motivo obligatorio). |
| `socio`       | `/validar` y ver cifras. Gastos y sugerencias llegan en la siguiente entrega.                 |
| `dependiente` | `/ipv`. No ve costos ni utilidades.                                                           |

**Sin IA.** El bot no interpreta mensajes libres: cualquier texto que no sea un comando recibe el menú de botones del rol.

## Requisitos

- **Node.js 22** o superior (desarrollo local).
- **Docker** con Docker Compose v2 (despliegue).
- **Un VPS en EE. UU.** Las APIs de Google no están disponibles desde Cuba; el bot usa long polling, así que no necesita dominio ni HTTPS.

## 1. Crear el bot en Telegram

1. Abre [@BotFather](https://t.me/botfather) y envía `/newbot`.
2. Elige un nombre y un usuario que termine en `bot` (por ejemplo, `kilo12_cuadre_bot`).
3. BotFather entrega el **token** (`123456789:AA...`). Trátalo como una contraseña: va en `TELEGRAM_TOKEN`.
4. Opcional, para que Telegram sugiera los comandos: `/mybots` → tu bot → **Edit Bot** → **Edit Commands**, y pega:

   ```
   ipv - Cargar el IPV del día
   validar - Revisar errores del cuadre
   tc - Fijar la tasa de cambio del día
   deshacer - Revertir la última escritura
   ayuda - Ver los comandos
   cancelar - Cancelar la acción en curso
   ```

## 2. Crear la service account de Google

1. En [Google Cloud Console](https://console.cloud.google.com/) crea un proyecto (o usa uno existente).
2. **APIs y servicios → Biblioteca**: busca **Google Sheets API** y pulsa **Habilitar**. (La **Google Drive API** hará falta más adelante para vigilar la carpeta del IPV.)
3. **IAM y administración → Cuentas de servicio → Crear cuenta de servicio**: escribe un nombre (por ejemplo, `kilo12-bot`) y pulsa **Listo**. No necesita roles del proyecto.
4. Abre la cuenta creada → pestaña **Claves** → **Agregar clave → Crear clave nueva** → **JSON** → **Crear**. El archivo se descarga una sola vez; guárdalo bien.
   - Si Google no deja crear la clave, la organización tiene activa la política `iam.disableServiceAccountKeyCreation` (activa por defecto en organizaciones creadas desde mayo de 2024). Con una cuenta personal de Gmail no ocurre.
5. Copia el correo de la cuenta (campo `client_email` del JSON, termina en `iam.gserviceaccount.com`).
6. Abre la hoja **Cuadre K12 Remoto** → **Compartir** → pega ese correo con permiso de **Editor**.

**Carpeta de Drive del IPV:** próximamente. Hoy el IPV se envía al bot por Telegram.

## 3. Configuración (`.env`)

Copia la plantilla y complétala:

```bash
cp .env.example .env
```

| Variable              | Obligatoria | Qué es                                                                                                                                                                             |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_TOKEN`      | Sí          | Token de @BotFather.                                                                                                                                                               |
| `OWNER_IDS`           | Sí          | IDs numéricos de Telegram de las dueñas, separados por coma (`111,222`). Se registran con rol `dueno` al arrancar.                                                                 |
| `GOOGLE_SA_JSON`      | No\*        | JSON de la service account: la **ruta** al archivo `.json` o el JSON completo en **una sola línea**.                                                                               |
| `CUADRE_SHEET_ID`     | No\*        | ID de la hoja de cuadre (ver abajo).                                                                                                                                               |
| `CUADRE_SEED_PATH`    | No          | Ruta a un cuadre exportado en `.xlsx`. Si la base de datos está vacía, carga de ahí el catálogo y los costos (usa la última pestaña de días). Recomendado para el primer arranque. |
| `DRIVE_IPV_FOLDER_ID` | No          | Carpeta de Drive del IPV. Todavía no se usa.                                                                                                                                       |
| `ANTHROPIC_API_KEY`   | No          | No se usa: el MVP no tiene IA.                                                                                                                                                     |
| `DB_PATH`             | No          | Ruta de la base SQLite. Por defecto `./data/kilo12.db` (en Docker, `/app/data/kilo12.db`).                                                                                         |
| `TZ`                  | No          | Zona horaria. Por defecto `America/Havana`.                                                                                                                                        |

\* **Sin `GOOGLE_SA_JSON` o sin `CUADRE_SHEET_ID` el bot arranca con una hoja simulada en memoria** y lo indica en el log. Sirve para probar, pero no escribe en Google Sheets y lo cargado se pierde al reiniciar.

**ID de la hoja:** está en la URL, entre `/d/` y `/edit`:
`https://docs.google.com/spreadsheets/d/`**`1AbC...xyz`**`/edit`

**ID de Telegram de cada persona:** escribe a [@userinfobot](https://t.me/userinfobot) desde la cuenta de esa persona y responde con su `Id`. Otra forma: con el bot ya levantado, la persona le escribe; el intento queda registrado en la tabla `access_log` con su `telegram_id` (ver [Usuarios](#usuarios-socios-y-dependientes)).

## Desarrollo local

```bash
npm ci
npm test          # pruebas (usan los Excel reales de tests/fixtures)
npm run typecheck
npm run lint
npm run dev       # arranca el bot con recarga automática; lee .env
```

Para probar sin Google, deja vacíos `GOOGLE_SA_JSON` y `CUADRE_SHEET_ID` y apunta `CUADRE_SEED_PATH` a un cuadre `.xlsx`: el bot usa la hoja simulada y `/validar` revisa ese archivo.

## Despliegue con Docker

En el VPS, con el repositorio clonado y el `.env` completo:

```bash
mkdir -p data
# Archivos que el contenedor debe leer van dentro de data/ (se monta en /app/data):
#   data/service-account.json  → GOOGLE_SA_JSON=/app/data/service-account.json
#   data/cuadre.xlsx           → CUADRE_SEED_PATH=/app/data/cuadre.xlsx
sudo chown -R 1000:1000 data   # el contenedor corre como el usuario node (uid 1000)

docker compose up -d --build   # construir y levantar
docker compose logs -f bot     # ver el log
docker compose down            # detener
```

- **Datos:** la base SQLite vive en `./data/kilo12.db` (usuarios, catálogo, costos, registro de cambios, copias para `/deshacer`). Usa modo WAL, así que respáldala con el bot detenido para copiar también los archivos `-wal` y `-shm`: `docker compose stop bot && mkdir -p backups && cp data/kilo12.db* backups/ && docker compose start bot`.
- **Actualizar:** `git pull && docker compose up -d --build`. Las migraciones de la base se aplican solas al arrancar.
- **Reinicios:** el contenedor se reinicia solo si el proceso falla. Un token inválido o una configuración incompleta detienen el bot con un mensaje claro en el log, sin reiniciarse en bucle: corrige el `.env` y vuelve a levantarlo.

## Usuarios (socios y dependientes)

Las dueñas se registran solas desde `OWNER_IDS`. Esta versión no tiene todavía un comando para agregar socios o dependientes; se agregan en la base de datos:

```bash
docker compose exec bot node -e "
const db = require('better-sqlite3')('/app/data/kilo12.db');
db.prepare('INSERT OR REPLACE INTO users (telegram_id, name, role, active) VALUES (?, ?, ?, 1)')
  .run(123456789, 'Nombre', 'dependiente');
"
```

Roles válidos: `dueno`, `socio`, `dependiente`. Para desactivar a alguien, pon `active` en `0`.

## Flujo diario

1. **Cargar el IPV:** reenviar el `.xlsx` al bot (con el día en el pie si el archivo tiene varios). Revisar la vista previa: venta, utilidad bruta, productos sin costo y alertas.
   - La venta del cuadre debe ser igual al `IMPORTE TOTAL` del IPV. La única diferencia aceptada es exactamente la merma y el consumo valorados a precio (aviso 🟡).
   - Si hay bloqueos 🔴 (por ejemplo, `CANT. FINAL` vacía con existencia), no aparece ✅. Una dueña puede usar **⚠️ Confirmar igual** y escribir el motivo, que queda registrado.
2. **Fijar la TC:** `/tc 780`.
3. **Revisar:** `/validar` o `/validar semana`.
4. **Corregir un error:** `/deshacer` borra la pestaña recién creada o restaura la TC anterior.

## Seguridad

- **Lista blanca:** solo responden los usuarios registrados. El resto recibe "No autorizado." y el intento queda en `access_log`, igual que un comando que el rol no permite.
- **Confirmación obligatoria:** toda escritura en la hoja muestra antes una vista previa con ✅ / ❌. Solo quien pidió la acción puede confirmarla, y la confirmación vence a los 15 minutos.
- **Copias y registro:** antes de escribir, el bot guarda en SQLite lo que va a cambiar y anota quién cambió qué y cuándo. No se crean pestañas de respaldo en la hoja.

## Pestañas que crea el bot en el cuadre

- **`_plantilla`** (oculta): encabezados, formato y fórmulas de una hoja diaria. Cada día nuevo se crea duplicándola. Si ya existe, el bot no la modifica.
- **`_config`** (solo lectura): copia del catálogo del bot (producto, alias del IPV, costo, categoría, perecedero, mínimo). **Se sobrescribe completa**; los cambios hechos a mano se pierden. Los costos y equivalencias se cambian desde el bot.

## Pendiente

- **Nombres de pestaña por mes.** Las pestañas diarias se llaman `01`, `02`… sin mes. Falta decidir entre un libro por mes o pestañas `DD-MM`. Mientras tanto, si la pestaña del día ya existe, el bot rechaza la carga y no sobrescribe nada.
- **Siguiente entrega:** reportes (`/hoy`, `/semana`, `/mes`), gastos (`/gasto`), inventario y compras, sugerencias, vigilancia de la carpeta de Drive y tareas programadas (09:00 y 21:00).
