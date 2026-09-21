/**
 * DriveCopier.gs — Copia archivos/carpetas de Drive desde URLs sueltas
 * hacia una carpeta destino. Usado por SheetWriter tras registrar un envío
 * para que la documentación del correo quede respaldada en la carpeta raíz
 * del usuario, aunque el desarrollador borre el original.
 *
 * Todo corre con DriveApp (servicio nativo). Sin advanced services.
 *
 * Diseño:
 * - copiarUrlsADestino(urls, destino, presupuestoMs) es la entrada única.
 * - Es time-aware: chequea el presupuesto antes de cada archivo. Los
 *   add-ons de Gmail cortan a los 30 s, así que quien llama pasa un margen
 *   (~20 s) y deja los otros 10 s para escritura en Sheet + re-render.
 * - Cada fallo se clasifica en 'permiso' / 'temporal' / 'invalido'. Solo
 *   'temporal' es candidato a reintento (fase 3, todavía no implementado).
 */

var DRIVE_COPIER = {
  PRESUPUESTO_DEFECTO_MS: 20000
};

// ── ID de envío ─────────────────────────────────────────────────────

/**
 * Genera un identificador corto y estable por envío. Formato: env_ + 6
 * caracteres hex del timestamp + 2 aleatorios. No es criptográficamente
 * fuerte — solo sirve para distinguir envíos en el Sheet.
 */
function generarIdEnvio() {
  var ts = new Date().getTime().toString(16).slice(-6);
  var rand = Math.floor(Math.random() * 256).toString(16);
  if (rand.length === 1) rand = '0' + rand;
  return 'env_' + ts + rand;
}

// ── Parseo de URLs ──────────────────────────────────────────────────

/**
 * Extrae el ID de una URL de Drive y trata de decir si apunta a un
 * archivo o a una carpeta. Formatos soportados:
 *   /file/d/{ID}/...           → archivo
 *   /document|spreadsheets|presentation/d/{ID}/...  → archivo (Doc/Sheet/Slide)
 *   /drive/folders/{ID} o /drive/u/N/folders/{ID}   → carpeta
 *   ?id={ID}                    → desconocido (probamos como archivo primero)
 *
 * Retorna { id, tipo } donde tipo es 'archivo' | 'carpeta' | 'desconocido',
 * o null si no logra extraer nada.
 */
function parsearIdDrive(url) {
  if (!url) return null;
  var u = String(url).trim();

  var m = u.match(/\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]{20,})/);
  if (m) return { id: m[1], tipo: 'carpeta' };

  m = u.match(/\/(?:file|document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return { id: m[1], tipo: 'archivo' };

  m = u.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m) return { id: m[1], tipo: 'desconocido' };

  return null;
}

// ── Colisiones de carpeta ───────────────────────────────────────────

/**
 * Devuelve una carpeta hija dentro de `padre` con el nombre `base`. Si ya
 * existe una con ese nombre, prueba `base_2`, `base_3`, ... hasta
 * encontrar uno libre. Nunca reutiliza — cada envío estrena su carpeta
 * (por decisión del usuario: sufijo de fecha en el nombre base).
 */
function obtenerOCrearCarpetaHijaUnica(padre, base) {
  var nombre = base;
  var i = 1;
  while (existeCarpetaConNombre(padre, nombre)) {
    i++;
    nombre = base + '_' + i;
  }
  return padre.createFolder(nombre);
}

/**
 * Idempotente para el caso de "carpeta padre por servicio": si ya existe
 * `Servicio` como hija de la raíz, la reutilizamos. Si no, la creamos.
 * Los envíos individuales van adentro con nombres únicos vía el helper de
 * arriba.
 */
function obtenerOCrearCarpetaHija(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  if (it.hasNext()) return it.next();
  return padre.createFolder(nombre);
}

/**
 * Versión cacheada de obtenerOCrearCarpetaHija. Consulta primero el cache
 * en memoria (padreId + '/' + nombre) y solo pregunta a Drive si no hay
 * entrada. Fix para el bug de duplicación en reintentos: Drive tiene
 * consistencia eventual y `getFoldersByName` puede no ver una carpeta
 * recién creada — sin cache, dos iteraciones consecutivas dentro del mismo
 * intento podrían crear dos carpetas con el mismo nombre.
 */
function obtenerOCrearCarpetaHijaCacheada(padre, nombre, cache) {
  var clave = padre.getId() + '/' + nombre;
  if (cache[clave]) return cache[clave];
  var it = padre.getFoldersByName(nombre);
  var folder = it.hasNext() ? it.next() : padre.createFolder(nombre);
  cache[clave] = folder;
  return folder;
}

function existeCarpetaConNombre(padre, nombre) {
  return padre.getFoldersByName(nombre).hasNext();
}

// ── Copia ───────────────────────────────────────────────────────────

/**
 * Copia una lista de URLs de Drive dentro de `carpetaDestino`. Devuelve
 * un resumen para que quien llama pueda mostrar toast y anotar el Sheet.
 *
 * Formato de retorno:
 * {
 *   copiados: 5,
 *   totalIntentados: 6,
 *   fallos: [ { url, motivo, mensaje } ],
 *   tiempoAgotado: false
 * }
 *
 * Motivos posibles:
 *   'permiso'   — el usuario no tiene acceso al archivo/carpeta origen
 *   'temporal'  — timeout, red, cuota momentánea → reintentar más tarde
 *   'invalido'  — URL no parseable / archivo no existe
 *   'tiempo'    — se acabó el presupuesto antes de intentar
 */
function copiarUrlsADestino(urls, carpetaDestino, presupuestoMs, opciones) {
  var inicio = new Date().getTime();
  var presupuesto = presupuestoMs || DRIVE_COPIER.PRESUPUESTO_DEFECTO_MS;
  var opts = opciones || {};
  // Cache de carpetas hijas creadas/encontradas durante ESTA corrida. Es
  // crítico para el reintento: Drive tiene consistencia eventual y
  // `getFoldersByName` puede no ver una carpeta recién creada por segundos,
  // lo que llevaría a crear duplicados. El cache se comparte por toda la
  // recursión — si el llamador nos pasa uno, lo respetamos (así múltiples
  // llamadas dentro del mismo reintento comparten memoria).
  if (!opts.cacheCarpetas) opts.cacheCarpetas = {};

  var resultado = {
    copiados: 0,
    saltados: 0,
    totalIntentados: 0,
    fallos: [],
    tiempoAgotado: false
  };

  var listaUrls = (urls || [])
    .map(function(u) { return String(u).trim(); })
    .filter(function(u) { return u !== ''; });

  // Guard de cantidad: si el envío trae más URLs que el tope, las
  // excedentes se marcan como fallo 'tamano' (no reintentable) para que
  // queden anotadas y el link original se conserve en el Sheet.
  if (listaUrls.length > COPIA_MAX_URLS_POR_ENVIO) {
    var excedentes = listaUrls.slice(COPIA_MAX_URLS_POR_ENVIO);
    listaUrls = listaUrls.slice(0, COPIA_MAX_URLS_POR_ENVIO);
    excedentes.forEach(function(u) {
      resultado.fallos.push({
        url: u,
        motivo: 'tamano',
        mensaje: 'Excede el tope de ' + COPIA_MAX_URLS_POR_ENVIO + ' URLs por envío'
      });
    });
    console.warn('[Copia] ' + excedentes.length + ' URL(s) excedieron el tope de ' + COPIA_MAX_URLS_POR_ENVIO + ' — no se copian');
  }

  for (var i = 0; i < listaUrls.length; i++) {
    var url = listaUrls[i];

    if (agotado(inicio, presupuesto)) {
      resultado.tiempoAgotado = true;
      resultado.fallos.push({ url: url, motivo: 'tiempo', mensaje: 'Sin tiempo para intentar' });
      continue;
    }

    var parsed = parsearIdDrive(url);
    if (!parsed) {
      resultado.fallos.push({ url: url, motivo: 'invalido', mensaje: 'URL no reconocida' });
      continue;
    }

    resultado.totalIntentados++;

    try {
      var copiadosDeEste = copiarPorId(parsed, carpetaDestino, inicio, presupuesto, opts);
      resultado.copiados += copiadosDeEste.copiados;
      resultado.saltados += (copiadosDeEste.saltados || 0);
      if (copiadosDeEste.tiempoAgotado) {
        resultado.tiempoAgotado = true;
      }
      copiadosDeEste.fallosParciales.forEach(function(f) {
        resultado.fallos.push({ url: url, motivo: f.motivo, mensaje: f.mensaje });
      });
    } catch (e) {
      var clasif = clasificarError(e);
      resultado.fallos.push({ url: url, motivo: clasif, mensaje: e.message });
    }
  }

  return resultado;
}

/**
 * Copia un ID (archivo o carpeta) dentro de `destino`. Si el tipo viene
 * como 'desconocido' (URL con ?id=...), prueba primero como archivo y
 * cae a carpeta si es que falla con "not found" o similar.
 *
 * Retorna { copiados, tiempoAgotado, fallosParciales } donde
 * fallosParciales son subarchivos que no se copiaron dentro de una
 * carpeta (URL de la carpeta al menos se registró en totalIntentados).
 */
function copiarPorId(parsed, destino, inicio, presupuesto, opciones) {
  var opts = opciones || {};

  if (parsed.tipo === 'carpeta') {
    // esRaiz=true: volcamos el contenido directo en `destino`, sin
    // crear un nivel intermedio con el nombre de la carpeta origen.
    return copiarCarpetaRecursivo(parsed.id, destino, inicio, presupuesto, true, opts);
  }

  if (parsed.tipo === 'archivo') {
    var r = copiarArchivoPorId(parsed.id, destino, opts);
    return { copiados: r.copiado ? 1 : 0, saltados: r.saltado ? 1 : 0, tiempoAgotado: false, fallosParciales: [] };
  }

  // 'desconocido' — probamos archivo, si falla probamos carpeta.
  try {
    var r2 = copiarArchivoPorId(parsed.id, destino, opts);
    return { copiados: r2.copiado ? 1 : 0, saltados: r2.saltado ? 1 : 0, tiempoAgotado: false, fallosParciales: [] };
  } catch (e1) {
    // Si el error fue "no encontrado como archivo", probamos carpeta.
    // Cualquier otro error se propaga (permiso, etc.).
    if (esNotFound(e1)) {
      return copiarCarpetaRecursivo(parsed.id, destino, inicio, presupuesto, true, opts);
    }
    throw e1;
  }
}

/**
 * Copia un archivo por ID dentro de destino. Con opts.saltarSiExiste=true,
 * si el destino ya contiene un archivo con el mismo nombre no se copia
 * (evita duplicados en reintentos que reanudan una carpeta parcial).
 */
function copiarArchivoPorId(fileId, destino, opciones) {
  var opts = opciones || {};
  var archivo = DriveApp.getFileById(fileId);
  var nombre = archivo.getName();
  if (opts.saltarSiExiste && destino.getFilesByName(nombre).hasNext()) {
    return { copiado: false, saltado: true };
  }
  chequearTamanoArchivo_(archivo);
  archivo.makeCopy(nombre, destino);
  return { copiado: true, saltado: false };
}

/**
 * Tira Error con mensaje claro si el archivo excede COPIA_MAX_SIZE_MB.
 * El error lo captura clasificarError() como 'tamano' (via el prefijo
 * "Archivo demasiado grande") y no se reintenta.
 */
function chequearTamanoArchivo_(archivo) {
  var maxBytes = COPIA_MAX_SIZE_MB * 1024 * 1024;
  var size = archivo.getSize();
  if (size > maxBytes) {
    var mb = Math.round(size / 1024 / 1024);
    throw new Error('Archivo demasiado grande: ' + mb + ' MB (tope: ' + COPIA_MAX_SIZE_MB + ' MB)');
  }
}

/**
 * Copia el contenido de una carpeta origen dentro de `destino`,
 * recursivamente. Es time-aware — corta apenas se pasa del presupuesto
 * y devuelve tiempoAgotado=true para que quien llama lo refleje en el
 * Sheet.
 *
 * Los errores por archivo individual dentro de la carpeta se anotan en
 * fallosParciales, no cortan el resto de la copia.
 *
 * Parámetro `esRaiz`: cuando true, los archivos y subcarpetas de
 * `origen` se vuelcan directamente en `destino` sin crear un nivel
 * intermedio con el nombre de la carpeta origen. Cuando false, se
 * crea `destino/{nombreOrigen}/` y todo va adentro. Esto sirve para
 * que las URLs de carpeta que aparecen en el correo no generen un
 * nivel extra en el Drive del usuario, pero las subcarpetas
 * anidadas sí conserven su estructura.
 */
function copiarCarpetaRecursivo(folderId, destino, inicio, presupuesto, esRaiz, opciones) {
  var opts = opciones || {};
  var res = { copiados: 0, saltados: 0, tiempoAgotado: false, fallosParciales: [] };

  var origen = DriveApp.getFolderById(folderId);
  // Con saltarSiExiste, reutilizamos la subcarpeta hija que ya exista con
  // ese nombre (el reintento reanuda dentro de la misma jerarquía). Sin la
  // opción, comportamiento original: siempre creamos una nueva.
  // Nota: usamos la versión cacheada de obtenerOCrearCarpetaHija para no
  // duplicar carpetas por consistencia eventual de Drive.
  var subDestino;
  if (esRaiz) {
    subDestino = destino;
  } else if (opts.saltarSiExiste) {
    subDestino = obtenerOCrearCarpetaHijaCacheada(destino, origen.getName(), opts.cacheCarpetas || {});
  } else {
    subDestino = destino.createFolder(origen.getName());
  }

  var archivos = origen.getFiles();
  while (archivos.hasNext()) {
    if (agotado(inicio, presupuesto)) {
      res.tiempoAgotado = true;
      res.fallosParciales.push({ motivo: 'tiempo', mensaje: 'Sin tiempo para el resto de la carpeta' });
      return res;
    }
    var f = archivos.next();
    try {
      if (opts.saltarSiExiste && subDestino.getFilesByName(f.getName()).hasNext()) {
        res.saltados++;
      } else {
        chequearTamanoArchivo_(f);
        f.makeCopy(f.getName(), subDestino);
        res.copiados++;
      }
    } catch (e) {
      res.fallosParciales.push({ motivo: clasificarError(e), mensaje: f.getName() + ': ' + e.message });
    }
  }

  var subcarpetas = origen.getFolders();
  while (subcarpetas.hasNext()) {
    if (agotado(inicio, presupuesto)) {
      res.tiempoAgotado = true;
      res.fallosParciales.push({ motivo: 'tiempo', mensaje: 'Sin tiempo para subcarpetas' });
      return res;
    }
    var sub = subcarpetas.next();
    try {
      var sr = copiarCarpetaRecursivo(sub.getId(), subDestino, inicio, presupuesto, false, opts);
      res.copiados += sr.copiados;
      res.saltados += (sr.saltados || 0);
      if (sr.tiempoAgotado) res.tiempoAgotado = true;
      sr.fallosParciales.forEach(function(fp) { res.fallosParciales.push(fp); });
    } catch (e) {
      res.fallosParciales.push({ motivo: clasificarError(e), mensaje: sub.getName() + '/: ' + e.message });
    }
  }

  return res;
}

// ── Utilidades ──────────────────────────────────────────────────────

function agotado(inicio, presupuesto) {
  return (new Date().getTime() - inicio) >= presupuesto;
}

function esNotFound(e) {
  var m = (e && e.message ? e.message : '').toLowerCase();
  return m.indexOf('not found') !== -1 || m.indexOf('no encontrado') !== -1;
}

/**
 * Clasifica un error de DriveApp en una etiqueta útil para el usuario y
 * para decidir si vale la pena reintentar (fase 3).
 */
function clasificarError(e) {
  var m = (e && e.message ? e.message : '').toLowerCase();
  if (m.indexOf('archivo demasiado grande') !== -1 ||
      m.indexOf('file too large') !== -1) {
    return 'tamano';
  }
  if (m.indexOf('access') !== -1 || m.indexOf('permission') !== -1 ||
      m.indexOf('permiso') !== -1 || m.indexOf('no autor') !== -1) {
    return 'permiso';
  }
  if (m.indexOf('not found') !== -1 || m.indexOf('no encontrado') !== -1 ||
      m.indexOf('invalid') !== -1) {
    return 'invalido';
  }
  if (m.indexOf('timed out') !== -1 || m.indexOf('timeout') !== -1 ||
      m.indexOf('rate limit') !== -1 || m.indexOf('user rate') !== -1 ||
      m.indexOf('quota') !== -1 || m.indexOf('temporarily') !== -1 ||
      m.indexOf('try again') !== -1) {
    return 'temporal';
  }
  return 'temporal';
}

/**
 * Traduce un error crudo (que puede venir con texto técnico en inglés
 * tipo "You do not have permission to call SpreadsheetApp.openById")
 * a un mensaje en español accionable para el usuario. `contexto` orienta
 * la sugerencia según qué se estaba intentando: 'guardar', 'sheet',
 * 'carpeta' o vacío para un mensaje genérico.
 */
function mensajeErrorUsuario(e, contexto) {
  var raw = (e && e.message ? e.message : '');
  var m = raw.toLowerCase();
  var ctx = contexto || '';

  // Permisos revocados / faltantes.
  if (m.indexOf('permission') !== -1 || m.indexOf('permiso') !== -1 ||
      m.indexOf('no autor') !== -1 ||
      (m.indexOf('access') !== -1 && m.indexOf('denied') !== -1)) {
    if (ctx === 'sheet') return 'Perdiste acceso al Sheet configurado. Pide permiso al dueño o configura otro Sheet.';
    if (ctx === 'carpeta') return 'Perdiste acceso a la carpeta de Drive. Pide permiso al dueño o configura otra carpeta.';
    if (ctx === 'guardar') return 'Perdiste acceso al Sheet o a la carpeta configurada. Reabre el correo y revisa la configuración.';
    return 'No tienes permiso para hacer esta acción. Revisa que sigas teniendo acceso al Sheet y a la carpeta configurados.';
  }

  // Recurso borrado o URL/ID inválido.
  if (m.indexOf('not found') !== -1 || m.indexOf('no encontrado') !== -1 ||
      m.indexOf('no such') !== -1) {
    if (ctx === 'sheet') return 'El Sheet configurado ya no existe (fue eliminado o movido). Configura uno nuevo.';
    if (ctx === 'carpeta') return 'La carpeta configurada ya no existe (fue eliminada o movida). Configura otra.';
    if (ctx === 'guardar') return 'El Sheet o la carpeta configurados ya no existen. Vuelve a configurar desde "Configuración".';
    return 'El recurso ya no existe (fue eliminado o movido).';
  }

  if (m.indexOf('invalid') !== -1 || m.indexOf('malformed') !== -1) {
    if (ctx === 'sheet') return 'La URL del Sheet no es válida. Copia el enlace completo desde la barra del navegador.';
    if (ctx === 'carpeta') return 'La URL de la carpeta no es válida. Debe contener /drive/folders/...';
    return 'La URL o el ID no son válidos.';
  }

  // Rate limit / cuota.
  if (m.indexOf('rate limit') !== -1 || m.indexOf('user rate') !== -1 ||
      m.indexOf('quota') !== -1 || m.indexOf('too many') !== -1) {
    return 'Google está limitando las peticiones. Espera uno o dos minutos y reintenta.';
  }

  // Timeout / red / servicio caído.
  if (m.indexOf('timed out') !== -1 || m.indexOf('timeout') !== -1 ||
      m.indexOf('deadline') !== -1 || m.indexOf('try again') !== -1 ||
      m.indexOf('temporarily') !== -1 || m.indexOf('unavailable') !== -1 ||
      m.indexOf('backend error') !== -1 || m.indexOf('internal error') !== -1) {
    return 'Problema temporal de red o de Google. Espera unos segundos y reintenta.';
  }

  // Fallback: mensaje genérico + el técnico entre paréntesis para no
  // esconder información nueva que aparezca a futuro.
  if (ctx === 'guardar') return 'No se pudo guardar. Reintenta en unos segundos.' + (raw ? ' (' + raw + ')' : '');
  if (ctx === 'sheet') return 'No se pudo abrir el Sheet.' + (raw ? ' (' + raw + ')' : '');
  if (ctx === 'carpeta') return 'No se pudo abrir la carpeta.' + (raw ? ' (' + raw + ')' : '');
  return 'Ocurrió un error.' + (raw ? ' (' + raw + ')' : '');
}
