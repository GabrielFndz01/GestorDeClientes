const SHEET_NAME = "Registro_Clientes";
const DEMO_SHEET_NAME = "Registro_Clientes_Demo"; // La nueva hoja
const ID_COLUMN = "Nr_Cliente";
const TIMESTAMP_COLUMN = "Marca temporal";

function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  const headers = data[0];
  const rows = data.slice(1);

  const json = rows.map(row => {
    let obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i];
    });
    return obj;
  });

  return ContentService.createTextOutput(JSON.stringify(json))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const payload = JSON.parse(e.postData.contents);

    if (payload.action === "update") return handleUpdate(sheet, payload);
    if (payload.action === "create") return handleCreate(sheet, payload);
    if (payload.action === "restore") return handleRestore();

    return respond({ success: false, error: "Acción no reconocida: " + payload.action });
  } catch (err) {
    return respond({ success: false, error: String(err) });
  }
}

function handleRestore() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const activeSheet = ss.getSheetByName(SHEET_NAME);
  const demoSheet = ss.getSheetByName(DEMO_SHEET_NAME);

  if (!demoSheet) {
    return respond({ success: false, error: "No se encontró la hoja de demo: " + DEMO_SHEET_NAME });
  }

  activeSheet.clear();

  const demoData = demoSheet.getDataRange().getValues();
  if (demoData.length > 0) {
    activeSheet.getRange(1, 1, demoData.length, demoData[0].length).setValues(demoData);
  }

  return respond({ success: true, action: "restore" });
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
        if (header === ID_COLUMN) return;
        if (Object.prototype.hasOwnProperty.call(payload, header)) {
          sheet.getRange(r + 1, c + 1).setValue(payload[header]);
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

  const nextId = getNextId(rows, idCol);

  const newRow = headers.map(header => {
    if (header === ID_COLUMN) return nextId; 
    if (header === TIMESTAMP_COLUMN) {
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