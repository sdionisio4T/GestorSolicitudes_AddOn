// Carga los .gs de src/ en un contexto de Node para correr sus funciones
// puras sin Apps Script. Solo se simulan los servicios de Google que los
// tests usan; el resto no existe y fallaria si algun test lo llamara.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');

// Archivos temporales que no forman parte del producto.
const EXCLUIDOS = ['Pruebas.gs'];

// Utilities.computeDigest devuelve bytes con signo (-128 a 127), igual que
// Java; el codigo de SheetWriter.gs ya los convierte a hex con eso en cuenta.
const utilitiesDoble = {
  DigestAlgorithm: { MD5: 'md5', SHA_1: 'sha1', SHA_256: 'sha256' },
  computeDigest(algoritmo, texto) {
    const buf = crypto.createHash(algoritmo).update(String(texto), 'utf8').digest();
    return Array.from(buf, (b) => (b > 127 ? b - 256 : b));
  }
};

// RichTextValue minimo: texto, rangos con link y getRuns() que parte el
// texto en tramos con el mismo link, como hace Sheets.
function nuevoRichText() {
  let texto = '';
  let linkTodo = null;
  const rangos = [];
  const builder = {
    setText(t) { texto = String(t); return builder; },
    setLinkUrl(a, b, c) {
      if (b === undefined) linkTodo = a;
      else rangos.push({ inicio: a, fin: b, url: c });
      return builder;
    },
    setTextStyle() { return builder; },
    build() {
      const linkEn = (i) => {
        for (let k = rangos.length - 1; k >= 0; k--) {
          if (i >= rangos[k].inicio && i < rangos[k].fin) return rangos[k].url;
        }
        return linkTodo;
      };
      const runs = [];
      let inicio = 0;
      for (let i = 1; i <= texto.length; i++) {
        if (i === texto.length || linkEn(i) !== linkEn(inicio)) {
          const url = linkEn(inicio);
          const parte = texto.slice(inicio, i);
          runs.push({
            getText: () => parte,
            getLinkUrl: () => url,
            getStartIndex: () => inicio,
            getEndIndex: () => i
          });
          inicio = i;
        }
      }
      return {
        getText: () => texto,
        getLinkUrl: () => linkTodo,
        getRuns: () => runs
      };
    }
  };
  return builder;
}

const spreadsheetAppDoble = { newRichTextValue: nuevoRichText };

function cargarGs(opciones = {}) {
  const contexto = vm.createContext({
    console: opciones.console || console,
    Utilities: utilitiesDoble,
    SpreadsheetApp: spreadsheetAppDoble
  });
  const archivos = fs.readdirSync(SRC)
    .filter((f) => f.endsWith('.gs') && !EXCLUIDOS.includes(f))
    .sort();
  for (const archivo of archivos) {
    const codigo = fs.readFileSync(path.join(SRC, archivo), 'utf8');
    vm.runInContext(codigo, contexto, { filename: archivo });
  }
  return contexto;
}

module.exports = { cargarGs };
