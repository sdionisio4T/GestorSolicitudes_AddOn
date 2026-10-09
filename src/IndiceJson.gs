/**
 * IndiceJson.gs: JSON de las solicitudes.
 *
 * Para cada fila del Sheet busca sus .json y los escribe en la columna N
 * (links o, si no hay, el motivo). En la columna O pone el link a nuestra
 * carpeta copiada cuando la columna C no lo tiene. Los .json de la raíz que
 * ninguna fila usa quedan en la pestaña "JSON sin fila".
 *
 * La clave es el número de caso: se juntan los .json de todas las carpetas
 * del caso dentro de la raíz configurada (tomada por su ID). Si el caso no
 * tiene carpeta, se usan los links de las columnas C y D, incluidos los
 * originales de otras personas (una carpeta por consulta: la consulta
 * agrupada por padres pierde archivos sin avisar en carpetas de otros).
 *
 * Trabaja por partes con un activador .after(), como los reintentos. El
 * avance es la propia columna N: cada parte sigue en la primera N vacía.
 * Solo se guarda una nota corta por Sheet en las propiedades del proyecto.
 * La columna C, el envío y los reintentos no se tocan.
 */

var INDICE_CONFIG = {
  CARPETA_MIME: 'application/vnd.google-apps.folder',
  // Filas que se escriben con el lock tomado; entre un bloque y otro se
  // suelta para no frenar los envíos de los demás.
  BLOQUE_N: 40,
  // Si la parte programada no arrancó en este tiempo, la tarjeta lo avisa.
  ESPERA_ACTIVADOR_MS: 90000
};

// ── Utilidades ────────────────────────────────────────────────────────

var INDICE_REGEX_URL_DRIVE = /https?:\/\/(?:drive|docs)\.google\.com\/[^\s<>"]+/gi;

/**
 * Misma limpieza que se aplica al nombre del servicio al crear su carpeta.
 */
function indiceLimpiarServicio_(servicio) {
  return (String(servicio || '(sin servicio)')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()) || '(sin servicio)';
}

/**
 * Cadena de carpetas desde el primer nivel bajo la raíz hasta `carpetaId`
 * (incluida), como [{ id, nombre }]. Null si no cuelga de la raíz.
 * `carpetas` es { id: [nombre, idPadre] }.
 */
function indiceCadena_(carpetaId, raizId, carpetas) {
  var cadena = [];
  var actual = carpetaId;
  var vueltas = 0;
  while (actual && vueltas < 60) {
    if (actual === raizId) return cadena.reverse();
    var info = carpetas[actual];
    if (!info) return null;
    cadena.push({ id: actual, nombre: info[0] });
    actual = info[1];
    vueltas++;
  }
  return null;
}

/**
 * IDs de Drive de una celda: textos con hipervínculo y URLs pegadas como
 * texto plano, sin repetir.
 */
function indiceIdsDeCelda_(rich) {
  var vistos = {};
  var ids = [];
  function agregar(url) {
    var parsed = parsearIdDrive(url);
    if (!parsed || vistos[parsed.id]) return;
    vistos[parsed.id] = true;
    ids.push(parsed.id);
  }
  rich.getRuns().forEach(function(run) {
    var url = run.getLinkUrl();
    if (url) agregar(url);
  });
  (rich.getText().match(INDICE_REGEX_URL_DRIVE) || []).forEach(agregar);
  return ids;
}

/**
 * De qué links originales sale un .json encontrado en originales: el link
 * al propio archivo y las carpetas enlazadas que lo contienen. También
 * devuelve la más cercana y la ruta desde ella.
 *
 * O: { estados: { id: 'carpeta' | 'json' | 'sin_acceso' | 'otro' },
 *      carpetas: { id: [nombre, padre o null] } }
 */
function indiceOrigenDeJson_(j, O) {
  var origenes = [];
  var ruta = [];
  var cercano = null;
  if (O.estados[j[0]] === 'json') origenes.push(j[0]);
  var p = j[2];
  var vueltas = 0;
  while (p && O.carpetas[p] && vueltas < 60) {
    if (O.estados[p] === 'carpeta') {
      origenes.push(p);
      if (!cercano) cercano = p;
    }
    if (!cercano) ruta.unshift(O.carpetas[p][0]);
    p = O.carpetas[p][1];
    vueltas++;
  }
  return { origenes: origenes, cercano: cercano, ruta: ruta };
}

// ── Búsqueda por número de caso (funciones puras) ─────────────────────
//
// El número de caso es la clave: el nombre del servicio puede tener
// errores de escritura y un caso tiene filas de varios ambientes y
// componentes. Trabajan sobre el árbol de la raíz ya recorrido:
//   arbol: { raizId, carpetas: { id: [nombre, padre] },
//            jsons: [[id, nombre, padre, modificadoIso, md5]] }

var INDICE_MOTIVOS = {
  carpeta_sin_json: 'Hay carpeta del caso en el Drive, pero no tiene JSON',
  original_sin_acceso: 'Sin acceso al original o fue borrado; pedir permiso',
  original_sin_json: 'El original no tiene JSON',
  sin_carpeta_ni_link: 'No hay carpeta del caso en el Drive ni link en la fila'
};

function indiceUrlArchivo_(id) {
  return 'https://drive.google.com/file/d/' + id + '/view';
}

function indiceUrlCarpeta_(id) {
  return 'https://drive.google.com/drive/folders/' + id;
}

/**
 * Número de caso normalizado (solo dígitos, sin ceros a la izquierda), o ''
 * si el valor no es un número. En el Sheet un caso puede venir como número
 * o como texto.
 */
function indiceNormalizarCaso_(caso) {
  var s = String(caso == null ? '' : caso).trim();
  if (!/^\d+$/.test(s)) return '';
  return s.replace(/^0+(?=\d)/, '');
}

/**
 * Quita el sufijo de reenvío ("9300_2" → "9300"). Solo si va pegado a un
 * número y tiene hasta 3 dígitos, para no confundirlo con un número de caso
 * escrito con guion bajo ("caso_9300" queda igual).
 */
function indiceQuitarSufijo_(nombre) {
  return String(nombre || '').replace(/(\d)_\d{1,3}$/, '$1');
}

/**
 * Números de caso que aparecen completos en el nombre de una carpeta. El
 * sufijo de reenvío "_2", "_3" no cuenta como número aparte.
 *   "9300" y "9300_2" → 9300;  "caso 9300" y "caso_9300" → 9300;
 *   "19300" → 19300 (no 9300)
 */
function indiceNumerosEnNombre_(nombre) {
  var s = indiceQuitarSufijo_(nombre);
  var vistos = {};
  var res = [];
  (s.match(/\d+/g) || []).forEach(function(n) {
    var k = indiceNormalizarCaso_(n);
    if (!k || vistos[k]) return;
    vistos[k] = true;
    res.push(k);
  });
  return res;
}

/**
 * Directorio por número de caso: para cada número, las carpetas de la raíz
 * que lo tienen en su nombre (con su ruta y su rama) y los .json que cuelgan
 * de ellas, en cualquier subcarpeta.
 *
 * La rama es APIM si la carpeta está dentro de la subcarpeta APIM de la
 * raíz; si no, General. La raíz se toma por su ID: su nombre no importa.
 *
 * Devuelve { porCaso: { numero: { carpetas: [...], jsons: [...] } },
 *            casosDeJson: { idJson: [numeros] } }
 */
function indiceDirectorioPorCaso_(arbol) {
  var porCaso = {};
  var infoCarpeta = {};

  Object.keys(arbol.carpetas).forEach(function(id) {
    var cadena = indiceCadena_(id, arbol.raizId, arbol.carpetas);
    if (!cadena || cadena.length === 0) return;
    var nombre = arbol.carpetas[id][0];
    var info = {
      id: id,
      nombre: nombre,
      ruta: cadena.map(function(c) { return c.nombre; }).join('/'),
      segmentos: cadena.map(function(c) { return c.nombre; }),
      rama: cadena[0].nombre === CONFIG.CARPETA_APIM ? 'APIM' : 'General',
      conSufijo: indiceQuitarSufijo_(nombre) !== nombre
    };
    infoCarpeta[id] = info;
    indiceNumerosEnNombre_(nombre).forEach(function(num) {
      if (!porCaso[num]) porCaso[num] = { carpetas: [], jsons: [] };
      porCaso[num].carpetas.push(info);
    });
  });

  var casosDeJson = {};
  (arbol.jsons || []).forEach(function(j) {
    var vistos = {};
    var actual = j[2];
    var vueltas = 0;
    while (actual && actual !== arbol.raizId && infoCarpeta[actual] && vueltas < 60) {
      var info = infoCarpeta[actual];
      indiceNumerosEnNombre_(info.nombre).forEach(function(num) {
        if (vistos[num]) return;
        vistos[num] = true;
        porCaso[num].jsons.push({
          id: j[0],
          nombre: j[1],
          modificado: j[3] || '',
          md5: j[4] || '',
          rama: info.rama,
          conSufijo: info.conSufijo,
          carpetaCaso: info.id
        });
      });
      actual = arbol.carpetas[actual][1];
      vueltas++;
    }
    casosDeJson[j[0]] = Object.keys(vistos);
  });

  Object.keys(porCaso).forEach(function(num) {
    porCaso[num].carpetas.sort(indiceOrdenCarpetas_);
  });
  return { porCaso: porCaso, casosDeJson: casosDeJson };
}

/**
 * Orden de carpetas de un caso: primero las sin sufijo, luego por ruta.
 */
function indiceOrdenCarpetas_(a, b) {
  if (a.conSufijo !== b.conSufijo) return a.conSufijo ? 1 : -1;
  return a.ruta.localeCompare(b.ruta);
}

/**
 * Deja un solo .json por contenido. Idénticos = mismo nombre y misma huella
 * md5: se queda el de la carpeta sin "_N" y, si empatan, el más reciente.
 * Mismo nombre con contenido distinto: quedan todos. Sin huella, cada
 * archivo cuenta como distinto. Ordena por nombre y, dentro del nombre, del
 * más reciente al más viejo.
 */
function indiceQuitarRepetidos_(jsons) {
  var elegidos = {};
  var orden = [];
  jsons.forEach(function(j) {
    var clave = j.md5 ? j.nombre + '|' + j.md5 : 'id|' + j.id;
    var actual = elegidos[clave];
    if (!actual) {
      elegidos[clave] = j;
      orden.push(clave);
      return;
    }
    if (actual.id === j.id) return;
    var mejor = (actual.conSufijo !== j.conSufijo)
      ? (actual.conSufijo ? j : actual)
      : (String(j.modificado) > String(actual.modificado) ? j : actual);
    elegidos[clave] = mejor;
  });
  var res = orden.map(function(k) { return elegidos[k]; });
  res.sort(function(a, b) {
    var n = a.nombre.localeCompare(b.nombre);
    if (n !== 0) return n;
    return String(b.modificado).localeCompare(String(a.modificado));
  });
  return res;
}

/**
 * JSON de un caso, de todas sus carpetas y ramas, sin repetir idénticos.
 */
function indiceJsonDelCaso_(entradaCaso) {
  return entradaCaso ? indiceQuitarRepetidos_(entradaCaso.jsons) : [];
}

/**
 * Carpeta(s) de una fila para la columna "Carpeta copiada".
 *   1. Por ruta desde la raíz: [APIM/]Servicio/Caso y sus reenvíos Caso_N.
 *   2. De respaldo, por número de caso, solo en la rama de la fila (API o
 *      APIM dentro de APIM/; las demás, fuera).
 * No devuelve nada si la fila ya enlaza una carpeta de nuestra raíz en la
 * columna C o D.
 *
 * Devuelve { por: 'ruta' | 'numero' | null, carpetas: [info], yaEnlazada }.
 */
function indiceCarpetaDeFila_(fila, arbol, directorio) {
  var yaEnlazada = (fila.ids || []).some(function(id) { return !!arbol.carpetas[id]; });
  if (yaEnlazada) return { por: null, carpetas: [], yaEnlazada: true };

  var caso = indiceNormalizarCaso_(fila.caso);
  var entrada = caso ? directorio.porCaso[caso] : null;
  if (!entrada) return { por: null, carpetas: [], yaEnlazada: false };

  var rama = esComponenteAPIM(String(fila.componente || '').trim()) ? 'APIM' : 'General';
  var enRama = entrada.carpetas.filter(function(c) { return c.rama === rama; });

  var servicio = indiceLimpiarServicio_(fila.servicio);
  var largo = rama === 'APIM' ? 3 : 2;
  var porRuta = enRama.filter(function(c) {
    var s = c.segmentos;
    if (s.length !== largo || s[largo - 2] !== servicio) return false;
    return indiceNormalizarCaso_(indiceQuitarSufijo_(s[largo - 1])) === caso;
  });
  if (porRuta.length > 0) return { por: 'ruta', carpetas: porRuta, yaEnlazada: false };

  // Por número: solo las de más arriba (una subcarpeta con el mismo número
  // dentro de otra ya encontrada no se repite).
  var ids = {};
  enRama.forEach(function(c) { ids[c.id] = true; });
  var deArriba = enRama.filter(function(c) {
    var padre = arbol.carpetas[c.id][1];
    var vueltas = 0;
    while (padre && padre !== arbol.raizId && arbol.carpetas[padre] && vueltas < 60) {
      if (ids[padre]) return false;
      padre = arbol.carpetas[padre][1];
      vueltas++;
    }
    return true;
  });
  if (deArriba.length > 0) return { por: 'numero', carpetas: deArriba, yaEnlazada: false };
  return { por: null, carpetas: [], yaEnlazada: false };
}

/**
 * .json que cuelgan de una carpeta de nuestra raíz, en cualquier nivel.
 */
function indiceJsonBajoCarpeta_(arbol, carpetaId) {
  return (arbol.jsons || []).filter(function(j) {
    return indiceCadenaContiene_(j[2], carpetaId, arbol);
  }).map(function(j) {
    return { id: j[0], nombre: j[1], modificado: j[3] || '', md5: j[4] || '', conSufijo: false };
  });
}

function indiceCadenaContiene_(desdeId, buscadoId, arbol) {
  var actual = desdeId;
  var vueltas = 0;
  while (actual && vueltas < 60) {
    if (actual === buscadoId) return true;
    if (actual === arbol.raizId || !arbol.carpetas[actual]) return false;
    actual = arbol.carpetas[actual][1];
    vueltas++;
  }
  return false;
}

/**
 * Qué va en la columna N de una fila: los links de sus JSON o el motivo.
 *   1. JSON de todas las carpetas del caso en nuestra raíz.
 *   2. Si el caso no tiene carpeta: links de C y D. Si apuntan a nuestra
 *      raíz (copia con otro nombre), sus JSON; si son originales, los JSON
 *      encontrados en ellos.
 *   3. Si no hay JSON, el motivo.
 *
 * originales: resultado del recorrido de originales, o null si todavía no
 * se revisaron: { estados: { id: 'carpeta' | 'json' | 'sin_acceso' | 'otro' },
 *                 carpetas: { id: [nombre, padre] }, jsons: [[id, nombre, padre, mod, md5]] }
 *
 * Devuelve { links: [url], motivo: texto o null, fuente }, o { pendiente }
 * si la fila tiene originales que todavía no se revisaron.
 */
function indiceResultadoFila_(fila, arbol, directorio, originales) {
  var caso = indiceNormalizarCaso_(fila.caso);
  var entrada = caso ? directorio.porCaso[caso] : null;

  if (entrada && entrada.carpetas.length > 0) {
    var delCaso = indiceJsonDelCaso_(entrada);
    if (delCaso.length > 0) {
      return { links: delCaso.map(function(j) { return indiceUrlArchivo_(j.id); }), motivo: null, fuente: 'caso' };
    }
    return { links: [], motivo: INDICE_MOTIVOS.carpeta_sin_json, fuente: 'caso' };
  }

  var ids = fila.ids || [];
  var encontrados = [];
  var hayNuestra = false;
  var haySinAcceso = false;
  var hayOriginalLeido = false;
  var hayPendiente = false;
  ids.forEach(function(id) {
    if (arbol.carpetas[id]) {
      hayNuestra = true;
      encontrados = encontrados.concat(indiceJsonBajoCarpeta_(arbol, id));
      return;
    }
    var estado = originales ? originales.estados[id] : null;
    if (!estado) {
      hayPendiente = true;
      return;
    }
    if (estado === 'sin_acceso') {
      haySinAcceso = true;
      return;
    }
    hayOriginalLeido = true;
    (originales.jsons || []).forEach(function(j) {
      if (indiceOrigenDeJson_(j, originales).origenes.indexOf(id) === -1) return;
      encontrados.push({ id: j[0], nombre: j[1], modificado: j[3] || '', md5: j[4] || '', conSufijo: false });
    });
  });

  if (hayPendiente) return { pendiente: true, links: [], motivo: null, fuente: 'links' };

  var unicos = indiceQuitarRepetidos_(encontrados);
  if (unicos.length > 0) {
    return { links: unicos.map(function(j) { return indiceUrlArchivo_(j.id); }), motivo: null, fuente: 'links' };
  }
  var motivo;
  if (hayNuestra) motivo = INDICE_MOTIVOS.carpeta_sin_json;
  else if (haySinAcceso) motivo = INDICE_MOTIVOS.original_sin_acceso;
  else if (hayOriginalLeido) motivo = INDICE_MOTIVOS.original_sin_json;
  else motivo = INDICE_MOTIVOS.sin_carpeta_ni_link;
  return { links: [], motivo: motivo, fuente: 'links' };
}

// ── Recorrido de Drive ────────────────────────────────────────────────

/**
 * Hijos de una carpeta, una carpeta por consulta. `driveId` es la unidad
 * compartida de nuestra raíz; `todasLasUnidades` se usa para carpetas de
 * otras personas, que pueden estar en cualquier unidad.
 */
function indiceListarHijos_(carpetaId, driveId, todasLasUnidades) {
  var params = {
    q: "'" + carpetaId + "' in parents and trashed = false",
    fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum)',
    pageSize: 1000,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  };
  if (todasLasUnidades) {
    params.corpora = 'allDrives';
  } else if (driveId) {
    params.corpora = 'drive';
    params.driveId = driveId;
  } else {
    params.corpora = 'user';
  }
  var hijos = [];
  var token = null;
  do {
    if (token) params.pageToken = token;
    var resp = Drive.Files.list(params);
    hijos = hijos.concat(resp.files || []);
    token = resp.nextPageToken;
  } while (token);
  return hijos;
}

/**
 * Un paso del recorrido de originales: primero abre cada link pendiente
 * (carpeta, .json suelto, otro archivo o sin acceso) y después recorre las
 * carpetas con acceso, una por consulta. Devuelve false si Drive pidió
 * esperar; el paso queda para la próxima parte.
 */
function indiceAvanzarOriginal_(O, cuenta) {
  function agregarJson(id, nombre, padre, modificado, md5) {
    if (O.posJson[id] !== undefined) {
      if (padre && !O.jsons[O.posJson[id]][2]) O.jsons[O.posJson[id]][2] = padre;
      return;
    }
    O.posJson[id] = O.jsons.length;
    O.jsons.push([id, nombre, padre, modificado || '', md5 || '']);
    cuenta.jsons++;
  }

  if (O.pendientes.length > 0) {
    var id = O.pendientes.shift();
    var f;
    try {
      f = Drive.Files.get(id, { fields: 'id,name,mimeType,modifiedTime,md5Checksum', supportsAllDrives: true });
    } catch (err) {
      if (indiceEsLimiteDeCuota_(err)) {
        O.pendientes.unshift(id);
        return false;
      }
      O.estados[id] = 'sin_acceso';
      cuenta.revisados++;
      cuenta.sinAcceso++;
      return true;
    }
    cuenta.revisados++;
    cuenta.conAcceso++;
    if (f.mimeType === INDICE_CONFIG.CARPETA_MIME) {
      O.estados[id] = 'carpeta';
      if (!O.carpetas[id]) {
        O.carpetas[id] = [f.name, null];
        O.cola.push(id);
      }
    } else if (/\.json$/i.test(f.name || '')) {
      O.estados[id] = 'json';
      agregarJson(id, f.name, '', f.modifiedTime, f.md5Checksum);
    } else {
      O.estados[id] = 'otro';
    }
    return true;
  }

  if (O.cola.length > 0) {
    var carpetaId = O.cola.shift();
    var hijos;
    try {
      hijos = indiceListarHijos_(carpetaId, null, true);
    } catch (err) {
      if (indiceEsLimiteDeCuota_(err)) {
        O.cola.unshift(carpetaId);
        return false;
      }
      console.warn('[Indice] No se pudo listar una carpeta original: ' + err.message);
      return true;
    }
    hijos.forEach(function(h) {
      if (h.mimeType === INDICE_CONFIG.CARPETA_MIME) {
        if (!O.carpetas[h.id]) {
          O.carpetas[h.id] = [h.name, carpetaId];
          O.cola.push(h.id);
        } else if (O.carpetas[h.id][1] === null) {
          // Otro link apuntaba directo a esta subcarpeta: se engancha a su padre.
          O.carpetas[h.id][1] = carpetaId;
        }
      } else if (/\.json$/i.test(h.name || '')) {
        agregarJson(h.id, h.name, carpetaId, h.modifiedTime, h.md5Checksum);
      }
    });
    cuenta.carpetas++;
  }
  return true;
}

function indiceEsLimiteDeCuota_(err) {
  var msg = String(err && err.message || '');
  return /rate limit|quota|429|userRateLimitExceeded|backendError/i.test(msg);
}

// ── Escritura de las columnas N y O ───────────────────────────────────

// Columna O, a continuación de Archivos JSON (N). El envío y los reintentos
// no la usan.
var INDICE_COL_CARPETA = 15;

var INDICE_TITULO_CARPETA = 'Carpeta copiada';

function indiceEsLineaLink_(linea) {
  return /^https?:\/\/\S+$/i.test(String(linea).trim());
}

/**
 * Separa el contenido de una celda de la columna N en links (líneas que
 * son una URL) y motivos (cualquier otra línea con texto).
 */
function indiceAnalizarCeldaN_(texto) {
  var res = { links: [], motivos: [] };
  String(texto == null ? '' : texto).split('\n').forEach(function(linea) {
    var l = linea.trim();
    if (!l) return;
    if (indiceEsLineaLink_(l)) res.links.push(l);
    else res.motivos.push(l);
  });
  return res;
}

/**
 * Qué hacer con la celda N de una fila, según lo que ya tiene:
 *   vacía                → escribir el resultado (links o motivo)
 *   solo links           → no tocar
 *   links y motivo       → limpiar: dejar solo los links
 *   solo motivo          → no tocar, salvo al revisar avisos
 * Devuelve { accion: 'escribir' | 'limpiar' | 'nada', texto, tipo }.
 */
function indiceDecidirCeldaN_(textoActual, resultado, revisarAvisos) {
  var actual = indiceAnalizarCeldaN_(textoActual);
  if (actual.links.length > 0 && actual.motivos.length > 0) {
    return { accion: 'limpiar', texto: actual.links.join('\n'), tipo: 'limpiada' };
  }
  if (actual.links.length > 0) return { accion: 'nada', tipo: 'yaTenia' };
  var vacia = actual.motivos.length === 0;
  if (!vacia && !revisarAvisos) return { accion: 'nada', tipo: 'conMotivo' };
  if (!resultado || resultado.pendiente) return { accion: 'nada', tipo: 'pendiente' };
  if (resultado.links.length > 0) {
    return { accion: 'escribir', texto: resultado.links.join('\n'), tipo: 'links' };
  }
  if (!vacia && actual.motivos.join('\n') === resultado.motivo) {
    return { accion: 'nada', tipo: 'mismoMotivo' };
  }
  return { accion: 'escribir', texto: resultado.motivo, tipo: 'motivo' };
}

/**
 * Celda de la columna "Carpeta copiada": una línea por carpeta, cada una
 * con su link. Las encontradas solo por número de caso lo dicen.
 */
function indiceCeldaCarpeta_(carpetaDeFila) {
  var prefijo = carpetaDeFila.por === 'numero' ? 'Por número de caso: ' : '';
  var lineas = carpetaDeFila.carpetas.map(function(c) { return prefijo + c.ruta; });
  var builder = SpreadsheetApp.newRichTextValue().setText(lineas.join('\n'));
  var inicio = 0;
  carpetaDeFila.carpetas.forEach(function(c, i) {
    builder.setLinkUrl(inicio, inicio + lineas[i].length, indiceUrlCarpeta_(c.id));
    inicio += lineas[i].length + 1;
  });
  return builder.build();
}

/**
 * Escribe un bloque de filas en las columnas N y O con el lock tomado.
 * Antes de escribir vuelve a leer cada fila: si cambió de caso o servicio
 * (alguien ordenó o insertó filas) se salta. La columna O solo se escribe
 * si está vacía. Devuelve false si no consiguió el lock.
 *
 * bloque: [{ fila, caso, servicio, resultado, carpeta, soloCarpeta }]
 *   ordenado por fila, con resultado de indiceResultadoFila_ y carpeta de
 *   indiceCarpetaDeFila_. Con soloCarpeta la columna N no se mira.
 */
function indiceEscribirBloqueFilas_(ss, bloque, cuenta, revisarAvisos) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return false;
  try {
    var hoja = ss.getSheetByName(obtenerSheetTab());
    if (!hoja) throw new Error('No existe la pestaña de solicitudes configurada.');
    var ultima = hoja.getLastRow();
    var desde = bloque[0].fila;
    var hasta = Math.min(bloque[bloque.length - 1].fila, ultima);

    var datos = [];
    var columnaN = [];
    var columnaO = [];
    if (hasta >= desde) {
      var n = hasta - desde + 1;
      datos = hoja.getRange(desde, SHEET_COLS.NUMERO_CASO, n, 2).getValues();
      columnaN = hoja.getRange(desde, SHEET_COLS.ARCHIVOS_JSON, n, 1).getValues();
      columnaO = hoja.getRange(desde, INDICE_COL_CARPETA, n, 1).getValues();
    }

    var cambiosN = [];
    var cambiosO = [];
    bloque.forEach(function(t) {
      var i = t.fila - desde;
      if (t.fila > hasta ||
          String(datos[i][0] || '').trim() !== t.caso ||
          String(datos[i][1] || '') !== t.servicio) {
        cuenta.cambiaron = (cuenta.cambiaron || 0) + 1;
        return;
      }
      if (!t.soloCarpeta) {
        var decision = indiceDecidirCeldaN_(columnaN[i][0], t.resultado, revisarAvisos);
        if (decision.accion !== 'nada') {
          cambiosN.push({ fila: t.fila, valor: construirCeldaConEnlaces(decision.texto) });
        }
        cuenta[decision.tipo] = (cuenta[decision.tipo] || 0) + 1;
      }

      if (t.carpeta && t.carpeta.carpetas.length > 0 && String(columnaO[i][0] || '').trim() === '') {
        cambiosO.push({ fila: t.fila, valor: indiceCeldaCarpeta_(t.carpeta) });
        cuenta.carpetas = (cuenta.carpetas || 0) + 1;
      }
    });

    if (cambiosN.length > 0) {
      indiceTituloSiFalta_(hoja, SHEET_COLS.ARCHIVOS_JSON, SHEET_HEADERS[SHEET_COLS.ARCHIVOS_JSON - 1]);
      indiceEscribirTramos_(hoja, SHEET_COLS.ARCHIVOS_JSON, cambiosN);
    }
    if (cambiosO.length > 0) {
      indiceTituloSiFalta_(hoja, INDICE_COL_CARPETA, INDICE_TITULO_CARPETA);
      indiceEscribirTramos_(hoja, INDICE_COL_CARPETA, cambiosO);
    }
    if (cambiosN.length > 0 || cambiosO.length > 0) SpreadsheetApp.flush();
    return true;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Título en la fila 1 de una columna, solo si la fila 1 tiene encabezados
 * (A1 con texto) y esa celda está vacía.
 */
function indiceTituloSiFalta_(hoja, col, titulo) {
  var celda = hoja.getRange(1, col);
  if (String(hoja.getRange(1, 1).getValue()).trim() !== '' &&
      String(celda.getValue()).trim() === '') {
    celda.setValue(titulo).setFontWeight('bold');
  }
}

/**
 * Escribe valores enriquecidos en una columna; las filas seguidas van juntas.
 */
function indiceEscribirTramos_(hoja, col, cambios) {
  var tramo = [];
  function escribir() {
    if (tramo.length === 0) return;
    hoja.getRange(tramo[0].fila, col, tramo.length, 1)
      .setRichTextValues(tramo.map(function(c) { return [c.valor]; }));
    tramo = [];
  }
  cambios.forEach(function(c) {
    if (tramo.length > 0 && c.fila !== tramo[tramo.length - 1].fila + 1) escribir();
    tramo.push(c);
  });
  escribir();
}

/**
 * Formato de las columnas N y O desde la fila 2: el texto se recorta dentro
 * de su celda (no se desborda ni cambia la altura de la fila) y se alinea a
 * la izquierda. Solo formato.
 */
function indiceFormatoColumnas_(hoja) {
  var ultima = Math.max(hoja.getLastRow(), 2);
  hoja.getRange(2, SHEET_COLS.ARCHIVOS_JSON, ultima - 1, 2)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
    .setHorizontalAlignment('left');
}

// ── Pestaña "JSON sin fila" ───────────────────────────────────────────

var INDICE_PESTANA_SIN_FILA = 'JSON sin fila';

var INDICE_ENCABEZADOS_SIN_FILA = ['Archivo', 'Ruta', 'Modificado', 'Número en la ruta', 'Por qué no tiene fila'];

/**
 * JSON de nuestra raíz que ninguna fila usa: ninguna carpeta de su ruta
 * tiene un número de caso que exista en el Sheet, y ninguna fila enlaza en
 * C o D una carpeta que lo contenga (ni al archivo). Un archivo repetido en
 * dos carpetas aparece dos veces: son dos ubicaciones. Ordenado por ruta.
 */
function indiceJsonSinFila_(arbol, directorio, filas) {
  var casos = {};
  var enlazados = {};
  filas.forEach(function(f) {
    var c = indiceNormalizarCaso_(f.caso);
    if (c) casos[c] = true;
    (f.ids || []).forEach(function(id) { enlazados[id] = true; });
  });

  var lista = [];
  (arbol.jsons || []).forEach(function(j) {
    var numeros = directorio.casosDeJson[j[0]] || [];
    if (numeros.some(function(n) { return casos[n]; })) return;
    if (enlazados[j[0]]) return;
    var actual = j[2];
    var vueltas = 0;
    while (actual && actual !== arbol.raizId && arbol.carpetas[actual] && vueltas < 60) {
      if (enlazados[actual]) return;
      actual = arbol.carpetas[actual][1];
      vueltas++;
    }
    var cadena = indiceCadena_(j[2], arbol.raizId, arbol.carpetas) || [];
    var motivo;
    if (numeros.length === 1) motivo = 'Ninguna fila tiene el caso ' + numeros[0];
    else if (numeros.length > 1) motivo = 'Ninguna fila tiene los casos ' + numeros.join(', ');
    else motivo = 'La carpeta no tiene número de caso y ninguna fila la enlaza';
    lista.push({
      id: j[0],
      nombre: j[1],
      ruta: cadena.map(function(c) { return c.nombre; }).join('/') || '(carpeta raíz)',
      modificado: j[3] || '',
      numeros: numeros.join(', '),
      motivo: motivo
    });
  });
  lista.sort(function(a, b) {
    var r = a.ruta.localeCompare(b.ruta);
    return r !== 0 ? r : a.nombre.localeCompare(b.nombre);
  });
  return lista;
}

/**
 * Escribe la pestaña "JSON sin fila": la crea si no existe, borra su
 * contenido y escribe la lista actual con filtro.
 */
function indiceEscribirSinFila_(ss, lista) {
  var hoja = ss.getSheetByName(INDICE_PESTANA_SIN_FILA) || ss.insertSheet(INDICE_PESTANA_SIN_FILA);
  var filtro = hoja.getFilter();
  if (filtro) filtro.remove();
  hoja.clearContents();

  var nCols = INDICE_ENCABEZADOS_SIN_FILA.length;
  hoja.getRange(1, 1, 1, nCols).setValues([INDICE_ENCABEZADOS_SIN_FILA]).setFontWeight('bold');
  hoja.setFrozenRows(1);
  if (lista.length === 0) {
    hoja.getRange(2, 1).setValue('Todos los JSON de la carpeta raíz están relacionados con alguna fila.');
    return;
  }

  hoja.getRange(2, 1, lista.length, nCols).setValues(lista.map(function(s) {
    return ['', sanitizarParaSheet(s.ruta), s.modificado ? new Date(s.modificado) : '',
      s.numeros || '(ninguno)', s.motivo];
  }));
  hoja.getRange(2, 1, lista.length, 1).setRichTextValues(lista.map(function(s) {
    return [SpreadsheetApp.newRichTextValue().setText(s.nombre).setLinkUrl(indiceUrlArchivo_(s.id)).build()];
  }));
  hoja.getRange(2, 3, lista.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  hoja.getRange(1, 1, lista.length + 1, nCols).createFilter();
}

// ── Búsqueda por filas ────────────────────────────────────────────────
//
// Una ejecución recorre la raíz (en memoria), lee el Sheet y resuelve las
// filas de arriba hacia abajo, escribiendo cada bloque. El avance es la
// propia columna N: la siguiente ejecución empieza en la primera N vacía.
// Lo único que se guarda es una nota corta por Sheet en las propiedades del
// proyecto (compartidas por todos los usuarios, no se ven en el Sheet ni en
// Drive): turno, modo, fila para "revisar avisos" y contadores.

var INDICE_BUSQUEDA = {
  PREFIJO_NOTA: 'INDICE_NOTA_',
  MARGEN_FILA_MS: 15000,
  REINTENTOS_LOCK: 3,
  HANDLER: 'continuarBusquedaJson',
  PRESUPUESTO_MS: 5 * 60 * 1000,
  MAX_PARTES: 20,
  // Si Google rechaza programar la parte siguiente por el límite de una vez
  // por hora, se programa para dentro de este tiempo.
  ESPERA_HORA_MS: 61 * 60 * 1000
};

function indiceLeerNota_(sheetId) {
  var texto = PropertiesService.getScriptProperties().getProperty(INDICE_BUSQUEDA.PREFIJO_NOTA + sheetId);
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch (err) {
    return null;
  }
}

function indiceGuardarNota_(sheetId, nota) {
  PropertiesService.getScriptProperties().setProperty(INDICE_BUSQUEDA.PREFIJO_NOTA + sheetId, JSON.stringify(nota));
}

/**
 * Filas del Sheet con lo necesario para buscar y escribir: caso, servicio,
 * componente, links de C y D, y el texto actual de N y O.
 */
function indiceLeerFilasCompletas_(hoja) {
  var ultima = hoja.getLastRow();
  if (ultima < 2) return [];
  var n = ultima - 1;
  var valores = hoja.getRange(2, 1, n, SHEET_NUM_COLS).getValues();
  var columnaO = hoja.getRange(2, INDICE_COL_CARPETA, n, 1).getValues();
  var richC = hoja.getRange(2, SHEET_COLS.DRIVE, n, 1).getRichTextValues();
  var richD = hoja.getRange(2, SHEET_COLS.REPOSITORIO, n, 1).getRichTextValues();
  var filas = [];
  for (var i = 0; i < n; i++) {
    var v = valores[i];
    var caso = String(v[SHEET_COLS.NUMERO_CASO - 1] || '').trim();
    if (!caso) continue;
    filas.push({
      fila: i + 2,
      caso: caso,
      servicio: String(v[SHEET_COLS.SERVICIO - 1] || ''),
      componente: String(v[SHEET_COLS.COMPONENTE - 1] || ''),
      ids: indiceIdsDeCelda_(richC[i][0]).concat(indiceIdsDeCelda_(richD[i][0])),
      textoN: String(v[SHEET_COLS.ARCHIVOS_JSON - 1] || ''),
      textoO: String(columnaO[i][0] || '')
    });
  }
  return filas;
}

/**
 * Qué filas trabajar, de arriba hacia abajo:
 *   normal: N vacía (buscar) o mixta, con links y motivo (limpiar).
 *   revisar: N con solo motivo, desde la fila indicada.
 * Además, cualquier fila con la O vacía cuya carpeta se encontró (no
 * necesita Drive). Devuelve [{ fila, necesitaN, soloCarpeta, ... }].
 */
function indiceElegirFilas_(filas, modo, desdeFila, carpetaDe) {
  var lista = [];
  filas.forEach(function(f) {
    var celda = indiceAnalizarCeldaN_(f.textoN);
    var mixta = celda.links.length > 0 && celda.motivos.length > 0;
    var necesitaN;
    if (modo === 'revisar') {
      necesitaN = celda.links.length === 0 && celda.motivos.length > 0 && f.fila >= (desdeFila || 0);
    } else {
      necesitaN = celda.links.length === 0 && celda.motivos.length === 0;
    }
    var carpeta = carpetaDe ? carpetaDe(f) : null;
    var necesitaO = !!(carpeta && carpeta.carpetas.length > 0 && !String(f.textoO).trim());
    if (!necesitaN && !mixta && !necesitaO) return;
    lista.push({
      fila: f.fila,
      caso: f.caso,
      servicio: f.servicio,
      componente: f.componente,
      ids: f.ids,
      necesitaN: necesitaN,
      limpiar: mixta,
      soloCarpeta: !necesitaN && !mixta,
      carpeta: carpeta
    });
  });
  return lista;
}

/**
 * Recorre toda la raíz, una carpeta por consulta, y la deja en memoria.
 * Si Drive pide esperar, espera y reintenta la misma carpeta.
 */
function indiceRecorrerRaiz_(raizId, quedaMs) {
  var raiz = Drive.Files.get(raizId, { fields: 'id,driveId', supportsAllDrives: true });
  var arbol = { raizId: raizId, carpetas: {}, jsons: [], errores: 0, completo: true };
  var cola = [raizId];
  var esperas = 0;
  while (cola.length > 0) {
    if (quedaMs() < INDICE_BUSQUEDA.MARGEN_FILA_MS) {
      arbol.completo = false;
      break;
    }
    var carpetaId = cola.shift();
    var hijos;
    try {
      hijos = indiceListarHijos_(carpetaId, raiz.driveId || '');
    } catch (err) {
      if (indiceEsLimiteDeCuota_(err) && esperas < 5) {
        esperas++;
        cola.unshift(carpetaId);
        Utilities.sleep(2000 * esperas);
        continue;
      }
      arbol.errores++;
      console.warn('[Indice] No se pudo listar una carpeta: ' + err.message);
      continue;
    }
    hijos.forEach(function(h) {
      if (h.mimeType === INDICE_CONFIG.CARPETA_MIME) {
        arbol.carpetas[h.id] = [h.name, carpetaId];
        cola.push(h.id);
      } else if (/\.json$/i.test(h.name || '')) {
        arbol.jsons.push([h.id, h.name, carpetaId, h.modifiedTime || '', h.md5Checksum || '']);
      }
    });
  }
  return arbol;
}

/**
 * Revisa los links originales de una fila que todavía no se miraron en
 * esta ejecución. Devuelve false si se acabó el tiempo antes de terminar.
 */
function indiceRevisarOriginalesDeFila_(fila, arbol, originales, cuentaO, quedaMs) {
  fila.ids.forEach(function(id) {
    if (arbol.carpetas[id] || originales.estados[id] || originales.pendientes.indexOf(id) !== -1) return;
    originales.pendientes.push(id);
  });
  var esperas = 0;
  while (originales.pendientes.length > 0 || originales.cola.length > 0) {
    if (quedaMs() < INDICE_BUSQUEDA.MARGEN_FILA_MS) return false;
    if (!indiceAvanzarOriginal_(originales, cuentaO)) {
      if (esperas >= 5) return false;
      esperas++;
      Utilities.sleep(2000 * esperas);
    }
  }
  return true;
}

/**
 * Una ejecución de la búsqueda. modo: 'normal' (filas con la N vacía) o
 * 'revisar' (filas con solo motivo, desde la fila guardada en la nota).
 *
 * Devuelve { ocupado, nota } si otra búsqueda tiene el turno, o
 * { terminado, nota, cuenta } al terminar la ejecución.
 */
function indiceCorrerBusqueda_(sheetId, presupuestoMs, modo) {
  var inicio = Date.now();
  function quedaMs() { return presupuestoMs - (Date.now() - inicio); }
  var ss = SpreadsheetApp.openById(sheetId);
  var hoja = ss.getSheetByName(obtenerSheetTab());
  if (!hoja) throw new Error('No existe la pestaña de solicitudes configurada.');
  var raizId = obtenerCarpetaRaizId();
  if (!raizId) throw new Error('No hay carpeta raíz configurada.');

  // Turno: una sola búsqueda a la vez por Sheet, aunque la lancen dos personas.
  var nota;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ocupado: true, nota: indiceLeerNota_(sheetId) };
  try {
    nota = indiceLeerNota_(sheetId);
    if (nota && nota.ocupadoHasta > Date.now()) return { ocupado: true, nota: nota };
    var nueva = !nota || nota.etapa === 'terminado' || nota.modo !== modo;
    if (nueva) {
      nota = {
        modo: modo,
        etapa: 'buscando',
        iniciadoEn: inicio,
        partes: 0,
        fila: 0,
        filaActual: 0,
        ultimaFila: 0,
        cuenta: {}
      };
    }
    nota.partes++;
    nota.ocupadoHasta = inicio + presupuestoMs + 60000;
    nota.parteIniciadaEn = inicio;
    nota.ultimoError = '';
    indiceGuardarNota_(sheetId, nota);
  } finally {
    lock.releaseLock();
  }

  var cuenta = nota.cuenta;
  var cortado = false;
  try {
    var inicioRaiz = Date.now();
    var arbol = indiceRecorrerRaiz_(raizId, quedaMs);
    console.log('[Indice] Raíz recorrida: ' + Object.keys(arbol.carpetas).length + ' carpetas, ' +
      arbol.jsons.length + ' JSON, en ' + formatearDuracionIndice_(Date.now() - inicioRaiz) +
      (arbol.completo ? '' : ' (incompleta)'));
    if (!arbol.completo) {
      throw new Error('La carpeta raíz es demasiado grande para recorrerla en una parte (se revisaron ' +
        Object.keys(arbol.carpetas).length + ' carpetas en ' + formatearDuracionIndice_(Date.now() - inicioRaiz) +
        '). Avisar para ajustar la búsqueda.');
    }
    cuenta.erroresDrive = arbol.errores;
    var directorio = indiceDirectorioPorCaso_(arbol);
    var filas = indiceLeerFilasCompletas_(hoja);
    nota.ultimaFila = filas.length ? filas[filas.length - 1].fila : 0;

    var lista = indiceElegirFilas_(filas, modo, nota.fila, function(f) {
      return indiceCarpetaDeFila_(f, arbol, directorio);
    });

    var originales = { estados: {}, carpetas: {}, jsons: [], posJson: {}, pendientes: [], cola: [] };
    var cuentaO = { revisados: 0, conAcceso: 0, sinAcceso: 0, carpetas: 0, jsons: 0 };
    var bloque = [];

    var escribirBloque = function() {
      if (bloque.length === 0) return true;
      for (var intento = 0; intento < INDICE_BUSQUEDA.REINTENTOS_LOCK; intento++) {
        if (indiceEscribirBloqueFilas_(ss, bloque, cuenta, modo === 'revisar')) {
          nota.filaActual = bloque[bloque.length - 1].fila;
          if (modo === 'revisar') nota.fila = nota.filaActual + 1;
          bloque = [];
          return true;
        }
        Utilities.sleep(2000);
      }
      return false;
    };

    for (var k = 0; k < lista.length; k++) {
      if (quedaMs() < INDICE_BUSQUEDA.MARGEN_FILA_MS) {
        cortado = true;
        break;
      }
      var item = lista[k];
      var resultado = null;
      if (item.necesitaN) {
        resultado = indiceResultadoFila_(item, arbol, directorio, originales);
        if (resultado.pendiente) {
          if (!indiceRevisarOriginalesDeFila_(item, arbol, originales, cuentaO, quedaMs)) {
            cortado = true;
            break;
          }
          resultado = indiceResultadoFila_(item, arbol, directorio, originales);
        }
      }
      bloque.push({
        fila: item.fila,
        caso: item.caso,
        servicio: item.servicio,
        resultado: resultado,
        carpeta: item.carpeta,
        soloCarpeta: item.soloCarpeta
      });
      if (bloque.length >= INDICE_CONFIG.BLOQUE_N && !escribirBloque()) {
        cortado = true;
        break;
      }
    }
    if (!escribirBloque()) cortado = true;

    cuenta.originalesRevisados = (cuenta.originalesRevisados || 0) + cuentaO.revisados;
    if (!cortado) {
      indiceFormatoColumnas_(hoja);
      var sinFila = indiceJsonSinFila_(arbol, directorio, filas);
      indiceEscribirSinFila_(ss, sinFila);
      cuenta.sinFila = sinFila.length;
      nota.etapa = 'terminado';
      nota.terminadoEn = Date.now();
      nota.fila = 0;
    }
  } catch (err) {
    console.error('[Indice] Error en la búsqueda: ' + err.message);
    nota.ultimoError = String(err.message || err).substring(0, 300);
    cortado = true;
  } finally {
    nota.ocupadoHasta = 0;
    nota.cuenta = cuenta;
    indiceGuardarNota_(sheetId, nota);
  }

  console.log('[Indice] Búsqueda (' + modo + '), parte ' + nota.partes + ': hasta la fila ' +
    nota.filaActual + ' de ' + nota.ultimaFila + (cortado ? ', sigue en otra parte' : ', terminada'));
  return { terminado: !cortado && !nota.ultimoError, nota: nota, cuenta: cuenta };
}

// ── Activadores de la búsqueda ────────────────────────────────────────
//
// Mismo esquema que Reintentos.gs: el botón solo prepara y programa; cada
// parte corre en su activador y, al terminar, borra su propio activador y
// enseguida programa el siguiente si falta (sin crear otro si ya hay uno
// esperando). Si Google lo rechaza por el límite de una vez por hora, se
// programa a la hora y la tarjeta ofrece seguir desde el panel.

/**
 * Deja la nota lista para una búsqueda en el modo pedido. Si ya había una
 * a medias en el mismo modo, la retoma (el avance está en la columna N).
 * Devuelve { ocupado, nota } o { nota }.
 */
function indicePrepararBusqueda_(sheetId, modo) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ocupado: true, nota: indiceLeerNota_(sheetId) };
  try {
    var nota = indiceLeerNota_(sheetId);
    if (nota && nota.ocupadoHasta > Date.now()) return { ocupado: true, nota: nota };
    var retomar = nota && nota.modo === modo && (nota.etapa === 'buscando' || nota.etapa === 'detenido');
    if (retomar) {
      // Detenida (tope de partes o sin avance): el tope vuelve a contar.
      if (nota.etapa === 'detenido') nota.partes = 0;
      nota.etapa = 'buscando';
      nota.ultimoError = '';
    } else {
      nota = {
        modo: modo,
        etapa: 'buscando',
        iniciadoEn: Date.now(),
        partes: 0,
        fila: 0,
        filaActual: 0,
        ultimaFila: 0,
        cuenta: {}
      };
    }
    nota.activador = null;
    indiceGuardarNota_(sheetId, nota);
    return { nota: nota };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Cambia campos de la nota con el lock tomado, sin pisar lo que otra
 * ejecución haya guardado en otros campos.
 */
function indiceActualizarNota_(sheetId, cambios) {
  var lock = LockService.getScriptLock();
  var conLock = lock.tryLock(10000);
  try {
    var nota = indiceLeerNota_(sheetId) || {};
    Object.keys(cambios).forEach(function(k) { nota[k] = cambios[k]; });
    indiceGuardarNota_(sheetId, nota);
    return nota;
  } finally {
    if (conLock) lock.releaseLock();
  }
}

function indiceHayActivadorBusqueda_() {
  try {
    return ScriptApp.getProjectTriggers().some(function(t) {
      return t.getHandlerFunction() === INDICE_BUSQUEDA.HANDLER;
    });
  } catch (err) {
    return false;
  }
}

/**
 * Programa la parte siguiente. desde: 'panel' o 'activador' (se anota para
 * saber de qué contexto acepta Google programar). Respeta el cupo de
 * activadores que comparte con reintentos (solo los cuenta).
 * Devuelve el estado anotado en la nota.
 */
function indiceProgramarBusqueda_(sheetId, desde) {
  var activador;
  // Desde el panel (acción del usuario) se reemplaza el que haya, por
  // ejemplo uno programado a la hora; desde un activador no se crea otro.
  if (desde === 'panel') {
    try {
      ScriptApp.getProjectTriggers().forEach(function(t) {
        if (t.getHandlerFunction() === INDICE_BUSQUEDA.HANDLER) ScriptApp.deleteTrigger(t);
      });
    } catch (err) {
      console.log('[Indice] No se pudo borrar el activador anterior: ' + err.message);
    }
  }
  if (indiceHayActivadorBusqueda_()) {
    activador = { estado: 'ya_hay_uno', desde: desde, en: Date.now() };
  } else if (contarTriggersActivos() >= REINTENTOS_CONFIG.MAX_TRIGGERS_ACTIVOS) {
    activador = {
      estado: 'sin_cupo',
      desde: desde,
      en: Date.now(),
      detalle: 'ya hay ' + contarTriggersActivos() + ' activadores de tiempo en uso'
    };
  } else {
    try {
      ScriptApp.newTrigger(INDICE_BUSQUEDA.HANDLER).timeBased()
        .after(REINTENTOS_CONFIG.DELAY_TRIGGER_MS).create();
      activador = { estado: 'programado', desde: desde, en: Date.now() };
    } catch (err) {
      var detalle = String(err.message || err).substring(0, 200);
      console.warn('[Indice] Google rechazó programar la parte siguiente (' + desde + '): ' + detalle);
      if (/hour/i.test(detalle)) {
        try {
          ScriptApp.newTrigger(INDICE_BUSQUEDA.HANDLER).timeBased()
            .after(INDICE_BUSQUEDA.ESPERA_HORA_MS).create();
          activador = {
            estado: 'a_la_hora',
            desde: desde,
            en: Date.now() + INDICE_BUSQUEDA.ESPERA_HORA_MS,
            detalle: detalle
          };
        } catch (err2) {
          activador = { estado: 'error', desde: desde, en: Date.now(), detalle: String(err2.message || err2).substring(0, 200) };
        }
      } else {
        activador = { estado: 'error', desde: desde, en: Date.now(), detalle: detalle };
      }
    }
  }
  console.log('[Indice] Parte siguiente (' + desde + '): ' + activador.estado);
  indiceActualizarNota_(sheetId, { activador: activador });
  return activador;
}

/**
 * Qué hacer al final de una parte (solo calcula):
 *   'nada'      terminó, u otra parte tiene el turno y programará ella
 *   'programar' quedan filas y la parte avanzó
 *   'parar'     se llegó al tope de partes, o la parte no avanzó
 */
function indiceDecidirSiguiente_(res, filaAntes, maxPartes) {
  if (!res || res.ocupado || res.terminado || res.sinBusqueda) return { accion: 'nada' };
  var nota = res.nota || {};
  if (nota.partes >= maxPartes) {
    return { accion: 'parar', motivo: 'Se llegó al tope de ' + maxPartes + ' partes.' };
  }
  if (nota.filaActual === filaAntes) {
    return {
      accion: 'parar',
      motivo: nota.ultimoError
        ? 'La búsqueda se detuvo por un error: ' + nota.ultimoError
        : 'La búsqueda no avanzó en la última parte.'
    };
  }
  return { accion: 'programar' };
}

function indiceBorrarActivadorActual_(e) {
  var uid = e && e.triggerUid;
  if (!uid) return;
  try {
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getUniqueId() === uid) ScriptApp.deleteTrigger(t);
    });
  } catch (err) {
    console.log('[Indice] No se pudo borrar el activador propio: ' + err.message);
  }
}

/**
 * Handler del activador de la búsqueda: hace una parte y, como en los
 * reintentos, al final borra su propio activador y programa el siguiente.
 */
function continuarBusquedaJson(e) {
  console.log('[Indice] Activador disparado');
  var sheetId = PropertiesService.getUserProperties().getProperty('INDICE_SHEET_ID') || obtenerSheetId();
  var nota = sheetId ? indiceLeerNota_(sheetId) : null;
  if (!nota || nota.etapa !== 'buscando') {
    console.log('[Indice] No hay una búsqueda en curso; nada que hacer');
    indiceBorrarActivadorActual_(e);
    return;
  }

  var filaAntes = nota.filaActual;
  var res;
  try {
    res = indiceCorrerBusqueda_(sheetId, INDICE_BUSQUEDA.PRESUPUESTO_MS, nota.modo);
  } catch (err) {
    console.error('[Indice] ' + err.message);
    res = { nota: indiceActualizarNota_(sheetId, { ultimoError: String(err.message || err).substring(0, 300) }) };
  }
  if (res.ocupado) console.log('[Indice] Otra parte tiene el turno; esta termina sin hacer nada');

  indiceBorrarActivadorActual_(e);
  var decision = indiceDecidirSiguiente_(res, filaAntes, INDICE_BUSQUEDA.MAX_PARTES);
  if (decision.accion === 'programar') {
    indiceProgramarBusqueda_(sheetId, 'activador');
  } else if (decision.accion === 'parar') {
    console.warn('[Indice] ' + decision.motivo);
    indiceActualizarNota_(sheetId, { etapa: 'detenido', ultimoError: decision.motivo, activador: null });
  } else if (res.terminado) {
    indiceActualizarNota_(sheetId, { activador: null });
  }
}

// ── Tarjeta de la búsqueda ────────────────────────────────────────────

var INDICE_NOMBRE_MODO = { normal: 'Buscar JSON', revisar: 'Revisar avisos' };

var INDICE_TEXTO_ESTADO_ACTIVADOR = {
  programado: 'programada',
  a_la_hora: 'programada a la hora (Google no dejó antes)',
  ya_hay_uno: 'ya había una esperando',
  sin_cupo: 'sin cupo de activadores',
  error: 'no se pudo programar'
};

/**
 * Resumen de los contadores de una búsqueda, una línea por dato que tenga
 * algo.
 */
function indiceTextoCuenta_(cuenta) {
  var c = cuenta || {};
  var lineas = [];
  function agregar(valor, texto) {
    if (valor) lineas.push(valor + ' ' + texto);
  }
  agregar(c.links, 'fila(s) con JSON');
  agregar(c.motivo, 'fila(s) con el motivo de por qué no hay JSON');
  agregar(c.limpiada, 'celda(s) limpiadas (tenían un motivo viejo y links)');
  agregar(c.carpetas, 'fila(s) con su carpeta en la columna O');
  agregar(c.cambiaron, 'fila(s) saltadas porque cambiaron mientras corría');
  agregar(c.sinFila, 'JSON sin fila (ver la pestaña "' + INDICE_PESTANA_SIN_FILA + '")');
  agregar(c.erroresDrive, 'carpeta(s) de Drive que no se pudieron leer');
  return lineas.join('<br>');
}

/**
 * Una línea de estado para el menú del panel.
 */
function textoCortoBusquedaJson_() {
  var sheetId = obtenerSheetId();
  var nota = sheetId ? indiceLeerNota_(sheetId) : null;
  if (!nota) return 'Todavía no se ha buscado.';
  var c = nota.cuenta || {};
  if (nota.etapa === 'terminado') {
    return '✅ Última búsqueda: ' + formatearFechaIndice_(nota.terminadoEn) + ' · ' +
      (c.links || 0) + ' con JSON · ' + (c.motivo || 0) + ' con motivo';
  }
  if (nota.etapa === 'detenido') return '⚠️ La búsqueda se detuvo. Entra para continuar.';
  return '⏳ Buscando: va en la fila ' + (nota.filaActual || 0) + ' de ' + (nota.ultimaFila || '?');
}

/**
 * Tarjeta "JSON de las solicitudes": estado de la búsqueda (sale de la nota
 * compartida, así que todos ven lo mismo), resumen y botones.
 */
function buildBusquedaJsonCard_() {
  var sheetId = obtenerSheetId();
  var nota = sheetId ? indiceLeerNota_(sheetId) : null;
  var ahora = Date.now();
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('JSON de las solicitudes')
        .setSubtitle('Columnas N (JSON) y O (carpeta copiada)')
    );

  var estado = CardService.newCardSection();
  var botones = CardService.newButtonSet();
  function boton(texto, funcion, principal) {
    var b = CardService.newTextButton()
      .setText(texto)
      .setOnClickAction(CardService.newAction().setFunctionName(funcion));
    if (principal) b.setTextButtonStyle(CardService.TextButtonStyle.FILLED).setBackgroundColor('#1a73e8');
    botones.addButton(b);
  }
  function parrafo(html) {
    estado.addWidget(CardService.newTextParagraph().setText(html));
  }
  function rojo(html) {
    return '<font color="#d93025">' + html + '</font>';
  }

  var corriendo = !!(nota && nota.ocupadoHasta > ahora);
  var avance = nota && nota.partes > 0
    ? 'Va en la fila <b>' + (nota.filaActual || 0) + '</b> de ' + (nota.ultimaFila || '?') +
      ' · parte ' + nota.partes + ' · ' + INDICE_NOMBRE_MODO[nota.modo]
    : (nota ? INDICE_NOMBRE_MODO[nota.modo] : '');

  if (!nota) {
    parrafo('Busca los JSON de cada fila y los escribe en la columna <b>N</b>. Si no hay, escribe el motivo. ' +
      'En la columna <b>O</b> pone el link a nuestra carpeta copiada cuando la columna C no lo tiene.<br>' +
      '<i>Trabaja solo en segundo plano; el avance se ve en la columna N.</i>');
    boton('Buscar JSON', 'onBuscarJson', true);
    boton('Revisar avisos', 'onRevisarAvisosJson', false);
  } else if (corriendo) {
    parrafo('⏳ <b>Buscando</b>: la parte ' + nota.partes + ' empezó a las ' +
      formatearHoraIndice_(nota.parteIniciadaEn) + ' (hace ' + formatearDuracionIndice_(ahora - nota.parteIniciadaEn) + ').<br>' + avance);
    boton('Ver avance', 'onVerAvanceBusquedaJson', false);
  } else if (nota.etapa === 'buscando') {
    var act = nota.activador;
    var texto;
    var ofrecerContinuar = true;
    if (!act) {
      texto = '⏸️ <b>En pausa.</b> Presiona "Continuar" para seguir.';
    } else if (act.estado === 'a_la_hora') {
      texto = '⏱️ <b>La parte ' + (nota.partes + 1) + ' quedó para las ' + formatearHoraIndice_(act.en) +
        '</b> (Google no dejó programarla antes). Para seguir ya, presiona "Continuar".';
    } else if (act.estado === 'programado' || act.estado === 'ya_hay_uno') {
      if (ahora - act.en < INDICE_CONFIG.ESPERA_ACTIVADOR_MS) {
        texto = '⏱️ <b>La parte ' + (nota.partes + 1) + ' arranca sola en unos segundos.</b>';
        ofrecerContinuar = false;
      } else {
        texto = rojo('⚠️ <b>La parte ' + (nota.partes + 1) + ' se programó a las ' + formatearHoraIndice_(act.en) +
          ' y no ha arrancado.</b> Presiona "Continuar".');
      }
    } else {
      texto = rojo('⚠️ <b>No se pudo programar la parte siguiente</b>: ' + escaparHtml(act.detalle || act.estado));
    }
    parrafo(texto + '<br>' + avance);
    if (ofrecerContinuar) boton('Continuar', 'onContinuarBusquedaJson', true);
    boton('Ver avance', 'onVerAvanceBusquedaJson', false);
  } else if (nota.etapa === 'detenido') {
    parrafo(rojo('⚠️ <b>La búsqueda se detuvo.</b> ' + escaparHtml(nota.ultimoError || '')) + '<br>' + avance);
    boton('Continuar', 'onContinuarBusquedaJson', true);
    boton('Ver avance', 'onVerAvanceBusquedaJson', false);
  } else {
    parrafo('✅ <b>' + INDICE_NOMBRE_MODO[nota.modo] + ' terminó el ' + formatearFechaIndice_(nota.terminadoEn) +
      '</b>, en ' + nota.partes + ' parte' + (nota.partes === 1 ? '' : 's') + '.');
    boton('Buscar JSON', 'onBuscarJson', true);
    boton('Revisar avisos', 'onRevisarAvisosJson', false);
    var url = indiceUrlPestanaSinFila_(sheetId);
    if (url) {
      botones.addButton(CardService.newTextButton().setText('Abrir "JSON sin fila"')
        .setOpenLink(CardService.newOpenLink().setUrl(url)));
    }
  }

  var resumen = nota ? indiceTextoCuenta_(nota.cuenta) : '';
  if (resumen) parrafo(resumen);
  if (nota && nota.ultimoError && nota.etapa !== 'detenido') {
    parrafo(rojo('Último error: ' + escaparHtml(nota.ultimoError)));
  }
  if (nota && !corriendo && nota.etapa !== 'terminado') {
    parrafo('<i>Esta tarjeta no se refresca sola: usa "Ver avance". El avance también se ve en la columna N.</i>');
  }
  estado.addWidget(botones);
  card.addSection(estado);

  var activos = 0;
  var deBusqueda = 0;
  try {
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getEventType() !== ScriptApp.EventType.CLOCK) return;
      activos++;
      if (t.getHandlerFunction() === INDICE_BUSQUEDA.HANDLER) deBusqueda++;
    });
  } catch (err) {
    activos = -1;
  }
  card.addSection(
    CardService.newCardSection()
      .setHeader('Activadores')
      .setCollapsible(true)
      .addWidget(CardService.newTextParagraph().setText(activos < 0
        ? 'No se pudieron leer.'
        : 'De la búsqueda: ' + deBusqueda + ' · de tiempo en total: ' + activos + ' (tope ' +
          REINTENTOS_CONFIG.MAX_TRIGGERS_ACTIVOS + ')' +
          (nota && nota.activador
            ? '<br>Última parte siguiente: ' + (INDICE_TEXTO_ESTADO_ACTIVADOR[nota.activador.estado] || nota.activador.estado) +
              ', pedida desde ' + (nota.activador.desde === 'panel' ? 'el panel' : 'el activador')
            : '')))
  );
  return card.build();
}

function indiceUrlPestanaSinFila_(sheetId) {
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var hoja = ss.getSheetByName(INDICE_PESTANA_SIN_FILA);
    return hoja ? ss.getUrl() + '#gid=' + hoja.getSheetId() : '';
  } catch (err) {
    return '';
  }
}

function indiceRespuestaBusqueda_(aviso) {
  var r = CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildBusquedaJsonCard_()));
  if (aviso) r.setNotification(CardService.newNotification().setText(aviso));
  return r.build();
}

function indiceTextoActivador_(act) {
  if (act.estado === 'programado' || act.estado === 'ya_hay_uno') return 'Arranca sola en unos segundos.';
  if (act.estado === 'a_la_hora') {
    return 'Google no dejó programarla antes: quedó para las ' + formatearHoraIndice_(act.en) + '.';
  }
  return 'No se pudo programar: ' + (act.detalle || act.estado);
}

/**
 * "Buscar JSON" y "Revisar avisos": preparan la nota y programan la primera
 * parte. No buscan nada aquí (una acción de tarjeta tiene 30 s).
 */
function indiceIniciarDesdePanel_(modo) {
  var motivo = motivoConfigInvalida();
  if (motivo) return motivo;
  var sheetId = obtenerSheetId();
  PropertiesService.getUserProperties().setProperty('INDICE_SHEET_ID', sheetId);

  var nota = indiceLeerNota_(sheetId);
  if (nota && nota.ocupadoHasta > Date.now()) {
    return 'Ya hay una búsqueda corriendo: va en la fila ' + (nota.filaActual || 0) + '.';
  }
  if (nota && nota.modo !== modo && (nota.etapa === 'buscando' || nota.etapa === 'detenido')) {
    return 'Hay un "' + INDICE_NOMBRE_MODO[nota.modo] + '" a medias. Termínalo primero con "Continuar".';
  }
  var prep = indicePrepararBusqueda_(sheetId, modo);
  if (prep.ocupado) return 'Ya hay una búsqueda corriendo.';
  return INDICE_NOMBRE_MODO[modo] + ': ' + indiceTextoActivador_(indiceProgramarBusqueda_(sheetId, 'panel'));
}

function onAbrirBusquedaJson(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildBusquedaJsonCard_()))
    .build();
}

function onVerAvanceBusquedaJson(e) {
  return indiceRespuestaBusqueda_(null);
}

function onBuscarJson(e) {
  var aviso;
  try {
    aviso = indiceIniciarDesdePanel_('normal');
  } catch (err) {
    console.error('[Indice] ' + err.message);
    aviso = 'No se pudo iniciar la búsqueda: ' + err.message;
  }
  return indiceRespuestaBusqueda_(aviso);
}

function onRevisarAvisosJson(e) {
  var aviso;
  try {
    aviso = indiceIniciarDesdePanel_('revisar');
  } catch (err) {
    console.error('[Indice] ' + err.message);
    aviso = 'No se pudo iniciar la revisión: ' + err.message;
  }
  return indiceRespuestaBusqueda_(aviso);
}

/**
 * "Continuar": programa ya la parte siguiente (si quedó a la hora, se
 * detuvo o no arrancó).
 */
function onContinuarBusquedaJson(e) {
  var aviso;
  try {
    var sheetId = obtenerSheetId();
    PropertiesService.getUserProperties().setProperty('INDICE_SHEET_ID', sheetId);
    var nota = indiceLeerNota_(sheetId);
    if (!nota || nota.etapa === 'terminado') {
      aviso = 'No hay una búsqueda a medias.';
    } else if (nota.ocupadoHasta > Date.now()) {
      aviso = 'Ya hay una parte corriendo.';
    } else {
      var prep = indicePrepararBusqueda_(sheetId, nota.modo);
      aviso = prep.ocupado
        ? 'Ya hay una parte corriendo.'
        : 'Parte siguiente: ' + indiceTextoActivador_(indiceProgramarBusqueda_(sheetId, 'panel'));
    }
  } catch (err) {
    console.error('[Indice] ' + err.message);
    aviso = 'No se pudo continuar: ' + err.message;
  }
  return indiceRespuestaBusqueda_(aviso);
}

// ── Fechas y horas para la tarjeta ────────────────────────────────────

function formatearFechaIndice_(ms) {
  return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}

function formatearHoraIndice_(ms) {
  return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'HH:mm:ss');
}

function formatearDuracionIndice_(ms) {
  var s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  return Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
}

// ── Compatibilidad con la versión anterior ────────────────────────────
//
// Botones de tarjetas que quedaron abiertas con la versión anterior del
// índice: llevan a la tarjeta nueva. El activador anterior, si llega a
// dispararse, se borra solo y no hace nada.

function continuarIndiceJson(e) {
  console.log('[Indice] Activador de la versión anterior: se borra sin hacer nada');
  try {
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === 'continuarIndiceJson') ScriptApp.deleteTrigger(t);
    });
  } catch (err) {
    console.log('[Indice] No se pudo borrar el activador anterior: ' + err.message);
  }
}

function onAbrirIndiceJson(e) {
  return onAbrirBusquedaJson(e);
}

function onVerAvanceIndiceJson(e) {
  return onVerAvanceBusquedaJson(e);
}

function onIniciarIndiceJson(e) {
  return onBuscarJson(e);
}

function onActualizarIndiceJson(e) {
  return onBuscarJson(e);
}

function onContinuarIndiceJson(e) {
  return onContinuarBusquedaJson(e);
}

function onAvanzarAquiIndiceJson(e) {
  return onContinuarBusquedaJson(e);
}

function onEmpezarDeCeroIndiceJson(e) {
  return indiceRespuestaBusqueda_('Esa opción ya no existe en esta versión.');
}

function onReiniciarIndiceJson(e) {
  return onEmpezarDeCeroIndiceJson(e);
}
