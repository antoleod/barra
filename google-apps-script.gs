const SHEET_ID = '1_VT_QFvuObqWvA-4vngm7u_KBhfIA1AmP-BOjzncJwY';
const SHEET_NAME = 'Hoja1';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const records = Array.isArray(body.records) ? body.records : [];

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

    sheet.clearContents();
    sheet.appendRow(['Codigo', 'Layout', 'Fecha']);

    if (records.length > 0) {
      const rows = records.map((record) => [
        record.code || '',
        record.layout || 'N/A',
        record.date || ''
      ]);
      sheet.getRange(2, 1, rows.length, 3).setValues(rows);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, rows: records.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(error) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
