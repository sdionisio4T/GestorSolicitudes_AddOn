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
- **JSON de las solicitudes** (desde el panel del Sheet): busca los `.json` de cada fila por número de caso y deja los links en la columna N o, si no hay, el motivo. Ver la sección [JSON de las solicitudes](#json-de-las-solicitudes).

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
| `src/IndiceJson.gs` | Búsqueda de JSON de las solicitudes desde el panel del Sheet: columnas N y O, pestaña "JSON sin fila", trabajo por partes con activadores. |
| `src/JsonWso2.gs` | Copia de los JSON a `[Raíz]/JSON-WSO2/<caso>/` y celda de la columna N con el link a esa carpeta. La usan la búsqueda de JSON, el envío y los reintentos. |
| `src/Tests.gs` | Tests unitarios de helpers puros (regex, columnas, parsing). Corren en Apps Script (`correrTodosLosTests`) y en Node (`npm test`). |
| `src/Integracion.gs` | Prueba de integración real del envío (`correrIntegracion`) contra un Sheet y una carpeta de prueba. Se corre a mano en Apps Script. |
| `src/appsscript.template.json` | Plantilla del manifiesto del add-on: scopes OAuth, triggers, dominios permitidos, y una URL de logo por defecto (gstatic Gmail). Está en git y es la fuente de verdad. |
| `src/appsscript.json` | Manifiesto real que consume clasp. **No está en git** (lo genera `npm run setup` a partir de la plantilla, reemplazando la URL del logo por el que el usuario sube a su Drive). |

## Estructura del repositorio

Además del código en `src/`, el repositorio contiene:

| Ubicación | Descripción |
|---|---|
| `src/` | Código fuente del add-on (`.gs` + `appsscript.template.json`). `clasp` toma esta carpeta como raíz de push (ver `rootDir` en `.clasp.json`). |
| `tests/` | Tests en Node (`npm test`): `cargar-gs.js` carga los `.gs` de `src/` con dobles mínimos de Apps Script, y `fixtures/` guarda correos de solicitud anonimizados con lo que se espera extraer de cada uno. No se sube a Apps Script. |
| `scripts/setup.js` | Orquestador de `npm run setup`: crea la carpeta del proyecto en Drive del usuario, sube el logo, marca el logo como público, genera `src/appsscript.json` a partir de la plantilla, crea el proyecto Apps Script dentro de la carpeta y sube el código. |
| `scripts/generar-manifest.js` | Lo usa el workflow de deploy: genera `src/appsscript.json` desde la plantilla conservando el logo que el proyecto ya tiene en Apps Script. |
| `scripts/finish-login.sh` | Helper para completar `clasp login` desde Codespaces cuando el redirect a `localhost` falla. Se invoca con `npm run login:finish`. Ver sección **Login OAuth desde Codespaces**. |
| `.devcontainer/devcontainer.json` | Configuración de GitHub Codespaces. Al abrir el repo en Codespaces, se levanta un contenedor con Node 24, deps de npm y ESLint ya instalados, para trabajar sin instalar nada en la PC local. |
| `docs/` | Documentación interna del mantenedor (contexto del proyecto, roadmap, aviso de privacidad). No se versiona en git ni se sube a Apps Script. |
| `assets/` | Assets estáticos del proyecto (por ejemplo el ícono `icon_96x96.png`). El logo servido por el add-on en runtime lo sube el `npm run setup` desde acá a la carpeta Drive del usuario, y como fallback (para instalaciones manuales o si la subida falla) la plantilla apunta a un ícono público de Gmail alojado en gstatic. |
| `secrets/` | Plantillas de `CLASP_JSON` y `CLASPRC_JSON`. Cada colaborador reemplaza los placeholders con sus valores reales y las usa para dos cosas: (1) `CLASP_JSON` se copia como `.clasp.json` local para trabajar con clasp desde la máquina, y (2) ambos archivos se pegan como secrets del repo en GitHub Actions para que el workflow de deploy pueda hacer `clasp push`. |
| `.github/workflows/deploy.yml` | Workflow de GitHub Actions que lintea, corre los tests, genera el manifest desde la plantilla y sube el código a Apps Script en cada push a `main` o `desarrollo`. |
| `.claspignore` | Lista de archivos que `clasp push` no debe subir al editor web de Apps Script. Versionada porque es política común del proyecto. |
| `.eslintrc.js` | Configuración de ESLint con reglas de calidad de código y de seguridad (`eslint-plugin-security`) para los archivos `.gs`. |
| `.gitignore` | Archivos y carpetas que git ignora (incluye `.clasp.json`, `src/appsscript.json` generado, dependencias de npm, `docs/`, entre otros). |
| `package.json` y `package-lock.json` | Declaración y versiones exactas de dependencias de npm (clasp va con versión fija). El proyecto usa npm para lintear, correr los tests y subir con clasp, en local y en CI. El add-on no corre en Node. |
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

## Registros y enmascaramiento de datos

El add-on procesa exclusivamente datos operativos del proceso interno de despliegues: número de caso, servicio a desplegar, ambiente, URLs de documentación técnica y correo corporativo del colaborador que radica la solicitud. No procesa información clínica ni datos de pacientes.

Los registros de ejecución (`console.log` que van al panel de Ejecuciones de Apps Script) enmascaran los datos personales antes de imprimirlos:

- **Bandera `LOG_REDACT_PII`** en `Config.gs`, activada por defecto.
- **Helpers** `redactEmail_`, `redactCaso_`, `redactTexto_` y `redactUrl_` aplican el enmascaramiento en todos los puntos donde se registran valores del correo, del formulario o del Sheet.
- **Ejemplos del formato de salida:**

  | Valor original | Aparece en el log como |
  |---|---|
  | `juan.perez@keralty.com` | `j***@k***.com` |
  | `1234` (número de caso) | `12**` |
  | `Producción` (servicio) | `Prod...(10)` |
  | URL de Drive con ID | `https://drive.google.com/...` |

- Los identificadores internos (`envioId`, `messageId`, IDs de trigger, contadores) se registran sin enmascarar porque no identifican personas y son necesarios para trazar el flujo entre ejecuciones.

La bandera `LOG_REDACT_PII` solo debería quedar en `false` durante depuración puntual contra datos ficticios.


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

## JSON de las solicitudes

En el panel del add-on en el Sheet, la sección **"🗂️ JSON de las solicitudes"** abre una tarjeta que busca los `.json` de cada fila y los anota en el propio Sheet. La función es solo del Sheet; no aparece en Gmail.

### Qué escribe

| Dónde | Qué |
|---|---|
| Columna N | El link a la carpeta de los JSON del caso en `JSON-WSO2`, con el texto `JSON-WSO2/9300 (2 JSON)`. Si no hay JSON, el motivo. Debajo pueden quedar links a archivos que no se pudieron copiar (ver [Carpeta JSON-WSO2](#carpeta-json-wso2)). |
| Columna O ("Carpeta copiada") | El link a la carpeta copiada de la fila, cuando la columna C no enlaza ya una carpeta de la raíz. |
| Carpeta `[Raíz]/JSON-WSO2/<caso>/` | Una copia de cada JSON del caso, un archivo por nombre. |
| Pestaña "JSON sin fila" | Los `.json` de la raíz que ninguna fila usa, con su ruta y el porqué. Se reescribe al terminar cada búsqueda completa. |

Motivos posibles en la columna N:

| Motivo | Significa |
|---|---|
| `Carpeta sin JSON` | El caso tiene carpeta en la raíz, pero sin `.json`. |
| `Sin acceso al original` | El link original de la fila no se puede abrir (sin permiso o borrado). |
| `Original sin JSON` | El original se pudo abrir y no tiene `.json`. |
| `Sin carpeta ni link` | No hay carpeta del caso en la raíz ni link en la fila. |

Cualquier línea de la columna N que no sea una URL se toma como motivo. Las celdas que ya tienen links nunca se modifican: pueden venir de los envíos.

### Cómo busca

- **La clave es el número de caso.** Para cada fila se juntan los `.json` de todas las carpetas de la raíz cuyo nombre contiene el número de caso completo, en cualquier rama. El sufijo de reenvío no cuenta (`9300_2` es el caso 9300) y solo se toman números de 3 dígitos o más, para no confundir versiones o nombres de productos (`v1.0.1`, `WSO2`) con casos.
- **Archivos repetidos:** mismo nombre y mismo contenido (md5) dejan un solo link; mismo nombre con contenido distinto deja los dos.
- **Si el caso no tiene carpeta en la raíz**, se abren los links de las columnas C y D de esa fila (la copia con otro nombre o la carpeta original) y se busca ahí.
- **Qué lee de Drive:** solo la carpeta raíz configurada, una carpeta por consulta, y las carpetas enlazadas en las columnas C y D. No recorre el resto del Drive de quien busca ni la carpeta `JSON-WSO2`, que solo tiene copias.

### Botones

| Botón | Qué hace |
|---|---|
| Buscar JSON | Revisa todo el Sheet: trabaja las filas sin links en la columna N, tanto las vacías como las que tienen un motivo (por si ya subieron el JSON o dieron el permiso). El texto del motivo no se interpreta: solo importa si la celda tiene links o no. |
| Buscar en filas | Con "Desde fila" y "Hasta fila": revisa al momento solo esas filas (ver [Búsqueda por filas](#búsqueda-por-filas)). |
| Ver avance | Refresca la tarjeta y deja lista la parte siguiente (ver abajo). |
| Continuar | Sigue una búsqueda que quedó a medias. |
| Detener | Para la búsqueda; lo ya escrito se conserva. |
| Pasar JSON a JSON-WSO2 | Aparece arriba solo si hay filas con links a archivos JSON en la columna N. Copia esos JSON a `JSON-WSO2/<caso>/` y cambia la celda por el link a la carpeta. Corre en segundo plano, por partes. |

La tarjeta tiene poco texto a propósito. Junto a "Buscar JSON", "Buscar en filas" y "Pasar JSON a JSON-WSO2" hay un ícono ⓘ: al pasar el cursor muestra para qué sirve el botón, y con un clic muestra lo mismo como aviso. Las casillas tienen una pista debajo ("Por ejemplo, 120" y "Vacío = una sola fila").

Las tarjetas de los add-ons solo muestran un tooltip en los botones de **solo ícono**: en un botón con texto, Google ignora el texto alternativo al pasar el cursor. Por eso la ayuda va en un ícono aparte y no en el botón. Los textos están en `INDICE_AYUDA_BOTONES`, en `src/IndiceJson.gs`.

### Búsqueda por filas

Para revisar unas pocas filas (por ejemplo, porque ya subieron el JSON o dieron el permiso) no hace falta recorrer toda la raíz. "Buscar en filas" corre dentro del mismo clic y va directo a las carpetas de cada fila:

1. **La ruta del caso en la raíz:** `Servicio/Caso` o `APIM/Servicio/Caso`, con sus reenvíos `Caso_N`.
2. **La carpeta anotada en la columna O.**
3. Si en las anteriores no hay `.json`, **los links de las columnas C y D** (la copia o el original).

Reglas:

- Trabaja las filas del rango con la columna N vacía o con motivo. Las que tienen links no se tocan.
- Para una sola fila, "Hasta fila" queda vacío.
- Tiene unos 15 segundos para consultar Drive (una acción de tarjeta dura 30). Si el rango no alcanza, escribe lo que hizo, avisa desde qué fila falta y deja las casillas listas para presionar otra vez.
- No reescribe la pestaña "JSON sin fila" ni usa la nota de la búsqueda completa.

Diferencia con la búsqueda completa: esta no ve un `.json` que esté en una carpeta del caso fuera de su ruta normal y sin link en la fila. Para eso está "Buscar JSON".

### Carpeta JSON-WSO2

Los JSON encontrados se copian a `[Raíz]/JSON-WSO2/<caso>/`, y la columna N enlaza esa carpeta en vez de cada archivo:

```
[Raíz]/
└── JSON-WSO2/
    ├── 9300/
    │   ├── config.json
    │   └── tarifas.json
    └── 7799/
        └── api.json
```

- **Un archivo por nombre en cada caso.** Si varias filas del caso usan el mismo JSON, hay una sola copia. Los reenvíos (`9300_2`) van a la misma carpeta `9300`.
- **Mismo nombre con otro contenido:** se queda el más reciente. Se reemplaza el contenido sobre el mismo archivo, así su link no cambia.
- **Quién copia:** "Buscar JSON", "Buscar en filas", "Pasar JSON a JSON-WSO2", el envío y los reintentos de copia.
- **El envío** copia los JSON en el mismo clic solo si le quedan al menos 8 segundos de los 30 que dura la acción. Si no, la columna N queda con los links a los archivos y la fila aparece en "Pasar JSON a JSON-WSO2". Los reintentos copian como mucho 8 segundos por ronda, para no alargar el activador.
- **Si un JSON no se puede copiar** (sin tiempo o sin permiso), su link queda debajo de la línea de la carpeta y la fila sigue apareciendo en "Pasar JSON a JSON-WSO2".
- Las copias quedan a nombre de quien las crea. El ID de la carpeta `JSON-WSO2` se guarda en las propiedades del script (`JSON_WSO2_ID_<raíz>`). Código en `src/JsonWso2.gs`.

### Trabajo por partes

Una ejecución de Apps Script dura como máximo 6 minutos, así que la búsqueda corre en segundo plano por partes de hasta 4,5 minutos. Cada parte sigue en la fila donde quedó la anterior.

Google no permite que un activador de un complemento de editor programe al siguiente antes de una hora, pero sí lo permite desde una acción del usuario. Por eso:

- Al presionar **"Ver avance"** o abrir el panel mientras corre una parte, la siguiente queda programada para cuando esa termine. Basta una vez, en cualquier momento.
- Si nadie presiona nada, la parte siguiente arranca sola a la hora.

Como referencia, con unas 600 filas y una raíz de unas 750 carpetas una búsqueda completa toma 2 o 3 partes, según la velocidad de respuesta de Drive.

### Dónde se guarda el estado

- **Mapa de la raíz:** en la caché del script (`CacheService`), solo mientras dura una búsqueda, para que la parte siguiente no vuelva a leer Drive. Se borra al terminar o al detener; como respaldo, vence a las 6 horas.
- **Nota de la búsqueda:** en las propiedades del script, una por Sheet (por su ID): parte, fila donde va, contadores y fecha de término. De ahí sale el resumen de la tarjeta, que se muestra durante 24 horas después de terminar; luego la tarjeta vuelve al texto de inicio.

Si se copian las columnas N y O a otro Sheet, la búsqueda las reconoce igual, pero ese Sheet no hereda la nota: la tarjeta se verá como si nunca se hubiera buscado.

### Lectura de la raíz de una vez (apagada)

`INDICE_CONFIG.LEER_RAIZ_DE_UNA_VEZ` en `src/IndiceJson.gs` cambia la forma de leer la raíz:

| Valor | Cómo lee | Alcance |
|---|---|---|
| `false` (por defecto) | Una consulta por carpeta, desde la raíz hacia abajo. | Solo la carpeta raíz. |
| `true` | Dos listados de toda la unidad (carpetas y archivos) y filtra en memoria lo que cuelga de la raíz. Más rápido. | Unidad compartida: solo esa unidad. Mi unidad: **todo el Drive de quien busca**, incluido lo compartido con esa persona (solo nombres e IDs, sin contenido). |

Encenderla solo tiene sentido si la raíz está en una unidad compartida. El registro de cada parte indica qué forma se usó ("leída de una vez" o "Raíz leída carpeta por carpeta").

## Instalación

Apps Script no permite instalar un add-on directamente desde un repositorio. El código tiene que vivir **al menos una vez** dentro de un proyecto Apps Script bajo la cuenta de Google de alguien del equipo. Ese proyecto puede después compartirse con otros testers (ver [Distribución](#distribución-compartir-con-testers)) o usarse solo por quien lo creó.

Hay dos rutas para armar ese proyecto en tu cuenta. Elige la que se ajuste a tu situación:

- **[Ruta A: local](#ruta-a-local-node-en-tu-computador)**: si tienes o puedes instalar Node.js en tu computador. Los secrets quedan guardados en el disco y persisten entre sesiones.
- **[Ruta B: GitHub Codespaces](#ruta-b-github-codespaces-sin-instalar-nada)**: si no puedes o no quieres instalar nada local. Todo corre en la nube. Los secrets viven en el Codespace y se pierden cuando el servidor se apaga.

Cuando termines cualquiera de las dos, sigue **[Instalar el add-on en Gmail](#instalar-el-add-on-en-gmail)** para dejarlo disponible en tu bandeja.

> ¿Vas a modificar código y quieres que cada `git push` actualice el add-on solo? Después de terminar la instalación, sigue la sección **[Deploy automático desde tu fork](#deploy-automático-desde-tu-fork-opcional-para-desarrolladores)**. Los secrets que necesitas ya los tienes en el disco (Ruta A) o en el Codespace (Ruta B).

### Ruta A: local (Node en tu computador)

**Cuándo elegirla:** vas a trabajar habitualmente con el add-on desde tu PC, o quieres que los secrets de clasp queden guardados para poder configurar deploy automático más adelante sin re-loguearte.

**Requisitos:**

- [Node.js 18 o superior](https://nodejs.org). Incluye `npm` y `npx`, que son los que ejecutan todos los comandos. Para verificar si ya lo tienes, corre:

  ```bash
  node --version
  npm --version
  ```

  Si te responde con números de versión, ya lo tienes. Si te dice que el comando no existe, instálalo:

  - **Windows** (recomendado, `winget` viene preinstalado):

    ```powershell
    winget install OpenJS.NodeJS.LTS
    ```

    Cierra y vuelve a abrir PowerShell para que reconozca `node` y `npm`.

  - **macOS con [Homebrew](https://brew.sh/):** `brew install node`.
  - **Linux con apt:** `sudo apt install nodejs npm`.
  - **Instalador gráfico multiplataforma:** descargá el instalador LTS desde [nodejs.org](https://nodejs.org) y reinicia la terminal después.

- [Git](https://git-scm.com/) instalado, para clonar el repositorio.
- Una cuenta de Google donde va a vivir tu copia del proyecto Apps Script.

No hace falta instalar `clasp` a mano: se declara como dependencia de desarrollo en `package.json` y queda disponible después de `npm install`.

**Paso previo obligatorio:** habilita la **Google Apps Script API** en tu cuenta de Google. Es un switch de un solo clic que Google mantiene desactivado por defecto y que `clasp` necesita para crear y modificar proyectos desde línea de comandos:

1. Abre [https://script.google.com/home/usersettings](https://script.google.com/home/usersettings).
2. Activa el switch **"Google Apps Script API"** (ponlo en ON).
3. Espera 1 o 2 minutos para que el cambio se propague.

Sin este paso, `npm run setup` falla en `clasp create` con el mensaje `User has not enabled the Apps Script API`.

**Instalación:**

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

Cuando termine, sigue [Instalar el add-on en Gmail](#instalar-el-add-on-en-gmail).

**Comandos posteriores** (una vez instalado, para día a día):

```bash
npm run push   # sube al proyecto Apps Script los cambios que hagas en local
npm run pull   # baja al repo los cambios que hagas en el editor web
```

**Dónde quedan los secrets (importante si vas a configurar deploy automático después):**

- `.clasp.json` (con el `scriptId` de tu proyecto): en la raíz del repo. Ignorado por git.
- `.clasprc.json` (token OAuth de tu cuenta Google): en tu carpeta personal de usuario, **no** en el repo:
  - Windows: `C:\Users\TuUsuario\.clasprc.json`
  - macOS y Linux: `~/.clasprc.json`

Los dos persisten entre reinicios del computador. Los vas a necesitar tal cual para [Deploy automático](#deploy-automático-desde-tu-fork-opcional-para-desarrolladores).

**Notas:**

- El setup es idempotente: se puede correr varias veces sin duplicar nada. La segunda corrida detecta que la carpeta y el logo ya están, y salta el `clasp create` si `.clasp.json` existe.
- Para arrancar completamente desde cero, borra `.clasp.json` y `src/appsscript.json` antes de correr `npm run setup`. Si además quieres que el logo se re-suba a una carpeta nueva, borra también la carpeta "Gestor de Solicitudes" desde tu Drive.
- `src/appsscript.json` **no está en git** (`.gitignore` lo excluye). Cada usuario tiene el suyo local, con su URL de logo personal.
- La configuración por usuario (`SHEET_ID`, `SHEET_TAB`, `CARPETA_RAIZ_ID`) se define desde el propio add-on la primera vez que lo abres, no desde el repositorio. Ver sección [Configuración por usuario](#configuración-por-usuario).

### Ruta B: GitHub Codespaces (sin instalar nada)

**Cuándo elegirla:** no quieres o no puedes instalar Node/git en tu computador; quieres probarlo rápido sin comprometerte a nada local; el PC donde trabajas no permite instalar software.

**Requisitos:** solo una cuenta de GitHub. Todo el resto (Node 24, npm, clasp, ESLint) viene preinstalado en el contenedor gracias a `.devcontainer/devcontainer.json`.

**Paso previo obligatorio:** habilita la **Google Apps Script API** en tu cuenta de Google (mismo paso que en la Ruta A):

1. Abre [https://script.google.com/home/usersettings](https://script.google.com/home/usersettings).
2. Activa el switch **"Google Apps Script API"** (ponlo en ON).
3. Espera 1 o 2 minutos.

**Abrir el Codespace:**

1. Entra al repo en GitHub.
2. Botón verde **Code → Codespaces → Create codespace on main**.
3. Espera 1 o 2 minutos mientras se construye el contenedor. Al terminar tienes un VS Code en el navegador con la terminal integrada.

**Login OAuth desde Codespaces (una sola vez):**

El flujo estándar de `clasp login` no funciona directo en Codespaces porque Google redirige el callback a `http://localhost:<PUERTO>/?code=...` y ese `localhost` es el del contenedor en la nube, no el de tu navegador. Por eso el navegador muestra `ERR_CONNECTION_REFUSED` al final del login. Workaround en dos terminales dentro del Codespace:

1. En la **terminal 1**, corre `npx clasp login`. El comando queda esperando el callback.
2. Copia la URL de Google que imprime, ábrela en tu navegador y autoriza con tu cuenta Google.
3. Al fallar el redirect a `localhost`, copia la URL completa de la barra del navegador (la que empieza con `http://localhost:<PUERTO>/?code=...`).
4. Abre una **terminal 2** en el mismo Codespace y corre:

   ```bash
   npm run login:finish
   ```

   Pega la URL cuando te la pida y presiona Enter. Ese script hace el `curl` local que le entrega el `code` al servidor de clasp que sigue corriendo en la terminal 1.
5. Vuelve a la terminal 1: clasp imprime "Success!" y crea `~/.clasprc.json` dentro del Codespace.

**Setup:**

```bash
npm run setup
```

Hace lo mismo que en la Ruta A (los 8 pasos descritos arriba). Cuando termine, sigue [Instalar el add-on en Gmail](#instalar-el-add-on-en-gmail).

**Comandos posteriores** (día a día, dentro del Codespace):

```bash
npm run push
npm run pull
```

**Dónde quedan los secrets (importante si vas a configurar deploy automático después):**

- `.clasp.json`: en la raíz del repo dentro del Codespace.
- `.clasprc.json`: en `~/.clasprc.json` dentro del Codespace (equivalente a `/home/codespace/.clasprc.json`).

> **Los secrets del Codespace son temporales.** Cuando el Codespace se apaga por inactividad (Codespaces suele suspenderlos a los 30 minutos y borrarlos a los 30 días) se pierde todo, incluidos los tokens. Al reabrirlo hay que volver a hacer el login OAuth en dos terminales. Si vas a activar [Deploy automático](#deploy-automático-desde-tu-fork-opcional-para-desarrolladores), copia los secrets a los GitHub Secrets **antes** de cerrar el Codespace por primera vez. Una vez configurados los secrets del repo, ya puedes seguir trabajando desde el Codespace sin problema porque el workflow tiene su propia copia.

### Instalar el add-on en Gmail

Este paso aplica igual para Ruta A y Ruta B. Al terminar el `npm run setup`, el script imprime la URL de tu proyecto Apps Script. Después:

1. Abre esa URL (o entra a [script.google.com](https://script.google.com) y buscá "Gestor de Solicitudes").
2. En la barra superior del editor: **Implementar → Implementaciones de prueba**.
3. Botón **Instalar**, después **Listo**.
4. Google va a pedirte que aceptes los cinco scopes declarados en `appsscript.json`. Antes de la pantalla de consentimiento aparece una advertencia intermedia roja que explico abajo.
5. Refresca Gmail. El add-on aparece en el panel lateral derecho.

**Advertencia "Google no ha verificado esta aplicación"**

Antes de llegar a la pantalla de consentimiento con los cinco scopes, Google muestra una **pantalla intermedia roja** que dice:

> Google no ha verificado esta aplicación
>
> La aplicación está solicitando acceso a información sensible de tu cuenta de Google. No deberías utilizar esta aplicación hasta que el desarrollador la verifique con Google.

**Es normal y esperado.** Aparece porque el add-on está en modo de implementación de prueba, no publicado en Google Workspace Marketplace, y por lo tanto **no ha pasado la verificación oficial del OAuth consent screen** que Google exige para uso público. Esa verificación implica un proceso formal (revisión de scopes, política de privacidad, video demo, dominio del desarrollador) que solo se hace cuando el add-on se publica al Marketplace.

Mientras el add-on esté en implementación de prueba, esta advertencia va a aparecer para cada usuario nuevo que lo instale. Para continuar:

1. Haz clic en el enlace **"Configuración avanzada"** abajo a la izquierda.
2. Aparece un texto pequeño tipo **"Ir a Gestor de Solicitudes (no seguro)"**. Haz clic ahí.
3. Google muestra ahora sí la pantalla real de consentimiento con los cinco scopes. Aprueba y queda instalado.

El correo que aparece en la advertencia como "desarrollador" es simplemente la cuenta dueña del proyecto Apps Script; no expone ningún dato personal adicional al usuario que instala.

**Alternativa: instalación manual sin clasp**

Si por alguna razón no puedes usar `npm run setup` (por ejemplo, política del PC que bloquea Node y no quieres usar Codespaces), puedes armar el proyecto a mano copiando y pegando el código en el editor web. Es más lento y cada actualización hay que repetirla a mano, así que solo conviene para pruebas puntuales:

1. Entra a [script.google.com](https://script.google.com) → **Proyecto nuevo** y ponle el nombre "Gestor de Solicitudes".
2. Crea un archivo de script por cada `.gs` de la carpeta `src/` (botón **+** junto a "Archivos" → **Secuencia de comandos**). El nombre va sin la extensión: `Main`, `Config`, `Cards`, etc. Copia y pega en cada uno el contenido del archivo correspondiente. `Tests.gs` e `Integracion.gs` son opcionales. El archivo `Código.gs` que trae el proyecto nuevo puedes borrarlo.
3. Muestra el manifest: **Configuración del proyecto** (engranaje) → activa **"Mostrar el archivo de manifiesto appsscript.json en el editor"**.
4. Abre `appsscript.json` en el editor y **reemplaza todo su contenido** con el de `src/appsscript.template.json`. Sin este paso el add-on no funciona: el manifest por defecto no trae los scopes OAuth, los triggers de Gmail y Sheets ni la sección `addOns`.
5. Sigue [Instalar el add-on en Gmail](#instalar-el-add-on-en-gmail) desde el paso 2 (**Implementar → Implementaciones de prueba**).

Para el logo: la plantilla trae el logo por defecto de Gmail, que funciona sin configurar nada. Si quieres uno propio, sube la imagen a Drive, compártela como "cualquiera con el enlace" y cambia el valor de `logoUrl` en `appsscript.json` por `https://lh3.googleusercontent.com/d/<ID del archivo>`. El ID es la parte del enlace de Drive entre `/d/` y `/view`.

## Distribución (compartir con testers)

Cuando ya tengas el proyecto instalado en tu cuenta (por Ruta A o Ruta B), puedes compartirlo con otras personas del equipo sin que ellas necesiten clonar el repo ni correr `npm run setup`. El add-on se distribuye como **implementación de prueba**, no como publicación oficial de Workspace Marketplace.

**Compartir el proyecto:**

1. Abrí tu proyecto en el editor de Apps Script.
2. Ícono de **Compartir** (👤➕ arriba a la derecha).
3. Agregá el correo del tester con acceso **Editor**.

Eso le da permiso para abrir el proyecto y ejecutar la implementación de prueba en su cuenta.

**Qué hace el tester:**

1. Abre el proyecto compartido en el editor de Apps Script.
2. Sigue los mismos pasos de [Instalar el add-on en Gmail](#instalar-el-add-on-en-gmail).

El add-on queda disponible en el panel lateral de Gmail y Sheets para esa cuenta. Los cambios en el código quedan visibles la próxima vez que el tester recarga Gmail o reabre el add-on, sin necesidad de reinstalar.

## Deploy automático desde tu fork (opcional, para desarrolladores)

Esta sección es para quien va a **modificar el código** y quiere que cada `git push` a `main` actualice el add-on solo en Apps Script, sin correr `npm run push` a mano. Si solo vas a usar el add-on, ignorá esta sección.

**Requisitos previos:**

- Haber terminado la [Ruta A](#ruta-a-local-node-en-tu-computador) o la [Ruta B](#ruta-b-github-codespaces-sin-instalar-nada). Ya tienes `.clasp.json` con el `scriptId` y `.clasprc.json` con el token OAuth.
- Un fork del repositorio (o el repo original, si eres el mantenedor).

### Cómo funciona el workflow

Cada push a las ramas `main` o `desarrollo` dispara `.github/workflows/deploy.yml`. Se ejecuta en un runner Ubuntu efímero de GitHub Actions y hace:

1. Clona el código del repo.
2. Instala Node.js 24 y las dependencias de `package.json` (`npm ci`), incluida clasp en la versión fija del `package.json`.
3. Corre ESLint (`npm run lint`). Si hay errores, aborta.
4. Corre en Node los tests de `src/Tests.gs` (`npm test`). Si alguno falla, aborta. La carpeta `tests/` está fuera de `src/` y no se sube a Apps Script.
5. Restaura las credenciales de clasp y el `.clasp.json` desde los GitHub Secrets.
6. Lee el logo que el proyecto ya tiene en Apps Script (`clasp pull`) y restaura el código del repo.
7. Genera `src/appsscript.json` a partir de `src/appsscript.template.json`, **conservando el logo leído del paso anterior**. Si el proyecto no tiene logo propio o falla la lectura, usa el logo de fallback.
8. Ejecuta `clasp push --force` contra el proyecto Apps Script.

Si cualquiera de los pasos falla, el workflow queda en rojo y Apps Script conserva la versión anterior. Los cambios llegan al editor web únicamente cuando el workflow termina en verde.

**Comportamiento en forks sin secrets configurados:** el workflow detecta que faltan los secrets y termina en verde sin intentar el push, mostrando un aviso en el log. Un fork recién clonado no rompe su pestaña Actions con errores rojos; el deploy automático simplemente queda desactivado hasta que agregues los secrets.

### Obtener los dos secrets

El workflow lee dos secrets del repo:

| Secret | Contenido |
|---|---|
| `CLASPRC_JSON` | Token OAuth de la cuenta Google que hace el push. Incluye el refresh token. |
| `CLASP_JSON` | Configuración de clasp con el `scriptId` del proyecto Apps Script destino. |

Los dos archivos ya los generó la Ruta A o Ruta B. Solo hay que copiar su contenido al portapapeles y pegarlo en los secrets del repo. Comandos por sistema:

**PowerShell (Windows, Ruta A):**

Verifica que existan (ambos deben responder `True`). Corre desde la carpeta del repo:

```powershell
Test-Path $env:USERPROFILE\.clasprc.json
Test-Path .clasp.json
```

Copia cada uno al portapapeles:

```powershell
Get-Content $env:USERPROFILE\.clasprc.json | Set-Clipboard
# Pegar en el secret CLASPRC_JSON con Ctrl+V, luego "Add secret"

Get-Content .clasp.json | Set-Clipboard
# Pegar en el secret CLASP_JSON con Ctrl+V, luego "Add secret"
```

**Git Bash (Windows), macOS o Linux (Ruta A):**

En Git Bash, `~` equivale a `C:\Users\TuUsuario`. Verifica desde la carpeta del repo:

```bash
ls -a ~/.clasprc.json .clasp.json
```

Copia al portapapeles:

```bash
# Git Bash (Windows)
cat ~/.clasprc.json | clip
cat .clasp.json | clip

# macOS
cat ~/.clasprc.json | pbcopy
cat .clasp.json | pbcopy

# Linux (requiere xclip instalado)
cat ~/.clasprc.json | xclip -selection clipboard
cat .clasp.json | xclip -selection clipboard
```

Primero `.clasprc.json` → pegá en `CLASPRC_JSON`. Después `.clasp.json` → pegá en `CLASP_JSON`.

**GitHub Codespaces (Ruta B):**

La terminal del Codespace no tiene acceso al portapapeles de tu PC. La forma limpia es abrir cada archivo en el editor y copiar desde ahí:

```bash
code ~/.clasprc.json
```

Se abre en una pestaña de VS Code (en el navegador del Codespace). Clic dentro del editor, **Ctrl+A** (seleccionar todo), **Ctrl+C** (copiar). Ve al secret `CLASPRC_JSON` en GitHub y **Ctrl+V** para pegar.

Repite con `.clasp.json`:

```bash
code .clasp.json
```

Ctrl+A, Ctrl+C, pegar en el secret `CLASP_JSON`. **Hacé esto antes de cerrar el Codespace**, porque cuando se apaga el `~/.clasprc.json` se pierde.

**Cómo sacar el `scriptId` por otras vías**

Si por algún motivo no tienes el `.clasp.json` a mano (por ejemplo lo borraste, o quieres apuntar el workflow a un proyecto distinto), el `scriptId` se puede sacar de dos formas:

- **Desde el editor de Apps Script:** abrí el proyecto, **Configuración del proyecto** (engranaje del menú izquierdo) → sección **ID de secuencia de comandos**. Copiá el valor.
- **Desde línea de comandos con clasp**, parado en la carpeta del proyecto donde exista `.clasp.json`:

  ```bash
  npx clasp status
  ```

  Imprime el `scriptId` junto con la lista de archivos rastreados.

Con el `scriptId` construís el contenido de `CLASP_JSON`:

```json
{"scriptId":"AQUI_EL_SCRIPT_ID","rootDir":"src"}
```

### Pegar los secrets en GitHub

1. En tu fork (o repo original), entra a **Settings → Secrets and variables → Actions → New repository secret**.
2. Creá los dos secrets con los nombres exactos `CLASPRC_JSON` y `CLASP_JSON`, pegando el contenido copiado en el paso anterior.
3. Confirma que el workflow `.github/workflows/deploy.yml` corre sobre las ramas que te interesan.
4. Hacé un `git push` a `main`. El workflow arranca solo y sube el código a Apps Script en 1 o 2 minutos.

Los secrets se guardan encriptados en GitHub y solo se descifran dentro del runner efímero al correr el workflow. `CLASPRC_JSON` es especialmente sensible porque autentica ante Google.

### Rotación y disparo manual

**Rotación de credenciales:** si el token OAuth de `CLASPRC_JSON` deja de funcionar (Google los revoca eventualmente, o si borrás el Codespace), corré `clasp login` de nuevo para regenerarlo y actualiza el valor del secret con el contenido nuevo. El secret se puede editar sin borrarlo desde la misma pantalla donde lo creaste.

**Disparo manual:** además del push automático, el workflow puede dispararse a mano desde la pestaña **Actions** del repositorio con el botón **Run workflow**. Útil para reintentar un deploy que falló por causas transitorias (timeout de red hablando con Google) sin generar un commit nuevo.

**Fallback local:** si el pipeline no está disponible (credenciales vencidas, GitHub Actions en mantenimiento, cambios que no van a versionarse todavía), puedes subir a Apps Script directo desde local con `npm run push`. Requiere haber corrido `clasp login` en la cuenta correcta y tener un `.clasp.json` válido en la raíz del proyecto.

### Lint local

Antes de commitear, correr el linter evita que el workflow falle en el paso 3:

```bash
npm run lint
```

### Pruebas

Hay tres niveles:

1. **Tests en Node** (automáticos): corren en el workflow antes de cada push a Apps Script. Para correrlos en local:

   ```bash
   npm test
   ```

   Incluyen los tests de `src/Tests.gs`, los de la búsqueda de JSON (`tests/indice-json.test.js` y `tests/json-wso2.test.js`) y los correos de ejemplo de `tests/fixtures/`. Para agregar un correo: guardar el cuerpo en `tests/fixtures/<nombre>.txt` y en `tests/fixtures/<nombre>.json` el asunto y los valores esperados (ver los existentes). Los correos van anonimizados.

2. **Integración real** (a mano, en Apps Script): `correrIntegracion()` en `src/Integracion.gs` hace un envío mixto ESB + API contra recursos de prueba, revisa filas, carpetas, copias y la columna de JSON, y al final borra lo que creó. Requiere en Propiedades del script: `TEST_SHEET_ID`, `TEST_SHEET_TAB`, `TEST_CARPETA_ID` (destino de las copias) y `TEST_ORIGEN_URL` (una carpeta pequeña con al menos un `.json`, fuera de `TEST_CARPETA_ID`). Correrla después de cada cambio en el envío o la copia.

3. **Pruebas de interfaz** (a mano, en Gmail y Sheets): los clics en las tarjetas no se pueden automatizar; se siguen con un checklist interno del mantenedor.

La versión del add-on está en `VERSION_APP` (`src/Config.gs`) y se ve en el menú principal, en Diagnóstico y al pie de Ayuda. Se sube a mano en el mismo commit del cambio (`MAYOR.MENOR.PARCHE`).
