/**
 * .eslintrc.js — Configuracion de ESLint para el proyecto.
 *
 * Contexto:
 *   El codigo corre en Google Apps Script V8 (ES2019+). Los .gs comparten
 *   scope global entre archivos sin sistema de imports/exports — cualquier
 *   funcion top-level definida en un .gs es visible desde otro.
 *
 * Por que no-undef esta DESACTIVADO:
 *   Si lo dejamos activo, ESLint marca como error cada llamada cross-file
 *   (por ejemplo obtenerSheet en SheetWriter.gs que se define en Config.gs).
 *   Listar TODAS las funciones globales del proyecto se desactualiza rapido.
 *   Los tests unitarios + smokeTest + la carga del add-on detectan las
 *   referencias rotas de sobra. Confiamos en esos.
 *
 * Que si atrapa este config:
 *   - no-redeclare       → misma var declarada dos veces en el mismo scope
 *   - no-unused-vars     → var declarada y nunca usada
 *   - eqeqeq             → uso de == o != en vez de === o !==
 *   - consistent-return  → funcion que a veces retorna valor y a veces no
 *   - curly              → if/else/for/while sin llaves { }
 *   - no-dupe-keys       → objeto con la misma key dos veces
 *   - no-unreachable     → codigo despues de un return / throw
 *
 * Reglas de seguridad (eslint-plugin-security):
 *   Se activa el set 'recommended-legacy' del plugin, que atrapa patrones
 *   riesgosos comunes en JavaScript: uso de eval() con expresiones,
 *   RegExp construidos con variables, Math.random() usado en contexto de
 *   seguridad, comparacion de strings sensible a timing attacks, y
 *   bracket-notation con input no confiable. Las reglas Node-especificas
 *   (fs, child_process, Buffer, require, Express, Handlebars) se
 *   desactivan porque no aplican al runtime de Apps Script. detect-unsafe-regex
 *   tambien se desactiva por generar solo falsos positivos en este
 *   proyecto (ver comentario en rules).
 *
 * Como correrlo:
 *   npm run lint        → linta todos los .gs y muestra errores en consola.
 *   La extension "ESLint" de VS Code lo corre automatico mientras editas.
 */

module.exports = {
  env: {
    es2021: true,
  },
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'script',
  },
  plugins: ['security'],
  extends: ['plugin:security/recommended-legacy'],
  globals: {
    // Google Apps Script builtins que usa el proyecto
    CardService: 'readonly',
    SpreadsheetApp: 'readonly',
    DriveApp: 'readonly',
    GmailApp: 'readonly',
    PropertiesService: 'readonly',
    CacheService: 'readonly',
    LockService: 'readonly',
    ScriptApp: 'readonly',
    Utilities: 'readonly',
    Session: 'readonly',
    HtmlService: 'readonly',
    UrlFetchApp: 'readonly',
    Logger: 'readonly',
    console: 'readonly',
  },
  rules: {
    'no-redeclare': 'error',
    // vars: 'local' → solo revisa variables dentro de funciones. Ignora
    // declaraciones top-level (funciones globales del proyecto y handlers
    // que llama el runtime de Apps Script, como onEnviar u onHomepage).
    // Sin esto, ESLint marca como "unused" cada funcion .gs porque no ve
    // los callsites cross-file (no hay import/export en Apps Script).
    'no-unused-vars': ['warn', { vars: 'local', args: 'none' }],
    // null: 'ignore' → permite `x == null` (matchea null Y undefined en
    // una sola comparacion, idioma reconocido). Todo lo demas sigue
    // requiriendo === estricto.
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'consistent-return': 'warn',
    'no-undef': 'off',
    curly: ['warn', 'multi-line'],
    'no-dupe-keys': 'error',
    'no-unreachable': 'error',
    // Reglas de eslint-plugin-security desactivadas porque son especificas
    // de Node.js y no aplican al runtime de Apps Script (no hay fs,
    // child_process, Buffer, require, ni Express/Handlebars).
    'security/detect-non-literal-fs-filename': 'off',
    'security/detect-non-literal-require': 'off',
    'security/detect-child-process': 'off',
    'security/detect-buffer-noassignment': 'off',
    'security/detect-new-buffer': 'off',
    'security/detect-no-csrf-before-method-override': 'off',
    'security/detect-disable-mustache-escape': 'off',
    'security/detect-bidi-characters': 'off',
    // detect-object-injection marca CUALQUIER acceso obj[var] con corchetes
    // aunque el indice sea un contador de loop, una clave interna, o una
    // URL ya validada. Esta pensada para el caso Node/Express con
    // req.query como indice, vector que no existe en Apps Script (no hay
    // HTTP requests del atacante, los inputs vienen de correo y formularios
    // ya parseados). Es la regla mas falso-positiva del plugin. Se
    // desactiva a nivel proyecto; si en algun archivo especifico se
    // recibiera indice de input no confiable, se reactiva puntual con
    // /* eslint-enable security/detect-object-injection */.
    'security/detect-object-injection': 'off',
    // detect-unsafe-regex usa safe-regex, que marca por heurística cualquier
    // regex con cuantificador sobre grupos aunque el patrón no sea vulnerable
    // a ReDoS. Los regexes del proyecto operan sobre URLs, formatos de fecha
    // y strings del Sheet/correo (longitud acotada, no input adversarial
    // arbitrario), y los cuantificadores están todos acotados o siguen a
    // literales fijos. Genera solo falsos positivos → se desactiva.
    'security/detect-unsafe-regex': 'off',
  },
  ignorePatterns: [
    'node_modules/',
    '*.md',
  ],
};
