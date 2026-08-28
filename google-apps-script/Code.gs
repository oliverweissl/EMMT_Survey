function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ok: true, service: 'bbox-survey'}))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const sheetName = 'responses';
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
    const headers = [
      'annotator_id', 'session_id', 'task_index', 'category', 'method', 'variant',
      'filename', 'label', 'label_index', 'total_labels', 'response_type',
      'reject_reason', 'bboxes', 'num_bboxes', 'image_width', 'image_height',
      'timestamp', 'server_received_at'
    ];
    if (sheet.getLastRow() === 0) sheet.appendRow(headers);
    const raw = e && e.postData && e.postData.contents
      ? e.postData.contents
      : (e && e.parameter && e.parameter.payload ? e.parameter.payload : '{}');
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed.responses) ? parsed.responses : [parsed];
    const receivedAt = new Date().toISOString();
    const rows = records.map(function(data) {
      return [
        data.annotator_id || '', data.session_id || '', data.task_index || '',
        data.category || '', data.method || '', data.variant || '', data.filename || '',
        data.label || '', data.label_index || '', data.total_labels || '',
        data.response_type || '', data.reject_reason || '', data.bboxes || '[]',
        data.num_bboxes || 0, data.image_width || '', data.image_height || '',
        data.timestamp || '', receivedAt
      ];
    });
    if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
    return ContentService.createTextOutput(JSON.stringify({ok: true, received: rows.length}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ok: false, error: String(error)}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
