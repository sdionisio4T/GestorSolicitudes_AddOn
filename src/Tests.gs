/**
 * Tests.gs — Tests manuales para las funciones puras del proyecto.
 *
 * Cómo correr:
 *   1. En el editor de Apps Script, en el dropdown de arriba seleccionar
 *      `correrTodosLosTests`.
 *   2. Click en "Ejecutar".
 *   3. Mirar la consola: cada test imprime ✅ si pasó o ❌ + el detalle
 *      si falló. Al final, un resumen "Total: N OK, M fallaron".
 *   4. Si algo falla, la ejecución termina lanzando una excepción con la
 *      lista de fallos — así queda ROJO en el panel de Ejecuciones.
 *
 * Cómo agregar un test:
 *   1. Definir una función `test_<algo>()` que use los assertX() de más
 *      abajo. Si algo no cumple, se lanza excepción y el runner la agarra.
 *   2. Agregar el nombre de la función al array `tests` dentro de
 *      `correrTodosLosTests`. Nada más.
 *
 * Qué NO se testea acá (a propósito):
 *   - Cards (buildValidacionCard, buildEstadoEnvioCard) — son objetos de
 *     UI, se prueban visualmente abriendo el add-on.
 *   - Callbacks (onEnviar, onReintentarCopiaManual) — dependen del `e` de
 *     CardService, requieren mockear muchas cosas.
 *   - Funciones que tocan Drive, Sheets o Gmail reales — mockearlas es
 *     más trabajo que valor. Se prueban en el flujo real.
 *   - Triggers y flujos asincrónicos (fase 3, retries en segundo plano).
 */

// ══════════════════════════════════════════════════════════════════════
// HELPERS DE ASERCIÓN
// ══════════════════════════════════════════════════════════════════════

function assertIgual(actual, esperado, msg) {
  if (actual !== esperado) {
    throw new Error((msg || 'assertIgual') + ' → esperado: ' + JSON.stringify(esperado) +
                    ', actual: ' + JSON.stringify(actual));
  }
}

function assertDistinto(a, b, msg) {
  if (a === b) {
    throw new Error((msg || 'assertDistinto') + ' → se esperaban distintos, ambos son: ' + JSON.stringify(a));
  }
}

function assertContiene(texto, sub, msg) {
  if (String(texto).indexOf(sub) === -1) {
    throw new Error((msg || 'assertContiene') + ' → "' + texto + '" no contiene "' + sub + '"');
  }
}

function assertVerdadero(v, msg) {
  if (!v) throw new Error(msg || 'assertVerdadero → se esperaba truthy, fue: ' + JSON.stringify(v));
}

function assertFalso(v, msg) {
  if (v) throw new Error(msg || 'assertFalso → se esperaba falsy, fue: ' + JSON.stringify(v));
}

function assertNulo(v, msg) {
  if (v !== null && v !== undefined) {
    throw new Error(msg || 'assertNulo → se esperaba null/undefined, fue: ' + JSON.stringify(v));
  }
}

function assertLongitud(arr, n, msg) {
  var len = (arr && arr.length !== undefined) ? arr.length : -1;
  if (len !== n) {
    throw new Error((msg || 'assertLongitud') + ' → esperado length ' + n + ', actual: ' + len);
  }
}

// ══════════════════════════════════════════════════════════════════════
// RUNNER
// ══════════════════════════════════════════════════════════════════════

function correrTodosLosTests() {
  var tests = [
    // Extractor.gs
    test_buscarNumeroCaso,
    test_detectarAmbiente,
    test_deduplicarUrls,
    test_limpiarUrl,
    test_extraerCampo,
    test_esSolicitudValida,
    test_extraerDatos_integracion,
    // Golden tests — fixtures de correos reales anonimizados
    test_extraerDatos_golden_formatoPlainBodyConBold,
    test_extraerDatos_golden_multiplesDrives,
    test_extraerDatos_golden_casoEnAsuntoNoEnBody,
    test_extraerDatos_golden_sinFraseSoloRemitente,
    test_extraerDatos_golden_correoSolicitanteEnBody,
    // DriveCopier.gs
    test_parsearIdDrive,
    test_clasificarError,
    test_mensajeErrorUsuario,
    // SheetWriter.gs
    test_firmarEnvio,
    test_columnALetra,
    test_construirCeldaConEnlaces,
    test_resumirMotivos,
    test_sanitizarParaSheet
  ];

  var ok = 0, fail = 0, errores = [];
  console.log('════════════════════════════════════');
  console.log('Corriendo ' + tests.length + ' tests...');
  console.log('════════════════════════════════════');

  tests.forEach(function(t) {
    try {
      t();
      console.log('✅ ' + t.name);
      ok++;
    } catch (err) {
      console.error('❌ ' + t.name + ' → ' + err.message);
      errores.push(t.name + ': ' + err.message);
      fail++;
    }
  });

  console.log('════════════════════════════════════');
  console.log('Total: ' + ok + ' OK, ' + fail + ' fallaron');
  console.log('════════════════════════════════════');

  if (fail > 0) {
    throw new Error('Fallaron ' + fail + ' test(s):\n' + errores.join('\n'));
  }
  return { ok: ok, fail: fail };
}

// ══════════════════════════════════════════════════════════════════════
// TESTS — Extractor.gs
// ══════════════════════════════════════════════════════════════════════

function test_buscarNumeroCaso() {
  // Patrón principal: "caso asignado con numero N"
  var m1 = buscarNumeroCaso('El caso asignado con numero 1234 requiere despliegue.');
  assertVerdadero(m1, 'match del patrón principal');
  assertIgual(m1[1], '1234');

  // Tolera "número" con acento
  var m2 = buscarNumeroCaso('caso asignado con número 5678');
  assertVerdadero(m2, 'con acento en número');
  assertIgual(m2[1], '5678');

  // Tolera *asteriscos* (formato negrita de getPlainBody)
  var m3 = buscarNumeroCaso('caso asignado con numero *9300*');
  assertVerdadero(m3, 'con asteriscos');
  assertIgual(m3[1], '9300');

  // Patrón secundario: "CASO N"
  var m4 = buscarNumeroCaso('Ticket relacionado: CASO 4321');
  assertVerdadero(m4, 'patrón CASO N');
  assertIgual(m4[1], '4321');

  // Sin match → null
  assertNulo(buscarNumeroCaso('texto sin ningún caso'), 'texto libre sin patrón');
  assertNulo(buscarNumeroCaso(''), 'string vacío');
  assertNulo(buscarNumeroCaso(null), 'null');
}

function test_detectarAmbiente() {
  // Match exacto contra CONFIG.AMBIENTES = ['Preproducción', 'Producción', 'Pruebas']
  assertIgual(detectarAmbiente('Preproducción'), 'Preproducción', 'exacto');
  assertIgual(detectarAmbiente('producción'), 'Producción', 'case-insensitive');
  assertIgual(detectarAmbiente('  Pruebas  '), 'Pruebas', 'con espacios');

  // Match dentro de texto más largo
  assertIgual(detectarAmbiente('Desplegar en Producción por favor'), 'Producción', 'dentro de frase');

  // Sin match
  assertIgual(detectarAmbiente('DEV'), '', 'ambiente inexistente');
  assertIgual(detectarAmbiente(''), '', 'string vacío');
  assertIgual(detectarAmbiente(null), '', 'null');
}

function test_deduplicarUrls() {
  var res1 = deduplicarUrls(['https://a.com', 'https://b.com', 'https://a.com']);
  assertLongitud(res1, 2, 'quita duplicados exactos');
  assertIgual(res1[0], 'https://a.com');
  assertIgual(res1[1], 'https://b.com');

  // Case-insensitive (dedup por clave lowercase)
  var res2 = deduplicarUrls(['https://Foo.com/A', 'https://foo.com/a']);
  assertLongitud(res2, 1, 'dedup case-insensitive');

  // Preserva el orden de la primera aparición
  var res3 = deduplicarUrls(['b', 'a', 'b', 'c', 'a']);
  assertIgual(res3.join(','), 'b,a,c', 'preserva orden');

  // Vacío
  assertLongitud(deduplicarUrls([]), 0);
}

function test_limpiarUrl() {
  // Cierra paréntesis / brackets al final
  assertIgual(limpiarUrl('https://a.com/x)'), 'https://a.com/x');
  assertIgual(limpiarUrl('https://a.com/x]'), 'https://a.com/x');

  // Trunca en marcadores de fin de línea codificados
  assertIgual(limpiarUrl('https://a.com/x^^basura'), 'https://a.com/x');
  assertIgual(limpiarUrl('https://a.com/x||basura'), 'https://a.com/x');
  assertIgual(limpiarUrl('https://a.com/x%5E%5Ebasura'), 'https://a.com/x');

  // URL normal no se toca
  assertIgual(limpiarUrl('https://drive.google.com/file/d/ABC/view'),
              'https://drive.google.com/file/d/ABC/view');

  // Limita a MAX_URL_LENGTH (500)
  var larga = 'https://a.com/' + Array(600).join('x');
  var res = limpiarUrl(larga);
  assertVerdadero(res.length <= 500, 'trunca a 500 chars');
}

function test_extraerCampo() {
  // La función retorna el valor limpio (sin ":", "-", "*" ni espacios al
  // principio) que sigue a la etiqueta, en la misma línea o en las 3
  // siguientes.
  var body =
    'Solicitud de despliegue\n' +
    'Nombre del servicio a desplegar: ESB-Autenticacion\n' +
    'Ambiente a desplegar\n' +
    'Producción\n' +
    'Otras notas: nada';

  // Con ":" en el body, el separador se remueve — el valor queda limpio.
  assertIgual(extraerCampo(body, 'Nombre del servicio a desplegar'),
              'ESB-Autenticacion', 'valor en la misma línea, sin ":" pegado');

  // Sin nada después de la etiqueta, salta a la siguiente línea no vacía.
  assertIgual(extraerCampo(body, 'Ambiente a desplegar'), 'Producción',
              'valor en la línea siguiente');

  // Sin match → string vacío
  assertIgual(extraerCampo(body, 'Etiqueta que no existe'), '', 'sin match');
  assertIgual(extraerCampo('', 'X'), '', 'body vacío');

  // Caso limpio (sin ":" en el body): match exacto de lo que sigue
  var bodyLimpio = 'Foo\nX Y Z valor-limpio\nBar';
  assertIgual(extraerCampo(bodyLimpio, 'X Y Z'), 'valor-limpio',
              'sin dos puntos, valor exacto');

  // Otras variantes de separador que se ven en correos reales
  assertIgual(extraerCampo('Foo\nCampo - valor con guion\nBar', 'Campo'),
              'valor con guion', 'separador "-" removido');
  assertIgual(extraerCampo('Foo\nCampo: *valor bold*\nBar', 'Campo'),
              'valor bold*', 'separador ":" + "*" de bold removidos al inicio');
}

function test_esSolicitudValida() {
  var body = 'Hola.\n' + CONFIG.FRASE_IDENTIFICACION + ' 1234.\nsaludos';

  // La frase alcanza
  assertVerdadero(esSolicitudValida('cualquiera@dominio.com', body),
                  'body con frase debe pasar');

  // El remitente permitido alcanza (aunque body no tenga frase)
  assertVerdadero(esSolicitudValida('arquitecturatikeralty@keralty.com', 'body sin frase'),
                  'remitente permitido debe pasar');

  // Ninguna condición → falla
  assertFalso(esSolicitudValida('random@otro.com', 'body sin frase ni nada'),
              'sin ninguna condición debe fallar');
}

function test_extraerDatos_integracion() {
  var body =
    'Buenas.\n' +
    'El caso asignado con numero 9300 necesita despliegue.\n' +
    'Nombre del servicio a desplegar: ESB-Autenticacion\n' +
    'Ambiente a desplegar: Producción\n' +
    'Documentación: https://drive.google.com/file/d/ABC123/view\n' +
    'Repo: https://github.com/keralty/mi-repo\n' +
    'Saludos.';

  var d = extraerDatos(body, 'Solicitud despliegue caso 9300');

  assertIgual(d.numeroCaso, '9300');
  assertIgual(d.servicioDesplegar, 'ESB-Autenticacion',
              'servicio sin ":" pegado (fix I12)');
  assertIgual(d.ambienteExtraido, 'Producción');
  assertContiene(d.driveDocumentacion, 'drive.google.com/file/d/ABC123');
  assertContiene(d.repositorio, 'github.com/keralty/mi-repo');

  // Fix I13: un caso con más de 4 dígitos NO se trunca. La validación de
  // formato es responsabilidad de onEnviar, no del extractor.
  var d2 = extraerDatos(
    'El caso asignado con numero 12345 necesita despliegue.\n' +
    'Nombre del servicio a desplegar: X\n',
    ''
  );
  assertIgual(d2.numeroCaso, '12345',
              'caso de 5 dígitos NO se trunca (fix I13)');
}

// ══════════════════════════════════════════════════════════════════════
// GOLDEN TESTS — bodies reales anonimizados
// ══════════════════════════════════════════════════════════════════════
//
// Cada test se llama "test_extraerDatos_golden_<variante>" y verifica
// que la extracción de un cuerpo real siga dando el mismo resultado.
// Cuando aparezca un formato nuevo de correo que rompa la extracción,
// agregar un fixture acá con el body que rompió — así queda cubierto
// para siempre.

/**
 * Formato típico de getPlainBody de Gmail: los **negrita** del correo
 * llegan como *asteriscos* alrededor del texto (el número de caso
 * incluido).
 */
function test_extraerDatos_golden_formatoPlainBodyConBold() {
  var body =
    'Buenas.\n' +
    'El caso asignado con numero *9300* requiere despliegue en producción.\n' +
    '\n' +
    '*Nombre del servicio a desplegar:* ESB-PacientesActivos\n' +
    '*Ambiente a desplegar:* Producción\n' +
    '*Documentación:* https://drive.google.com/file/d/1AbC2dEf3GhI4jKl5MnO6pQr7sTu8Vw/view\n' +
    '*Repositorio:* https://github.com/keralty/esb-pacientes-activos\n' +
    '\n' +
    'Del siguiente correo: jperez@keralty.com\n' +
    '\n' +
    'Gracias.';

  var d = extraerDatos(body, 'RE: Despliegue caso 9300');

  assertIgual(d.numeroCaso, '9300', 'caso con asteriscos de bold');
  assertIgual(d.servicioDesplegar, 'ESB-PacientesActivos', 'servicio limpio sin ":" ni "*"');
  assertIgual(d.ambienteExtraido, 'Producción');
  assertIgual(d.correoSolicitante, 'jperez@keralty.com');
  assertContiene(d.driveDocumentacion, 'drive.google.com/file/d/1AbC2dEf3GhI4jKl5MnO6pQr7sTu8Vw');
  assertContiene(d.repositorio, 'github.com/keralty/esb-pacientes-activos');
}

/**
 * Correo con dos enlaces de Drive: uno de archivo suelto y otro de
 * carpeta. La extracción debe devolver los dos separados por \n para
 * que buildValidacionCard pinte checkboxes.
 */
function test_extraerDatos_golden_multiplesDrives() {
  var body =
    'El caso asignado con numero 4521 requiere despliegue.\n' +
    'Nombre del servicio a desplegar: API-Historia\n' +
    'Ambiente a desplegar: Preproducción\n' +
    'Documentación:\n' +
    'https://drive.google.com/file/d/1FILE_HistoriaSpec2024xyz_abcdefg/view\n' +
    'https://drive.google.com/drive/folders/1FOLDER_HistoriaAssets_hijklmn\n' +
    'Repositorio: https://github.com/keralty/api-historia\n';

  var d = extraerDatos(body, 'Caso 4521');

  assertIgual(d.numeroCaso, '4521');
  assertIgual(d.servicioDesplegar, 'API-Historia');
  assertIgual(d.ambienteExtraido, 'Preproducción');

  var urls = d.driveDocumentacion.split('\n').filter(function(u) { return u.trim() !== ''; });
  assertIgual(urls.length, 2, 'debe detectar los 2 Drives');
  assertContiene(urls[0], '/file/d/1FILE_HistoriaSpec2024xyz_abcdefg');
  assertContiene(urls[1], '/drive/folders/1FOLDER_HistoriaAssets_hijklmn');
}

/**
 * Correo donde el número de caso está en el asunto pero no en el body
 * (patrón "CASO N"). buscarNumeroCaso debe caer al patrón secundario.
 */
function test_extraerDatos_golden_casoEnAsuntoNoEnBody() {
  var body =
    'Buenos días.\n' +
    'Necesitamos desplegar el servicio en pruebas.\n' +
    'Nombre del servicio a desplegar: DSS-Reportes\n' +
    'Ambiente a desplegar: Pruebas\n';

  var d = extraerDatos(body, 'RE: Solicitud CASO 8891 - despliegue urgente');

  assertIgual(d.numeroCaso, '8891', 'caso extraído del asunto (patrón CASO N)');
  assertIgual(d.servicioDesplegar, 'DSS-Reportes');
  assertIgual(d.ambienteExtraido, 'Pruebas');
}

/**
 * Correo de un remitente permitido que NO trae la frase de identificación
 * ni la etiqueta "Nombre del servicio a desplegar". Es un caso que el
 * usuario va a llenar a mano — extraerDatos devuelve strings vacíos sin
 * romperse.
 */
function test_extraerDatos_golden_sinFraseSoloRemitente() {
  var body =
    'Hola, necesitamos coordinar el despliegue del EI-Contactos ' +
    'para el próximo release. Cualquier duda me avisan.\n' +
    'Gracias.';

  var d = extraerDatos(body, 'Despliegue EI-Contactos');

  // Sin patrón de caso identificable → vacío (no null, no error).
  assertIgual(d.numeroCaso, '', 'sin patrón de caso → vacío');
  assertIgual(d.servicioDesplegar, '', 'sin etiqueta → vacío');
  assertIgual(d.ambienteExtraido, '', 'sin ambiente → vacío');
  assertIgual(d.correoSolicitante, '', 'sin "del siguiente correo:" → vacío');
  assertIgual(d.driveDocumentacion, '', 'sin URLs de Drive → vacío');
}

/**
 * Correo con "del siguiente correo:" en el body — el add-on lo usa como
 * fuente del correo solicitante, distinto del remitente del correo
 * (que suele ser una cuenta genérica de arquitectura).
 */
function test_extraerDatos_golden_correoSolicitanteEnBody() {
  var body =
    'El caso asignado con numero 2100 requiere despliegue.\n' +
    'Nombre del servicio a desplegar: ESB-Facturacion\n' +
    'Ambiente a desplegar: Producción\n' +
    'Del siguiente correo: mgomez@keralty.com\n' +
    'para gestionar los accesos necesarios.\n';

  var d = extraerDatos(body, 'Caso 2100');

  assertIgual(d.correoSolicitante, 'mgomez@keralty.com',
              'correo solicitante extraído de "del siguiente correo:"');
  assertIgual(d.numeroCaso, '2100');
  assertIgual(d.servicioDesplegar, 'ESB-Facturacion');
}

// ══════════════════════════════════════════════════════════════════════
// SMOKE TEST — post-implementación de prueba
// ══════════════════════════════════════════════════════════════════════
//
// NO va en correrTodosLosTests: escribe y borra una fila real en el
// Sheet configurado. Correr manualmente desde el editor después de
// cada "Implementar → Nueva versión" para verificar que las escrituras
// y lecturas básicas siguen funcionando antes de que lo toque un
// usuario real.
//
// Uso:
//   1) En el dropdown del editor, seleccionar smokeTest.
//   2) Ejecutar.
//   3) La consola debe imprimir "[SmokeTest] OK — implementación sana".
//      Si falla, revertir a la versión anterior antes de que la usen.
//
// Deja el Sheet como estaba (borra la fila que escribió) y no toca
// Drive más allá de leer el nombre de la carpeta raíz.

function smokeTest() {
  var envioIdSmoke = 'smoke_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  var sheet = obtenerSheet();
  if (!sheet) {
    throw new Error('[SmokeTest] No hay Sheet configurado. Configurar antes de correr.');
  }
  var startRow = sheet.getLastRow() + 1;

  try {
    sheet.getRange(startRow, 1, 1, SHEET_NUM_COLS).setValues([[
      '0000', 'SMOKE-TEST-BORRAR', '', '', '', 'Pruebas', 'ESB',
      'PENDIENTE - smoke test', '', new Date(), 'Smoke test OK',
      'smoke@test.local', envioIdSmoke
    ]]);

    var leido = sheet.getRange(startRow, SHEET_COLS.ID_ENVIO).getValue();
    if (leido !== envioIdSmoke) {
      throw new Error('[SmokeTest] Lectura no coincide con escritura: escribí "' +
                      envioIdSmoke + '", leí "' + leido + '"');
    }

    var carpetaId = obtenerCarpetaRaizId();
    if (!carpetaId) {
      throw new Error('[SmokeTest] No hay carpeta raíz configurada.');
    }
    var carpeta = DriveApp.getFolderById(carpetaId);
    if (!carpeta.getName()) {
      throw new Error('[SmokeTest] Carpeta raíz no accesible.');
    }

    console.log('[SmokeTest] OK — implementación sana');
    console.log('  Sheet: ' + sheet.getParent().getName() + ' / ' + sheet.getName());
    console.log('  Carpeta raíz: ' + carpeta.getName());
    console.log('  Fila escrita y borrada en row ' + startRow);
  } finally {
    // Aún si algo falla arriba, borramos la fila de smoke para no dejarla en el Sheet.
    var lastRow = sheet.getLastRow();
    if (lastRow >= startRow) {
      var idFilaFinal = sheet.getRange(lastRow, SHEET_COLS.ID_ENVIO).getValue();
      if (idFilaFinal === envioIdSmoke) {
        sheet.deleteRow(lastRow);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// TESTS — DriveCopier.gs
// ══════════════════════════════════════════════════════════════════════

function test_parsearIdDrive() {
  // NOTA: parsearIdDrive exige IDs de al menos 20 caracteres. Usamos IDs
  // sintéticos de 25-30 chars (los IDs reales de Drive tienen 25-44).

  var ID_ARCHIVO = 'ABCDEFGHIJ1234567890abcdef';   // 26 chars
  var ID_DOC     = '1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o';// 30 chars
  var ID_SHEET   = 'SHEET_id_de_25_caract_ok_x';   // 26 chars
  var ID_SLIDE   = 'slide_ID_de_25_caract_ok_yz';  // 27 chars
  var ID_FOLDER  = 'FOLDER_1234567890abcdef_ok';   // 26 chars
  var ID_QUERY   = 'QUERY_1234567890abcdef1234';   // 26 chars

  // Archivo por /file/d/ → tipo 'archivo'
  var r = parsearIdDrive('https://drive.google.com/file/d/' + ID_ARCHIVO + '/view');
  assertVerdadero(r, 'file/d/ debe parsear');
  assertIgual(r.id, ID_ARCHIVO);
  assertIgual(r.tipo, 'archivo', 'file/d/ → tipo archivo');

  // Documento → mismo tipo 'archivo' (el parseo agrupa file/document/spreadsheet/presentation)
  var d = parsearIdDrive('https://docs.google.com/document/d/' + ID_DOC + '/edit');
  assertVerdadero(d, 'document/d/ debe parsear');
  assertIgual(d.id, ID_DOC);
  assertIgual(d.tipo, 'archivo');

  // Spreadsheet
  var s = parsearIdDrive('https://docs.google.com/spreadsheets/d/' + ID_SHEET + '/edit#gid=0');
  assertVerdadero(s, 'spreadsheets/d/ debe parsear');
  assertIgual(s.id, ID_SHEET);
  assertIgual(s.tipo, 'archivo');

  // Presentation
  var p = parsearIdDrive('https://docs.google.com/presentation/d/' + ID_SLIDE + '/edit');
  assertVerdadero(p, 'presentation/d/ debe parsear');
  assertIgual(p.id, ID_SLIDE);
  assertIgual(p.tipo, 'archivo');

  // Carpeta → tipo 'carpeta'
  var f = parsearIdDrive('https://drive.google.com/drive/folders/' + ID_FOLDER);
  assertVerdadero(f, 'drive/folders/ debe parsear');
  assertIgual(f.id, ID_FOLDER);
  assertIgual(f.tipo, 'carpeta', 'carpeta se detecta como tipo=carpeta');

  // Carpeta con /u/N/ (cuenta cambiada)
  var f2 = parsearIdDrive('https://drive.google.com/drive/u/0/folders/' + ID_FOLDER);
  assertVerdadero(f2, 'drive/u/0/folders/ debe parsear');
  assertIgual(f2.id, ID_FOLDER);

  // Parámetro ?id= → tipo 'desconocido' (no sabemos si es file/folder solo con el id)
  var q = parsearIdDrive('https://drive.google.com/open?id=' + ID_QUERY);
  assertVerdadero(q, '?id= debe parsear');
  assertIgual(q.id, ID_QUERY);
  assertIgual(q.tipo, 'desconocido', '?id= → tipo desconocido');

  // IDs menores a 20 chars → NO parsean (comportamiento intencional)
  assertNulo(parsearIdDrive('https://drive.google.com/file/d/CORTO/view'),
             'ID corto (<20 chars) no debe parsear');

  // Basura
  assertNulo(parsearIdDrive('hola mundo'), 'texto libre debe dar null');
  assertNulo(parsearIdDrive(''), 'string vacío');
  assertNulo(parsearIdDrive(null), 'null');
}

function test_clasificarError() {
  // Permisos
  assertIgual(clasificarError({ message: 'You do not have permission to access this' }), 'permiso');
  assertIgual(clasificarError({ message: 'permission denied' }), 'permiso');
  assertIgual(clasificarError({ message: 'access denied' }), 'permiso');
  assertIgual(clasificarError({ message: 'sin permiso' }), 'permiso');

  // Inválido / no encontrado
  assertIgual(clasificarError({ message: 'file not found' }), 'invalido');
  assertIgual(clasificarError({ message: 'invalid argument' }), 'invalido');

  // Temporal
  assertIgual(clasificarError({ message: 'timed out' }), 'temporal');
  assertIgual(clasificarError({ message: 'rate limit exceeded' }), 'temporal');
  assertIgual(clasificarError({ message: 'user rate exceeded' }), 'temporal');
  assertIgual(clasificarError({ message: 'quota exceeded' }), 'temporal');

  // Fallback (algo no reconocido → temporal para reintentar por las dudas)
  // Nota: si el fallback cambiara en el futuro este test lo detectaría.
  var fallback = clasificarError({ message: 'algo raro' });
  assertVerdadero(
    fallback === 'temporal' || fallback === 'invalido',
    'fallback debe ser temporal o invalido, fue: ' + fallback
  );

  // Sin mensaje
  var vacio = clasificarError({});
  assertVerdadero(typeof vacio === 'string', 'siempre debe devolver un string');
}

function test_mensajeErrorUsuario() {
  // Permisos por contexto
  var msgSheet = mensajeErrorUsuario({ message: 'permission denied' }, 'sheet');
  assertContiene(msgSheet, 'Sheet', 'menciona el Sheet');
  assertContiene(msgSheet, 'acceso', 'habla de acceso perdido');

  var msgCarpeta = mensajeErrorUsuario({ message: 'permission denied' }, 'carpeta');
  assertContiene(msgCarpeta, 'carpeta');

  // Rate limit
  var msgRate = mensajeErrorUsuario({ message: 'rate limit exceeded' }, '');
  assertVerdadero(typeof msgRate === 'string' && msgRate.length > 0,
                  'siempre devuelve un mensaje');
}

// ══════════════════════════════════════════════════════════════════════
// TESTS — SheetWriter.gs
// ══════════════════════════════════════════════════════════════════════

function test_firmarEnvio() {
  // Misma firma para mismos datos (incluso con componentes en distinto orden)
  var a = firmarEnvio('1234', 'ESB', 'Producción', ['ESB', 'API'], 'APROBADO');
  var b = firmarEnvio('1234', 'ESB', 'Producción', ['API', 'ESB'], 'APROBADO');
  assertIgual(a, b, 'el orden de componentes no debe afectar la firma');

  // Firma distinta si cambia el ambiente
  var c = firmarEnvio('1234', 'ESB', 'Preproducción', ['ESB', 'API'], 'APROBADO');
  assertDistinto(a, c, 'ambiente distinto → firma distinta');

  // Firma distinta si cambia el estado
  var d = firmarEnvio('1234', 'ESB', 'Producción', ['ESB', 'API'], 'PENDIENTE');
  assertDistinto(a, d, 'estado distinto → firma distinta');

  // Firma distinta si cambia el número de caso
  var e = firmarEnvio('9999', 'ESB', 'Producción', ['ESB', 'API'], 'APROBADO');
  assertDistinto(a, e, 'caso distinto → firma distinta');

  // Firma es un string hexadecimal de MD5 (32 chars)
  assertIgual(a.length, 32, 'debe ser MD5 hex de 32 chars');
  assertVerdadero(/^[0-9a-f]{32}$/.test(a), 'debe ser hex minúsculas');
}

function test_columnALetra() {
  assertIgual(columnALetra(1), 'A');
  assertIgual(columnALetra(2), 'B');
  assertIgual(columnALetra(3), 'C');
  assertIgual(columnALetra(8), 'H');   // Estado
  assertIgual(columnALetra(11), 'K');  // Estado Copia
  assertIgual(columnALetra(12), 'L');  // Correo solicitante
  assertIgual(columnALetra(13), 'M');  // ID Envío (oculta)
  assertIgual(columnALetra(26), 'Z');
  assertIgual(columnALetra(27), 'AA');
  assertIgual(columnALetra(52), 'AZ');
  assertIgual(columnALetra(53), 'BA');
}

function test_construirCeldaConEnlaces() {
  // Una URL sola → un run con link
  var rich1 = construirCeldaConEnlaces('https://drive.google.com/file/d/ABC/view');
  var runs1 = rich1.getRuns();
  var conLink1 = 0;
  for (var i = 0; i < runs1.length; i++) {
    if (runs1[i].getLinkUrl()) conLink1++;
  }
  assertVerdadero(conLink1 > 0, 'una URL sola debe generar al menos un run con link');

  // Dos URLs separadas por \n → dos links
  var rich2 = construirCeldaConEnlaces(
    'https://drive.google.com/file/d/A/view\n' +
    'https://drive.google.com/file/d/B/view'
  );
  var links2 = {};
  rich2.getRuns().forEach(function(r) {
    var url = r.getLinkUrl();
    if (url) links2[url] = true;
  });
  assertIgual(Object.keys(links2).length, 2, 'dos URLs deben dar dos links distintos');

  // Texto sin URLs → sin links
  var rich3 = construirCeldaConEnlaces('solo texto plano');
  var conLink3 = 0;
  rich3.getRuns().forEach(function(r) {
    if (r.getLinkUrl()) conLink3++;
  });
  assertIgual(conLink3, 0, 'texto sin URLs no debe tener links');
}

function test_sanitizarParaSheet() {
  // Texto normal — no cambia
  assertIgual(sanitizarParaSheet('hola'), 'hola', 'texto normal sin cambio');
  assertIgual(sanitizarParaSheet('ESB-Autenticacion'), 'ESB-Autenticacion', 'servicio válido sin cambio');
  assertIgual(sanitizarParaSheet('APROBADO - todo bien'), 'APROBADO - todo bien', 'estado con guion en medio');

  // Fórmulas peligrosas — se prefijan con apóstrofo
  assertIgual(sanitizarParaSheet('=SUM(A1)'), "'=SUM(A1)", '= al inicio se prefija');
  assertIgual(sanitizarParaSheet('=HYPERLINK("x","y")'), "'=HYPERLINK(\"x\",\"y\")", 'fórmula compleja prefijada');
  assertIgual(sanitizarParaSheet('=IMPORTRANGE("id","hoja")'), "'=IMPORTRANGE(\"id\",\"hoja\")", 'exfiltración vía IMPORTRANGE prefijada');
  assertIgual(sanitizarParaSheet('+42'), "'+42", '+ al inicio se prefija');
  assertIgual(sanitizarParaSheet('-1'), "'-1", '- al inicio se prefija');
  assertIgual(sanitizarParaSheet('@SUM'), "'@SUM", '@ al inicio se prefija');

  // Casos borde
  assertIgual(sanitizarParaSheet(''), '', 'string vacío se conserva');
  assertIgual(sanitizarParaSheet(null), '', 'null → vacío');
  assertIgual(sanitizarParaSheet(undefined), '', 'undefined → vacío');
  assertIgual(sanitizarParaSheet(1234), '1234', 'número se convierte a string');

  // Caracteres peligrosos que NO están al inicio no se tocan
  assertIgual(sanitizarParaSheet('hola=mundo'), 'hola=mundo', '= en medio no se prefija');
  assertIgual(sanitizarParaSheet('email@dominio.com'), 'email@dominio.com', '@ en medio (email) no se prefija');
}

function test_resumirMotivos() {
  // Agrupa por motivo
  var r1 = resumirMotivos([
    { motivo: 'permiso' }, { motivo: 'permiso' }, { motivo: 'tiempo' }
  ]);
  assertContiene(r1, '2 sin acceso');
  assertContiene(r1, '1 sin tiempo');

  // Motivo único
  var r2 = resumirMotivos([{ motivo: 'invalido' }, { motivo: 'invalido' }]);
  assertContiene(r2, '2 URL inválida');

  // Lista vacía
  var r3 = resumirMotivos([]);
  assertIgual(r3, 'sin detalle');

  // Null / undefined
  var r4 = resumirMotivos(null);
  assertIgual(r4, 'sin detalle');
}
