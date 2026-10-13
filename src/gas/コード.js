/**
 * recipients-admin
 * 共有スプレッドシート line-recipients の入力画面（GAS Webアプリ）
 *
 * 目的：Families / Students への入力を、シート直接編集ではなく専用フォームから行う。
 * schedule-line / proposal-line と同じ共有スプレッドシート（RECIPIENTS_SPREADSHEET_ID）を対象にする。
 *
 *   Families：家族ID | 宛名 | 配信区分 | 保護者LINE_USER_ID | 登録日 | 配信有効フラグ
 *   Students：生徒ID | 家族ID | 学年 | 生徒氏名 | 兄弟順位 | 在籍フラグ | 生徒LINE_USER_ID
 *
 * 【安全方針】
 *   - 保存は該当行のみを更新し、他の行には触れない。
 *   - 既存行の更新は「値が実際に変わったセルだけ」を書き込む（未編集セルは元の値・型のまま温存）。
 *   - 行の削除機能は作らない（退塾は在籍フラグ FALSE で表す）。
 *   - 家族ID・生徒IDの自動採番はしない（手入力）。
 */

var FAMILIES_SHEET = 'Families';
var STUDENTS_SHEET = 'Students';
var FAM_HEADERS = ['家族ID', '宛名', '配信区分', '保護者LINE_USER_ID', '登録日', '配信有効フラグ'];
var ST_HEADERS  = ['生徒ID', '家族ID', '学年', '生徒氏名', '兄弟順位', '在籍フラグ', '生徒LINE_USER_ID'];

/**
 * Webアプリのエントリポイント。管理画面を返す。
 * @return {HtmlOutput}
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('admin')
    .setTitle('recipients-admin 受信者管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 対象スプレッドシートを開く。
 * @return {Spreadsheet}
 */
function _getSpreadsheet() {
  return SpreadsheetApp.openById(_getRequiredProp('RECIPIENTS_SPREADSHEET_ID'));
}

/**
 * 画面初期ロード：全家族（所属生徒つき）と、既存ID一覧（重複チェック用）を返す。
 * 値は表示値（getDisplayValues）で返す。
 * @return {{families: Object[], existingFamilyIds: string[], existingStudentIds: string[]}}
 */
function getData() {
  var ss = _getSpreadsheet();
  var fam = _readForEdit(ss, FAMILIES_SHEET, FAM_HEADERS);
  var st  = _readForEdit(ss, STUDENTS_SHEET, ST_HEADERS);

  // 生徒を家族IDでグループ化
  var studentsByFamily = {};
  var existingStudentIds = [];
  st.rows.forEach(function(row) {
    var sid = _trim(row[st.col['生徒ID']]);
    if (sid) existingStudentIds.push(sid);
    var fid = _trim(row[st.col['家族ID']]);
    var rec = {
      studentId: sid,
      familyId: fid,
      grade: _cell(row[st.col['学年']]),
      studentName: _cell(row[st.col['生徒氏名']]), // 加工しない（trimもしない）
      siblingOrder: _cell(row[st.col['兄弟順位']]),
      enrolled: _isEnrolled(row[st.col['在籍フラグ']]),
      lineId: _trim(row[st.col['生徒LINE_USER_ID']])
    };
    (studentsByFamily[fid] = studentsByFamily[fid] || []).push(rec);
  });

  var families = [];
  var existingFamilyIds = [];
  fam.rows.forEach(function(row, i) {
    var raw = fam.vals[i];
    var fid = _trim(row[fam.col['家族ID']]);
    if (fid) existingFamilyIds.push(fid);
    families.push({
      familyId: fid,
      name: _cell(row[fam.col['宛名']]),
      kubun: _cell(row[fam.col['配信区分']]),
      guardianId: _trim(row[fam.col['保護者LINE_USER_ID']]),
      registered: _registeredToInput(raw[fam.col['登録日']]), // 日付型 → yyyy-MM-dd（Asia/Tokyo）
      enabled: _isEnrolled(row[fam.col['配信有効フラグ']]),
      students: studentsByFamily[fid] || []
    });
  });

  return {
    families: families,
    existingFamilyIds: existingFamilyIds,
    existingStudentIds: existingStudentIds,
    today: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd') // 新規追加の登録日初期値（Asia/Tokyo）
  };
}

/**
 * 家族1件（Families行＋所属Students行）を保存する。該当行のみ更新、他行は不変。
 * 既存行は値が変わったセルのみ書き込む。新規行は末尾に追記する。
 *
 * payload = {
 *   isNewFamily: boolean,
 *   originalFamilyId: string,            // 編集時に行を特定するための元ID（新規は ''）
 *   family: { familyId, name, kubun, guardianId, registered, enabled },
 *   students: [ { isNew, originalStudentId, studentId, grade, studentName, siblingOrder, enrolled, lineId } ]
 * }
 * @param {Object} payload
 * @return {{success:boolean, familyAction:string, studentAppended:number, studentUpdated:number}}
 */
function saveFamily(payload) {
  var ss = _getSpreadsheet();
  var famSheet = ss.getSheetByName(FAMILIES_SHEET);
  var stSheet  = ss.getSheetByName(STUDENTS_SHEET);
  var famRead = _readForEdit(ss, FAMILIES_SHEET, FAM_HEADERS);
  var stRead  = _readForEdit(ss, STUDENTS_SHEET, ST_HEADERS);

  var f = payload.family;
  var fc = famRead.col;
  var familyAction;

  // --- Families ---
  var famRow = payload.isNewFamily ? -1 : _findRow(famRead, '家族ID', payload.originalFamilyId);
  if (famRow === -1) {
    var nf = famSheet.getLastRow() + 1;
    _setCell(famSheet, nf, fc['家族ID'], f.familyId);
    _setCell(famSheet, nf, fc['宛名'], f.name);
    _setCell(famSheet, nf, fc['配信区分'], f.kubun);
    _setCell(famSheet, nf, fc['保護者LINE_USER_ID'], f.guardianId);
    _setCell(famSheet, nf, fc['登録日'], _registeredToCellValue(f.registered));
    _setCell(famSheet, nf, fc['配信有効フラグ'], !!f.enabled);
    familyAction = 'append';
  } else {
    var cf = famRead.rows[famRow - 2];
    _setIfChanged(famSheet, famRow, fc['家族ID'], f.familyId, cf[fc['家族ID']]);
    _setIfChanged(famSheet, famRow, fc['宛名'], f.name, cf[fc['宛名']]);
    _setIfChanged(famSheet, famRow, fc['配信区分'], f.kubun, cf[fc['配信区分']]);
    _setIfChanged(famSheet, famRow, fc['保護者LINE_USER_ID'], f.guardianId, cf[fc['保護者LINE_USER_ID']]);
    _setRegisteredIfChanged(famSheet, famRow, fc['登録日'], f.registered, famRead.vals[famRow - 2][fc['登録日']]);
    _setBoolIfChanged(famSheet, famRow, fc['配信有効フラグ'], !!f.enabled, cf[fc['配信有効フラグ']]);
    familyAction = 'update';
  }

  // --- Students ---
  var sc = stRead.col;
  var appended = 0;
  var updated = 0;
  var nextRow = stSheet.getLastRow() + 1;
  (payload.students || []).forEach(function(s) {
    var row = s.isNew ? -1 : _findRow(stRead, '生徒ID', s.originalStudentId);
    if (row === -1) {
      var r = nextRow++;
      _setCell(stSheet, r, sc['生徒ID'], s.studentId);
      _setCell(stSheet, r, sc['家族ID'], f.familyId);
      _setCell(stSheet, r, sc['学年'], s.grade);
      _setCell(stSheet, r, sc['生徒氏名'], s.studentName); // 加工しない
      _setCell(stSheet, r, sc['兄弟順位'], s.siblingOrder);
      _setCell(stSheet, r, sc['在籍フラグ'], !!s.enrolled);
      _setCell(stSheet, r, sc['生徒LINE_USER_ID'], s.lineId);
      appended++;
    } else {
      var cs = stRead.rows[row - 2];
      _setIfChanged(stSheet, row, sc['生徒ID'], s.studentId, cs[sc['生徒ID']]);
      _setIfChanged(stSheet, row, sc['家族ID'], f.familyId, cs[sc['家族ID']]);
      _setIfChanged(stSheet, row, sc['学年'], s.grade, cs[sc['学年']]);
      _setIfChanged(stSheet, row, sc['生徒氏名'], s.studentName, cs[sc['生徒氏名']]);
      _setIfChanged(stSheet, row, sc['兄弟順位'], s.siblingOrder, cs[sc['兄弟順位']]);
      _setBoolIfChanged(stSheet, row, sc['在籍フラグ'], !!s.enrolled, cs[sc['在籍フラグ']]);
      _setIfChanged(stSheet, row, sc['生徒LINE_USER_ID'], s.lineId, cs[sc['生徒LINE_USER_ID']]);
      updated++;
    }
  });

  return { success: true, familyAction: familyAction, studentAppended: appended, studentUpdated: updated };
}

/**
 * シートを1行目ヘッダで読み、必須列の列番号と2行目以降の「表示値」を返す。
 * 行 index i は実シート行 (i + 2) に対応する。ヘッダ照合は空白を無視する。
 * @param {Spreadsheet} ss
 * @param {string} sheetName
 * @param {string[]} headers
 * @return {{col: Object.<string, number>, rows: string[][]}}
 */
function _readForEdit(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('共有スプレッドシートに「' + sheetName + '」シートが見つかりません。');
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    throw new Error('「' + sheetName + '」シートにヘッダ行がありません。');
  }
  var range = sheet.getRange(1, 1, lastRow, lastCol);
  var disp = range.getDisplayValues();
  var raw = range.getValues(); // 型つき生値（登録日の日付判定に使う）
  var header = disp[0].map(function(h) { return _normalizeName(h); });
  var col = {};
  var missing = [];
  headers.forEach(function(name) {
    var idx = header.indexOf(_normalizeName(name));
    if (idx === -1) missing.push(name); else col[name] = idx;
  });
  if (missing.length) {
    throw new Error('「' + sheetName + '」シートに列が見つかりません: ' + missing.join(', '));
  }
  return { col: col, rows: disp.slice(1), vals: raw.slice(1) };
}

/**
 * 指定列の値に一致する行の「実シート行番号」を返す（見つからなければ -1）。
 * @param {{col:Object, rows:Array}} read
 * @param {string} colName
 * @param {string} value
 * @return {number}
 */
function _findRow(read, colName, value) {
  var idx = read.col[colName];
  var v = _trim(value);
  if (v === '') return -1;
  for (var i = 0; i < read.rows.length; i++) {
    if (_trim(read.rows[i][idx]) === v) return i + 2;
  }
  return -1;
}

/**
 * セルに値を書く（0始まり列indexを1始まりに変換）。
 * @param {Sheet} sheet
 * @param {number} row
 * @param {number} col0
 * @param {*} val
 */
function _setCell(sheet, row, col0, val) {
  sheet.getRange(row, col0 + 1).setValue(val);
}

/**
 * 値が現在の表示値と異なるときだけ書き込む（文字列比較）。
 * @param {Sheet} sheet
 * @param {number} row
 * @param {number} col0
 * @param {*} newVal
 * @param {string} curDisplay
 */
function _setIfChanged(sheet, row, col0, newVal, curDisplay) {
  var a = (newVal == null) ? '' : String(newVal);
  var b = (curDisplay == null) ? '' : String(curDisplay);
  if (a !== b) sheet.getRange(row, col0 + 1).setValue(newVal);
}

/**
 * 真偽値が現在の表示値の真偽解釈と異なるときだけ boolean を書き込む。
 * @param {Sheet} sheet
 * @param {number} row
 * @param {number} col0
 * @param {boolean} newBool
 * @param {string} curDisplay
 */
function _setBoolIfChanged(sheet, row, col0, newBool, curDisplay) {
  if (!!newBool !== _isEnrolled(curDisplay)) {
    sheet.getRange(row, col0 + 1).setValue(!!newBool);
  }
}

/**
 * 登録日セルの生値を <input type="date"> 用の yyyy-MM-dd（Asia/Tokyo）に変換する。
 * 日付型 → 書式化、空 → ''、その他文字列 → そのまま（trim）。
 * @param {*} v
 * @return {string}
 */
function _registeredToInput(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  if (v == null) return '';
  return String(v).trim();
}

/**
 * yyyy-MM-dd 文字列を、日付型を保つための Date（Asia/Tokyo の暦日）に変換する。
 * 空文字は '' のまま（セルをクリア）。想定外の文字列はそのまま返す。
 * ※ スクリプトのタイムゾーンが Asia/Tokyo のため new Date(y,m,d) は JST 0:00 になる。
 * @param {string} s
 * @return {Date|string}
 */
function _registeredToCellValue(s) {
  s = (s == null) ? '' : String(s).trim();
  if (s === '') return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * 登録日専用の差分書き込み。提出値(yyyy-MM-dd/空)と、現在のセル生値を
 * yyyy-MM-dd へ揃えて比較し、変わったときだけ書き込む（日付型を温存）。
 * @param {Sheet} sheet
 * @param {number} row
 * @param {number} col0
 * @param {string} submitted - yyyy-MM-dd または ''
 * @param {*} curRaw - 現在セルの生値（Date など）
 */
function _setRegisteredIfChanged(sheet, row, col0, submitted, curRaw) {
  var baseline = _registeredToInput(curRaw);
  var sub = (submitted == null) ? '' : String(submitted).trim();
  if (sub !== baseline) {
    sheet.getRange(row, col0 + 1).setValue(_registeredToCellValue(sub));
  }
}

/**
 * フラグ解釈。boolean true / "TRUE" / "1" / "○" / "はい" / "在籍" を真とみなす。
 * @param {*} v
 * @return {boolean}
 */
function _isEnrolled(v) {
  if (v === true) return true;
  if (v === false || v == null || v === '') return false;
  return /^(true|1|yes|y|○|はい|在籍)$/i.test(String(v).trim());
}

/**
 * セル値を文字列化（null安全・trimしない）。
 * @param {*} v
 * @return {string}
 */
function _cell(v) {
  return (v == null) ? '' : String(v);
}

/**
 * 文字列トリム（null安全）。ID等の比較用。
 * @param {*} v
 * @return {string}
 */
function _trim(v) {
  return String(v == null ? '' : v).trim();
}

/**
 * ヘッダ照合用：空白（半角・全角）を除去。
 * @param {*} s
 * @return {string}
 */
function _normalizeName(s) {
  if (s == null) return '';
  return String(s).replace(/[\s　]/g, '');
}

/**
 * 必須スクリプトプロパティ取得（未設定なら例外）。
 * @param {string} key
 * @return {string}
 */
function _getRequiredProp(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) {
    throw new Error('スクリプトプロパティ「' + key + '」が設定されていません。');
  }
  return v;
}
