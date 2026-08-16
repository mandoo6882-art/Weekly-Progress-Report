// 브라우저(관리자 업로드 화면)에서 실행되는 엑셀 파싱/추출 로직.
// 원본 파일은 서버로 전송하지 않고, 이 모듈이 브라우저에서 필요한 범위만 추출해
// 작은 JSON으로 만든 뒤 서버에 저장합니다.
import * as XLSX from 'xlsx';
import { TAB_CONFIGS } from './tabConfig';

function isDateSerial(v) {
  return typeof v === 'number' && v > 20000 && v < 60000;
}

export function excelSerialToDate(serial) {
  if (!isDateSerial(serial)) return serial;
  const utcDays = Math.floor(serial - 25569);
  const utcMs = utcDays * 86400 * 1000;
  const d = new Date(utcMs);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getUTCDate()).padStart(2, '0')}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

// 지정한 행 구간(rowStart~rowEnd, 1-based, 포함)을 시트 전체 열 범위에서 가져온 뒤
// 값이 있는 열만 남기고 잘라냅니다. 숫자 중 날짜로 보이는 값은 자동 변환합니다.
function extractRowBandTrimmed(ws, rowStart, rowEnd) {
  const full = XLSX.utils.decode_range(ws['!ref']);
  const range = { s: { r: rowStart - 1, c: full.s.c }, e: { r: rowEnd - 1, c: full.e.c } };
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range, defval: '' });

  let minC = Infinity;
  let maxC = -1;
  rows.forEach((r) => {
    r.forEach((v, i) => {
      if (v !== '' && v !== null && v !== undefined) {
        if (i < minC) minC = i;
        if (i > maxC) maxC = i;
      }
    });
  });
  if (maxC === -1) return [];

  return rows.map((r) =>
    r.slice(minC, maxC + 1).map((v) => (isDateSerial(v) ? excelSerialToDate(v) : v))
  );
}

// A1 표기 범위(예: 'X50:AO62')를 그대로 추출. dateCols는 추출된 배열 기준 0-based
// 열 인덱스 목록으로, 해당 열만 날짜로 변환합니다(수량 값이 날짜로 오인식되는 것 방지).
function extractRange(ws, rangeA1, dateCols = []) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: rangeA1, defval: '' });
  if (!dateCols.length) return rows;
  return rows.map((r) => {
    const copy = r.slice();
    dateCols.forEach((ci) => {
      if (isDateSerial(copy[ci])) copy[ci] = excelSerialToDate(copy[ci]);
    });
    return copy;
  });
}

// 단일 셀 값을 가져옵니다(예: 'U3'). 날짜로 보이면 자동 변환합니다.
function getCellValue(ws, addr) {
  const cell = ws[addr];
  if (!cell) return null;
  return isDateSerial(cell.v) ? excelSerialToDate(cell.v) : cell.v;
}

// 숫자는 소수점 둘째 자리까지, percentColIdx에 해당하는 열은 백분율(×100 + %)로 표시합니다.
// 문자열/날짜(이미 변환된 값)는 그대로 둡니다.
function formatNumericGrid(rows, percentColIdxList = []) {
  const percentSet = new Set(percentColIdxList);
  return rows.map((row) =>
    row.map((cell, ci) => {
      if (typeof cell !== 'number') return cell;
      if (percentSet.has(ci)) return `${(cell * 100).toFixed(2)}%`;
      return cell.toFixed(2);
    })
  );
}

function rowValuesAtCols(ws, r, colLetters) {
  return colLetters.map((cl) => {
    const c = XLSX.utils.decode_col(cl);
    const addr = XLSX.utils.encode_cell({ r: r - 1, c });
    const cell = ws[addr];
    return cell ? cell.v : null;
  });
}

function extractTrendChartAtCols(ws, { datesRow, seriesRows, cols, labelCol }) {
  const categoriesRaw = rowValuesAtCols(ws, datesRow, cols);
  const categories = categoriesRaw.map((v) => (isDateSerial(v) ? excelSerialToDate(v) : v));

  const series = seriesRows.map(({ row, type }) => {
    const c = XLSX.utils.decode_col(labelCol);
    const addr = XLSX.utils.encode_cell({ r: row - 1, c });
    const cell = ws[addr];
    return {
      label: cell ? String(cell.v) : `Row ${row}`,
      type,
      data: rowValuesAtCols(ws, row, cols).map((v) => (typeof v === 'number' ? v : null)),
    };
  });

  return { categories, series };
}

// anchorCol 열에서 anchorPattern에 맞는 텍스트를 찾고, 그 아래 표(colStart~colEnd)를
// 헤더 행부터 데이터가 끊기는 행까지 자동으로 인식해 추출합니다.
function extractDelayedList(ws, { anchorCol, anchorPattern, colStart, colEnd, dateCols = [] }) {
  const full = XLSX.utils.decode_range(ws['!ref']);
  const anchorColIdx = XLSX.utils.decode_col(anchorCol);

  let anchorRow = -1;
  for (let r = full.s.r; r <= full.e.r; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: anchorColIdx });
    const cell = ws[addr];
    const v = cell ? cell.v : undefined;
    if (typeof v === 'string' && anchorPattern.test(v)) {
      anchorRow = r;
      break;
    }
  }
  if (anchorRow === -1) return { anchorText: null, rows: [] };

  const anchorText = ws[XLSX.utils.encode_cell({ r: anchorRow, c: anchorColIdx })].v;
  const colStartIdx = XLSX.utils.decode_col(colStart);
  const colEndIdx = XLSX.utils.decode_col(colEnd);

  const rowHasData = (r) => {
    for (let c = colStartIdx; c <= colEndIdx; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell && cell.v !== undefined && cell.v !== '') return true;
    }
    return false;
  };

  let headerRow = anchorRow + 1;
  while (headerRow <= full.e.r && !rowHasData(headerRow)) headerRow++;

  let lastRow = headerRow;
  let r = headerRow;
  while (r <= full.e.r && rowHasData(r)) {
    lastRow = r;
    r++;
  }

  const range = { s: { r: headerRow, c: colStartIdx }, e: { r: lastRow, c: colEndIdx } };
  let rows = XLSX.utils.sheet_to_json(ws, { header: 1, range, defval: '' });
  if (dateCols.length) {
    rows = rows.map((row) => {
      const copy = row.slice();
      dateCols.forEach((ci) => {
        if (isDateSerial(copy[ci])) copy[ci] = excelSerialToDate(copy[ci]);
      });
      return copy;
    });
  }

  return { anchorText, rows };
}

// 43행 간격으로 반복되는 디시플린별 트렌드 블록(WeeklyProgTrend 시트)을 자동으로 찾아
// 각각 콤보 차트(막대: Plan/Actual 증분, 꺾은선: Variance)로 만들 데이터를 생성합니다.
function extractWeeklyProgTrendBlocks(ws, opts = {}) {
  const {
    firstHeaderRow = 2,
    blockHeight = 43,
    headerCol = 'B',
    datesOffset = 31,
    seriesOffsets = [
      { offset: 35, type: 'bar' }, // Plan (JP) Inc.
      { offset: 37, type: 'bar' }, // Actual/FCST Inc.
      { offset: 39, type: 'line' }, // Variance (JP)
    ],
    labelCol = 'E',
    cols = ['C', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
    maxBlocks = 40,
  } = opts;

  const full = XLSX.utils.decode_range(ws['!ref']);
  const headerColIdx = XLSX.utils.decode_col(headerCol);
  const blocks = [];

  for (let i = 0; i < maxBlocks; i++) {
    const headerRow = firstHeaderRow + i * blockHeight;
    if (headerRow > full.e.r + 1) break;
    const addr = XLSX.utils.encode_cell({ r: headerRow - 1, c: headerColIdx });
    const cell = ws[addr];
    const title = cell ? String(cell.v).trim() : '';
    if (!title) break;

    const datesRow = headerRow + datesOffset;
    const chart = extractTrendChartAtCols(ws, {
      datesRow,
      seriesRows: seriesOffsets.map((s) => ({ row: headerRow + s.offset, type: s.type })),
      cols,
      labelCol,
    });

    blocks.push({ title, chart });
  }

  return blocks;
}

// 파일명에서 "as of" 날짜 부분을 뽑아 사람이 읽기 쉬운 문자열로 정리
function guessAsOf(filename, prefix) {
  const rest = filename.slice(prefix.length).replace(/\.(xlsx|xlsb|xls)$/i, '');
  return rest.replace(/^[_\s]+/, '').trim() || null;
}

export function validateFile(tabId, file) {
  const cfg = TAB_CONFIGS.find((t) => t.id === tabId);
  if (!cfg) return { ok: false, error: '알 수 없는 탭입니다.' };

  const name = file.name;
  const nameLower = name.toLowerCase();
  const prefixLower = cfg.filePrefix.toLowerCase();
  const extLower = cfg.fileExt.toLowerCase();

  if (!nameLower.startsWith(prefixLower)) {
    return {
      ok: false,
      error: `파일명이 "${cfg.filePrefix}"로 시작해야 합니다.\n(예: ${cfg.example})`,
    };
  }
  if (!nameLower.endsWith(extLower)) {
    return { ok: false, error: `파일 확장자는 ${cfg.fileExt} 여야 합니다.` };
  }
  return { ok: true };
}

// 탭별 추출 진입점. arrayBuffer를 받아 워크북을 열고, 탭에 맞는 표/차트 데이터를 만듭니다.
export async function parseTabFile(tabId, arrayBuffer, filename) {
  const cfg = TAB_CONFIGS.find((t) => t.id === tabId);
  if (!cfg) throw new Error('알 수 없는 탭입니다.');

  // 브라우저의 File.arrayBuffer()는 순수 ArrayBuffer를 반환하는데, SheetJS의 'array' 타입은
  // 바이트 배열(Uint8Array)을 기대합니다. 변환하지 않으면 특히 .xlsb(복합 바이너리 포맷) 파일이
  // 암호화된 파일로 잘못 인식되어 "ECMA-376 Encrypted file missing /EncryptionInfo" 오류가 납니다.
  const bytes = new Uint8Array(arrayBuffer);
  const wb = XLSX.read(bytes, { type: 'array', sheets: cfg.sheets });
  const asOf = guessAsOf(filename, cfg.filePrefix);
  const result = { sourceFile: filename, asOf, tables: [], charts: [], cutoffDate: null };

  if (tabId === 'overall-progress') {
    const wsProgress = wb.Sheets['Progress Table_weekly (JP)'];
    const wsTrend = wb.Sheets['Var. Trend (JP)'];
    if (!wsProgress || !wsTrend) throw new Error('필요한 시트를 찾을 수 없습니다 (Progress Table_weekly (JP) / Var. Trend (JP)).');

    // U3 셀의 cut-off date
    result.cutoffDate = getCellValue(wsProgress, 'U3');

    // E3:V11 고정 범위. T열(E기준 15번째, 0-based)은 날짜, H열(3번째)은 WT% 백분율.
    const progressRaw = extractRange(wsProgress, 'E3:V11', [15]);
    result.tables.push({
      title: 'Progress Table_weekly (JP) — E3:V11',
      rows: formatNumericGrid(progressRaw, [3]),
    });
    result.tables.push({
      title: 'Var. Trend (JP) — 행 2~33',
      rows: extractRowBandTrimmed(wsTrend, 2, 33),
    });
    const { categories, series } = extractTrendChartAtCols(wsTrend, {
      datesRow: 27,
      seriesRows: [
        { row: 30, type: 'bar' },
        { row: 32, type: 'bar' },
        { row: 33, type: 'line' },
      ],
      cols: ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
      labelCol: 'B',
    });
    result.charts.push({ title: 'EPC Overall Progress (Var. Trend)', categories, series });
  }

  if (tabId === 'critical-milestone') {
    const ws = wb.Sheets['CM'];
    if (!ws) throw new Error('필요한 시트를 찾을 수 없습니다 (CM).');
    result.tables.push({
      title: 'Critical Milestone — 행 19~43',
      rows: extractRowBandTrimmed(ws, 19, 43),
    });
  }

  if (tabId === 'procurement') {
    const wsDash = wb.Sheets['Dashboard'];
    const wsDelay = wb.Sheets['Delayed List'];
    if (!wsDash || !wsDelay) throw new Error('필요한 시트를 찾을 수 없습니다 (Dashboard / Delayed List).');

    result.tables.push({
      title: 'Dashboard — X50:AO62',
      rows: extractRange(wsDash, 'X50:AO62'),
    });

    const { anchorText, rows } = extractDelayedList(wsDelay, {
      anchorCol: 'BJ',
      anchorPattern: /Delayed List.*Internal Target/i,
      colStart: 'BJ',
      colEnd: 'BS',
      dateCols: [6, 7, 8],
    });
    result.tables.push({
      title: anchorText ? `Delayed List — ${anchorText}` : 'Delayed List',
      rows,
    });
  }

  if (tabId === 'construction') {
    const wsDash = wb.Sheets['Dashboard(JP)'];
    const wsTrend = wb.Sheets['WeeklyProgTrend'];
    if (!wsDash || !wsTrend) throw new Error('필요한 시트를 찾을 수 없습니다 (Dashboard(JP) / WeeklyProgTrend).');

    result.tables.push({
      title: 'Dashboard(JP) — Progress Status (X29:AO43)',
      rows: extractRange(wsDash, 'X29:AO43'),
    });
    result.tables.push({
      title: 'Dashboard(JP) — Major Quantity Status (H47:AD71)',
      rows: extractRange(wsDash, 'H47:AD71', [21]),
    });

    const blocks = extractWeeklyProgTrendBlocks(wsTrend, {});
    blocks.forEach((b) => {
      result.charts.push({
        title: `WeeklyProgTrend — ${b.title}`,
        categories: b.chart.categories,
        series: b.chart.series,
      });
    });
  }

  return result;
}
