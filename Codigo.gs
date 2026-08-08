/**
 * CENTRO DE SOPORTE — Backend (Google Apps Script)
 * Hoja: Registro_Clientes
 *
 * La fila 1 de la hoja debe tener estos encabezados EXACTOS (mayúsculas,
 * acentos y paréntesis incluidos), porque el frontend arma los objetos
 * de ticket a partir de estos nombres de columna:
 *
 *   Nr_Cliente | Marca temporal | Nombre | Apellido | Localidad |
 *   Teléfono (WhatsApp) | Dispositivo | Detalles de la consulta |
 *   Prioridad | Estado | Archivado | Diagnostico
 *
 * DESPLIEGUE:
 *   Implementar > Nueva implementación > Tipo: Aplicación web
 *     - Ejecutar como: Yo (tu cuenta)
 *     - Quién tiene acceso: Cualquiera
 *   Copiá la URL que termina en /exec a CONFIG.API_URL en app.js
 *
 * Si ya tenías una implementación activa y modificás este archivo,
 * necesitás "Gestionar implementaciones" > editar > Nueva versión
 * para que los cambios se reflejen en la URL /exec ya publicada.
 */

const SHEET_NAME = "Registro_Clientes";
const ID_COLUMN = "Nr_Cliente";
const TIMESTAMP_COLUMN = "Marca temporal";

/* ------------------------------------------------------------------ */
/* GET — devuelve todos los tickets como JSON                          */
/* ------------------------------------------------------------------ */
function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  // Separamos los títulos de los datos
  const headers = data[0];
  const rows = data.slice(1);

  // Convertimos las filas en un formato JSON fácil de consumir en la web
  const json = rows.map(row => {
    let obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i];
    });
    return obj;
  });

  // Devolvemos el JSON
  return ContentService.createTextOutput(JSON.stringify(json))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* POST — crea o actualiza un ticket                                   */
/*                                                                      */
/*   El frontend envía el body como texto plano (para evitar el        */
/*   preflight CORS) pero el contenido es JSON válido:                 */
/*                                                                      */
/*   Actualizar: { action:"update", Nr_Cliente, ...camposModificados } */
/*   Crear:      { action:"create", Nombre, Apellido, Localidad, ... } */
/* ------------------------------------------------------------------ */
function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const payload = JSON.parse(e.postData.contents);

    if (payload.action === "update") return handleUpdate(sheet, payload);
    if (payload.action === "create") return handleCreate(sheet, payload);

    return respond({ success: false, error: "Acción no reconocida: " + payload.action });
  } catch (err) {
    return respond({ success: false, error: String(err) });
  }
}

/**
 * Busca la fila cuyo Nr_Cliente coincide y sobrescribe únicamente las
 * columnas que vinieron en el payload (el resto queda intacto).
 */
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
          sheet.getRange(r + 1, c + 1).setValue(payload[header]);
        }
      });
      return respond({ success: true, action: "update", Nr_Cliente: payload.Nr_Cliente });
    }
  }

  return respond({ success: false, error: "No se encontró el ticket Nr_Cliente=" + payload.Nr_Cliente });
}

/**
 * Agrega una fila nueva al final de la hoja. El Nr_Cliente se calcula
 * en el servidor (máximo existente + 1) para que sea siempre único,
 * en vez de confiar en un ID generado del lado del cliente.
 */
function handleCreate(sheet, payload) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const rows = values.slice(1);
  const idCol = headers.indexOf(ID_COLUMN);

  const nextId = getNextId(rows, idCol);

  const newRow = headers.map(header => {
    if (header === ID_COLUMN) return nextId;
    if (header === TIMESTAMP_COLUMN) {
      // Guardamos como Date real para que quede igual que el resto de
      // la planilla (el frontend manda un string ISO en "Marca temporal").
      return payload[header] ? new Date(payload[header]) : new Date();
    }
    return payload[header] !== undefined ? payload[header] : "";
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

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
