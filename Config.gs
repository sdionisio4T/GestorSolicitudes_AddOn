/**
 * Config.gs — Configuración central del proyecto.
 */

var CONFIG = {

  // Frase que identifica una solicitud en el correo
  FRASE_IDENTIFICACION: 'El caso asignado con numero',

  // Opciones manuales
  AMBIENTES: ['Preproducción', 'Producción', 'Pruebas'],
  COMPONENTES: ['ESB', 'EI', 'API', 'APIM', 'EI-APIM', 'DSS', 'ESB-DSS'],

  // Estructura de carpetas al copiar archivos del correo a Drive.
  // Toda copia queda bajo <raíz>/SERVICIOS CAPA/. Cuando el componente
  // marcado es API o APIM, se inserta un nivel extra APIM/ para separar
  // esos casos del resto.
  CARPETA_INTERMEDIA: 'SERVICIOS CAPA',
  CARPETA_APIM: 'APIM',
  COMPONENTES_APIM: ['API', 'APIM'],

  // Remitentes/dominios permitidos para reconocer una solicitud, además de
  // la frase del cuerpo. Coincidencia parcial: puede ser un correo exacto
  // ("solicitudes@miempresa.com") o un dominio ("@miempresa.com").
  // Vacío por defecto = sin restricción de remitente (comportamiento
  // original, solo por frase).
  REMITENTES_PERMITIDOS: ['@keralty.com', '@colsanitas.com'],

  // Estados posibles (independientes del botón de envío)
  ESTADOS: ['PENDIENTE', 'APROBADO', 'NO APROBADO'],
  ESTADO_DEFECTO: 'PENDIENTE'
};

// Regex reutilizables — se centralizan acá para que cambiar la regla
// de negocio (por ejemplo, aceptar otro formato de "caso asignado")
// sea un cambio de un solo lugar.
var REGEX_EMAIL = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
var REGEX_CASO_ASIGNADO = /caso\s+asignado\s+con\s+n[uú]mero[\s ]*\*?(\d+)\*?/i;

// Límites de la copia a Drive. Si necesitás ampliarlos, cambialos acá:
//   COPIA_MAX_SIZE_MB           — peso máximo POR ARCHIVO individual.
//                                 2048 MB (2 GB) está en el techo práctico
//                                 de Apps Script makeCopy(). Arriba de eso
//                                 la copia falla igual por timeout / cuota.
//   COPIA_MAX_URLS_POR_ENVIO    — cantidad máxima de URLs distintas por
//                                 envío. Una carpeta cuenta como 1 URL
//                                 aunque tenga cientos de archivos adentro.
//                                 50 es holgado — supera los peores casos
//                                 reales y previene correos con 500 links
//                                 que agotarían la cuota diaria de Drive.
//   Las URLs excedentes NO se copian pero SÍ quedan como link en la col C
//   del Sheet, y el usuario recibe una notification clara.
var COPIA_MAX_SIZE_MB = 2048;
var COPIA_MAX_URLS_POR_ENVIO = 50;

// Topes de largo de campos de texto libre (chars). Sheets rechaza celdas
// con >50k chars — estos topes previenen el rechazo con excepción cruda
// y también acotan lo que un correo malicioso podría inyectar.
var CAMPO_MAX_LARGO = {
  servicioDesplegar:        200,
  observaciones:            1000,
  driveDocumentacionExtra:  5000
};

/**
 * Corta un string al largo máximo. Log de warning si tuvo que cortar,
 * para que quede rastro sin romper el envío.
 */
function truncarCampo(s, max, nombre) {
  s = String(s == null ? '' : s);
  if (s.length <= max) return s;
  console.warn('[Truncar] Campo "' + nombre + '" excedió ' + max + ' chars (largo real: ' + s.length + ') — se recorta');
  return s.substring(0, max);
}

/**
 * Devuelve true si la URL apunta a un recurso de Drive o Workspace.
 * Cubre 7 patrones oficiales que aparecen en correos reales.
 * Usado para validar el campo "Agregar otro enlace de Drive" — cualquier
 * otro tipo de URL se descarta con notification al usuario.
 */
function esUrlDriveOWorkspace(url) {
  if (!url) return false;
  var u = String(url).trim();
  return /^https:\/\/drive\.google\.com\/file\/d\//i.test(u) ||
         /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\//i.test(u) ||
         /^https:\/\/drive\.google\.com\/open\?id=/i.test(u) ||
         /^https:\/\/docs\.google\.com\/document\/d\//i.test(u) ||
         /^https:\/\/docs\.google\.com\/spreadsheets\/d\//i.test(u) ||
         /^https:\/\/docs\.google\.com\/presentation\/d\//i.test(u) ||
         /^https:\/\/docs\.google\.com\/forms\/d\//i.test(u);
}

// Índices de columna del Sheet (1-indexado). Fuente única de verdad —
// si se agrega o reordena una columna, se cambia solo acá.
var SHEET_COLS = {
  NUMERO_CASO:        1,
  SERVICIO:           2,
  DRIVE:              3,
  REPOSITORIO:        4,
  SONAR:              5,
  AMBIENTE:           6,
  COMPONENTE:         7,
  ESTADO:             8,
  ARTEFACTOS:         9,
  FECHA:              10,
  ESTADO_COPIA:       11,
  CORREO_SOLICITANTE: 12,
  ID_ENVIO:           13
};
var SHEET_NUM_COLS = 13;

// Nombres de los headers que el add-on escribe al crear un Sheet vacío.
// Deben coincidir 1 a 1 con SHEET_COLS (mismo orden). NO se usan para
// validar Sheets existentes con formatos distintos — solo se escriben
// una vez desde el botón "Crear headers automáticamente" cuando el Sheet
// está totalmente vacío.
var SHEET_HEADERS = [
  'Número de caso', 'Servicio', 'Drive documentación', 'Repositorio',
  'SonarQube', 'Ambiente', 'Componente', 'Estado',
  'Artefactos', 'Fecha', 'Estado copia', 'Correo solicitante', 'ID envío'
];

/**
 * Guarda el ID del Sheet elegido por este usuario.
 */
function guardarSheetId(sheetId) {
  PropertiesService.getUserProperties().setProperty('SHEET_ID', sheetId);
}

/**
 * Obtiene el ID del Sheet de este usuario.
 * Retorna null si no ha configurado uno.
 */
function obtenerSheetId() {
  return PropertiesService.getUserProperties().getProperty('SHEET_ID');
}

/**
 * Borra toda la configuración del usuario (Sheet, pestaña y carpeta raíz)
 * para reconfigurar desde cero.
 */
function borrarSheetId() {
  var props = PropertiesService.getUserProperties();
  props.deleteProperty('SHEET_ID');
  props.deleteProperty('SHEET_TAB');
  props.deleteProperty('CARPETA_RAIZ_ID');
}

function guardarSheetTab(tabName) {
  PropertiesService.getUserProperties().setProperty('SHEET_TAB', tabName);
}

function obtenerSheetTab() {
  return PropertiesService.getUserProperties().getProperty('SHEET_TAB');
}

/**
 * Carpeta raíz de Drive donde se copian los archivos de documentación. La
 * elige el usuario en el paso 3 de la config. Los envíos crean subcarpetas
 * dentro de acá con la estructura Servicio/Caso_fecha[_N].
 */
function guardarCarpetaRaizId(folderId) {
  PropertiesService.getUserProperties().setProperty('CARPETA_RAIZ_ID', folderId);
}

function obtenerCarpetaRaizId() {
  return PropertiesService.getUserProperties().getProperty('CARPETA_RAIZ_ID');
}

/**
 * Diagnóstico único de la configuración. Devuelve { paso, mensaje }:
 *   - paso: 'ok' | 'sin_sheet' | 'sheet_inaccesible' | 'sin_tab' |
 *           'tab_no_existe' | 'sin_carpeta' | 'carpeta_inaccesible'
 *   - mensaje: string explicativo (vacío si paso === 'ok')
 *
 * motivoConfigInvalida y buildCardConfigApropiada consumen esta salida —
 * uno decide si dejar pasar al usuario, el otro decide a qué paso del
 * wizard mandarlo. La lógica de validación queda en un solo lugar.
 */
function estadoConfig() {
  var sheetId = obtenerSheetId();
  if (!sheetId) {
    return { paso: 'sin_sheet', mensaje: 'No hay Sheet configurado. Pega la URL para comenzar.' };
  }

  var tabName = obtenerSheetTab();

  var pestana = null;
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    if (tabName) {
      pestana = ss.getSheetByName(tabName);
      if (!pestana) {
        return { paso: 'tab_no_existe', mensaje: 'La pestaña "' + tabName + '" ya no existe en el Sheet configurado. Vuelve a configurar.' };
      }
    }
  } catch (error) {
    console.error('[Config] Sheet no accesible: ' + error.message);
    return { paso: 'sheet_inaccesible', mensaje: 'El Sheet configurado ya no está disponible (fue eliminado o perdiste acceso). Configura uno nuevo.' };
  }

  if (!tabName) {
    return { paso: 'sin_tab', mensaje: 'No has seleccionado una pestaña. Elige una para comenzar.' };
  }

  // Chequeo mínimo de "Sheet vacío": si la pestaña tiene 0 filas o A1 está
  // vacía, ofrecemos escribir los headers automáticamente. NO validamos
  // que los headers existentes coincidan — Sheets con formatos distintos
  // (los propios del usuario) siguen pasando como OK.
  try {
    if (pestana && sheetPestanaVacia_(pestana)) {
      return { paso: 'sheet_vacio', mensaje: 'La pestaña está vacía. Podemos crear las cabeceras automáticamente.' };
    }
  } catch (errVacio) {
    // No crítico: si no se puede leer A1, seguimos como si tuviera datos.
    console.log('[Config] No se pudo chequear si la pestaña está vacía: ' + errVacio.message);
  }

  var carpetaRaizId = obtenerCarpetaRaizId();
  if (!carpetaRaizId) {
    return { paso: 'sin_carpeta', mensaje: 'No has seleccionado la carpeta raíz de Drive donde se copian los archivos. Elige una para comenzar.' };
  }

  try {
    // Solo confirmamos que la carpeta existe y es accesible en lectura.
    // No usamos getAccess(Session.getActiveUser()) porque en add-ons de
    // Gmail Session.getActiveUser().getEmail() suele venir vacío por
    // privacidad, y getAccess('') retorna NONE aunque la carpeta sea
    // propia. Si al momento de copiar no tenemos permiso de escritura,
    // la copia falla con un error claro que el clasificador etiqueta
    // como 'permiso'.
    DriveApp.getFolderById(carpetaRaizId);
  } catch (error) {
    console.error('[Config] Carpeta raíz no accesible: ' + error.message);
    return { paso: 'carpeta_inaccesible', mensaje: 'La carpeta raíz de Drive ya no está disponible (fue eliminada o perdiste acceso). Configura una nueva.' };
  }

  return { paso: 'ok', mensaje: '' };
}

/**
 * Wrapper legado: null si la config está OK, o un mensaje listo para
 * mostrar al usuario. Preserva la firma anterior — todos los callsites
 * existentes siguen funcionando sin cambios.
 */
function motivoConfigInvalida() {
  var estado = estadoConfig();
  // sheet_vacio NO bloquea el envío — es una sugerencia del wizard, no un
  // error. El add-on sabe funcionar contra una pestaña vacía (escribe en
  // la fila 1). Solo bloqueamos cuando falta algo esencial (Sheet, tab,
  // carpeta).
  if (estado.paso === 'ok' || estado.paso === 'sheet_vacio') return null;
  return estado.mensaje;
}

/**
 * Devuelve true si la pestaña no tiene datos escritos todavía. Se usa
 * para detectar el caso "Sheet vacío recién creado" y ofrecer el botón
 * de crear cabeceras automáticamente. Considera vacía si:
 *   - getLastRow() === 0 (Google no vio nada escrito), o
 *   - la fila 1 completa está en blanco.
 */
function sheetPestanaVacia_(pestana) {
  if (pestana.getLastRow() === 0) return true;
  var fila1 = pestana.getRange(1, 1, 1, SHEET_NUM_COLS).getValues()[0];
  for (var i = 0; i < fila1.length; i++) {
    if (String(fila1[i] || '').trim() !== '') return false;
  }
  return true;
}

/**
 * Escribe los 13 headers en la fila 1 de la pestaña, los pone en bold
 * y congela la fila. Solo debe llamarse cuando sheetPestanaVacia_ es
 * true — nunca sobrescribe headers existentes.
 */
function crearHeadersEnSheetVacio_(pestana) {
  var rango = pestana.getRange(1, 1, 1, SHEET_NUM_COLS);
  rango.setValues([SHEET_HEADERS]);
  rango.setFontWeight('bold');
  try {
    pestana.setFrozenRows(1);
  } catch (errFreeze) {
    console.log('[Config] No se pudo congelar la fila 1: ' + errFreeze.message);
  }
  console.log('[Config] Headers creados en "' + pestana.getName() + '"');
}
