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
// dateColIdxList를 넘기면 그 열(추출 배열 기준 0-based)만 날짜 변환을 시도합니다.
// 넘기지 않으면(=null) 기존처럼 모든 셀에 대해 날짜로 보이면 변환합니다.
function extractRangeWithMerges(ws, rangeA1, customMerges = null, dateColIdxList = null) {
  const range = XLSX.utils.decode_range(rangeA1);
  const merges = customMerges || ws['!merges'] || [];
  const numRows = range.e.r - range.s.r + 1;
  const numCols = range.e.c - range.s.c + 1;
  const dateSet = dateColIdxList ? new Set(dateColIdxList) : null;

  const grid = [];
  for (let r = 0; r < numRows; r++) {
    const row = [];
    for (let c = 0; c < numCols; c++) {
      const addr = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c });
      const cell = ws[addr];
      let v = cell ? cell.v : '';
      const checkDate = dateSet ? dateSet.has(c) : true;
      if (checkDate && isDateSerial(v)) v = excelSerialToDate(v);
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

// A1 범위를 병합 없이 순수 값(2차원 배열)으로만 추출합니다. dateColIdxList가 있으면
// 그 열(추출 배열 기준 0-based)만 날짜로 변환합니다.
function extractPlainValues(ws, rangeA1, dateColIdxList = null) {
  const range = XLSX.utils.decode_range(rangeA1);
  const dateSet = dateColIdxList ? new Set(dateColIdxList) : null;
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      let v = cell ? cell.v : '';
      const checkDate = dateSet ? dateSet.has(c - range.s.c) : true;
      if (checkDate && isDateSerial(v)) v = excelSerialToDate(v);
      row.push(v === undefined ? '' : v);
    }
    rows.push(row);
  }
  return rows;
}

// 한 행의 값 배열을 받아, groups(예: [[0,3],[4,5], ...] — 0-based 열 구간)마다
// "그 구간 안에서 값이 있는 첫 칸부터 구간 끝까지"만 병합합니다. 즉 오른쪽으로 이어지는
// 빈 칸만 병합하고, 값보다 앞쪽의 빈 칸(들여쓰기 등으로 의도된 것)은 그대로 둡니다.
// 헤더 행(라벨이 항상 구간 맨 앞 칸에 있음)과 데이터 행(들여쓰기로 값이 중간 칸에
// 있을 수 있음) 모두 자연스럽게 처리됩니다.
function mergeRowTrailingBlanks(rowValues, groups) {
  const cells = rowValues.map((v) => ({ value: v === undefined ? '' : v, colSpan: 1, rowSpan: 1, hidden: false }));
  groups.forEach(([s, e]) => {
    let firstNonEmpty = -1;
    for (let c = s; c <= e; c++) {
      const v = cells[c]?.value;
      if (v !== '' && v !== null && v !== undefined) {
        firstNonEmpty = c;
        break;
      }
    }
    if (firstNonEmpty === -1) return; // 구간 전체가 빈 값이면 그대로 둠
    const span = e - firstNonEmpty + 1;
    if (span > 1) {
      cells[firstNonEmpty].colSpan = span;
      for (let c = firstNonEmpty + 1; c <= e; c++) cells[c].hidden = true;
    }
  });
  return cells;
}

// 범위를 읽어 행마다 mergeRowTrailingBlanks를 적용합니다. bigRowOffset(0-based, 범위 내 상대 행)에는
// groupsBig을, 그 외 모든 행에는 groupsDefault를 사용합니다.
function buildGroupedMergeTable(ws, rangeA1, { bigRowOffset, groupsDefault, groupsBig, dateColIdxList = null }) {
  const grid2D = extractPlainValues(ws, rangeA1, dateColIdxList);
  return grid2D.map((rowValues, ri) => mergeRowTrailingBlanks(rowValues, ri === bigRowOffset ? groupsBig : groupsDefault));
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

// 병합 셀 그리드의 숫자를 정수(천단위 콤마)로 표시합니다. skipColIdxSet에 있는 열은 건너뜁니다
// (다른 서식, 예: 증감 세모 표시가 이미 적용된 열).
function formatIntegerMergeGrid(grid, skipColIdxSet = new Set()) {
  return grid.map((row) =>
    row.map((cell, ci) => {
      if (skipColIdxSet.has(ci)) return cell;
      if (typeof cell.value !== 'number') return cell;
      return { ...cell, value: Math.round(cell.value).toLocaleString('en-US') };
    })
  );
}

// 지정한 열(Variance 성격의 값)에 대해 음수는 빨간 아래세모(▼), 양수는 파란 위세모(▲)로
// 표시합니다. cls 속성을 셀에 추가해 화면에서 색을 입힐 수 있게 합니다.
function applyVarianceIndicator(grid, colIdxList) {
  const set = new Set(colIdxList);
  return grid.map((row) =>
    row.map((cell, ci) => {
      if (!set.has(ci)) return cell;
      if (typeof cell.value !== 'number') return cell;
      const rounded = Math.round(cell.value);
      if (rounded < 0) {
        return { ...cell, value: `▼ ${Math.abs(rounded).toLocaleString('en-US')}`, cls: 'variance-down' };
      }
      if (rounded > 0) {
        return { ...cell, value: `▲ ${rounded.toLocaleString('en-US')}`, cls: 'variance-up' };
      }
      return { ...cell, value: '0' };
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

// 하나의 트렌드 블록(날짜 행 + Plan/Plan Inc./Actual-FCST/Actual-FCST Inc./Variance 5개 행)에서
// - 차트1: 막대(Plan Inc., Actual/FCST Inc.) + 꺾은선(Plan 누적, Actual/FCST 누적)
// - 차트2: 꺾은선(Variance)만 별도 차트
// - 표: 날짜 / Plan / Plan Inc. / Actual-FCST / Actual-FCST Inc. / Variance 순서, 단일 날짜 행
// 를 만들어 반환합니다. tab1(Var. Trend)과 tab4(WeeklyProgTrend) 양쪽에서 공용으로 씁니다.
function buildTrendChartsAndTable(ws, { datesRow, planRow, planIncRow, actualRow, actualIncRow, varianceRow, cols, labelCol }) {
  const categoriesRaw = rowValuesAtCols(ws, datesRow, cols);
  const categories = categoriesRaw.map((v) => (isDateSerial(v) ? excelSerialToDate(v) : v));

  function seriesAt(row, type) {
    const c = XLSX.utils.decode_col(labelCol);
    const addr = XLSX.utils.encode_cell({ r: row - 1, c });
    const cell = ws[addr];
    return {
      label: cell ? String(cell.v) : `Row ${row}`,
      type,
      data: rowValuesAtCols(ws, row, cols).map((v) => (typeof v === 'number' ? v : null)),
    };
  }

  const planS = seriesAt(planRow, 'line');
  const planIncS = seriesAt(planIncRow, 'bar');
  const actualS = seriesAt(actualRow, 'line');
  const actualIncS = seriesAt(actualIncRow, 'bar');
  const varianceS = seriesAt(varianceRow, 'line');

  const chart1 = { categories, series: [planIncS, actualIncS, planS, actualS] };
  const chart2 = { categories, series: [varianceS] };

  const pct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(2)}%` : '');
  const table = [
    ['', ...categories],
    [planS.label, ...planS.data.map(pct)],
    [planIncS.label, ...planIncS.data.map(pct)],
    [actualS.label, ...actualS.data.map(pct)],
    [actualIncS.label, ...actualIncS.data.map(pct)],
    [varianceS.label, ...varianceS.data.map(pct)],
  ];

  return { chart1, chart2, table };
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
// 각 블록마다 buildTrendChartsAndTable로 차트1/차트2/표를 만들어 반환합니다.
function extractWeeklyProgTrendBlocksV2(ws, opts = {}) {
  const {
    firstHeaderRow = 2,
    blockHeight = 43,
    headerCol = 'B',
    datesOffset = 31,
    planOffset = 34,
    planIncOffset = 35,
    actualOffset = 36,
    actualIncOffset = 37,
    varianceOffset = 39,
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

    const { chart1, chart2, table } = buildTrendChartsAndTable(ws, {
      datesRow: headerRow + datesOffset,
      planRow: headerRow + planOffset,
      planIncRow: headerRow + planIncOffset,
      actualRow: headerRow + actualOffset,
      actualIncRow: headerRow + actualIncOffset,
      varianceRow: headerRow + varianceOffset,
      cols,
      labelCol,
    });

    blocks.push({ title, chart1, chart2, table });
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

    // 날짜(27행)/Plan(29)/Plan Inc.(30)/Actual-FCST(31)/Actual-FCST Inc.(32)/Variance(33)
    const { chart1, chart2, table } = buildTrendChartsAndTable(wsTrend, {
      datesRow: 27,
      planRow: 29,
      planIncRow: 30,
      actualRow: 31,
      actualIncRow: 32,
      varianceRow: 33,
      cols: ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
      labelCol: 'B',
    });
    result.blocks.push({ type: 'chart', title: 'EPC Overall Progress Trend (Plan/Actual)', categories: chart1.categories, series: chart1.series });
    result.blocks.push({ type: 'chart', title: 'EPC Overall Progress Trend (Variance)', categories: chart2.categories, series: chart2.series });
    result.blocks.push({ type: 'table', title: 'Var. Trend — 수치', rows: table, headerRowCount: 1 });
  }

  if (tabId === 'critical-milestone') {
    const ws = wb.Sheets['CM'];
    if (!ws) throw new Error('필요한 시트를 찾을 수 없습니다 (CM).');
    const rows = removeBlankRows(extractRowBandTrimmed(ws, 19, 43));
    const lastColIdx = (rows[0]?.length || 1) - 1;
    result.blocks.push({
      type: 'table',
      title: 'Critical Milestone',
      rows,
      headerRowCount: 2,
      wideCols: [lastColIdx], // Remarks 열: 내용이 길면 줄바꿈 + 폭 2배, 다른 열은 그대로
    });
  }

  if (tabId === 'procurement') {
    const wsDash = wb.Sheets['Dashboard'];
    const wsDelay = wb.Sheets['Delayed List'];
    if (!wsDash || !wsDelay) throw new Error('필요한 시트를 찾을 수 없습니다 (Dashboard / Delayed List).');

    // 행50 = 제목(표에서 제외, 소제목으로 표시), 행51~62가 표 본문.
    // 행51(첫 헤더 행)은 큰 그룹(Discipline/WF%/This Week Increment/This Week Cumulative),
    // 그 외 모든 행(행52 서브헤더 포함 데이터 행들)은 작은 그룹(각 %지표 2열씩).
    // 각 그룹 안에서 값이 있는 첫 칸부터 오른쪽 끝까지만 병합 → 들여쓰기된 하위 항목도 자연스럽게 처리.
    const dashTitle = findFirstValueInRow(wsDash, 50, 'X', 'AO');
    const dashGroupsDefault = [[0, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15], [16, 17]];
    const dashGroupsBig = [[0, 3], [4, 5], [6, 11], [12, 17]];
    const dashGrid = buildGroupedMergeTable(wsDash, 'X51:AO62', {
      bigRowOffset: 0,
      groupsDefault: dashGroupsDefault,
      groupsBig: dashGroupsBig,
    });
    const numCols = dashGrid[0]?.length || 0;
    const allCols = Array.from({ length: numCols }, (_, i) => i);
    const dashRows = removeBlankMergeRows(formatMergeGrid(dashGrid, allCols));
    result.blocks.push({
      type: 'table',
      title: dashTitle || 'Dashboard',
      rows: dashRows,
      headerRowCount: 2,
    });

    const { anchorText, rows } = extractDelayedList(wsDelay, {
      anchorCol: 'BJ',
      anchorPattern: /Delayed List.*Internal Target/i,
      colStart: 'BK', // BJ(첫 Discipline 중복 열)는 제외
      colEnd: 'BS',
      dateCols: [5, 6, 7], // Plan / Internal Target / Forecast (열 이동 반영)
    });
    // WV 열(4번째, 0-based)만 백분율로 표시
    const delayRows = formatNumericGrid(rows, [4]);
    result.blocks.push({
      type: 'table',
      title: anchorText ? `Delayed List — ${anchorText}` : 'Delayed List',
      rows: removeBlankRows(delayRows),
      headerRowCount: 1,
      narrowCols: [3], // PMS Description 열 폭 절반
    });
  }

  if (tabId === 'construction') {
    const wsDash = wb.Sheets['Dashboard(JP)'];
    const wsTrend = wb.Sheets['WeeklyProgTrend'];
    if (!wsDash || !wsTrend) throw new Error('필요한 시트를 찾을 수 없습니다 (Dashboard(JP) / WeeklyProgTrend).');

    // --- Progress Status per Discipline (원래 X29:AO43, 행29 = 제목) ---
    const progTitle = findFirstValueInRow(wsDash, 29, 'X', 'AO');
    const progGroupsDefault = [[0, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15], [16, 17]];
    const progGroupsBig = [[0, 3], [4, 5], [6, 11], [12, 17]];
    const progGrid = buildGroupedMergeTable(wsDash, 'X30:AO43', {
      bigRowOffset: 0,
      groupsDefault: progGroupsDefault,
      groupsBig: progGroupsBig,
    });
    const progNumCols = progGrid[0]?.length || 0;
    const progAllCols = Array.from({ length: progNumCols }, (_, i) => i);
    const progRows = removeBlankMergeRows(formatMergeGrid(progGrid, progAllCols));
    result.blocks.push({
      type: 'table',
      title: progTitle || 'Dashboard(JP) — Progress Status',
      rows: progRows,
      headerRowCount: 2,
    });

    // --- Major Quantity Status (원래 H47:AD71, 행47 = 제목) ---
    // H=0,I=1,J=2,K=3,L=4(UoM,단독),M=5,N=6,O=7,P=8,Q=9,R=10,S=11,T=12,U=13,V=14,W=15,X=16,Y=17,Z=18,AA=19,AB=20,AC=21,AD=22
    const qtyTitle = findFirstValueInRow(wsDash, 47, 'H', 'AD');
    const qtyGroupsDefault = [[0, 1], [2, 3], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22]];
    const qtyGroupsBig = [[0, 1], [2, 3], [5, 6], [7, 12], [13, 18], [19, 20], [21, 22]];
    // AC열(0-based idx21, Completion Date)만 날짜 변환. 나머지는 수량(예: M3 ~29365)이 날짜로 오인식되지 않도록 보호.
    let qtyGrid = buildGroupedMergeTable(wsDash, 'H48:AD71', {
      bigRowOffset: 0,
      groupsDefault: qtyGroupsDefault,
      groupsBig: qtyGroupsBig,
      dateColIdxList: [21],
    });
    // S&T(idx11), Y&Z(idx17) = Variance 열: 음수 빨간 아래세모 / 양수 파란 위세모
    qtyGrid = applyVarianceIndicator(qtyGrid, [11, 17]);
    // 나머지 숫자는 정수로 표시
    qtyGrid = formatIntegerMergeGrid(qtyGrid, new Set([11, 17]));
    const qtyRows = removeBlankMergeRows(qtyGrid);
    result.blocks.push({
      type: 'table',
      title: qtyTitle || 'Dashboard(JP) — Major Quantity Status',
      rows: qtyRows,
      headerRowCount: 2,
    });

    // --- WeeklyProgTrend: 디시플린별로 차트1(Plan/Actual 누적+증분) / 차트2(Variance) / 표 ---
    const blocks = extractWeeklyProgTrendBlocksV2(wsTrend, {});
    blocks.forEach((b) => {
      result.blocks.push({
        type: 'chart',
        title: `WeeklyProgTrend — ${b.title} (Plan/Actual)`,
        categories: b.chart1.categories,
        series: b.chart1.series,
      });
      result.blocks.push({
        type: 'chart',
        title: `WeeklyProgTrend — ${b.title} (Variance)`,
        categories: b.chart2.categories,
        series: b.chart2.series,
      });
      result.blocks.push({
        type: 'table',
        title: `${b.title} — 수치`,
        rows: b.table,
        headerRowCount: 1,
      });
    });
  }

  return result;
}
