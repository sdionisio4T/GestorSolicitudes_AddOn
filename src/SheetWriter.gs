/**
 * SheetWriter.gs — Escritura en Google Sheets y callback del botón ENVIAR.
 */

/**
 * Único callback del formulario. Guarda TODOS los datos actuales del
 * formulario tal como están, incluyendo el Estado (APROBADO / NO APROBADO /
 * PENDIENTE) y las Observaciones (pueden ir vacías). No decide nada por su
 * cuenta: simplemente persiste lo que el usuario dejó en pantalla.
 *
 * Observaciones no tiene columna propia: si el usuario escribió algo, se
 * concatena dentro de la misma celda de Estado (columna H), con el formato
 * "ESTADO - observaciones". Si no hay observaciones, la celda queda solo
 * con el estado.
 */
function onEnviar(e) {
  var authResp = chequearAutorizacionAction_();
  if (authResp) return authResp;

  var input = parsearFormulario_(e);

  var errPre = validarInputPreConfig_(input);
  if (errPre) return errPre;

  var errCfg = validarConfig_();
  if (errCfg) return errCfg;

  var errPost = validarInputPostConfig_(input);
  if (errPost) return errPost;

  var dc = chequearDobleClic_(input);
  if (dc.respuesta) return dc.respuesta;
  var firma = dc.firma;

  try {
    var escritura = escribirFilasAlSheet_(input);
    var sheet = escritura.sheet;
    var envioId = escritura.envioId;
    var startRow = escritura.startRow;
    var filasCreadas = escritura.filasCreadas;

    var copia = copiarArchivosPorGrupo_(input, envioId);
    var urlsACopiar = copia.urlsACopiar;
    var resultadosPorGrupo = copia.resultadosPorGrupo;

    procesarResultadosPorGrupo_(input, resultadosPorGrupo, urlsACopiar);

    var consolidado = consolidarYActualizarSheet_(input, {
      sheet: sheet,
      envioId: envioId,
      startRow: startRow,
      filasCreadas: filasCreadas,
      driveDocumentacion: input.driveDocumentacion,
      estadoOriginal: input.estado,
      observacionesOriginal: input.observaciones
    }, resultadosPorGrupo, urlsACopiar);

    // Marca esta combinación como "ya enviada" por 15 segundos.
    marcarDobleClic_(firma);

    // El envío se guardó: cerramos el formulario activo para que la
    // homepage no siga ofreciendo "Volver al formulario".
    cerrarFormularioActivo_();

    return construirRespuestaFinal_(e, input, {
      sheet: sheet,
      startRow: startRow,
      filasCreadas: filasCreadas,
      envioIdParaCard: consolidado.envioIdParaCard,
      urlsACopiar: urlsACopiar,
      resultadosPorGrupo: resultadosPorGrupo,
      totalCopiados: consolidado.totalCopiados,
      totalFallos: consolidado.totalFallos,
      seReintentaEnSegundoPlano: consolidado.seReintentaEnSegundoPlano,
      hayPendientesDeAcceso: consolidado.hayPendientesDeAcceso,
      estadoFinal: consolidado.estadoFinal,
      observacionesFinal: consolidado.observacionesFinal
    });

  } catch (error) {
    console.error('[Enviar] Error no controlado: ' + error.message);
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText(mensajeErrorUsuario(error, 'guardar'))
      )
      .build();
  }
}

/**
 * Parseo puro de formInputs — sin validación, sin side effects más allá
 * de los warnings de truncarCampo. Devuelve todos los campos ya
 * normalizados que necesita onEnviar. Las validaciones de formato/
 * obligatoriedad se hacen en onEnviar después de este parseo.
 */
function parsearFormulario_(e) {
  var messageId = e.parameters && e.parameters.messageId;
  var formInputs = e.commonEventObject.formInputs || {};

  var numeroCaso = leerInput(formInputs, 'numeroCaso');
  var servicioDesplegar = truncarCampo(leerInput(formInputs, 'servicioDesplegar'), CAMPO_MAX_LARGO.servicioDesplegar, 'servicioDesplegar');
  var correoSolicitante = leerInput(formInputs, 'correoSolicitante').trim();

  var driveDocumentacionArr = leerMultiInput(formInputs, 'driveDocumentacion');
  var driveDocumentacion;
  if (driveDocumentacionArr.length > 1) {
    driveDocumentacion = driveDocumentacionArr.join('\n');
  } else if (driveDocumentacionArr.length === 1) {
    driveDocumentacion = driveDocumentacionArr[0];
  } else {
    driveDocumentacion = leerInput(formInputs, 'driveDocumentacion');
  }

  // Enlaces extra escritos a mano en el campo "Agregar otro enlace de
  // Drive" (aparece también con 1 Drive detectado y sin Drive). Se
  // agregan al final, deduplicando por URL exacta. Las URLs que no son
  // de Drive/Workspace se descartan y se avisa al usuario al final.
  var driveExtraTexto = truncarCampo(leerInput(formInputs, 'driveDocumentacionExtra'), CAMPO_MAX_LARGO.driveDocumentacionExtra, 'driveDocumentacionExtra');
  var urlsExtraDescartadas = [];
  if (driveExtraTexto) {
    var listaBase = (driveDocumentacion || '').split('\n')
      .map(function(u) { return u.trim(); })
      .filter(function(u) { return u !== ''; });
    var yaPresentes = {};
    listaBase.forEach(function(u) { yaPresentes[u] = true; });
    driveExtraTexto.split('\n')
      .map(function(u) { return u.trim(); })
      .filter(function(u) { return u !== ''; })
      .forEach(function(u) {
        if (yaPresentes[u]) return;
        if (!esUrlDriveOWorkspace(u)) {
          urlsExtraDescartadas.push(u);
          return;
        }
        listaBase.push(u);
        yaPresentes[u] = true;
      });
    driveDocumentacion = listaBase.join('\n');
    driveDocumentacionArr = listaBase.slice();
  }

  var repositorio = leerInput(formInputs, 'repositorio');
  var sonar = leerInput(formInputs, 'sonar').trim();
  var artefactos = leerInput(formInputs, 'artefactos');
  var ambiente = leerInput(formInputs, 'ambiente');
  var componentes = leerMultiInput(formInputs, 'componente');
  if (componentes.length === 0) componentes = [''];

  var estado = leerInput(formInputs, 'estado') || CONFIG.ESTADO_DEFECTO;
  var observaciones = truncarCampo(leerInput(formInputs, 'observaciones'), CAMPO_MAX_LARGO.observaciones, 'observaciones');
  var estadoCelda = observaciones ? (estado + ' - ' + observaciones) : estado;

  return {
    messageId: messageId,
    numeroCaso: numeroCaso,
    servicioDesplegar: servicioDesplegar,
    correoSolicitante: correoSolicitante,
    driveDocumentacion: driveDocumentacion,
    driveDocumentacionArr: driveDocumentacionArr,
    urlsExtraDescartadas: urlsExtraDescartadas,
    repositorio: repositorio,
    sonar: sonar,
    artefactos: artefactos,
    ambiente: ambiente,
    componentes: componentes,
    estado: estado,
    observaciones: observaciones,
    estadoCelda: estadoCelda
  };
}

/**
 * Escribe las filas nuevas del envío al Sheet configurado, protegido por
 * un lock a nivel script (LockService) para que envíos concurrentes de
 * distintos usuarios no lean la misma "última fila" y se pisen entre sí.
 *
 * Genera el `envioId` (compartido por todas las filas del envío),
 * calcula `startRow = sheet.getLastRow() + 1`, arma las filas con
 * `componentes.map` (una por componente), y escribe TODO en una sola
 * llamada a `setValues`. Después aplica hipervínculos rich (col C, D, E),
 * dropdowns de validación (F, G), alineaciones, formato de fecha y wrap.
 *
 * El lock se libera SIEMPRE en el `finally` para no colgar a otros
 * envíos si algo falla adentro.
 *
 * @param input  Resultado de parsearFormulario_.
 * @returns { sheet, envioId, startRow, filasCreadas }
 */
function escribirFilasAlSheet_(input) {
  var numeroCaso = input.numeroCaso;
  var servicioDesplegar = input.servicioDesplegar;
  var correoSolicitante = input.correoSolicitante;
  var driveDocumentacion = input.driveDocumentacion;
  var driveDocumentacionArr = input.driveDocumentacionArr;
  var repositorio = input.repositorio;
  var sonar = input.sonar;
  var artefactos = input.artefactos;
  var ambiente = input.ambiente;
  var componentes = input.componentes;
  var estadoCelda = input.estadoCelda;

  var sheet = obtenerSheet();

  // --- Candado: evita que dos envíos simultáneos (de distintas personas
  // usando el mismo Sheet) lean la misma "última fila" y se pisen entre
  // sí. Solo protege el bloque de lectura+escritura, no toda la función. ---
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // espera hasta 30s si otro envío está en curso

  var envioId = '';
  var startRow = 0;
  var filasCreadas = 0;

  try {
    // envioId identifica este ENVIAR — se comparte entre todas las
    // filas (una por componente) y sirve para localizar las filas
    // cuando la fase 3 (Web App) tenga que actualizar la copia.
    envioId = generarIdEnvio();

    // ID_ENVIO va al final y se oculta: así las columnas visibles
    // (Estado Copia, Correo solicitante) quedan pegadas sin el hueco
    // de la columna oculta en el medio.

    // Columnas de texto libre a las que se les fuerza alineación izquierda.
    // NUMERO_CASO e ID_ENVIO quedan fuera: van centrados.
    // AMBIENTE y COMPONENTE quedan fuera: conservan su propio formato/validación.
    // FECHA queda fuera: se deja con el formato por defecto de la hoja.
    var COLUMNAS_TEXTO_IZQUIERDA = [
      SHEET_COLS.SERVICIO,
      SHEET_COLS.DRIVE,
      SHEET_COLS.REPOSITORIO,
      SHEET_COLS.SONAR,
      SHEET_COLS.ESTADO,
      SHEET_COLS.ARTEFACTOS,
      SHEET_COLS.ESTADO_COPIA,
      SHEET_COLS.CORREO_SOLICITANTE
    ];

    startRow = sheet.getLastRow() + 1;
    var numRows = componentes.length;
    var endRow = startRow + numRows - 1;

    // Estado de copia inicial: "Copiando..." si hay URLs para copiar,
    // "Sin archivos" si no. Se sobrescribe después de intentar la copia.
    var hayUrlsParaCopiar = driveDocumentacionArr && driveDocumentacionArr.length > 0
      ? true
      : (driveDocumentacion && driveDocumentacion.trim() !== '');
    var estadoCopiaInicial = hayUrlsParaCopiar ? 'Copiando...' : 'Sin archivos';

    // Texto que se escribe en la col C (Drive) al armar la fila. Si no hay
    // URLs, en vez de dejar la celda vacía se pone "Sin enlace de Drive"
    // para que quede claro que no fue un olvido de copia — nunca hubo
    // enlace. El feature de "agregar Drive en edición" mira estadoCopia
    // ('Sin archivos') para habilitarse; el texto de la col C es solo UX.
    var driveTextoInicial = hayUrlsParaCopiar ? driveDocumentacion : 'Sin enlace de Drive';

    // Los campos de texto libre (servicioDesplegar viene del cuerpo del
    // correo o de la edición del usuario; estadoCelda contiene las
    // observaciones tipeadas en la card) pasan por sanitizarParaSheet
    // para prevenir inyección de fórmulas. Los otros ya están seguros:
    // numeroCaso valida solo dígitos, ambiente/componente contra listas
    // fijas, correoSolicitante contra regex de email, driveDocumentacion
    // y repositorio se sobrescriben con setRichTextValues (que no
    // ejecuta fórmulas). estadoCopiaInicial hoy es un literal
    // controlado pero lo sanitizamos por defensa a futuro.
    var filas = componentes.map(function(componente) {
      return [
        numeroCaso,
        sanitizarParaSheet(servicioDesplegar),
        driveTextoInicial,
        repositorio,
        sonar, // SONAR — URL opcional que el usuario tipeó en el formulario
        ambiente,
        componente,
        sanitizarParaSheet(estadoCelda),
        sanitizarParaSheet(artefactos), // ARTEFACTOS — texto libre
        new Date(), // FECHA — se escribe como Date real; el formato dd/MM/yyyy se aplica al rango más abajo
        sanitizarParaSheet(estadoCopiaInicial),
        correoSolicitante,
        envioId
      ];
    });

    // 1) Escribir TODAS las filas nuevas en una sola llamada.
    sheet.getRange(startRow, 1, numRows, SHEET_NUM_COLS).setValues(filas);

    // La columna K (ID Envío) sigue guardándose para que los reintentos
    // en segundo plano y la Card de "Estado del envío" puedan localizar
    // las filas del envío por env_XXXXXX, pero el usuario no la ve.
    // Ocultarla es idempotente: si ya estaba oculta de un envío previo,
    // hideColumns() no hace nada.
    try {
      sheet.hideColumns(SHEET_COLS.ID_ENVIO);
    } catch (errHide) {
      console.error('[Enviar] No se pudo ocultar columna ID Envío: ' + errHide.message);
    }

    // 1b) Sobrescribir Drive/Repositorio como hipervínculo real
    //     (RichTextValue), no como texto plano. setValues() por sí solo
    //     deja el texto en negro — Sheets solo autolinkifica en azul
    //     cuando un humano escribe la URL a mano y presiona Enter, no
    //     cuando se escribe por script. Esto lo evita.
    [
      { col: SHEET_COLS.DRIVE, valor: driveDocumentacion },
      { col: SHEET_COLS.REPOSITORIO, valor: repositorio },
      { col: SHEET_COLS.SONAR, valor: sonar }
    ].forEach(function(campo) {
      if (!campo.valor) {
        return;
      }
      var celdaRica = construirCeldaConEnlaces(campo.valor);
      var filasRicas = [];
      for (var i = 0; i < numRows; i++) {
        filasRicas.push([celdaRica]);
      }
      sheet.getRange(startRow, campo.col, numRows, 1).setRichTextValues(filasRicas);
    });

    // 2) Validación por código (dropdowns) en Ambiente (F) y Componente (G).
    //    Ya no depende de la fila 2 como plantilla — las listas vienen de
    //    CONFIG.AMBIENTES / CONFIG.COMPONENTES, y showCustomUi(true) hace
    //    que Sheets renderice el chip de dropdown en la celda.
    var validacionAmbiente = SpreadsheetApp.newDataValidation()
      .requireValueInList(CONFIG.AMBIENTES, true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(startRow, SHEET_COLS.AMBIENTE, numRows, 1).setDataValidation(validacionAmbiente);

    var validacionComponente = SpreadsheetApp.newDataValidation()
      .requireValueInList(CONFIG.COMPONENTES, true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(startRow, SHEET_COLS.COMPONENTE, numRows, 1).setDataValidation(validacionComponente);

    // Centrar Número de caso, Componente e ID Envío (antes lo heredaba del
    // formato de la fila 2 — ahora explícito por código). Componente (G)
    // se centra aquí porque la celda vacía + dropdown por defecto lo dejaba
    // pegado a la izquierda.
    sheet.getRangeList([
      columnALetra(SHEET_COLS.NUMERO_CASO) + startRow + ':' + columnALetra(SHEET_COLS.NUMERO_CASO) + endRow,
      columnALetra(SHEET_COLS.COMPONENTE) + startRow + ':' + columnALetra(SHEET_COLS.COMPONENTE) + endRow,
      columnALetra(SHEET_COLS.ID_ENVIO) + startRow + ':' + columnALetra(SHEET_COLS.ID_ENVIO) + endRow
    ]).setHorizontalAlignment('center');

    // Forzar formato de fecha dd/MM/yyyy en la columna J. Necesario porque
    // el valor se escribe como Date real: sin este formato el Sheet lo
    // renderiza según el locale del archivo (en en_US sale MM/dd/yyyy y el
    // DatePicker abre el mes equivocado, ej. 02/09 leído como 9-feb).
    sheet.getRange(startRow, SHEET_COLS.FECHA, numRows, 1).setNumberFormat('dd/MM/yyyy');

    // 3) Alineación izquierda en las columnas de texto libre, en una sola
    //    llamada usando una lista de rangos.
    var rangosIzquierda = COLUMNAS_TEXTO_IZQUIERDA.map(function(col) {
      return columnALetra(col) + startRow + ':' + columnALetra(col) + endRow;
    });
    sheet.getRangeList(rangosIzquierda).setHorizontalAlignment('left');

    // Wrap de texto en todas las filas nuevas, una sola llamada.
    sheet.getRange(startRow, 1, numRows, SHEET_NUM_COLS).setWrap(true);
    filasCreadas = numRows;

  } finally {
    // Se libera SIEMPRE, incluso si algo falló al escribir, para que
    // nadie más se quede esperando el candado indefinidamente.
    lock.releaseLock();
  }

  return { sheet: sheet, envioId: envioId, startRow: startRow, filasCreadas: filasCreadas };
}

/**
 * Copia los archivos de Drive del envío a la(s) carpeta(s) destino,
 * particionando componentes en grupos APIM / estándar. Cuando hay mezcla
 * de ambos, se copian los mismos archivos DOS veces (una por grupo) y
 * cada fila del Sheet apunta después a la carpeta de su grupo.
 *
 * Se corre FUERA del lock del Sheet — la copia no debe bloquear a otros
 * envíos concurrentes. El presupuesto de tiempo se reparte en partes
 * iguales entre los grupos activos para no exceder el techo de 30s de
 * Gmail. Los errores de preparar destino (permisos de carpeta raíz,
 * cuota) se capturan por grupo y se traducen a `resumenCopia` con un
 * fallo clasificado — no explota el envío completo.
 *
 * @param input   Resultado de parsearFormulario_.
 * @param envioId envioId ya generado por el paso de escritura al Sheet.
 * @returns { urlsACopiar, resultadosPorGrupo }
 */
function copiarArchivosPorGrupo_(input, envioId) {
  var driveDocumentacionArr = input.driveDocumentacionArr;
  var driveDocumentacion = input.driveDocumentacion;
  var componentes = input.componentes;
  var servicioDesplegar = input.servicioDesplegar;
  var numeroCaso = input.numeroCaso;

  var urlsACopiar = (driveDocumentacionArr && driveDocumentacionArr.length > 0)
    ? driveDocumentacionArr.slice()
    : (driveDocumentacion ? driveDocumentacion.split('\n') : []);
  urlsACopiar = urlsACopiar
    .map(function(u) { return (u || '').trim(); })
    .filter(function(u) { return u !== ''; });

  // Particionar filas por grupo de destino. Los componentes API/APIM
  // van a <raíz>/SERVICIOS CAPA/APIM/<Servicio>/<Caso>; el resto va a
  // <raíz>/SERVICIOS CAPA/<Servicio>/<Caso>. Si hay mezcla, se copian
  // los mismos archivos DOS veces (una en cada ruta) y cada fila del
  // Sheet apunta a la carpeta de su grupo.
  var indicesApim = [];
  var indicesStd = [];
  componentes.forEach(function(comp, i) {
    if (esComponenteAPIM(comp)) indicesApim.push(i);
    else indicesStd.push(i);
  });
  var grupos = [];
  if (indicesApim.length > 0) grupos.push({ esApim: true, indices: indicesApim });
  if (indicesStd.length > 0) grupos.push({ esApim: false, indices: indicesStd });

  // Presupuesto por grupo. Si hay uno solo, se usa entero; si hay dos,
  // se divide a la mitad para respetar el techo de 30s de Gmail.
  var presupuestoPorGrupo = urlsACopiar.length > 0
    ? Math.floor(DRIVE_COPIER.PRESUPUESTO_DEFECTO_MS / Math.max(grupos.length, 1))
    : 0;

  // Resultados por grupo — se consolidan al final para actualizar el
  // Sheet fila por fila.
  var resultadosPorGrupo = grupos.map(function(g) {
    return {
      esApim: g.esApim,
      indices: g.indices,
      subEnvioId: envioId + (g.esApim ? '_apim' : ''),
      carpetaDestino: null,
      resumenCopia: null,
      textoEstadoCopia: '',
      hayPendientesAcceso: false,
      urlsPermiso: [],
      esFalloDeCarpetaRaiz: false,
      seReintenta: false,
      actualizarColC: false
    };
  });

  if (urlsACopiar.length > 0) {
    // Cache compartido entre iteraciones (grupos APIM y estándar) para
    // reutilizar la misma referencia a las carpetas intermedias fijas
    // (SERVICIOS CAPA, APIM, Servicio) y evitar duplicados por la
    // consistencia eventual de Drive: si un forEach acaba de crear
    // "SERVICIOS CAPA" y el siguiente hace getFoldersByName al toque,
    // Drive puede no verla todavía y se crearía una segunda hermana.
    // La carpeta del caso (numeroCaso) NO se cachea: usa
    // obtenerOCrearCarpetaHijaUnica que crea una nueva por envío.
    var cacheCarpetas = {};

    resultadosPorGrupo.forEach(function(res) {
      try {
        var carpetaRaizId = obtenerCarpetaRaizId();
        var raiz = DriveApp.getFolderById(carpetaRaizId);
        var nombreServicio = (servicioDesplegar || '(sin servicio)')
          .replace(/[\\/:*?"<>|]/g, '_')
          .trim() || '(sin servicio)';

        // Estructura: raíz / Servicio / Caso.
        // Para envíos APIM se inserta un nivel extra: raíz / APIM / Servicio / Caso.
        // La raíz se usa tal cual la pasa el usuario — el add-on no crea niveles
        // intermedios ni depende del nombre de la carpeta raíz.
        var carpetaBase = raiz;
        if (res.esApim) {
          carpetaBase = obtenerOCrearCarpetaHijaCacheada(carpetaBase, CONFIG.CARPETA_APIM, cacheCarpetas);
        }
        var carpetaServicio = obtenerOCrearCarpetaHijaCacheada(carpetaBase, nombreServicio, cacheCarpetas);
        res.carpetaDestino = obtenerOCrearCarpetaHijaUnica(carpetaServicio, numeroCaso);

        res.resumenCopia = copiarUrlsADestino(urlsACopiar, res.carpetaDestino, presupuestoPorGrupo);
        console.log('[Copia][' + (res.esApim ? 'APIM' : 'STD') + '] copiados: ' +
                    res.resumenCopia.copiados + ' / intentados: ' + res.resumenCopia.totalIntentados +
                    ' | fallos: ' + res.resumenCopia.fallos.length +
                    ' | tiempoAgotado: ' + res.resumenCopia.tiempoAgotado);
      } catch (errCopia) {
        console.error('[Copia][' + (res.esApim ? 'APIM' : 'STD') + '] error preparando destino: ' + errCopia.message);
        var motivoPrep = clasificarError(errCopia);
        res.resumenCopia = {
          copiados: 0,
          totalIntentados: urlsACopiar.length,
          fallos: [{ url: '', motivo: motivoPrep, mensaje: errCopia.message }],
          tiempoAgotado: false
        };
      }
    });
  }

  return { urlsACopiar: urlsACopiar, resultadosPorGrupo: resultadosPorGrupo };
}

/**
 * Consolida los resultados por grupo en flags globales, aplica el override
 * de estado por permisos pendientes, y actualiza las columnas del Sheet
 * afectadas por el resultado de la copia (Estado Copia K, ID Envío M,
 * Drive C, Estado H).
 *
 * Devuelve el consolidado que necesita `construirRespuestaFinal_`:
 *   `seReintentaEnSegundoPlano`, `hayPendientesDeAcceso`,
 *   `totalCopiados`, `totalFallos`, `envioIdParaCard`,
 *   `estadoFinal`, `observacionesFinal`.
 *
 * Los errores al escribir se logean y se tragan — el envío ya se
 * completó, no vale la pena voltearlo por un fallo de UI en el Sheet.
 *
 * @param input               Resultado de parsearFormulario_.
 * @param escritura           { sheet, envioId, startRow, filasCreadas,
 *                              driveDocumentacion, estadoOriginal, observacionesOriginal }
 * @param resultadosPorGrupo  Array mutado por copiar y procesar (con textoEstadoCopia, actualizarColC, etc).
 * @param urlsACopiar         Lista de URLs efectivamente candidatas a copia.
 */
function consolidarYActualizarSheet_(input, escritura, resultadosPorGrupo, urlsACopiar) {
  var sheet = escritura.sheet;
  var envioId = escritura.envioId;
  var startRow = escritura.startRow;
  var filasCreadas = escritura.filasCreadas;
  var driveDocumentacion = escritura.driveDocumentacion;

  // Consolidación para decisiones globales (override de estado, toast, navegación).
  var seReintentaEnSegundoPlano = resultadosPorGrupo.some(function(r) { return r.seReintenta; });
  var hayPendientesDeAcceso = resultadosPorGrupo.some(function(r) { return r.hayPendientesAcceso; });
  var totalCopiados = resultadosPorGrupo.reduce(function(acc, r) {
    return acc + (r.resumenCopia ? r.resumenCopia.copiados : 0);
  }, 0);
  var totalFallos = resultadosPorGrupo.reduce(function(acc, r) {
    return acc + (r.resumenCopia ? r.resumenCopia.fallos.length : 0);
  }, 0);
  // envioId a usar en la Card de estado si hay reintento: el primero
  // que reintentó (o el original si ninguno lo hizo).
  var envioIdParaCard = envioId;
  var primerReintentando = resultadosPorGrupo.filter(function(r) { return r.seReintenta || r.hayPendientesAcceso; })[0];
  if (primerReintentando) envioIdParaCard = primerReintentando.subEnvioId;

  // ── Override del estado por falta de permisos ──
  var estadoFinal = escritura.estadoOriginal;
  var observacionesFinal = escritura.observacionesOriginal;
  var estadoCelda = observacionesFinal ? (estadoFinal + ' - ' + observacionesFinal) : estadoFinal;
  if (hayPendientesDeAcceso) {
    var yaMencionaPermisos = /Falta de permisos/i.test(observacionesFinal || '');
    if (!yaMencionaPermisos) {
      observacionesFinal = observacionesFinal
        ? (observacionesFinal + ' | Falta de permisos')
        : 'Falta de permisos';
    }
    estadoFinal = 'PENDIENTE';
    estadoCelda = estadoFinal + ' - ' + observacionesFinal;
  }

  // --- Actualización del Sheet: Estado Copia (K), Drive (C), Estado (H)
  //     e ID Envío oculto (M) — todo fila por fila según el grupo. ---
  try {
    var estadoCopiaMatriz = [];
    var subEnvioIdMatriz = [];
    for (var iFila = 0; iFila < filasCreadas; iFila++) {
      var res = resultadoParaFila(resultadosPorGrupo, iFila);
      estadoCopiaMatriz.push([sanitizarParaSheet(res ? res.textoEstadoCopia : 'Sin archivos')]);
      subEnvioIdMatriz.push([res ? res.subEnvioId : envioId]);
    }
    sheet.getRange(startRow, 11, filasCreadas, 1).setValues(estadoCopiaMatriz);
    // La columna M (ID Envío oculto, col 13) ya se escribió al crear
    // las filas con el envioId original. Si algún grupo usó un
    // subEnvioId distinto (APIM), lo reescribimos acá para que los
    // reintentos localicen las filas correctas.
    sheet.getRange(startRow, 13, filasCreadas, 1).setValues(subEnvioIdMatriz);

    // Column C (Drive) — hipervínculo por fila según su grupo.
    var necesitaActualizarColC = resultadosPorGrupo.some(function(r) { return r.actualizarColC && r.carpetaDestino; });
    if (necesitaActualizarColC) {
      var filasC = [];
      for (var jFila = 0; jFila < filasCreadas; jFila++) {
        var resFila = resultadoParaFila(resultadosPorGrupo, jFila);
        if (resFila && resFila.actualizarColC && resFila.carpetaDestino) {
          filasC.push([SpreadsheetApp.newRichTextValue()
            .setText('Ver carpeta copiada')
            .setLinkUrl(resFila.carpetaDestino.getUrl())
            .build()]);
        } else {
          // Mantiene el valor actual (URLs originales) para esta fila —
          // se escribe el rich text que ya tenía. Para no complicar,
          // reescribimos el texto plano del driveDocumentacion como
          // rich con enlaces (misma lógica que en la creación).
          filasC.push([construirCeldaConEnlaces(driveDocumentacion || '')]);
        }
      }
      sheet.getRange(startRow, 3, filasCreadas, 1).setRichTextValues(filasC);
    }

    if (hayPendientesDeAcceso) {
      var estadoMatriz = [];
      for (var iOv = 0; iOv < filasCreadas; iOv++) estadoMatriz.push([sanitizarParaSheet(estadoCelda)]);
      sheet.getRange(startRow, 8, filasCreadas, 1).setValues(estadoMatriz);
    }
  } catch (errUpd) {
    console.error('[Copia] No se pudo actualizar estado en Sheet: ' + errUpd.message);
  }

  return {
    seReintentaEnSegundoPlano: seReintentaEnSegundoPlano,
    hayPendientesDeAcceso: hayPendientesDeAcceso,
    totalCopiados: totalCopiados,
    totalFallos: totalFallos,
    envioIdParaCard: envioIdParaCard,
    estadoFinal: estadoFinal,
    observacionesFinal: observacionesFinal
  };
}

/**
 * Muta cada `res` de `resultadosPorGrupo` con:
 *   - `textoEstadoCopia` (Sin archivos / Completado / Parcial / Sin copiar)
 *   - `actualizarColC` (true si copia completa)
 *   - `urlsPermiso`, `esFalloDeCarpetaRaiz`, `hayPendientesAcceso`
 *   - `seReintenta` (true si se pudo programar reintento en segundo plano)
 *
 * Como side effects: programa sobres PENDIENTE con `programarReintentoCopia`
 * cuando hay URLs reintentables (temporal/tiempo), y guarda sobres
 * TERMINADO con `guardarSobreTerminadoConPermiso` cuando hay URLs sin
 * permiso que no se van a reintentar. Errores de programación se logean
 * pero no rompen el flujo.
 */
function procesarResultadosPorGrupo_(input, resultadosPorGrupo, urlsACopiar) {
  // --- Texto de Estado Copia por grupo ---
  resultadosPorGrupo.forEach(function(res) {
    if (urlsACopiar.length === 0) {
      res.textoEstadoCopia = 'Sin archivos';
    } else if (res.resumenCopia && res.resumenCopia.fallos.length === 0) {
      res.textoEstadoCopia = 'Completado (' + res.resumenCopia.copiados + ' archivo' + (res.resumenCopia.copiados === 1 ? '' : 's') + ')';
      res.actualizarColC = true;
    } else if (res.resumenCopia && res.resumenCopia.copiados > 0) {
      res.textoEstadoCopia = 'Parcial: ' + res.resumenCopia.copiados + ' copiado' + (res.resumenCopia.copiados === 1 ? '' : 's') + '. Motivos: ' + resumirMotivos(res.resumenCopia.fallos) + '.';
    } else {
      res.textoEstadoCopia = 'Sin copiar: ' + resumirMotivos(res.resumenCopia ? res.resumenCopia.fallos : []) + '.';
    }
  });

  // --- Sobres pendientes y sobres TERMINADO por grupo ---
  resultadosPorGrupo.forEach(function(res) {
    if (!res.resumenCopia || res.resumenCopia.fallos.length === 0) return;

    var setPermiso = {};
    res.resumenCopia.fallos.forEach(function(f) {
      if (f.motivo === 'permiso') {
        if (f.url) setPermiso[f.url] = true;
        else res.esFalloDeCarpetaRaiz = true;
      }
    });
    res.urlsPermiso = Object.keys(setPermiso);
    res.hayPendientesAcceso = res.urlsPermiso.length > 0 || res.esFalloDeCarpetaRaiz;

    if (res.carpetaDestino) {
      var setReintentables = {};
      res.resumenCopia.fallos.forEach(function(f) {
        if ((f.motivo === 'temporal' || f.motivo === 'tiempo') && f.url) {
          setReintentables[f.url] = true;
        }
      });
      var urlsReintentables = Object.keys(setReintentables);
      if (urlsReintentables.length > 0) {
        var sobre = {
          envioId: res.subEnvioId,
          servicioNombre: input.servicioDesplegar,
          numeroCaso: input.numeroCaso,
          carpetaDestinoId: res.carpetaDestino.getId(),
          urlsPendientes: urlsReintentables,
          urlsPermisoPreexistentes: res.urlsPermiso,
          copiadosPrevios: res.resumenCopia.copiados,
          relanzamientos: 0,
          creadoEn: new Date().getTime()
        };
        try {
          res.seReintenta = programarReintentoCopia(sobre);
          if (res.seReintenta) {
            res.textoEstadoCopia += ' Reintentando en segundo plano.';
          }
        } catch (errProg) {
          console.error('[Enviar] No se pudo programar reintento (' + (res.esApim ? 'APIM' : 'STD') + '): ' + errProg.message);
        }
      }
    }

    if (!res.seReintenta && res.hayPendientesAcceso) {
      try {
        guardarSobreTerminadoConPermiso({
          envioId: res.subEnvioId,
          servicioNombre: input.servicioDesplegar,
          numeroCaso: input.numeroCaso,
          carpetaDestinoId: res.carpetaDestino ? res.carpetaDestino.getId() : ''
        }, res.urlsPermiso, res.resumenCopia.copiados, res.esFalloDeCarpetaRaiz);
      } catch (errTerm) {
        console.error('[Enviar] No se pudo guardar sobre TERMINADO (' + (res.esApim ? 'APIM' : 'STD') + '): ' + errTerm.message);
      }
    }
  });
}

/**
 * Arma el ActionResponse final que retorna onEnviar: notification con
 * resumen (guardado + toast de copia), navegación (estado del envío |
 * card de validación con los datos recién enviados | formulario en
 * blanco), y setStateChanged(true) para forzar al cliente a soltar el
 * estado local del formulario.
 *
 * Toda la lógica es lectura pura + composición de la card — no toca
 * Sheet ni Drive ni UserProperties. La única llamada con side effect
 * blando es la re-extracción del correo original (GmailApp lookup) para
 * que el re-render muestre los mismos checkboxes de Drive detectados
 * que estaban antes del envío.
 *
 * @param e          El evento original de Gmail (para gmail.accessToken).
 * @param input      Resultado de parsearFormulario_ (con messageId y todos los campos).
 * @param resultado  Consolidado del envío: sheet, startRow, filasCreadas,
 *                   envioIdParaCard, urlsACopiar, resultadosPorGrupo,
 *                   totalCopiados, totalFallos, seReintentaEnSegundoPlano,
 *                   hayPendientesDeAcceso, estadoFinal, observacionesFinal.
 */
function construirRespuestaFinal_(e, input, resultado) {
  var messageId = input.messageId;

  // Para el re-render, la lista completa de Drive URLs debe salir SIEMPRE
  // del correo original, no de lo que se acaba de enviar. Si el correo
  // trae dos Drives y el usuario mandó solo uno, la próxima pantalla
  // tiene que seguir mostrando ambos checkboxes para que pueda mandar el
  // otro. Solo el "cuáles quedan marcados" viene de la selección del
  // envío anterior.
  //
  // Ojo: dentro del callback de un botón NO hay token de Gmail activo
  // por defecto, hay que setearlo explícitamente antes de tocar GmailApp
  // o getMessageById tira "Authorization required".
  //
  // En modo manual (messageId vacío) no hay correo asociado, así que se
  // saltea la re-extracción.
  var driveDocumentacionOriginal = input.driveDocumentacion;
  if (messageId) {
    try {
      if (e.gmail && e.gmail.accessToken) {
        GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
      }
      var msgOriginal = GmailApp.getMessageById(messageId);
      var datosReextraidos = extraerDatos(msgOriginal.getPlainBody(), msgOriginal.getSubject());
      if (datosReextraidos.driveDocumentacion) {
        driveDocumentacionOriginal = datosReextraidos.driveDocumentacion;
      }
      console.log('[Enviar] Re-extracción OK, driveUrls originales: ' + (driveDocumentacionOriginal ? driveDocumentacionOriginal.split('\n').length : 0));
    } catch (errReex) {
      console.error('[Enviar] No se pudo re-extraer el correo para el re-render: ' + errReex.message);
    }
  }

  var datosActuales = {
    numeroCaso: input.numeroCaso,
    servicioDesplegar: input.servicioDesplegar,
    correoSolicitante: input.correoSolicitante,
    driveDocumentacion: driveDocumentacionOriginal,
    repositorio: input.repositorio
  };

  var seleccionActual = {
    ambiente: input.ambiente,
    componentes: input.componentes,
    estado: resultado.estadoFinal,
    observaciones: resultado.observacionesFinal,
    correoSolicitante: input.correoSolicitante,
    driveDocumentacion: input.driveDocumentacionArr,
    sonar: input.sonar,
    artefactos: input.artefactos
  };

  var toastCopia = '';
  var huboMezcla = resultado.resultadosPorGrupo.length > 1;
  var sufijoMezcla = huboMezcla ? ' (copia dual APIM + estándar)' : '';
  if (resultado.urlsACopiar.length === 0) {
    toastCopia = ' Sin archivos para copiar.';
  } else if (resultado.totalFallos === 0) {
    toastCopia = ' Copia OK: ' + resultado.totalCopiados + ' archivo(s)' + sufijoMezcla + '.';
  } else if (resultado.totalCopiados > 0) {
    toastCopia = ' Copia parcial: ' + resultado.totalCopiados + ' archivo(s)' + sufijoMezcla + '.';
    if (resultado.seReintentaEnSegundoPlano) {
      toastCopia += ' Reintentando en segundo plano.';
    } else if (resultado.hayPendientesDeAcceso) {
      toastCopia += ' Los enlaces sin acceso los puedes reintentar desde el add-on en "Envíos".';
    }
  } else if (resultado.hayPendientesDeAcceso && !resultado.seReintentaEnSegundoPlano) {
    toastCopia = ' No se copiaron los archivos por falta de permisos. Puedes reintentarlo desde el add-on en "Envíos" cuando tengas acceso.';
  } else if (resultado.seReintentaEnSegundoPlano) {
    toastCopia = ' Sin copiar en la primera pasada. Reintentando en segundo plano.';
  } else {
    toastCopia = ' Sin copiar todavía. Ver estado del envío en el add-on.';
  }

  // Aviso de URLs del campo extra que se descartaron por no ser de
  // Drive/Workspace. Van al final del toast, sin bloquear el envío.
  if (input.urlsExtraDescartadas.length > 0) {
    toastCopia += ' Ignoradas ' + input.urlsExtraDescartadas.length + ' URL(s) del campo extra por no ser de Drive/Workspace.';
    console.warn('[Enviar] URLs extra descartadas: ' + input.urlsExtraDescartadas.map(redactUrl_).join(' | '));
  }

  // URL directa a la primera fila recién escrita. Solo si tenemos
  // startRow > 0 (se escribió al menos una fila) y el sheet configurado.
  var ultimaFilaUrl = '';
  try {
    var sheetIdConf = obtenerSheetId();
    if (resultado.startRow > 0 && sheetIdConf) {
      ultimaFilaUrl = 'https://docs.google.com/spreadsheets/d/' + sheetIdConf +
        '/edit#gid=' + resultado.sheet.getSheetId() + '&range=A' + resultado.startRow;
    }
  } catch (errUrlFila) {
    // no crítico — el botón simplemente no aparece
  }

  var navegacion;
  if (resultado.seReintentaEnSegundoPlano || resultado.hayPendientesDeAcceso) {
    navegacion = CardService.newNavigation()
      .pushCard(buildEstadoEnvioCard(resultado.envioIdParaCard, { messageId: messageId || '' }));
  } else if (!messageId) {
    navegacion = CardService.newNavigation()
      .updateCard(buildValidacionCard({}, null, null, null, null, ultimaFilaUrl));
  } else {
    navegacion = CardService.newNavigation()
      .updateCard(buildValidacionCard(datosActuales, messageId, seleccionActual, null, null, ultimaFilaUrl));
  }

  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification()
        .setText('Guardado (' + resultado.filasCreadas + ' fila/s, estado ' + resultado.estadoFinal + ').' + toastCopia)
    )
    .setNavigation(navegacion)
    // Fuerza al cliente a descartar el estado del formulario (checkboxes,
    // inputs) y usar los valores nuevos que trae la card servida. Sin
    // esto, Gmail conserva lo último que el usuario tildó y "no se
    // refresca" aunque el server mande otra cosa.
    .setStateChanged(true)
    .build();
}

/**
 * Chequea si esta combinación de datos se envió en los últimos 15
 * segundos (protección contra doble clic). Devuelve `{ firma, respuesta }`.
 * Si `respuesta` es no-null, `onEnviar` debe retornarla directamente. La
 * `firma` se guarda para pasarla a `marcarDobleClic_` una vez completado
 * el envío. Si cambia cualquier campo (por ejemplo el Ambiente), la firma
 * es distinta y el envío se procesa normalmente.
 */
function chequearDobleClic_(input) {
  var firma = firmarEnvio(input.numeroCaso, input.servicioDesplegar, input.ambiente, input.componentes, input.estadoCelda);
  var cache = CacheService.getUserCache();
  if (cache.get(firma)) {
    return {
      firma: firma,
      respuesta: CardService.newActionResponseBuilder()
        .setNotification(
          CardService.newNotification()
            .setText('Ya se registró este mismo envío hace unos segundos. Si quieres registrar otro, cambia algún dato (por ejemplo el Ambiente) y presiona ENVIAR de nuevo.')
        )
        .build()
    };
  }
  return { firma: firma, respuesta: null };
}

/**
 * Marca la firma del envío como "ya enviada" por 15 segundos en el
 * UserCache. Se llama al final de `onEnviar` cuando el envío se completó
 * sin excepción.
 */
function marcarDobleClic_(firma) {
  CacheService.getUserCache().put(firma, '1', 15);
}

/**
 * Validaciones de formato que corren ANTES de chequear la config. El orden
 * pre-config / config / post-config se preserva tal cual estaba inline
 * en onEnviar — es histórico. Devuelve ActionResponse listo para retornar
 * si algo falla, o null si todo está bien.
 */
function validarInputPreConfig_(input) {
  if (input.numeroCaso && !/^\d{1,4}$/.test(input.numeroCaso.trim())) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('El número de caso debe ser solo números (máx. 4 dígitos). Corrígelo antes de enviar.')
      )
      .build();
  }
  if (input.sonar && !/^https?:\/\/\S+$/i.test(input.sonar)) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('Sonar debe ser una URL válida (http/https) o quedar vacío.')
      )
      .build();
  }
  return null;
}

/**
 * Chequea que Sheet/pestaña/carpeta configurados sigan siendo válidos.
 * Si algo está mal, devuelve un ActionResponse con notification + push
 * de la card apropiada del wizard (paso 1, 2 o 3 según el motivo).
 */
function validarConfig_() {
  var motivoConfig = motivoConfigInvalida();
  if (!motivoConfig) return null;
  console.log('[Enviar] Config inválida al enviar: ' + motivoConfig);
  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText(motivoConfig)
    )
    .setNavigation(
      CardService.newNavigation().pushCard(buildCardConfigApropiada(motivoConfig))
    )
    .build();
}

/**
 * Validaciones de obligatoriedad + formato de correo que corren DESPUÉS
 * de la config (originalmente inline en onEnviar). El correo va acá y
 * no en pre-config porque así estaba el orden histórico.
 */
function validarInputPostConfig_(input) {
  if (!input.numeroCaso) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('El número de caso es obligatorio.')
      )
      .build();
  }
  if (!input.servicioDesplegar) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('El servicio a desplegar es obligatorio.')
      )
      .build();
  }
  if (input.correoSolicitante && !REGEX_EMAIL.test(input.correoSolicitante)) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('El correo del solicitante no tiene un formato válido. Déjalo vacío si no lo tienes.')
      )
      .build();
  }
  return null;
}

/**
 * Prefija un apóstrofo simple cuando el valor empieza con un caracter que
 * Sheets interpreta como fórmula (=, +, -, @). El apóstrofo NO se muestra
 * en la celda — solo fuerza a Sheets a tratar el contenido como texto
 * literal. Aplicar a TODO string que venga de un formulario o del cuerpo
 * de un correo antes de escribirlo con setValues/setValue. Sin esto, un
 * correo con "=HYPERLINK(...)" o "=IMPORTRANGE(...)" ejecuta la fórmula
 * en el Sheet corporativo (CSV/formula injection).
 */
function sanitizarParaSheet(v) {
  if (v == null) return '';
  var s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/**
 * Genera una huella corta y estable a partir de los datos que definen si
 * dos envíos son "el mismo" (caso, servicio, ambiente, componentes y
 * estado). No incluye observaciones ni las URLs porque esos campos no
 * distinguen un envío legítimamente distinto.
 */
function firmarEnvio(numeroCaso, servicioDesplegar, ambiente, componentes, estadoCelda) {
  var base = [
    numeroCaso,
    servicioDesplegar,
    ambiente,
    componentes.slice().sort().join(','),
    estadoCelda
  ].join('|');

  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, base);
  return bytes.map(function(b) {
    var v = (b < 0) ? b + 256 : b;
    var hex = v.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

/**
 * Convierte un índice de columna (1 = A, 2 = B, ...) a su letra en
 * notación A1. Usado para construir rangos como "B5:B7" en getRangeList.
 */
function columnALetra(col) {
  var letra = '';
  while (col > 0) {
    var resto = (col - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    col = Math.floor((col - 1) / 26);
  }
  return letra;
}

/**
 * Construye un RichTextValue para una celda que puede contener una o
 * varias URLs separadas por salto de línea (por ejemplo Drive). Cada línea
 * que sea una URL http(s) válida queda como hipervínculo azul real; el
 * resto del texto (si lo hay) queda como texto plano dentro de la misma
 * celda.
 */
function construirCeldaConEnlaces(valorCampo) {
  var builder = SpreadsheetApp.newRichTextValue().setText(valorCampo);
  var lineas = valorCampo.split('\n');
  var cursor = 0;

  lineas.forEach(function(linea) {
    var inicio = cursor;
    var fin = cursor + linea.length;
    var urlSinEspacios = linea.trim();

    if (/^https?:\/\/\S+$/i.test(urlSinEspacios)) {
      // Ajustar el rango para no incluir espacios de sobra al inicio/fin
      // de la línea (si los hubiera) dentro del hipervínculo.
      var offsetInicio = inicio + (linea.length - linea.replace(/^\s+/, '').length);
      var offsetFin = fin - (linea.length - linea.replace(/\s+$/, '').length);
      if (offsetFin > offsetInicio) {
        builder.setLinkUrl(offsetInicio, offsetFin, urlSinEspacios);
      }
    }

    cursor = fin + 1; // +1 por el '\n' que el split() se come
  });

  return builder.build();
}

/**
 * Convierte una lista de fallos de copia en una frase corta y legible
 * para el toast y la celda de Estado Copia. Agrupa por motivo, ej:
 * "2 sin acceso, 1 sin tiempo".
 */
function resumirMotivos(fallos) {
  if (!fallos || fallos.length === 0) return 'sin detalle';
  var counts = {};
  fallos.forEach(function(f) {
    var k = f.motivo || 'otro';
    counts[k] = (counts[k] || 0) + 1;
  });
  var labels = {
    permiso: 'sin acceso',
    temporal: 'error temporal',
    invalido: 'URL inválida',
    tiempo: 'sin tiempo'
  };
  return Object.keys(counts).map(function(k) {
    return counts[k] + ' ' + (labels[k] || k);
  }).join(', ');
}

/**
 * Devuelve true si el componente marcado pertenece al grupo APIM (API o
 * APIM). Esos componentes cambian la carpeta destino: los archivos
 * copiados van a <raíz>/SERVICIOS CAPA/APIM/<Servicio>/<Caso>/ en vez de
 * <raíz>/SERVICIOS CAPA/<Servicio>/<Caso>/.
 */
function esComponenteAPIM(comp) {
  if (!comp) return false;
  return CONFIG.COMPONENTES_APIM.indexOf(comp) !== -1;
}

/**
 * Dado el array de resultados por grupo y un índice de fila (0-indexado
 * dentro del envío), devuelve el resultado del grupo al que pertenece esa
 * fila. Retorna null si ninguna coincide (no debería pasar).
 */
function resultadoParaFila(resultados, iFila) {
  for (var g = 0; g < resultados.length; g++) {
    if (resultados[g].indices.indexOf(iFila) !== -1) return resultados[g];
  }
  return null;
}

/**
 * Copia URLs de Drive a un envio existente (invocado desde la edicion
 * cuando el envio original quedo "Sin archivos" y el usuario agrega Drive).
 *
 * Reutiliza la misma logica que onEnviar para copiar: particiona filas por
 * APIM/estandar, crea carpetas destino, copia URLs, actualiza col C (Drive)
 * y col K (Estado Copia), y programa sobres PENDIENTE (reintento) o
 * TERMINADO (esperando acceso) segun los fallos.
 *
 * A diferencia de onEnviar: no crea filas nuevas — sobrescribe las
 * existentes que corresponden al envioId dado.
 *
 * Params:
 *   sheet             — Sheet configurado (obtenerSheet())
 *   envioId           — id del envio original (envioIds subgrupo APIM se
 *                       generan aca, envioId + '_apim')
 *   filasRow          — array de row numbers de las filas del envio
 *   componentes       — array de componentes (uno por fila, mismo orden)
 *   servicioDesplegar — nombre del servicio (para nombrar la carpeta)
 *   numeroCaso        — numero de caso (para nombrar la carpeta hoja)
 *   urlsACopiar       — array de URLs de Drive validadas y deduplicadas
 *
 * Retorna:
 *   { totalCopiados, totalFallos, seReintenta, hayPendientesDeAcceso,
 *     resumenTexto } — resumenTexto listo para toast.
 */
function copiarUrlsPostEnvio_(sheet, envioId, filasRow, componentes, servicioDesplegar, numeroCaso, urlsACopiar) {
  if (!urlsACopiar || urlsACopiar.length === 0) {
    return {
      totalCopiados: 0,
      totalFallos: 0,
      seReintenta: false,
      hayPendientesDeAcceso: false,
      resumenTexto: 'Sin archivos para copiar.'
    };
  }

  // Particionar por grupo (APIM vs estandar), guardando los indices
  // dentro de filasRow/componentes para saber que filas del Sheet
  // corresponden a cada grupo.
  var indicesApim = [];
  var indicesStd = [];
  componentes.forEach(function(comp, i) {
    if (esComponenteAPIM(comp)) {
      indicesApim.push(i);
    } else {
      indicesStd.push(i);
    }
  });

  var grupos = [];
  if (indicesApim.length > 0) grupos.push({ esApim: true, indices: indicesApim });
  if (indicesStd.length > 0) grupos.push({ esApim: false, indices: indicesStd });

  var presupuestoPorGrupo = Math.floor(DRIVE_COPIER.PRESUPUESTO_DEFECTO_MS / Math.max(grupos.length, 1));

  // Cache compartido entre grupos para evitar duplicar carpetas
  // intermedias (APIM/Servicio) por consistencia eventual de Drive.
  var cacheCarpetas = {};

  var resultadosPorGrupo = grupos.map(function(g) {
    return {
      esApim: g.esApim,
      indices: g.indices,
      subEnvioId: envioId + (g.esApim ? '_apim' : ''),
      carpetaDestino: null,
      resumenCopia: null,
      textoEstadoCopia: '',
      hayPendientesAcceso: false,
      urlsPermiso: [],
      esFalloDeCarpetaRaiz: false,
      seReintenta: false,
      actualizarColC: false
    };
  });

  // Copia por grupo.
  resultadosPorGrupo.forEach(function(res) {
    try {
      var carpetaRaizId = obtenerCarpetaRaizId();
      var raiz = DriveApp.getFolderById(carpetaRaizId);
      var nombreServicio = (servicioDesplegar || '(sin servicio)')
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim() || '(sin servicio)';

      var carpetaBase = raiz;
      if (res.esApim) {
        carpetaBase = obtenerOCrearCarpetaHijaCacheada(carpetaBase, CONFIG.CARPETA_APIM, cacheCarpetas);
      }
      var carpetaServicio = obtenerOCrearCarpetaHijaCacheada(carpetaBase, nombreServicio, cacheCarpetas);
      res.carpetaDestino = obtenerOCrearCarpetaHijaUnica(carpetaServicio, numeroCaso);

      res.resumenCopia = copiarUrlsADestino(urlsACopiar, res.carpetaDestino, presupuestoPorGrupo);
      console.log('[EditCopia][' + (res.esApim ? 'APIM' : 'STD') + '] copiados: ' +
                  res.resumenCopia.copiados + ' / intentados: ' + res.resumenCopia.totalIntentados +
                  ' | fallos: ' + res.resumenCopia.fallos.length);
    } catch (errCopia) {
      console.error('[EditCopia][' + (res.esApim ? 'APIM' : 'STD') + '] error preparando destino: ' + errCopia.message);
      res.resumenCopia = {
        copiados: 0,
        totalIntentados: urlsACopiar.length,
        fallos: [{ url: '', motivo: clasificarError(errCopia), mensaje: errCopia.message }],
        tiempoAgotado: false
      };
    }
  });

  // Texto de Estado Copia por grupo.
  resultadosPorGrupo.forEach(function(res) {
    if (res.resumenCopia && res.resumenCopia.fallos.length === 0) {
      res.textoEstadoCopia = 'Completado (' + res.resumenCopia.copiados + ' archivo' + (res.resumenCopia.copiados === 1 ? '' : 's') + ')';
      res.actualizarColC = true;
    } else if (res.resumenCopia && res.resumenCopia.copiados > 0) {
      res.textoEstadoCopia = 'Parcial: ' + res.resumenCopia.copiados + ' copiado' + (res.resumenCopia.copiados === 1 ? '' : 's') + '. Motivos: ' + resumirMotivos(res.resumenCopia.fallos) + '.';
    } else {
      res.textoEstadoCopia = 'Sin copiar: ' + resumirMotivos(res.resumenCopia ? res.resumenCopia.fallos : []) + '.';
    }
  });

  // Sobres pendientes y sobres TERMINADO por grupo.
  resultadosPorGrupo.forEach(function(res) {
    if (!res.resumenCopia || res.resumenCopia.fallos.length === 0) return;

    var setPermiso = {};
    res.resumenCopia.fallos.forEach(function(f) {
      if (f.motivo === 'permiso') {
        if (f.url) setPermiso[f.url] = true;
        else res.esFalloDeCarpetaRaiz = true;
      }
    });
    res.urlsPermiso = Object.keys(setPermiso);
    res.hayPendientesAcceso = res.urlsPermiso.length > 0 || res.esFalloDeCarpetaRaiz;

    if (res.carpetaDestino) {
      var setReintentables = {};
      res.resumenCopia.fallos.forEach(function(f) {
        if ((f.motivo === 'temporal' || f.motivo === 'tiempo') && f.url) {
          setReintentables[f.url] = true;
        }
      });
      var urlsReintentables = Object.keys(setReintentables);
      if (urlsReintentables.length > 0) {
        var sobre = {
          envioId: res.subEnvioId,
          servicioNombre: servicioDesplegar,
          numeroCaso: numeroCaso,
          carpetaDestinoId: res.carpetaDestino.getId(),
          urlsPendientes: urlsReintentables,
          urlsPermisoPreexistentes: res.urlsPermiso,
          copiadosPrevios: res.resumenCopia.copiados,
          relanzamientos: 0,
          creadoEn: new Date().getTime()
        };
        try {
          res.seReintenta = programarReintentoCopia(sobre);
          if (res.seReintenta) {
            res.textoEstadoCopia += ' Reintentando en segundo plano.';
          }
        } catch (errProg) {
          console.error('[EditCopia] No se pudo programar reintento (' + (res.esApim ? 'APIM' : 'STD') + '): ' + errProg.message);
        }
      }
    }

    if (!res.seReintenta && res.hayPendientesAcceso) {
      try {
        guardarSobreTerminadoConPermiso({
          envioId: res.subEnvioId,
          servicioNombre: servicioDesplegar,
          numeroCaso: numeroCaso,
          carpetaDestinoId: res.carpetaDestino ? res.carpetaDestino.getId() : ''
        }, res.urlsPermiso, res.resumenCopia.copiados, res.esFalloDeCarpetaRaiz);
      } catch (errTerm) {
        console.error('[EditCopia] No se pudo guardar sobre TERMINADO (' + (res.esApim ? 'APIM' : 'STD') + '): ' + errTerm.message);
      }
    }
  });

  // Actualizar el Sheet: col C (Drive), K (Estado Copia), M (ID Envio si
  // hubo grupo APIM con subEnvioId distinto). Mapea por indice de fila.
  try {
    var estadoCopiaMatriz = [];
    var subEnvioIdMatriz = [];
    var richTextColC = [];

    for (var iFila = 0; iFila < filasRow.length; iFila++) {
      var resFila = null;
      resultadosPorGrupo.forEach(function(res) {
        if (res.indices.indexOf(iFila) !== -1) resFila = res;
      });

      estadoCopiaMatriz.push([sanitizarParaSheet(resFila ? resFila.textoEstadoCopia : 'Sin archivos')]);
      subEnvioIdMatriz.push([resFila ? resFila.subEnvioId : envioId]);

      // Col C: link a la carpeta si copio OK, sino las URLs originales
      // como link (para que el usuario pueda reintentar manualmente).
      if (resFila && resFila.actualizarColC && resFila.carpetaDestino) {
        richTextColC.push([SpreadsheetApp.newRichTextValue()
          .setText('Ver carpeta copiada')
          .setLinkUrl(resFila.carpetaDestino.getUrl())
          .build()]);
      } else {
        richTextColC.push([construirCeldaConEnlaces(urlsACopiar.join('\n'))]);
      }
    }

    // Escritura fila por fila porque las filasRow pueden no ser contiguas
    // (aunque en la practica lo son — igual defensivo).
    for (var j = 0; j < filasRow.length; j++) {
      var row = filasRow[j];
      sheet.getRange(row, SHEET_COLS.ESTADO_COPIA).setValue(estadoCopiaMatriz[j][0]);
      sheet.getRange(row, SHEET_COLS.ID_ENVIO).setValue(subEnvioIdMatriz[j][0]);
      sheet.getRange(row, SHEET_COLS.DRIVE).setRichTextValue(richTextColC[j][0]);
    }
  } catch (errUpd) {
    console.error('[EditCopia] No se pudo actualizar el Sheet: ' + errUpd.message);
  }

  // Consolidar metricas para el toast.
  var totalCopiados = resultadosPorGrupo.reduce(function(acc, r) {
    return acc + (r.resumenCopia ? r.resumenCopia.copiados : 0);
  }, 0);
  var totalFallos = resultadosPorGrupo.reduce(function(acc, r) {
    return acc + (r.resumenCopia ? r.resumenCopia.fallos.length : 0);
  }, 0);
  var seReintenta = resultadosPorGrupo.some(function(r) { return r.seReintenta; });
  var hayPendientesDeAcceso = resultadosPorGrupo.some(function(r) { return r.hayPendientesAcceso; });

  var resumenTexto;
  var huboMezcla = resultadosPorGrupo.length > 1;
  var sufijoMezcla = huboMezcla ? ' (APIM + estándar)' : '';
  if (totalFallos === 0) {
    resumenTexto = 'Copia OK: ' + totalCopiados + ' archivo(s)' + sufijoMezcla + '.';
  } else if (totalCopiados > 0) {
    resumenTexto = 'Copia parcial: ' + totalCopiados + ' archivo(s)' + sufijoMezcla + '.';
    if (seReintenta) resumenTexto += ' Reintentando en segundo plano.';
    else if (hayPendientesDeAcceso) resumenTexto += ' Ver "Envíos" para reintentar los sin acceso.';
  } else if (hayPendientesDeAcceso && !seReintenta) {
    resumenTexto = 'Sin copiar por falta de permisos. Reintentar desde "Envíos" cuando tengas acceso.';
  } else if (seReintenta) {
    resumenTexto = 'Sin copiar en la primera pasada. Reintentando en segundo plano.';
  } else {
    resumenTexto = 'Sin copiar todavía. Ver "Envíos" para más detalles.';
  }

  return {
    totalCopiados: totalCopiados,
    totalFallos: totalFallos,
    seReintenta: seReintenta,
    hayPendientesDeAcceso: hayPendientesDeAcceso,
    resumenTexto: resumenTexto
  };
}

function obtenerSheet() {
  var sheetId = obtenerSheetId();

  if (!sheetId) {
    throw new Error('No se ha configurado un Sheet. Usa el botón de configuración.');
  }

  var tabName = obtenerSheetTab();

  if (!tabName) {
    throw new Error('No se ha seleccionado una pestaña. Usa el botón de configuración.');
  }

  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName(tabName);

  if (!sheet) {
    throw new Error('No se encontró la pestaña "' + tabName + '" en el Sheet.');
  }

  return sheet;
}

