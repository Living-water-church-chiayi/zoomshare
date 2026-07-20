const SPREADSHEET_ID = '11O0As3DWpT45otcL5T7BadMpPVWcWKAoiZ5OUPocMpA';
const SCHEDULE_COLUMNS = 'A:F';
const ROSTER_RANGE = '服務名單!A:G';

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function secureEqual_(left, right) {
  left = String(left || '');
  right = String(right || '');
  if (!left || left.length !== right.length) return false;
  var difference = 0;
  for (var index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function compactValues_(values) {
  var lastRow = values.length - 1;
  while (lastRow >= 0 && values[lastRow].every(function (cell) { return cell === ''; })) lastRow -= 1;
  return values.slice(0, lastRow + 1).map(function (row) {
    var lastCell = row.length - 1;
    while (lastCell >= 0 && row[lastCell] === '') lastCell -= 1;
    return row.slice(0, lastCell + 1);
  });
}

function readRange_(spreadsheet, rangeName) {
  var separator = rangeName.indexOf('!');
  if (separator <= 0) throw new Error('工作表範圍格式不正確');
  var sheet = spreadsheet.getSheetByName(rangeName.slice(0, separator));
  if (!sheet) throw new Error('找不到工作表：' + rangeName.slice(0, separator));
  return compactValues_(sheet.getRange(rangeName.slice(separator + 1)).getDisplayValues());
}

function readFirstSheet_(spreadsheet, columns) {
  var sheets = spreadsheet.getSheets();
  if (!sheets.length) throw new Error('試算表沒有任何工作表');
  return {
    range: sheets[0].getName() + '!' + columns,
    values: compactValues_(sheets[0].getRange(columns).getDisplayValues())
  };
}

function doGet() {
  return json_({ ok: false, error: 'Method not allowed' });
}

function doPost(event) {
  try {
    var expectedSecret = PropertiesService.getScriptProperties().getProperty('BRIDGE_SECRET');
    var request = JSON.parse(event && event.postData && event.postData.contents || '{}');
    if (!expectedSecret || !secureEqual_(request.secret, expectedSecret)) {
      return json_({ ok: false, error: 'Unauthorized' });
    }
    if (request.version !== 1) return json_({ ok: false, error: 'Unsupported version' });
    var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    var schedule = readFirstSheet_(spreadsheet, SCHEDULE_COLUMNS);
    return json_({
      ok: true,
      valueRanges: [
        schedule,
        { range: ROSTER_RANGE, values: readRange_(spreadsheet, ROSTER_RANGE) }
      ]
    });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message || error || 'Unknown error') });
  }
}
