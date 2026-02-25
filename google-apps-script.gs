const SHEET_ID = '1_VT_QFvuObqWvA-4vngm7u_KBhfIA1AmP-BOjzncJwY';
const SHEET_NAME = 'Hoja1';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action || 'replaceAll';
    const records = Array.isArray(body.records) ? body.records : [];
    const record = body.record || null;

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
    ensureHeaders(sheet);

    if (action === 'append' && record) {
      sheet.appendRow([
        record.code || '',
        record.layout || 'N/A',
        record.date || '',
        record.used === true ? 'SI' : 'NO',
        record.usedAt || ''
      ]);
    } else {
      sheet.clearContents();
      ensureHeaders(sheet);
      if (records.length > 0) {
        const rows = records.map((row) => [
          row.code || '',
          row.layout || 'N/A',
          row.date || '',
          row.used === true ? 'SI' : 'NO',
          row.usedAt || ''
        ]);
        sheet.getRange(2, 1, rows.length, 5).setValues(rows);
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, action: action }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(error) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Codigo', 'Layout', 'Fecha', 'Usado', 'FechaUso']);
    return;
  }

  const headers = sheet.getRange(1, 1, 1, 5).getValues()[0];
  if (
    headers[0] !== 'Codigo' ||
    headers[1] !== 'Layout' ||
    headers[2] !== 'Fecha' ||
    headers[3] !== 'Usado' ||
    headers[4] !== 'FechaUso'
  ) {
    sheet.getRange(1, 1, 1, 5).setValues([['Codigo', 'Layout', 'Fecha', 'Usado', 'FechaUso']]);
  }
}
