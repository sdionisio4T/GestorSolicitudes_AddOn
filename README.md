# Gestor de Solicitudes

Google Workspace Add-on (Gmail + Sheets) que automatiza el registro de solicitudes de despliegue: extrae los datos del correo, escribe una fila por componente en un Sheet de seguimiento y copia los adjuntos del correo a la carpeta del cliente en Drive.

## Funcionalidades

- **Detección automática** de correos con solicitudes de despliegue (por frase clave o remitente permitido).
- **Extracción de campos** desde el cuerpo del correo: número de caso, servicio, ambiente, correo del solicitante, enlaces de Drive y repositorio.
- **Formulario de validación** en el panel lateral con los datos pre-llenados, más campos opcionales (Sonar, artefactos). El usuario ajusta y envía.
- **Escritura en Sheet** de una fila por componente, con manejo de bloqueo para envíos concurrentes.
- **Copia de archivos en Drive** con estructura de carpetas por servicio, caso y APIM, con reintentos automáticos en segundo plano si algo falla.
- **Panel de envíos** para consultar el estado de solicitudes en curso (desde Gmail o Sheets).
- **Editor de solicitudes** para modificar envíos ya guardados sin duplicar filas ni re-copiar archivos.
- **Detección de duplicados**: banner que avisa cuando el caso de un correo ya tiene un envío editable.

## Estructura del proyecto

| Archivo | Descripción |
|---|---|
| `Main.gs` | Triggers de entrada: `onHomepage`, `onHomepageSheets`, `onGmailMessageOpen`. Navegación cruzada correo ↔ menú principal. |
| `Auth.gs` | Chequeo de scopes OAuth. Tarjeta de autorización requerida. |
| `Config.gs` | Configuración global (`CONFIG`) y helpers de `UserProperties` (Sheet, pestaña, carpeta raíz). |
| `ConfigHandlers.gs` | Handlers de los botones del wizard, panel de configuración y ayuda. |
| `Extractor.gs` | Detección de solicitud y extracción de campos del cuerpo del correo. |
| `Cards.gs` | Builders puros de las tarjetas de la UI. |
| `Ayuda.gs` | Contenido de la card de ayuda del add-on. |
| `Diagnostico.gs` | Panel de diagnóstico y reset total. |
| `SheetWriter.gs` | Orquestador de `onEnviar` y helpers de escritura, copia y consolidación. |
| `DriveCopier.gs` | Copia de carpetas y archivos del correo a la carpeta destino, con manejo de permisos. |
| `Reintentos.gs` | Reintentos en segundo plano vía triggers programados. |
| `EstadoCard.gs` | Tarjeta de estado de envíos y lista de envíos abiertos. |
| `EditarSolicitud.gs` | Editor de solicitudes ya guardadas (in-place, sin duplicar filas). |
| `Tests.gs` | Tests unitarios de helpers puros (regex, columnas, parsing). |
| `appsscript.json` | Manifiesto del add-on: scopes OAuth, triggers, logo, dominios permitidos. |

## Scopes OAuth

El add-on declara cinco scopes en `appsscript.json`:

| Scope | Uso |
|---|---|
| `gmail.addons.execute` | Ejecutar el add-on en el panel lateral de Gmail. |
| `gmail.addons.current.message.readonly` | Leer únicamente el correo abierto, no la bandeja. |
| `spreadsheets` | Leer y escribir en el Sheet de seguimiento. |
| `drive` | Copiar los adjuntos del correo a la carpeta destino. |
| `script.scriptapp` | Programar triggers de reintento para copias fallidas. |

Google solicita todos los scopes juntos al instalar. `Auth.gs` muestra una tarjeta que explica cada permiso antes de disparar el consentimiento nativo.

## Configuración por usuario

Cada persona que instala el add-on define tres valores la primera vez que lo abre. Se guardan en `UserProperties` y son propias de esa cuenta:

- `SHEET_ID` — ID del Sheet de seguimiento donde va a escribir.
- `SHEET_TAB` — nombre de la pestaña dentro de ese Sheet.
- `CARPETA_RAIZ_ID` — ID de la carpeta raíz de Drive del cliente donde se replican los adjuntos.

Se editan desde el botón **⚙ Configuración** del homepage.

La configuración global (ambientes, componentes, frase de detección, remitentes permitidos) vive en `CONFIG` dentro de `Config.gs`.

## Estructura de carpetas en Drive

Los archivos del correo se copian dentro de la carpeta raíz configurada, con esta estructura:

```
[Raíz]/
├── <Servicio>/                    ← componentes generales (ESB, EI, DSS…)
│   └── <Caso>[_N]/
│       └── ...archivos
└── APIM/                          ← componentes API o APIM
    └── <Servicio>/
        └── <Caso>[_N]/
            └── ...archivos
```

Reglas:

- `APIM/` y `<Servicio>/` se reutilizan si ya existen; nunca se duplican.
- La carpeta `<Caso>` es única por envío: si ya existía, se crea con sufijo `_2`, `_3`, etc.
- Cuando un envío mezcla componentes API/APIM con otros, los mismos archivos se copian a ambas rutas, y cada fila del Sheet apunta a la carpeta que le corresponde por componente.

## Desarrollo local

El código del add-on corre en Apps Script, no en Node. `package.json` existe únicamente para poder lintar los `.gs` con ESLint en local.

### Requisitos

- Node.js (para clasp y ESLint).
- [`@google/clasp`](https://github.com/google/clasp) instalado globalmente.

### Sincronización con Apps Script

El proyecto se sincroniza con el editor web de Apps Script mediante clasp:

```bash
clasp login          # una sola vez, con la cuenta de Google del proyecto
clasp clone <scriptId>
clasp pull           # bajar cambios hechos en el editor web
clasp push           # subir cambios locales al editor web
```

El archivo `.clasp.json` contiene el `scriptId` y está excluido del repositorio; cada quien lo genera con `clasp clone` apuntando a su propio proyecto.

### Lint

```bash
npm install
npm run lint
```

## Distribución

El add-on se distribuye a los testers como **implementación de prueba**, no como implementación oficial de Workspace Marketplace.

### Compartir el proyecto con un tester

Desde el editor de Apps Script, ícono de **Compartir** (👤➕ arriba a la derecha) → agregar el correo del tester con acceso de **Editor**. Eso le da permiso para abrir el proyecto y ejecutar la implementación de prueba en su cuenta.

### Instalar el add-on como tester

Una vez que el tester tiene acceso al proyecto:

1. Abrir el proyecto en el editor de Apps Script.
2. Menú superior **Implementar → Implementaciones de prueba**.
3. **Instalar**.
4. Aceptar los permisos que pide Google (los cinco scopes declarados en `appsscript.json`).

El add-on queda disponible en el panel lateral de Gmail y en Sheets para esa cuenta. Los cambios en el código quedan visibles la próxima vez que el tester recarga Gmail o reabre el add-on — sin necesidad de reinstalar.
