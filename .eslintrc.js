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
  },
  ignorePatterns: [
    'node_modules/',
    '*.md',
  ],
};
