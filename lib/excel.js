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

// 완전히 빈 행은 제거합니다.
function removeBlankRows(rows) {
  return rows.filter((row) => row.some((v) => v !== '' && v !== null && v !== undefined));
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

// A1 범위를 병합 셀(colSpan/rowSpan) 정보까지 포함해서 추출합니다.
// 반환값: 각 행은 { value, colSpan, rowSpan, hidden } 객체의 배열.
// hidden=true인 셀은 다른 셀의 병합 범위에 포함되어 화면에 그리지 않아야 합니다.
// customMerges를 넘기면 시트의 실제 병합 정보 대신 그 값을 사용합니다(엑셀에 병합으로
// 저장되어 있지 않지만 시각적으로 합쳐 보여주고 싶은 경우).
function extractRangeWithMerges(ws, rangeA1, customMerges = null) {
  const range = XLSX.utils.decode_range(rangeA1);
  const merges = customMerges || ws['!merges'] || [];
  const numRows = range.e.r - range.s.r + 1;
  const numCols = range.e.c - range.s.c + 1;

  const grid = [];
  for (let r = 0; r < numRows; r++) {
    const row = [];
    for (let c = 0; c < numCols; c++) {
      const addr = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c });
      const cell = ws[addr];
      let v = cell ? cell.v : '';
      if (isDateSerial(v)) v = excelSerialToDate(v);
      row.push({ value: v === undefined ? '' : v, colSpan: 1, rowSpan: 1, hidden: false });
    }
    grid.push(row);
  }

  merges.forEach((m) => {
    if (m.s.r > range.e.r || m.e.r < range.s.r || m.s.c > range.e.c || m.e.c < range.s.c) return;

    const localR = m.s.r - range.s.r;
    const localC = m.s.c - range.s.c;
    if (localR < 0 || localC < 0 || localR >= numRows || localC >= numCols) return;

    const spanR = Math.min(m.e.r - m.s.r + 1, numRows - localR);
    const spanC = Math.min(m.e.c - m.s.c + 1, numCols - localC);
    if (spanR < 1 || spanC < 1) return;

    grid[localR][localC].colSpan = spanC;
    grid[localR][localC].rowSpan = spanR;

    for (let rr = localR; rr < localR + spanR; rr++) {
      for (let cc = localC; cc < localC + spanC; cc++) {
        if (rr === localR && cc === localC) continue;
        grid[rr][cc].hidden = true;
      }
    }
  });

  return grid;
}

// 병합 셀 그리드에서, 병합에 관여하지 않는(다른 셀에 가려지지도, 자기가 여러 행에
// 걸치지도 않는) 완전히 빈 행만 제거합니다. 병합 구조를 깨지 않기 위한 안전한 제거입니다.
function removeBlankMergeRows(grid) {
  return grid.filter((row) => {
    const touchesMerge = row.some((cell) => cell.hidden || cell.rowSpan > 1);
    if (touchesMerge) return true;
    return row.some((cell) => cell.value !== '' && cell.value !== null && cell.value !== undefined);
  });
}

// 병합 셀 그리드의 value에 숫자 서식(둘째 자리 + 지정 열 백분율)을 적용합니다.
function formatMergeGrid(grid, percentColIdxList = []) {
  const percentSet = new Set(percentColIdxList);
  return grid.map((row) =>
    row.map((cell, ci) => {
      if (typeof cell.value !== 'number') return cell;
      const value = percentSet.has(ci) ? `${(cell.value * 100).toFixed(2)}%` : cell.value.toFixed(2);
      return { ...cell, value };
    })
  );
}

// 단일 셀 값을 가져옵니다(예: 'U3'). 날짜로 보이면 자동 변환합니다.
function getCellValue(ws, addr) {
  const cell = ws[addr];
  if (!cell) return null;
  return isDateSerial(cell.v) ? excelSerialToDate(cell.v) : cell.v;
}

// 정확한 셀 위치를 모를 때, 해당 행(colStart~colEnd) 안에서 값이 있는 첫 번째 셀을 찾습니다.
function findFirstValueInRow(ws, row, colStart, colEnd) {
  const c1 = XLSX.utils.decode_col(colStart);
  const c2 = XLSX.utils.decode_col(colEnd);
  for (let c = c1; c <= c2; c++) {
    const addr = XLSX.utils.encode_cell({ r: row - 1, c });
    const cell = ws[addr];
    if (cell && cell.v !== undefined && cell.v !== '') {
      return isDateSerial(cell.v) ? excelSerialToDate(cell.v) : cell.v;
    }
  }
  return null;
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

// 차트에 쓰인 categories/series를 그대로 "수치 표"로도 변환합니다 (차트 하단에 표시용).
// 값은 모두 퍼센트(증분/편차 성격의 값)로 표시합니다.
function chartToPercentTable(categories, series) {
  const header = ['', ...categories];
  const dataRows = series.map((s) => [
    s.label,
    ...s.data.map((v) => (typeof v === 'number' ? `${(v * 100).toFixed(2)}%` : '')),
  ]);
  return [header, ...dataRows];
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

// 탭별 추출 진입점. arrayBuffer를 받아 워크북을 열고, 탭에 맞는 순서(blocks)로
// 표/차트 데이터를 만듭니다. blocks는 화면에 위에서부터 그려지는 순서 그대로입니다.
export async function parseTabFile(tabId, arrayBuffer, filename) {
  const cfg = TAB_CONFIGS.find((t) => t.id === tabId);
  if (!cfg) throw new Error('알 수 없는 탭입니다.');

  // 브라우저의 File.arrayBuffer()는 순수 ArrayBuffer를 반환하는데, SheetJS의 'array' 타입은
  // 바이트 배열(Uint8Array)을 기대합니다. 변환하지 않으면 특히 .xlsb(복합 바이너리 포맷) 파일이
  // 암호화된 파일로 잘못 인식되어 "ECMA-376 Encrypted file missing /EncryptionInfo" 오류가 납니다.
  const bytes = new Uint8Array(arrayBuffer);
  const wb = XLSX.read(bytes, { type: 'array', sheets: cfg.sheets });
  const asOf = guessAsOf(filename, cfg.filePrefix);
  const result = { sourceFile: filename, asOf, cutoffDate: null, blocks: [] };

  if (tabId === 'overall-progress') {
    const wsProgress = wb.Sheets['Progress Table_weekly (JP)'];
    const wsTrend = wb.Sheets['Var. Trend (JP)'];
    if (!wsProgress || !wsTrend) throw new Error('필요한 시트를 찾을 수 없습니다 (Progress Table_weekly (JP) / Var. Trend (JP)).');

    // 행3 = 제목, 행4 = cut-off date (정확한 열을 몰라도 되도록 E~V 범위에서 첫 값 사용)
    result.title = findFirstValueInRow(wsProgress, 3, 'E', 'V');
    result.cutoffDate = findFirstValueInRow(wsProgress, 4, 'E', 'V');

    // 표 본문은 행5~10만. 행5(상대 0번째 행)에 지정된 열 병합을 그대로 적용.
    // E=0,F=1,G=2,H=3,I=4,J=5,K=6,L=7,M=8,N=9,O=10,P=11,Q=12,R=13,S=14,T=15,U=16,V=17 (E 기준 0-based)
    const row5Merges = ['E5:G5', 'I5:L5', 'M5:O5', 'P5:S5', 'U5:V5'].map((a1) => XLSX.utils.decode_range(a1));
    const progressGridRaw = extractRangeWithMerges(wsProgress, 'E5:V10', row5Merges);
    // T열(15번째, 0-based)은 표에서 제외
    const progressGrid = progressGridRaw.map((row) => row.filter((_, idx) => idx !== 15));
    // H열(WT%, 3번째 열)만 백분율로 표시
    const progressRows = removeBlankMergeRows(formatMergeGrid(progressGrid, [3]));
    result.blocks.push({
      type: 'table',
      title: 'Overall Progress (E5:V10)',
      rows: progressRows,
      headerRowCount: 2, // 행5(병합 헤더) + 행6(세부 헤더)
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
    result.blocks.push({ type: 'chart', title: 'EPC Overall Progress Trend', categories, series });

    // 엑셀 27~33행 그대로(B~L열: 날짜/Plan/Plan Inc./Actual-FCST/Actual-FCST Inc./Variance)
    const trendRaw = extractRange(wsTrend, 'B27:L33', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const trendRows = removeBlankRows(formatNumericGrid(trendRaw, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    result.blocks.push({
      type: 'table',
      title: 'Var. Trend — 수치 (B27:L33)',
      rows: trendRows,
      headerRowCount: 1,
    });
  }

  if (tabId === 'critical-milestone') {
    const ws = wb.Sheets['CM'];
    if (!ws) throw new Error('필요한 시트를 찾을 수 없습니다 (CM).');
    const rows = removeBlankRows(extractRowBandTrimmed(ws, 19, 43));
    result.blocks.push({ type: 'table', title: 'Critical Milestone', rows, headerRowCount: 2 });
  }

  if (tabId === 'procurement') {
    const wsDash = wb.Sheets['Dashboard'];
    const wsDelay = wb.Sheets['Delayed List'];
    if (!wsDash || !wsDelay) throw new Error('필요한 시트를 찾을 수 없습니다 (Dashboard / Delayed List).');

    const dashRows = removeBlankRows(extractRange(wsDash, 'X50:AO62'));
    result.blocks.push({ type: 'table', title: 'Dashboard', rows: dashRows, headerRowCount: 3 });

    const { anchorText, rows } = extractDelayedList(wsDelay, {
      anchorCol: 'BJ',
      anchorPattern: /Delayed List.*Internal Target/i,
      colStart: 'BJ',
      colEnd: 'BS',
      dateCols: [6, 7, 8],
    });
    result.blocks.push({
      type: 'table',
      title: anchorText ? `Delayed List — ${anchorText}` : 'Delayed List',
      rows: removeBlankRows(rows),
      headerRowCount: 1,
    });
  }

  if (tabId === 'construction') {
    const wsDash = wb.Sheets['Dashboard(JP)'];
    const wsTrend = wb.Sheets['WeeklyProgTrend'];
    if (!wsDash || !wsTrend) throw new Error('필요한 시트를 찾을 수 없습니다 (Dashboard(JP) / WeeklyProgTrend).');

    result.blocks.push({
      type: 'table',
      title: 'Dashboard(JP) — Progress Status',
      rows: removeBlankRows(extractRange(wsDash, 'X29:AO43')),
      headerRowCount: 3,
    });
    result.blocks.push({
      type: 'table',
      title: 'Dashboard(JP) — Major Quantity Status',
      rows: removeBlankRows(extractRange(wsDash, 'H47:AD71', [21])),
      headerRowCount: 3,
    });

    const blocks = extractWeeklyProgTrendBlocks(wsTrend, {});
    blocks.forEach((b) => {
      result.blocks.push({
        type: 'chart',
        title: `WeeklyProgTrend — ${b.title}`,
        categories: b.chart.categories,
        series: b.chart.series,
      });
      result.blocks.push({
        type: 'table',
        title: `${b.title} — 수치`,
        rows: chartToPercentTable(b.chart.categories, b.chart.series),
        headerRowCount: 1,
      });
    });
  }

  return result;
}
