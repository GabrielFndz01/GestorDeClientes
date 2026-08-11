/* ==========================================================================
   CONFIGURACIÓN
   ========================================================================== */
const SHEET_NAME = "Registro_Clientes";
const BACKUP_SHEET_NAME = "Respaldo";
const ID_COLUMN = "Nr_Cliente";
const TIMESTAMP_COLUMN = "Marca temporal";

// Tope de tickets para esta demo pública: evita que un script automatizado
// llene la planilla de filas basura. Subilo si tu caso de uso real lo necesita.
const MAX_ROWS = 500;

// Límite simple de escrituras por minuto (create/update/backup/restore juntos).
// No identifica visitantes individuales (Apps Script no expone la IP de forma
// confiable), pero frena scripts que golpean la API en loop.
const MAX_WRITES_PER_MINUTE = 20;

/* ==========================================================================
   CLAVE DE ADMINISTRADOR
   --------------------------------------------------------------------------
   Backup y Restore están protegidos por una clave que SOLO vos conocés.
   Configurala así (una única vez):
     1. En el editor de Apps Script → ícono de engranaje "Configuración del proyecto".
     2. Bajá hasta "Propiedades del script" → "Añadir propiedad del script".
     3. Nombre: ADMIN_SECRET   |   Valor: una clave larga y aleatoria.
   Nunca la escribas acá en el código ni la subas a un repo público: si el
   código es visible (GitHub, DevTools del navegador), la clave no debe estarlo.
   Si no configurás esta propiedad, backup y restore quedan deshabilitados
   por seguridad (fail-safe).
   ========================================================================== */

function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();

  const headers = values[0];
  const rows = values.slice(1);

  const json = rows.map(row => {
    let obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i];
    });
    return obj;
  });

  const props = PropertiesService.getScriptProperties();
  const lastBackupAt = props.getProperty("LAST_BACKUP_AT") || null;
  const lastBackupHash = props.getProperty("LAST_BACKUP_HASH") || null;
  const currentHash = hashValues(values);

  // hasUnsavedChanges le dice al frontend si los datos actuales difieren del
  // último resguardo, para mostrar el indicador "cambios sin resguardar".
  const hasUnsavedChanges = lastBackupHash === null ? true : currentHash !== lastBackupHash;

  return ContentService.createTextOutput(JSON.stringify({
    data: json,
    lastBackupAt: lastBackupAt,
    hasUnsavedChanges: hasUnsavedChanges,
  })).setMimeType(ContentService.MimeType.JSON);
}


function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const payload = JSON.parse(e.postData.contents);

    if (!withinRateLimit()) {
      return respond({ success: false, error: "Demasiadas solicitudes. Esperá un momento e intentá de nuevo." });
    }

    if (payload.action === "update") return handleUpdate(sheet, payload);
    if (payload.action === "create") return handleCreate(sheet, payload);
    if (payload.action === "backup") return handleBackup(sheet, payload);
    if (payload.action === "restore") return handleRestore(sheet, payload);

    return respond({ success: false, error: "Acción no reconocida: " + payload.action });
  } catch (err) {
    return respond({ success: false, error: String(err) });
  }
}


function handleUpdate(sheet, payload) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf(ID_COLUMN);

  if (idCol === -1) {
    return respond({ success: false, error: `No se encontró la columna "${ID_COLUMN}"` });
  }

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(payload.Nr_Cliente)) {
      headers.forEach((header, c) => {
        if (header === ID_COLUMN) return; // el ID nunca se reescribe
        if (Object.prototype.hasOwnProperty.call(payload, header)) {
          sheet.getRange(r + 1, c + 1).setValue(sanitizeValue(payload[header]));
        }
      });
      return respond({ success: true, action: "update", Nr_Cliente: payload.Nr_Cliente });
    }
  }

  return respond({ success: false, error: "No se encontró el ticket Nr_Cliente=" + payload.Nr_Cliente });
}


function handleCreate(sheet, payload) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const rows = values.slice(1);
  const idCol = headers.indexOf(ID_COLUMN);

  if (rows.length >= MAX_ROWS) {
    return respond({
      success: false,
      error: `Se alcanzó el límite de ${MAX_ROWS} tickets de esta demo. Restaurá un resguardo o depurá datos para seguir probando.`,
    });
  }

  const nextId = getNextId(rows, idCol);

  const newRow = headers.map(header => {
    if (header === ID_COLUMN) return "";
    if (header === TIMESTAMP_COLUMN) {
      // Guardamos como Date real para que quede igual que el resto de
      // la planilla (el frontend manda un string ISO en "Marca temporal").
      return payload[header] ? new Date(payload[header]) : new Date();
    }
    return sanitizeValue(payload[header] !== undefined ? payload[header] : "");
  });

  sheet.appendRow(newRow);

  return respond({ success: true, action: "create", Nr_Cliente: nextId });
}

function getNextId(rows, idCol) {
  let maxId = 0;
  rows.forEach(row => {
    const val = Number(row[idCol]);
    if (!isNaN(val) && val > maxId) maxId = val;
  });
  return maxId + 1;
}

/* ==========================================================================
   RESGUARDO Y RESTAURACIÓN
   --------------------------------------------------------------------------
   Guardamos una copia completa de la hoja en una hoja oculta "Respaldo".
   Cada backup nuevo pisa el anterior (guardamos el último estado "bueno
   conocido", no un historial). Como red adicional, Google Sheets también
   guarda automáticamente el historial de versiones del archivo entero
   (Archivo → Historial de versiones), sin necesidad de código.
   ========================================================================== */
function handleBackup(sheet, payload) {
  if (!checkAdmin(payload)) return respond({ success: false, error: "No autorizado" });

  const values = sheet.getDataRange().getValues();
  const backupSheet = getOrCreateBackupSheet();

  backupSheet.clearContents();
  backupSheet.getRange(1, 1, values.length, values[0].length).setValues(values);

  const now = new Date();
  const hash = hashValues(values);
  const props = PropertiesService.getScriptProperties();
  props.setProperty("LAST_BACKUP_AT", now.toISOString());
  props.setProperty("LAST_BACKUP_HASH", hash);

  return respond({ success: true, action: "backup", lastBackupAt: now.toISOString() });
}

function handleRestore(sheet, payload) {
  if (!checkAdmin(payload)) return respond({ success: false, error: "No autorizado" });

  const backupSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BACKUP_SHEET_NAME);
  if (!backupSheet || backupSheet.getLastRow() === 0) {
    return respond({ success: false, error: "Todavía no se guardó ningún resguardo." });
  }

  const values = backupSheet.getDataRange().getValues();
  sheet.clearContents();
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);

  // Los datos ahora vuelven a coincidir exactamente con el último resguardo.
  PropertiesService.getScriptProperties().setProperty("LAST_BACKUP_HASH", hashValues(values));

  return respond({ success: true, action: "restore" });
}

function getOrCreateBackupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(BACKUP_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(BACKUP_SHEET_NAME);
    sheet.hideSheet(); // no mezclarla con la hoja operativa
  }
  return sheet;
}

/* ==========================================================================
   SEGURIDAD: clave de admin, saneamiento y límite de solicitudes
   ========================================================================== */
function checkAdmin(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty("ADMIN_SECRET");
  if (!secret) return false; // sin clave configurada, backup/restore quedan bloqueados
  return payload && payload.adminSecret === secret;
}

function withinRateLimit() {
  const cache = CacheService.getScriptCache();
  const key = "write_count_" + Math.floor(Date.now() / 60000); // ventana de 1 minuto
  const count = Number(cache.get(key) || 0);
  if (count >= MAX_WRITES_PER_MINUTE) return false;
  cache.put(key, String(count + 1), 70);
  return true;
}

// Neutraliza inyección de fórmulas: si un visitante manda un valor que
// empieza con =, +, - o @, Sheets podría interpretarlo como fórmula
// (ej. para exfiltrar datos de otras celdas). Lo forzamos a texto plano.
function sanitizeValue(v) {
  if (typeof v === "string" && /^[=+\-@]/.test(v)) {
    return "'" + v;
  }
  return v;
}

// Hash simple y estable de todos los valores de la hoja, solo para detectar
// si algo cambió desde el último resguardo (no necesita ser criptográfico).
function hashValues(values) {
  const str = values.map(row => row.join("\u241F")).join("\u241E");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return String(hash);
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
