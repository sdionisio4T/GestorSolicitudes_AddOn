# Gestor de Solicitudes

Google Workspace Add-on (Gmail + Sheets) que automatiza el registro de solicitudes de despliegue: extrae los datos del correo, escribe una fila por componente en un Sheet de seguimiento y copia los adjuntos del correo a la carpeta del cliente en Drive.

## Funcionalidades

- **Detección manual con botón** al abrir un correo: se muestra el menú principal con un botón **"🔍 Detectar caso en este correo"** que dispara la lectura del cuerpo y la extracción de datos. La detección ya no es automática al abrir el correo, para evitar abrir el formulario de creación cuando el caso ya existía en el Sheet.
- **Extracción de campos** desde el cuerpo del correo: número de caso, servicio, ambiente, correo del solicitante, enlaces de Drive y repositorio (por frase clave o remitente permitido).
- **Chooser "Caso ya registrado"**: si al detectar el caso ya tiene envíos previos en el Sheet, aparece una card intermedia con las opciones **"✏️ Editar existente"** y **"➕ Registrar otro envío nuevo"**. Además avisa si hay filas manuales (sin ID de envío) para el mismo caso.
- **Formulario de validación** en el panel lateral con los datos pre-llenados, más campos opcionales (Sonar, artefactos). El usuario ajusta y envía.
- **Persistencia del formulario activo** entre correos e inbox: al detectar un caso se guarda el estado por hasta 6 horas; si el usuario se va al inbox u otro correo, la homepage muestra un botón **"🔙 Volver al formulario"** para retomar sin perder los datos extraídos.
- **Escritura en Sheet** de una fila por componente, con manejo de bloqueo para envíos concurrentes.
- **Copia de archivos en Drive** con estructura de carpetas por servicio, caso y APIM, con reintentos automáticos en segundo plano si algo falla.
- **Panel de envíos** para consultar el estado de solicitudes en curso (desde Gmail o Sheets).
- **Editor de solicitudes** para modificar envíos ya guardados sin duplicar filas ni re-copiar archivos. Incluye solo envíos en estado PENDIENTE de los últimos 30 días. Los APROBADOS o NO APROBADOS se consideran cerrados y no aparecen en el listado (pero sí siguen apareciendo como aviso en la card "Caso ya registrado" al detectar un correo, para evitar duplicados). Al pasar el estado a APROBADO se borran las observaciones automáticamente.

## Estructura del proyecto

Todo el código del add-on vive en `src/`. Los archivos `.gs` de Apps Script comparten un único scope global, así que la separación es únicamente organizacional.

| Archivo | Descripción |
|---|---|
| `src/Main.gs` | Triggers de entrada: `onHomepage`, `onHomepageSheets`, `onGmailMessageOpen`. Handler `onDetectarCaso` (botón manual), navegación cruzada correo ↔ menú principal, y persistencia del formulario activo (`UserProperties`) para no perder el estado al cambiar de correo o ir al inbox. |
| `src/Auth.gs` | Chequeo de scopes OAuth. Tarjeta de autorización requerida. |
| `src/Config.gs` | Configuración global (`CONFIG`) y helpers de `UserProperties` (Sheet, pestaña, carpeta raíz). |
| `src/ConfigHandlers.gs` | Handlers de los botones del wizard, panel de configuración y ayuda. |
| `src/Extractor.gs` | Detección de solicitud y extracción de campos del cuerpo del correo. |
| `src/Cards.gs` | Builders puros de las tarjetas de la UI. |
| `src/Ayuda.gs` | Contenido de la card de ayuda del add-on. |
| `src/Diagnostico.gs` | Panel de diagnóstico y reset total. |
| `src/SheetWriter.gs` | Orquestador de `onEnviar` y helpers de escritura, copia y consolidación. |
| `src/DriveCopier.gs` | Copia de carpetas y archivos del correo a la carpeta destino, con manejo de permisos. |
| `src/Reintentos.gs` | Reintentos en segundo plano vía triggers programados. |
| `src/EstadoCard.gs` | Tarjeta de estado de envíos y lista de envíos abiertos. |
| `src/EditarSolicitud.gs` | Editor de solicitudes ya guardadas (in-place, sin duplicar filas). |
| `src/Tests.gs` | Tests unitarios de helpers puros (regex, columnas, parsing). |
| `src/appsscript.template.json` | Plantilla del manifiesto del add-on: scopes OAuth, triggers, dominios permitidos, y una URL de logo por defecto (gstatic Gmail). Está en git y es la fuente de verdad. |
| `src/appsscript.json` | Manifiesto real que consume clasp. **No está en git** (lo genera `npm run setup` a partir de la plantilla, reemplazando la URL del logo por el que el usuario sube a su Drive). |

## Estructura del repositorio

Además del código en `src/`, el repositorio contiene:

| Ubicación | Descripción |
|---|---|
| `src/` | Código fuente del add-on (`.gs` + `appsscript.template.json`). `clasp` toma esta carpeta como raíz de push (ver `rootDir` en `.clasp.json`). |
| `scripts/setup.js` | Orquestador de `npm run setup`: crea la carpeta del proyecto en Drive del usuario, sube el logo, marca el logo como público, genera `src/appsscript.json` a partir de la plantilla, crea el proyecto Apps Script dentro de la carpeta y sube el código. |
| `scripts/finish-login.sh` | Helper para completar `clasp login` desde Codespaces cuando el redirect a `localhost` falla. Se invoca con `npm run login:finish`. Ver sección **Login OAuth desde Codespaces**. |
| `.devcontainer/devcontainer.json` | Configuración de GitHub Codespaces. Al abrir el repo en Codespaces, se levanta un contenedor con Node 20, deps de npm y ESLint ya instalados, para trabajar sin instalar nada en la PC local. |
| `docs/` | Documentación interna del mantenedor (contexto del proyecto, roadmap, aviso de privacidad). No se versiona en git ni se sube a Apps Script. |
| `assets/` | Assets estáticos del proyecto (por ejemplo el ícono `icon_96x96.png`). El logo servido por el add-on en runtime lo sube el `npm run setup` desde acá a la carpeta Drive del usuario, y como fallback (para instalaciones manuales o si la subida falla) la plantilla apunta a un ícono público de Gmail alojado en gstatic. |
| `secrets/` | Plantillas de `CLASP_JSON` y `CLASPRC_JSON`. Cada colaborador reemplaza los placeholders con sus valores reales y las usa para dos cosas: (1) `CLASP_JSON` se copia como `.clasp.json` local para trabajar con clasp desde la máquina, y (2) ambos archivos se pegan como secrets del repo en GitHub Actions para que el workflow de deploy pueda hacer `clasp push`. |
| `.github/workflows/deploy.yml` | Workflow de GitHub Actions que lintea, genera el manifest desde la plantilla y sube el código a Apps Script en cada push a `main` o `desarrollo`. |
| `.claspignore` | Lista de archivos que `clasp push` no debe subir al editor web de Apps Script. Versionada porque es política común del proyecto. |
| `.eslintrc.js` | Configuración de ESLint con reglas de calidad de código y de seguridad (`eslint-plugin-security`) para los archivos `.gs`. |
| `.gitignore` | Archivos y carpetas que git ignora (incluye `.clasp.json`, `src/appsscript.json` generado, dependencias de npm, `docs/`, entre otros). |
| `package.json` y `package-lock.json` | Declaración y versiones exactas de dependencias de npm. El proyecto solo usa npm para lintear en local y en CI. El add-on no corre en Node. |
| `README.md` | Este archivo. |

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

## Privacidad y logs

El add-on es una herramienta interna de uso corporativo. **No procesa datos clínicos ni información de pacientes**: opera solamente sobre correos internos del proceso de despliegues de software (número de caso, servicio, ambiente, URLs de documentación técnica, correo corporativo del colaborador que radica la solicitud).

Aun así, los correos corporativos identifican indirectamente a un colaborador y por lo tanto son datos personales bajo el artículo 3 de la Ley 1581 de 2012. Por eso el código incluye redacción de datos personales en los registros de ejecución (`console.log` que van al panel de Ejecuciones de Apps Script):

- **Bandera `LOG_REDACT_PII`** en `Config.gs`, activada por defecto.
- **Helpers** `redactEmail_`, `redactCaso_`, `redactTexto_`, `redactUrl_` que enmascaran los valores antes de imprimirlos.
- Ejemplo: `juan.perez@keralty.com` aparece como `j***@k***.com`, un caso `1234` como `12**`, un servicio `Producción` como `Prod...(10)`, una URL de Drive como `https://drive.google.com/...` sin el ID del documento.
- Los identificadores internos (`envioId`, `messageId`, IDs de trigger, contadores) se registran sin enmascarar porque no son datos personales y son necesarios para trazar el flujo entre ejecuciones.

Para depuración local sobre datos ficticios se puede poner `LOG_REDACT_PII = false` temporalmente. **No dejarlo en false en producción.**

El aviso de privacidad completo para el usuario (identidad del responsable, finalidades, derechos, canal para ejercerlos según el artículo 14 del Decreto 1377 de 2013) se mantiene aparte y no forma parte del repositorio versionado.

## Configuración por usuario

Cada persona que instala el add-on define tres valores la primera vez que lo abre. Se guardan en `UserProperties` y son propias de esa cuenta:

- `SHEET_ID`: ID del Sheet de seguimiento donde va a escribir.
- `SHEET_TAB`: nombre de la pestaña dentro de ese Sheet.
- `CARPETA_RAIZ_ID`: ID de la carpeta raíz de Drive del cliente donde se replican los adjuntos.

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

## Uso en tu propia cuenta

Si clonaste (o forkeaste) este repositorio y quieres instalar el add-on en tu propia cuenta de Google, hay dos rutas. La **Ruta A** es la recomendada para la mayoría de usuarios. La **Ruta C** es opcional y solo aplica si además quieres que cada `git push` a tu fork suba los cambios a tu Apps Script automáticamente.

### Requisitos comunes a ambas rutas

- [Node.js 18 o superior](https://nodejs.org) instalado. Incluye `npm` y `npx`, que son los que ejecutan todos los comandos de este flujo. Sin Node, ni `npm install` ni `npm run setup` funcionan. Para verificar si ya lo tienes, corre en terminal:

  ```bash
  node --version
  npm --version
  ```

  Si te responde con números de versión, ya lo tienes. Si te dice que el comando no existe, instálalo de una de estas dos formas:

  **Por terminal (recomendado en Windows 10/11):** `winget` viene preinstalado, y con un solo comando descarga e instala Node LTS:

  ```powershell
  winget install OpenJS.NodeJS.LTS
  ```

  Cierra y vuelve a abrir PowerShell para que reconozca los comandos `node` y `npm`. Si usas macOS con [Homebrew](https://brew.sh/) el equivalente es `brew install node`; en Linux con apt es `sudo apt install nodejs npm`.

  **Por instalador gráfico:** descarga el instalador "LTS" desde [nodejs.org](https://nodejs.org), ejecútalo con las opciones por defecto, y reinicia la terminal.

- [Git](https://git-scm.com/) instalado, para clonar el repositorio.
- Una cuenta de Google donde vivirá tu copia del proyecto Apps Script.

No hace falta instalar `clasp` a mano: se declara como dependencia de desarrollo en `package.json` y queda disponible después de `npm install`.

**¿Y si no quieres o no puedes instalar Node?** Este flujo con `clasp` está pensado para colaboradores que van a modificar el código. Si solo quieres **usar** el add-on sin tocarlo, no necesitas Node ni clonar el repo: pídele al mantenedor del proyecto que te comparta acceso como tester al proyecto Apps Script existente (ver sección **Distribución** más abajo). Con ese acceso puedes instalar el add-on en tu cuenta directamente desde el editor web, sin línea de comandos.

**Alternativa sin instalar nada local: GitHub Codespaces.** El repo trae `.devcontainer/devcontainer.json` configurado para levantar un contenedor con Node 20, deps de npm y ESLint ya instalados. Basta con abrir el repo en GitHub, botón verde **Code → Codespaces → Create codespace**. Tras uno o dos minutos tenés un VS Code en el navegador con todo listo para correr `npm run setup` sin instalar nada en tu PC. Detalle: si es la primera vez que hacés `clasp login` desde el Codespace, el flujo OAuth no puede completarse solo (el `localhost` del contenedor no es alcanzable desde tu navegador). Ver más abajo la sección **Login OAuth desde Codespaces** para el workaround.

### Ruta A: instalación básica (una sola vez, todo local)

Con esta ruta creas tu propio proyecto Apps Script bajo tu cuenta, subes el código de este repo, y quedas listo para usar el add-on. No requiere GitHub Actions ni secrets.

**Paso previo obligatorio:** habilita la **Google Apps Script API** en tu cuenta de Google. Es un switch de un solo clic que Google mantiene desactivado por defecto y que `clasp` necesita para crear y modificar proyectos desde línea de comandos:

1. Abre [https://script.google.com/home/usersettings](https://script.google.com/home/usersettings).
2. Activa el switch **"Google Apps Script API"** (ponlo en ON).
3. Espera 1-2 minutos para que el cambio se propague.

Sin este paso, `npm run setup` falla en `clasp create` con el mensaje `User has not enabled the Apps Script API`.

Después:

```bash
git clone <URL de este repositorio>
cd "Gestor de Solicitudes"
npm install
npm run setup
```

El script `npm run setup` corre `scripts/setup.js` que orquesta el bootstrap completo del proyecto en tu cuenta:

1. **Verifica credenciales de clasp**. Si `~/.clasprc.json` no existe, corre `clasp login` (abre el navegador para autorizar con tu Google). Si ya estabas logueado, se salta este paso.
2. **Busca o crea la carpeta "Gestor de Solicitudes"** en tu Drive. Todos los artefactos del add-on van a vivir dentro.
3. **Sube `assets/icon_96x96.png` a esa carpeta** y le pone permiso público, para que Google pueda cargarlo como logo del add-on. Si el archivo ya está subido, lo reusa.
4. **Genera `src/appsscript.json`** a partir de `src/appsscript.template.json`, reemplazando la URL del logo por la del que acabas de subir. Si la subida falló, deja la URL de fallback (`gstatic` de Gmail).
5. **Crea el proyecto Apps Script dentro de la carpeta** con `clasp create --parentId <folderId>`. Si `.clasp.json` ya existe, se salta este paso.
6. **Escribe `.clasp.json` con todos los campos explícitos** (`scriptId`, `rootDir=src`, extensiones, etc.).
7. **Sube el código** con `clasp push --force` (el `--force` evita la confirmación interactiva sobre el manifest).
8. **Imprime instrucciones** con la URL del proyecto y el paso manual final para instalar el add-on en Gmail.

Al terminar, entra al link que imprime el script (o [script.google.com](https://script.google.com)) y verás la carpeta "Gestor de Solicitudes" en tu Drive con el logo y el proyecto Apps Script dentro. Para que aparezca en Gmail, sigue el paso manual que imprime el setup: **Deploy → Test deployments → Install → Done**.

Para subir cambios locales al proyecto Apps Script en el futuro:

```bash
npm run push
```

Para bajar cambios hechos directamente en el editor web:

```bash
npm run pull
```

**Notas:**

- El setup es idempotente: se puede correr varias veces sin duplicar nada. La segunda corrida detecta que la carpeta y el logo ya están, y salta el `clasp create` si `.clasp.json` existe.
- Si querés arrancar completamente desde cero (por ejemplo para forzar un proyecto nuevo o probar el flujo entero), borrá `.clasp.json` y `src/appsscript.json` antes de correr `npm run setup`. Si además querés que el logo se re-suba a una carpeta nueva, borrá también la carpeta "Gestor de Solicitudes" desde tu Drive.
- El archivo `src/appsscript.json` que genera el setup **no está en git** (`.gitignore` lo excluye). Cada usuario tiene el suyo local, con su URL de logo personal. No hace falta cuidarse de commitearlo por accidente: git simplemente lo ignora.
- La configuración por usuario (`SHEET_ID`, `SHEET_TAB`, `CARPETA_RAIZ_ID`) se define desde el propio add-on la primera vez que lo abres, no desde el repositorio. Ver sección **Configuración por usuario**.

### Login OAuth desde Codespaces (workaround)

Si trabajás desde GitHub Codespaces y es la primera vez que hacés `clasp login`, el flujo estándar no puede completarse solo. Google redirige el callback OAuth a `http://localhost:<PUERTO>/?code=...` y ese `localhost` es el del contenedor Codespaces, no el de tu navegador. Por eso el navegador muestra `ERR_CONNECTION_REFUSED` al final.

Workaround en dos terminales dentro del Codespace:

1. En la **terminal 1**, corré `npx clasp login`. El comando queda esperando el callback.
2. Copiá la URL de Google que imprime, abrila en tu navegador Windows y autorizá con tu cuenta Google.
3. Al fallar el redirect a `localhost`, copiá la URL completa de la barra del navegador (la que empieza con `http://localhost:<PUERTO>/?code=...`).
4. En la **terminal 2** del mismo Codespace, corré:

   ```bash
   npm run login:finish
   ```

   Pegá la URL cuando te la pida y presioná Enter. Ese script hace el `curl` local que le entrega el `code` al servidor de clasp que sigue corriendo en la terminal 1.
5. Volvé a la terminal 1: clasp imprime "Success!" y crea `~/.clasprc.json` con las credenciales.

Después de esto ya podés correr `npm run setup` normalmente. El token dura varios meses; solo hay que repetir este paso si expira o si borrás el Codespace.

### Ruta C: deploy automático desde tu fork (opcional)

Con esta ruta, además de tener el add-on instalado localmente, configuras GitHub Actions en tu fork para que cada push a `main` suba automáticamente el código a tu Apps Script. Requiere haber completado antes la Ruta A.

**Pasos:**

1. Haz fork de este repositorio en tu cuenta de GitHub.
2. Clónalo local y ejecuta la Ruta A completa. Al final tendrás dos archivos con credenciales:
   - `~/.clasprc.json` (token OAuth de tu cuenta Google).
   - `.clasp.json` (con el `scriptId` de tu proyecto Apps Script).
3. En tu fork, ve a **Settings → Secrets and variables → Actions → New repository secret** y crea los dos secrets:

   | Nombre del secret | Contenido |
   |---|---|
   | `CLASPRC_JSON` | Contenido completo del archivo `~/.clasprc.json` (en Windows: `C:\Users\TuUsuario\.clasprc.json`). |
   | `CLASP_JSON` | Contenido completo del archivo `.clasp.json` que quedó en la raíz del repo. |

   **Cómo copiar el contenido en Windows (PowerShell):**

   Primero, verifica que los dos archivos existan. El `-Force` es necesario para `.clasprc.json` porque empieza con punto y por defecto PowerShell no muestra archivos ocultos:

   ```powershell
   cd "C:\ruta\a\Gestor de Solicitudes"
   Test-Path $env:USERPROFILE\.clasprc.json
   Test-Path .clasp.json
   ```

   Si ambos comandos responden `True`, cópialos al portapapeles uno a uno y pégalos en GitHub con **Ctrl+V**:

   ```powershell
   Get-Content $env:USERPROFILE\.clasprc.json | Set-Clipboard
   # Pegar en el secret CLASPRC_JSON con Ctrl+V, luego "Add secret"

   Get-Content .clasp.json | Set-Clipboard
   # Pegar en el secret CLASP_JSON con Ctrl+V, luego "Add secret"
   ```

   **Cómo copiar el contenido en macOS o Linux:**

   ```bash
   # macOS
   cat ~/.clasprc.json | pbcopy
   cat .clasp.json | pbcopy

   # Linux (requiere xclip instalado)
   cat ~/.clasprc.json | xclip -selection clipboard
   cat .clasp.json | xclip -selection clipboard
   ```

   **Cómo copiar el contenido desde GitHub Codespaces:**

   El terminal del Codespace no tiene acceso al portapapeles de tu PC. La forma limpia es abrir cada archivo en el editor y copiar desde ahí:

   ```bash
   code ~/.clasprc.json
   ```

   Se abre en una pestaña de VS Code (en el navegador del Codespace). Haz clic dentro del editor, **Ctrl+A** (seleccionar todo), **Ctrl+C** (copiar). Vas a la pantalla del secret `CLASPRC_JSON` en GitHub y **Ctrl+V** para pegar.

   Repite con el `.clasp.json`:

   ```bash
   code .clasp.json
   ```

   Igual: Ctrl+A, Ctrl+C, pegar en el secret `CLASP_JSON`.

4. Confirma que el workflow `.github/workflows/deploy.yml` corre sobre `main`.
5. Haz un `git push` a `main` de tu fork. El workflow arranca solo y sube el código a tu Apps Script.

**Comportamiento en forks sin secrets configurados:** el workflow detecta que faltan los secrets y termina en verde sin intentar el push, mostrando un aviso en el log. Es decir, un fork recién clonado no rompe su pestaña Actions con errores en rojo; simplemente el deploy automático queda desactivado hasta que agregues los secrets.

**Rotación de credenciales:** si el token OAuth de `CLASPRC_JSON` deja de funcionar (Google los revoca eventualmente), corre `clasp login` en local para regenerar el archivo y actualiza el valor del secret con el contenido nuevo. El secret se puede editar sin borrarlo, desde la misma pantalla donde lo creaste.

## Desarrollo local

El código del add-on corre en Apps Script, no en Node. `package.json` existe únicamente para poder lintar los `.gs` con ESLint en local y ejecutar los comandos de `clasp`.

### Requisitos

- Node.js 18+ (incluye `npm` y `npx`).
- Las dependencias del repo (`clasp`, ESLint, plugins) se instalan con `npm install` y quedan bajo `node_modules/`. No requiere instalación global.

### Sincronización con Apps Script

El proyecto se sincroniza con el editor web de Apps Script mediante clasp:

```bash
clasp login          # una sola vez, con la cuenta de Google del proyecto
clasp pull           # bajar cambios hechos en el editor web
clasp push           # subir cambios locales al editor web
```

El archivo `.clasp.json` contiene el `scriptId` (el identificador del proyecto Apps Script destino) y está excluido del repositorio porque puede diferir entre colaboradores (por ejemplo, cada uno con su propio proyecto de desarrollo). Se usa `secrets/CLASP_JSON` como plantilla:

```bash
cp secrets/CLASP_JSON .clasp.json
# editar .clasp.json y reemplazar TU_SCRIPT_ID_AQUI por el scriptId real
```

El mismo archivo `secrets/CLASP_JSON` (con el `scriptId` real) es el contenido que se pega como el secret `CLASP_JSON` en GitHub para que el workflow de deploy pueda hacer `clasp push`.

El `scriptId` se obtiene del editor de Apps Script en **Configuración del proyecto → ID de secuencia de comandos**.

El archivo `.claspignore` sí se versiona porque define qué archivos del repo NO deben subirse a Apps Script (documentación, dependencias de npm, configuración de linter, assets, etc.). Es política del proyecto y debe ser consistente entre colaboradores.

### Lint

```bash
npm install
npm run lint
```

## Automatización de despliegue

Cada push a las ramas `main` o `desarrollo` dispara automáticamente el workflow definido en `.github/workflows/deploy.yml`. El workflow se ejecuta en un runner Ubuntu efímero de GitHub Actions y hace lo siguiente:

1. Clona el código del repositorio.
2. Instala Node.js 20 y las dependencias declaradas en `package.json` (`npm ci`).
3. Corre ESLint (`npm run lint`). Si aparecen errores, el workflow se aborta.
4. Instala clasp globalmente.
5. Restaura las credenciales de clasp y el `.clasp.json` desde los GitHub Secrets del repositorio.
6. Genera `src/appsscript.json` a partir de `src/appsscript.template.json` (una copia directa, ya que la plantilla trae la URL de logo de fallback que el deploy usa por defecto).
7. Ejecuta `clasp push --force` contra el proyecto Apps Script destino.

Si cualquiera de los pasos falla, el workflow queda en rojo y Apps Script conserva la versión anterior. Los cambios llegan al editor web únicamente cuando el workflow termina en verde.

### Secretos requeridos

El workflow lee dos secretos configurados en la sección Actions Secrets del repositorio en GitHub:

| Secret | Contenido |
|---|---|
| `CLASPRC_JSON` | Contenido del archivo `~/.clasprc.json` local, generado con `clasp login`. Incluye el refresh token de la cuenta de Google que hace el push. |
| `CLASP_JSON` | Contenido del archivo `.clasp.json` local con el `scriptId` del proyecto Apps Script destino. |

Ambos secretos se guardan encriptados en GitHub y solo se descifran en el momento de correr el workflow, dentro del runner efímero. `CLASPRC_JSON` es especialmente sensible porque autentica ante Google; su rotación se hace corriendo `clasp login` local de nuevo y actualizando el valor del secret.

### Disparo manual

Además del push automático a `main`, el workflow puede dispararse a mano desde la pestaña **Actions** del repositorio con el botón **Run workflow**. Útil para reintentar un deploy que falló por causas transitorias (por ejemplo, timeout de red hablando con Google) sin generar un commit nuevo.

### Push desde local como fallback

Si por alguna razón el pipeline no está disponible (credenciales del secret vencidas, GitHub Actions en mantenimiento, cambios que no van a versionarse todavía), se puede subir a Apps Script directamente desde local con `clasp push`. Requiere haber corrido `clasp login` en la cuenta correcta y tener un `.clasp.json` válido en la raíz del proyecto.

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

El add-on queda disponible en el panel lateral de Gmail y en Sheets para esa cuenta. Los cambios en el código quedan visibles la próxima vez que el tester recarga Gmail o reabre el add-on, sin necesidad de reinstalar.

### Advertencia "Google no ha verificado esta aplicación"

Durante el paso 4, antes de llegar a la pantalla de consentimiento con los cinco scopes, Google muestra una **pantalla intermedia roja** que dice:

> Google no ha verificado esta aplicación
>
> La aplicación está solicitando acceso a información sensible de tu cuenta de Google. No deberías utilizar esta aplicación hasta que el desarrollador la verifique con Google.

**Es normal y esperado.** Aparece porque el add-on está en modo de implementación de prueba, no publicado en el Google Workspace Marketplace, y por lo tanto **no ha pasado la verificación oficial del OAuth consent screen** que Google exige para uso público. Esta verificación implica un proceso formal (revisión de scopes, política de privacidad, video demo, dominio del desarrollador, entre otras cosas) que solo se hace cuando el add-on se publica al Marketplace.

Mientras el add-on esté en implementación de prueba, esta advertencia siempre va a aparecer para cada usuario nuevo que lo instale. **Para continuar:**

1. Haz clic en el enlace **"Configuración avanzada"** abajo a la izquierda.
2. Aparece un texto pequeño tipo **"Ir a Gestor de Solicitudes (no seguro)"**. Haz clic ahí.
3. Google muestra ahora sí la pantalla real de consentimiento con los cinco scopes. Aprueba y ya queda instalado.

El correo que aparece en la advertencia como "desarrollador" es simplemente la cuenta dueña del proyecto Apps Script; no expone ningún dato personal adicional al usuario que instala.

Esta advertencia solo desaparecería si el add-on se publica formalmente en Marketplace y pasa por el proceso de verificación de Google, lo cual está fuera del alcance de la implementación de prueba.
