/**
 * Extractor.gs — Detección de solicitud + extracción de datos del correo.
 */

var MAX_URL_LENGTH = 500;

// ── Validación ──────────────────────────────────────────────────────

function esSolicitudValida(remitente, body) {
  var tieneFrase = body.indexOf(CONFIG.FRASE_IDENTIFICACION) !== -1;

  var tieneRemitente = false;
  if (CONFIG.REMITENTES_PERMITIDOS && CONFIG.REMITENTES_PERMITIDOS.length > 0) {
    var remLower = (remitente || '').toLowerCase();
    tieneRemitente = CONFIG.REMITENTES_PERMITIDOS.some(function(r) {
      return remLower.indexOf(r.toLowerCase()) !== -1;
    });
  }

  console.log('[Validacion] frase=' + tieneFrase + ' | remitente=' + tieneRemitente + ' | de=' + remitente);

  return tieneFrase || tieneRemitente;
}

// ── Extracción principal ────────────────────────────────────────────

function extraerDatos(body, asunto) {
  var datos = {
    numeroCaso: '',
    servicioDesplegar: '',
    correoSolicitante: '',
    driveDocumentacion: '',
    repositorio: '',
    ambienteExtraido: ''
  };

  // ─ Correo del solicitante ─
  // Viene dentro del cuerpo con el patrón "del siguiente correo:EMAIL"
  // (a veces con espacio, a veces sin él, a veces con asteriscos por el
  // formato bold que getPlainBody convierte a *texto*). Tolera todas
  // esas variantes. Si no lo encuentra, se deja vacío para que el
  // usuario lo llene a mano en el formulario.
  datos.correoSolicitante = extraerCorreoSolicitante(body);
  if (datos.correoSolicitante) {
    console.log('[Extractor] Correo solicitante: ' + datos.correoSolicitante);
  } else {
    console.log('[Extractor] No se encontró correo solicitante en el body');
  }

  // ─ Número de caso ─
  var matchCaso = buscarNumeroCaso(body);
  var fuenteCaso = matchCaso ? 'body' : '';

  // Último recurso: el asunto del correo. Solo se usa si el body no dio
  // nada, para no pisar un número correcto del cuerpo con uno del asunto.
  if (!matchCaso && asunto) {
    matchCaso = buscarNumeroCaso(asunto);
    if (matchCaso) {
      fuenteCaso = 'asunto';
    }
  }

  if (matchCaso) {
    var raw = matchCaso[1];
    if (raw.length > 4) {
      console.warn('[Extractor] Caso con más de 4 dígitos: ' + raw + ' — no se trunca; la validación de onEnviar decidirá qué hacer.');
    }
    datos.numeroCaso = raw;
    console.log('[Extractor] Caso encontrado: ' + datos.numeroCaso + ' (patrón: ' + matchCaso[0] + ' | fuente: ' + fuenteCaso + ')');
  } else {
    console.log('[Extractor] No se encontró número de caso ni en body ni en asunto');
  }

  // ─ Campos de texto ─
  datos.servicioDesplegar = extraerCampo(body, 'Nombre del servicio a desplegar');

  // ─ Ambiente ─
  var ambienteRaw = extraerCampo(body, 'Ambiente a desplegar');
  datos.ambienteExtraido = detectarAmbiente(ambienteRaw);

  // ─ URLs de Drive (excluye forms.google.com) ─
  var regexDrive = /https?:\/\/(?:docs|drive)\.google\.com\/[^\s<>"]+/gi;
  var matchDrive = body.match(regexDrive);
  if (matchDrive) {
    var urlsDrive = matchDrive
      .map(limpiarUrl)
      .filter(function(url) {
        return !/\/forms\//.test(url);
      });
    datos.driveDocumentacion = deduplicarUrls(urlsDrive).join('\n');
  }

  // ─ Repositorios ─ (solo GitHub, el resto se maneja manualmente)
  var regexRepo = /https?:\/\/github\.com\/[^\s<>"]+/gi;
  var matchRepo = body.match(regexRepo);
  if (matchRepo) {
    datos.repositorio = deduplicarUrls(matchRepo.map(limpiarUrl)).join('\n');
  }

  console.log('[Extractor] Resultado: caso=' + datos.numeroCaso +
    ' | servicio=' + datos.servicioDesplegar +
    ' | correoSolicitante=' + (datos.correoSolicitante || '(vacío)') +
    ' | driveUrls=' + (datos.driveDocumentacion ? datos.driveDocumentacion.split('\n').length : 0) +
    ' | repoUrls=' + (datos.repositorio ? datos.repositorio.split('\n').length : 0) +
    ' | ambiente=' + datos.ambienteExtraido);

  return datos;
}

/**
 * Busca el correo del solicitante dentro del cuerpo. El patrón esperado
 * es "del siguiente correo" seguido opcionalmente por :, *, espacios o
 * combinaciones (por el bold que getPlainBody renderiza como *texto*),
 * y luego el email.
 *
 * Deliberadamente NO hace fallback a "el primer email del body": eso
 * podría agarrar el email de la firma del remitente, un destinatario
 * en copia u otro dato irrelevante, y el usuario podría no darse
 * cuenta y mandarlo así al Sheet. Si el patrón falla, se devuelve ''
 * y el usuario lo escribe a mano en el formulario.
 */
function extraerCorreoSolicitante(body) {
  if (!body) return '';

  var regex = /del\s+siguiente\s+correo[\s:*]*([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/i;
  var m = body.match(regex);
  return m ? m[1] : '';
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Busca "el caso asignado con numero N" o "CASO N" en el texto y devuelve
 * el match (con el número en el grupo 1). Retorna null si no encuentra.
 * \*? maneja asteriscos que getPlainBody() usa para marcar negritas del
 * HTML — ejemplo: "numero *9300*" captura "9300". Incluye   en la
 * clase de espacios para tolerar espacios no separables.
 */
function buscarNumeroCaso(texto) {
  if (!texto) return null;
  var m = texto.match(REGEX_CASO_ASIGNADO);
  if (!m) {
    m = texto.match(/\bCASO\s+\*?(\d+)\*?/i);
  }
  return m;
}

function limpiarUrl(url) {
  var originalLen = url.length;

  url = url.replace(/[)\]}>]+$/, '');

  var idxTruncate = url.search(/%5E%5E|%7C%7C|\^\^|\|\|/i);
  if (idxTruncate > 0) {
    url = url.substring(0, idxTruncate);
  }

  url = url.replace(/(%[0-9A-Fa-f]{2})+$/, '');

  if (url.length > MAX_URL_LENGTH) {
    url = url.substring(0, MAX_URL_LENGTH);
  }

  if (url.length !== originalLen) {
    console.log('[limpiarUrl] Truncada: ' + originalLen + ' -> ' + url.length + ' chars');
  }

  return url;
}

function deduplicarUrls(urls) {
  var vistos = {};
  var resultado = [];
  urls.forEach(function(url) {
    var clave = url.toLowerCase();
    if (!vistos[clave]) {
      vistos[clave] = true;
      resultado.push(url);
    }
  });
  return resultado;
}

function extraerCampo(body, etiqueta) {
  var lineas = body.split('\n');
  var etiquetaLower = etiqueta.toLowerCase();

  for (var i = 0; i < lineas.length; i++) {
    var lineaTrimmed = lineas[i].trim();
    var idx = lineaTrimmed.toLowerCase().indexOf(etiquetaLower);

    if (idx !== -1) {
      var despues = lineaTrimmed.substring(idx + etiqueta.length)
        .replace(/^[:\-*\s]+/, '')
        .trim();
      if (despues !== '') {
        return despues;
      }

      for (var j = i + 1; j < lineas.length && j <= i + 3; j++) {
        var valor = lineas[j].trim();
        if (valor !== '') {
          return valor;
        }
      }
    }
  }
  return '';
}

function detectarAmbiente(texto) {
  if (!texto) return '';
  var textoLower = texto.toLowerCase().trim();

  for (var i = 0; i < CONFIG.AMBIENTES.length; i++) {
    if (textoLower.indexOf(CONFIG.AMBIENTES[i].toLowerCase()) !== -1) {
      return CONFIG.AMBIENTES[i];
    }
  }
  return '';
}
