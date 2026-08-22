// 브라우저(관리자 업로드 화면)에서 실행되는 엑셀 파싱/추출 로직.
// 원본 파일은 서버로 전송하지 않고, 이 모듈이 브라우저에서 필요한 범위만 추출해
// 작은 JSON으로 만든 뒤 서버에 저장합니다.
// 참고: xlsx 패키지를 그대로 쓰지 않고 lib/vendor/xlsx-patched.mjs(수정본)를 씁니다.
// 일부 .xlsb 파일에 손상된 정의된 이름(array formula)이 있으면 원본 xlsx 라이브러리가
// 파싱 중 예외를 던지며 완전히 멈추는 버그가 있어(예: "Bad SerAr: 255"), 해당 부분만
// 안전하게 건너뛰도록 고친 사본을 프로젝트에 직접 포함시켰습니다(node_modules 패치에
// 의존하면 배포 환경에 따라 적용이 안 될 수 있어 더 확실한 방법을 택함).
import * as XLSX from './vendor/xlsx-patched.mjs';
import { TAB_CONFIGS } from './tabConfig';

function isDateSerial(v) {
  return typeof v === 'number' && v > 20000 && v < 60000;
}

// 차트(TrendChart)와 그 아래 표(DataTable)의 x축(날짜) 위치를 맞추기 위한 고정 여백(px).
// 차트 쪽 y축 폭(afterFit)과 표 쪽 라벨 열 폭 합이 반드시 같아야 정렬됩니다.
// TREND_GUTTER: Tab1/Tab4처럼 표의 맨 앞 열이 1개(행 라벨)뿐인 경우.
// KEY_QTY_GUTTER: Tab5처럼 맨 앞에 Total Qty/Completed/Balance/행 라벨 4개 열이 있는 경우.
const TREND_GUTTER_LEFT = 130;
const TREND_GUTTER_RIGHT = 64;
const KEY_QTY_LEADING_COLS = [68, 68, 68, 130]; // Total Qty / Completed / Balance / 행 라벨(설명)
const KEY_QTY_GUTTER_LEFT = KEY_QTY_LEADING_COLS.reduce((s, w) => s + w, 0);
const KEY_QTY_GUTTER_RIGHT = 64;

export function excelSerialToDate(serial) {
  if (!isDateSerial(serial)) return serial;
  const utcDays = Math.floor(serial - 25569);
  const utcMs = utcDays * 86400 * 1000;
  const d = new Date(utcMs);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${String(d.getUTCDate()).padStart(2, '0')}-${months[d.getUTCMonth()]}-${yy}`;
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

// extractRangeWithMerges로 만든 grid에서 특정 열(들)을 화면에서 완전히 제거합니다.
// 단순히 배열에서 빼기만 하면, 그 열이 왼쪽 셀과 병합(colSpan)되어 있던 경우
// colSpan 값이 실제보다 커져서(예: 3열 병합이었는데 1열이 빠지면 2여야 함) 그 행부터
// 오른쪽 셀들이 한 칸씩 밀려 보이는 문제가 생깁니다. 이를 막기 위해, 제거할 열이
// 병합에 포함된 hidden 셀이면 같은 행 왼쪽의 병합 소유 셀(colSpan을 가진 셀)을 찾아
// colSpan을 1 줄인 뒤에 제거합니다. 여러 열을 지울 때는 뒤(오른쪽) 인덱스부터
// 처리해야 앞 인덱스가 밀리지 않습니다.
function removeGridColumns(grid, colIdxs) {
  const sortedDesc = [...colIdxs].sort((a, b) => b - a);
  let result = grid;
  sortedDesc.forEach((colIdx) => {
    result = result.map((row) => {
      const cell = row[colIdx];
      if (cell.hidden) {
        // 같은 행에서 왼쪽으로 가장 가까운 non-hidden 셀을 찾아 그 셀의 병합 범위가
        // colIdx까지 덮는지 확인합니다.
        let ownerIdx = -1;
        for (let i = colIdx - 1; i >= 0; i--) {
          if (!row[i].hidden) {
            ownerIdx = i;
            break;
          }
        }
        if (ownerIdx >= 0 && row[ownerIdx].colSpan > colIdx - ownerIdx) {
          const newRow = row.slice();
          newRow[ownerIdx] = { ...newRow[ownerIdx], colSpan: newRow[ownerIdx].colSpan - 1 };
          return newRow.filter((_, idx) => idx !== colIdx);
        }
        // 이 행에서는 그 병합의 소유 셀이 없음(다른 행에 있는 rowSpan 병합의 연장) → 그냥 제거.
        return row.filter((_, idx) => idx !== colIdx);
      }
      if (cell.colSpan > 1) {
        // 제거할 열 자신이 오른쪽으로 병합을 시작하는 소유 셀인 경우, 병합을 한 칸
        // 오른쪽(다음 열)으로 옮기고 colSpan을 1 줄입니다.
        const newRow = row.slice();
        newRow[colIdx + 1] = { ...cell, colSpan: cell.colSpan - 1 };
        return newRow.filter((_, idx) => idx !== colIdx);
      }
      return row.filter((_, idx) => idx !== colIdx);
    });
  });
  return result;
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
function buildTrendChartsAndTable(ws, { datesRow, planRow, planIncRow, actualRow, actualIncRow, varianceRow, cols, labelCol, format = 'percent' }) {
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

  const chart1 = { categories, series: [planIncS, actualIncS, planS, actualS], format };
  const chart2 = { categories, series: [varianceS], format };

  const fmt =
    format === 'integer'
      ? (v) => (typeof v === 'number' ? Math.round(v).toLocaleString('en-US') : '')
      : (v) => (typeof v === 'number' ? `${(v * 100).toFixed(2)}%` : '');
  const table = [
    ['', ...categories],
    [planS.label, ...planS.data.map(fmt)],
    [planIncS.label, ...planIncS.data.map(fmt)],
    [actualS.label, ...actualS.data.map(fmt)],
    [actualIncS.label, ...actualIncS.data.map(fmt)],
    [varianceS.label, ...varianceS.data.map(fmt)],
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
    format = 'percent',
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
      format,
    });

    blocks.push({ title, chart1, chart2, table });
  }

  return blocks;
}

// 실제 파일로 검증한 "Weekly QTY Curve" 시트 구조:
//   - B열에 [품목명, 상위구분(Overall 등)] 두 줄이 연속으로 있고, 그 줄(품목명 행) + 27행이
//     항상 "Plan (IP)" 행(=Plan vs Actual 표의 시작)이다(26개 품목 모두 정확히 일치 확인).
//   - 그 바로 위 행(Plan행-1)에 Total Qty/Completed/Balance/Plan vs Actual 헤더와 날짜들이 있음.
//   - Total/Completed/Balance 값은 Plan(IP) 행의 D/E/F열에 있음.
//   - 품목에 따라 G열에 Plan(IP)/Plan Inc.(IP) 뒤에 Plan(JP)/Plan Inc.(JP)가 추가로 있는 경우도
//     있고, Variance도 "(IP)"/"(JP)" 두 줄로 나뉘는 경우가 있음. Actual/Forecast와
//     Actual/Forecast Inc.는 표기가 하나뿐. JP가 있으면 JP를, 없으면 IP를 사용한다.
function extractLabelColumnBlocks(ws, {
  labelCol = 'G',
  titleCol = 'B',
  qtyCols = { total: 'D', completed: 'E', balance: 'F' },
  format = 'integer',
  maxDataCols = 60,
  planRowOffset = 27, // 품목명 행(1-based) + 27 = Plan(IP) 행(1-based)
  maxScanRows = 15,
  dashboardCol = null, // 지정하면, 품목명 행의 이 열 값이 "dashboard"인 품목만 남긴다.
} = {}) {
  const full = XLSX.utils.decode_range(ws['!ref']);
  const labelColIdx = XLSX.utils.decode_col(labelCol);
  const titleColIdx = XLSX.utils.decode_col(titleCol);
  const dashboardColIdx = dashboardCol ? XLSX.utils.decode_col(dashboardCol) : null;

  function cellRaw(r, c) {
    const addr = XLSX.utils.encode_cell({ r, c });
    const cell = ws[addr];
    return cell ? cell.v : undefined;
  }
  function cellStr(r, c) {
    const v = cellRaw(r, c);
    return v !== undefined && v !== null ? String(v).trim() : '';
  }

  const LABEL_RE = {
    planIP: /^plan\s*\(ip\)$/i,
    planJP: /^plan\s*\(jp\)$/i,
    planIncIP: /^plan\s*inc\.?\s*\(ip\)$/i,
    planIncJP: /^plan\s*inc\.?\s*\(jp\)$/i,
    actual: /^actual\s*\/\s*forecast$/i,
    actualInc: /^actual\s*\/\s*forecast\s*inc\.?$/i,
    varianceIP: /^variance\s*\(ip\)$/i,
    varianceJP: /^variance\s*\(jp\)$/i,
    varianceAny: /^variance$/i,
  };
  function classify(str) {
    for (const key of Object.keys(LABEL_RE)) {
      if (LABEL_RE[key].test(str)) return key;
    }
    return null;
  }

  // 1) B열에서 [품목명, 구분] 연속 쌍을 모두 찾음
  const titlePairs = [];
  for (let r = full.s.r; r < full.e.r; r++) {
    const v1 = cellStr(r, titleColIdx);
    if (!v1) continue;
    const v2 = cellStr(r + 1, titleColIdx);
    if (!v2) continue;
    // dashboardCol이 지정된 경우, 품목명과 같은 행의 그 열 값이 "dashboard"인 품목만 남긴다
    // (예: A열에 "dashboard"라고 표시된 품목만 조회 화면에 노출).
    if (dashboardColIdx !== null && !/^dashboard$/i.test(cellStr(r, dashboardColIdx))) continue;
    titlePairs.push({ titleRow: r, title: v1, category: v2 });
  }

  const blocks = [];
  titlePairs.forEach(({ titleRow, title, category }) => {
    // 2) 정해진 오프셋(+27) 근처(±3행)에서 실제 "Plan (IP)" 행을 찾음
    const expected = titleRow + planRowOffset;
    let anchorRow = null;
    for (let d = -3; d <= 3; d++) {
      if (LABEL_RE.planIP.test(cellStr(expected + d, labelColIdx))) {
        anchorRow = expected + d;
        break;
      }
    }
    if (anchorRow === null) return; // 이 품목은 예상 위치에 Plan(IP)가 없음 → 건너뜀

    // 3) anchorRow부터 최대 maxScanRows행 동안 라벨을 모두 수집(품목마다 행 구성이 다를 수 있음)
    const rowMap = {};
    for (let d = 0; d < maxScanRows; d++) {
      const rr = anchorRow + d;
      const label = cellStr(rr, labelColIdx);
      if (!label) continue;
      const key = classify(label);
      if (key && !(key in rowMap)) rowMap[key] = rr;
    }

    const planRowFinal = rowMap.planJP ?? rowMap.planIP;
    const planIncRowFinal = rowMap.planIncJP ?? rowMap.planIncIP;
    const actualRowFinal = rowMap.actual;
    const actualIncRowFinal = rowMap.actualInc;
    const varianceRowFinal = rowMap.varianceJP ?? rowMap.varianceIP ?? rowMap.varianceAny;
    if ([planRowFinal, planIncRowFinal, actualRowFinal, actualIncRowFinal, varianceRowFinal].some((v) => v == null)) {
      return; // 필수 라벨을 다 못 찾으면 건너뜀
    }

    // 데이터 열 범위 자동 인식: 날짜 헤더 행(anchorRow-1)에서 실제 날짜(serial) 값이 있는
    // 열까지만 인정(다른 잔여 값이 섞여 있어도 영향받지 않도록).
    let lastDataCol = labelColIdx;
    for (let c = labelColIdx + 1; c <= Math.min(labelColIdx + maxDataCols, full.e.c); c++) {
      if (isDateSerial(cellRaw(anchorRow - 1, c))) lastDataCol = c;
    }
    if (lastDataCol <= labelColIdx) return;
    const cols = [];
    for (let c = labelColIdx + 1; c <= lastDataCol; c++) cols.push(XLSX.utils.encode_col(c));

    // 날짜 행 = anchorRow(Plan(IP) 행) 바로 위 행
    const datesRow1based = anchorRow; // 0-based anchorRow → 1-based(anchorRow-1행)와 동일 값

    function qtyAt(colLetter) {
      const c = XLSX.utils.decode_col(colLetter);
      const v = cellRaw(anchorRow, c);
      return typeof v === 'number' ? Math.round(v).toLocaleString('en-US') : v || '';
    }
    const summary = {
      totalQty: qtyAt(qtyCols.total),
      completedQty: qtyAt(qtyCols.completed),
      balanceQty: qtyAt(qtyCols.balance),
    };

    const { chart1, chart2, table } = buildTrendChartsAndTable(ws, {
      datesRow: datesRow1based,
      planRow: planRowFinal + 1,
      planIncRow: planIncRowFinal + 1,
      actualRow: actualRowFinal + 1,
      actualIncRow: actualIncRowFinal + 1,
      varianceRow: varianceRowFinal + 1,
      cols,
      labelCol,
      format,
    });

    blocks.push({ title, category, chart1, chart2, table, summary });
  });

  if (blocks.length === 0) {
    const sampleTitles = titlePairs.slice(0, 10).map((t) => `행${t.titleRow + 1}: "${t.title}" / "${t.category}"`);
    throw new Error(
      `"${titleCol}"열에서 품목 제목은 ${titlePairs.length}개 찾았지만, "${labelCol}"열에서 필요한 라벨(Plan/Plan Inc./Actual Forecast/Variance)을 찾지 못했습니다.\n` +
      `찾은 제목 예시:\n${sampleTitles.join('\n') || '(없음)'}`
    );
  }

  return blocks;
}

// ---- Tab7: 세부 일정표(Gantt) 공통 추출 로직 ----
// 구역(sub tab)마다 파일이 다르고 시트 이름/정확한 열 위치도 조금씩 다를 수 있어서,
// "Description" 헤더와 Plan/Forecast/Actual 시작·종료일 라벨을 텍스트로 찾아 자동으로
// 맞춥니다(고정 열 번호에 의존하지 않음).

function rawCell(ws, r, c) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = ws[addr];
  return cell ? cell.v : undefined;
}

function scheduleCellText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

// 워크북 안에서 "Description" 헤더가 있는 시트를 찾습니다. 후보가 여러 개면(예: TS003의
// TS03_SVP / TS03_REAL) 데이터 행이 더 많은(=더 최신/완전한) 쪽을 고릅니다.
function findScheduleSheet(wb) {
  let best = null;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= Math.min(range.s.r + 15, range.e.r); r++) {
      let found = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (/^description$/i.test(scheduleCellText(rawCell(ws, r, c)))) {
          const rowCount = range.e.r - r;
          if (!best || rowCount > best.rowCount) best = { name, ws, headerRow: r, rowCount };
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  return best;
}

// 헤더 행("Description"/"Plan"/"Revised Plan"/"Forecast"/"Actual"가 있는 행)과 그 아래
// 서브헤더 행("Start date"/"Finish date")을 보고 Plan/Forecast/Actual의 시작·종료 열을 찾습니다.
function detectScheduleColumns(ws, headerRow) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const subHeaderRow = headerRow + 1;
  const merges = ws['!merges'] || [];

  const topLabel = [];
  let cur = '';
  let descCol = -1;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const t = scheduleCellText(rawCell(ws, headerRow, c));
    if (t) {
      cur = t;
      if (descCol === -1 && /^description$/i.test(t)) descCol = c;
    }
    topLabel[c] = cur;
  }
  if (descCol === -1) return null;

  const subLabel = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    subLabel[c] = scheduleCellText(rawCell(ws, subHeaderRow, c));
  }

  // "이름 열"(상/중/하위 항목명이 들어가는 열들) 범위를 구한다.
  // 오른쪽: Description 라벨이 그대로 이어지는(병합되었거나 빈칸으로 같은 라벨을 유지하는) 열까지.
  const nameLabel = topLabel[descCol];
  let afterNameCol = descCol;
  while (afterNameCol + 1 <= range.e.c && topLabel[afterNameCol + 1] === nameLabel) afterNameCol++;
  // 왼쪽: descCol 바로 왼쪽부터, 별도 헤더 라벨이 없는(빈칸) 열까지. 어떤 파일은 섹션 제목이
  // "Description" 헤더 자체가 없는 왼쪽 열(예: A열)에만 들어가 있어서(Cooling Tower 케이스),
  // 이 열도 이름 열로 포함시켜야 섹션 제목 행을 놓치지 않는다.
  let beforeNameCol = descCol;
  while (beforeNameCol - 1 >= range.s.c && topLabel[beforeNameCol - 1] === '') beforeNameCol--;

  // 이름 열 다음부터 "20xx" 연도 열(달력/간트 그리드 시작)이 나오기 전까지가
  // Plan/Revised Plan/Forecast/Actual 같은 날짜 구간 후보.
  const segments = [];
  let curLabel = null;
  let curCols = [];
  for (let c = afterNameCol + 1; c <= range.e.c; c++) {
    const label = topLabel[c] || '';
    if (/^\d{4}$/.test(label)) break;
    if (label !== curLabel) {
      if (curLabel !== null && curCols.length) segments.push({ label: curLabel, cols: curCols });
      curLabel = label;
      curCols = [c];
    } else {
      curCols.push(c);
    }
  }
  if (curLabel !== null && curCols.length) segments.push({ label: curLabel, cols: curCols });

  function findSubCol(cols, pattern) {
    const hit = cols.find((c) => pattern.test(subLabel[c]));
    return hit === undefined ? null : hit;
  }
  function segStartFinish(seg) {
    if (!seg) return { startCol: null, finishCol: null };
    const startCol = findSubCol(seg.cols, /start/i) ?? seg.cols[0] ?? null;
    const finishCol = findSubCol(seg.cols, /finish|end/i) ?? seg.cols[1] ?? seg.cols[0] ?? null;
    return { startCol, finishCol };
  }

  const planLike = segments.filter((s) => /plan/i.test(s.label));
  const forecastExplicit = segments.find((s) => /forecast/i.test(s.label));
  const actualSeg = segments.find((s) => /actual/i.test(s.label));

  const planSeg = planLike[0] || null;
  let forecastSeg = forecastExplicit || null;
  if (!forecastSeg && planLike.length > 1) forecastSeg = planLike[planLike.length - 1];

  const nameCols = [];
  for (let c = beforeNameCol; c <= afterNameCol; c++) nameCols.push(c);

  return {
    nameCols,
    subHeaderRow,
    plan: segStartFinish(planSeg),
    forecast: segStartFinish(forecastSeg),
    actual: segStartFinish(actualSeg),
    planLabel: planSeg ? planSeg.label : 'Plan',
    forecastLabel: forecastSeg ? forecastSeg.label : 'Forecast',
  };
}

function scheduleCellDate(ws, r, c) {
  if (c === null || c === undefined) return null;
  const v = rawCell(ws, r, c);
  if (v === undefined || v === null || v === '') return null;
  if (isDateSerial(v)) {
    const utcDays = Math.floor(v - 25569);
    return new Date(utcDays * 86400 * 1000).toISOString();
  }
  if (v instanceof Date) return v.toISOString();
  return null;
}

// ISO 날짜 문자열을 표에 쓰는 dd-mmm-yy 형식으로 변환.
function isoToDisplay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${String(d.getUTCDate()).padStart(2, '0')}-${months[d.getUTCMonth()]}-${yy}`;
}

// ---- Tab7 "Critical Path" 서브 탭 2개(Cooling Tower / TS003) 전용 고정 열 추출 ----
// 사용자가 실제 엑셀 열 문자를 직접 지정했으므로(자동 인식 대신) 그 열 위치를 그대로 씁니다.
// Cooling Tower "Detail schedule" 시트: A=구역(band, 병합), B=Activity, F=Dur.,
// G/H=Plan Start/Finish(원본 헤더는 "Revised Plan"), I/J=Actual Start/Finish, L=Remark.
function extractCriticalPathCoolingTower(ws) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = 4; r <= range.e.r; r++) {
    const band = scheduleCellText(rawCell(ws, r, 0)); // A열
    const activity = scheduleCellText(rawCell(ws, r, 1)); // B열
    if (activity) {
      rows.push({
        name: activity,
        isHeading: false,
        duration: rawCell(ws, r, 5), // F열
        planStart: scheduleCellDate(ws, r, 6), // G열
        planFinish: scheduleCellDate(ws, r, 7), // H열
        actualStart: scheduleCellDate(ws, r, 8), // I열
        actualFinish: scheduleCellDate(ws, r, 9), // J열
        remark: scheduleCellText(rawCell(ws, r, 11)), // L열
      });
    } else if (band) {
      rows.push({ name: band, isHeading: true, depth: 0 });
    }
  }
  return rows;
}

// TS003 "TS03_REAL" 시트: A=상위구역, B=하위구역, C=Activity, H=Dur., I/J=Plan Start/Finish
// (원본 헤더는 "Revised Plan"), K/L=Forecast Start/Finish, M/N=Actual Start/Finish, S=Remark.
function extractCriticalPathTS003(ws) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = 4; r <= range.e.r; r++) {
    const topBand = scheduleCellText(rawCell(ws, r, 0)); // A열
    const subBand = scheduleCellText(rawCell(ws, r, 1)); // B열
    const activity = scheduleCellText(rawCell(ws, r, 2)); // C열
    if (activity) {
      rows.push({
        name: activity,
        isHeading: false,
        depth: 1,
        duration: rawCell(ws, r, 7), // H열
        planStart: scheduleCellDate(ws, r, 8), // I열
        planFinish: scheduleCellDate(ws, r, 9), // J열
        forecastStart: scheduleCellDate(ws, r, 10), // K열
        forecastFinish: scheduleCellDate(ws, r, 11), // L열
        actualStart: scheduleCellDate(ws, r, 12), // M열
        actualFinish: scheduleCellDate(ws, r, 13), // N열
        remark: scheduleCellText(rawCell(ws, r, 18)), // S열
      });
    } else if (subBand) {
      rows.push({ name: subBand, isHeading: true, depth: 1 });
    } else if (topBand) {
      rows.push({ name: topBand, isHeading: true, depth: 0 });
    }
  }
  return rows;
}

// 시트를 통째로 읽어 Gantt 차트에 쓸 행 목록으로 변환합니다.
// 반환: [{ name, depth, isHeading, plan:{start,finish}, forecast:{...}, actual:{...} }, ...]
function extractGanttSchedule(ws, cols) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];

  for (let r = cols.subHeaderRow + 1; r <= range.e.r; r++) {
    // 이름 열 중 값이 있는 칸이 여러 개면(예: 왼쪽 칸에 남아있는 오타/잔여 텍스트 + 실제 항목명이
    // 같이 있는 경우) 가장 오른쪽(가장 구체적인) 칸을 실제 이름으로 쓴다. 헤더 행은 보통 가장
    // 왼쪽 칸 하나만 채워져 있으므로 이 규칙으로도 그대로 depth 0으로 잡힌다.
    let name = '';
    let depth = 0;
    for (let i = 0; i < cols.nameCols.length; i++) {
      const t = scheduleCellText(rawCell(ws, r, cols.nameCols[i]));
      if (t) {
        name = t;
        depth = i;
      }
    }
    if (!name) continue;

    const plan = { start: scheduleCellDate(ws, r, cols.plan.startCol), finish: scheduleCellDate(ws, r, cols.plan.finishCol) };
    const forecast = { start: scheduleCellDate(ws, r, cols.forecast.startCol), finish: scheduleCellDate(ws, r, cols.forecast.finishCol) };
    const actual = { start: scheduleCellDate(ws, r, cols.actual.startCol), finish: scheduleCellDate(ws, r, cols.actual.finishCol) };

    const isHeading = !plan.start && !plan.finish && !forecast.start && !forecast.finish && !actual.start && !actual.finish;
    rows.push({ name, depth, isHeading, plan, forecast, actual });
  }

  return rows;
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
  // sheets가 빈 배열이면(예: 시트 이름이 파일마다 달라 미리 정할 수 없는 tab7 일정표) 필터링 없이
  // 전체 시트를 읽어서, 아래에서 실제 필요한 시트를 라벨 기준으로 직접 찾는다.
  const wb = XLSX.read(bytes, { type: 'array', sheets: cfg.sheets && cfg.sheets.length ? cfg.sheets : undefined });
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
      title: 'Overall Progress',
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
    result.blocks.push({
      type: 'chart',
      title: 'EPC Overall Progress Trend (Plan/Actual)',
      categories: chart1.categories,
      series: chart1.series,
      format: chart1.format,
      gutterLeft: TREND_GUTTER_LEFT,
      gutterRight: TREND_GUTTER_RIGHT,
    });
    result.blocks.push({
      type: 'chart',
      title: 'EPC Overall Progress Trend (Variance)',
      categories: chart2.categories,
      series: chart2.series,
      format: chart2.format,
      gutterLeft: TREND_GUTTER_LEFT,
      gutterRight: TREND_GUTTER_RIGHT,
    });
    result.blocks.push({
      type: 'table',
      title: 'Var. Trend',
      rows: table,
      headerRowCount: 1,
      leadingColWidths: [TREND_GUTTER_LEFT],
      gutterRight: TREND_GUTTER_RIGHT,
    });
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
      colMaxWidths: { [lastColIdx]: 600 }, // Remarks 열: 기존 폭(300)의 2배, 줄바꿈 없이 가로 스크롤
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
    const delayFinalRows = removeBlankRows(delayRows);
    const delayLastColIdx = (delayFinalRows[0]?.length || 1) - 1; // Delay Reason 열
    result.blocks.push({
      type: 'table',
      title: anchorText ? `Delayed List — ${anchorText}` : 'Delayed List',
      rows: delayFinalRows,
      headerRowCount: 1,
      // PMS Description / Delay Reason 열: 둘 다 줄바꿈 없이 한 줄로 표시하고,
      // 내용이 넘치면 표 전체가 가로로 스크롤되도록 함. 행 수가 많을 수 있어 세로 스크롤도 추가.
      colMaxWidths: { 3: 180, [delayLastColIdx]: 500 },
      filterColumn: 0, // Discipline열 기준 드롭다운 필터
      filterLabel: 'Discipline',
      scrollHeight: 480,
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
        format: b.chart1.format,
        gutterLeft: TREND_GUTTER_LEFT,
        gutterRight: TREND_GUTTER_RIGHT,
      });
      result.blocks.push({
        type: 'chart',
        title: `WeeklyProgTrend — ${b.title} (Variance)`,
        categories: b.chart2.categories,
        series: b.chart2.series,
        format: b.chart2.format,
        gutterLeft: TREND_GUTTER_LEFT,
        gutterRight: TREND_GUTTER_RIGHT,
      });
      result.blocks.push({
        type: 'table',
        title: b.title,
        rows: b.table,
        headerRowCount: 1,
        leadingColWidths: [TREND_GUTTER_LEFT],
        gutterRight: TREND_GUTTER_RIGHT,
      });
    });
  }

  if (tabId === 'key-qty') {
    const wsQty = wb.Sheets['Weekly QTY Curve'];
    if (!wsQty) throw new Error('필요한 시트를 찾을 수 없습니다 (Weekly QTY Curve).');

    // G열에 Plan/Plan Inc./Actual/Forecast/Actual/Forecast Inc./Variance 5행이 연속으로
    // 나오는 위치를 찾아 그때마다 블록으로 인식합니다. 값은 정수로 표시합니다.
    const blocks = extractLabelColumnBlocks(wsQty, { labelCol: 'G', format: 'integer', dashboardCol: 'A' });

    let lastCategory = Symbol('none');
    blocks.forEach((b) => {
      // Overall / Train7 / Train8 / Train9 등 상위 구분이 바뀔 때마다 구분 제목을 추가
      if (b.category && b.category !== lastCategory) {
        result.blocks.push({ type: 'heading', text: b.category });
        lastCategory = b.category;
      }

      // tab4와 달리 Variance는 표에만 수치로 넣고, 별도 차트는 만들지 않습니다.
      result.blocks.push({
        type: 'chart',
        title: b.title,
        categories: b.chart1.categories,
        series: b.chart1.series,
        format: b.chart1.format,
        gutterLeft: KEY_QTY_GUTTER_LEFT,
        gutterRight: KEY_QTY_GUTTER_RIGHT,
      });

      // Total Qty / Completed / Balance를 엑셀과 동일하게 표 맨 앞 3개 열로 배치
      const [dateRow, planRow, planIncRow, actualRow, actualIncRow, varianceRow] = b.table;
      const tableWithSummary = [
        ['Total Qty', 'Completed', 'Balance', 'Plan vs Actual', ...dateRow.slice(1)],
        [b.summary.totalQty, b.summary.completedQty, b.summary.balanceQty, ...planRow],
        ['', '', '', ...planIncRow],
        ['', '', '', ...actualRow],
        ['', '', '', ...actualIncRow],
        ['', '', '', ...varianceRow],
      ];
      result.blocks.push({
        type: 'table',
        title: b.title,
        rows: tableWithSummary,
        headerRowCount: 1,
        leadingColWidths: KEY_QTY_LEADING_COLS,
        gutterRight: KEY_QTY_GUTTER_RIGHT,
      });
    });
  }

  if (tabId === 'equipment-control') {
    const ws = wb.Sheets['Summary'];
    if (!ws) throw new Error('필요한 시트를 찾을 수 없습니다 (Summary).');

    result.title = getCellValue(ws, 'B2');

    // B4:W29 표 (3행 헤더 + 데이터 + 소계/퍼센트 행 + 합계). 시트에 저장된 실제 병합 정보를 사용.
    let grid = extractRangeWithMerges(ws, 'B4:W29');
    // D열(두 번째 Category, C열과 내용이 겹침)은 화면에 보이지 않게 제거하고,
    // S/T열("SPARE", 항상 0)도 제거 (B=0 기준 idx2=D, idx17,18=S,T).
    // Total 행처럼 D열이 왼쪽 셀과 병합(colSpan)되어 있는 경우까지 고려해 안전하게 제거.
    grid = removeGridColumns(grid, [2, 17, 18]);

    const dataColStart = 2; // 0열(Discipline), 1열(Category)은 텍스트, 2열(Total)부터 숫자
    const pctRows = new Set([15, 23, 25]); // 소계/합계 바로 아래 퍼센트 행
    const totalRows = new Set([14, 22, 24]); // Stationary-Total / Rotating-Total / Mechanical-Total

    grid = grid.map((row, ri) =>
      row.map((cell, ci) => {
        if (typeof cell.value !== 'number') return cell;
        if (ci < dataColStart) return cell;
        if (pctRows.has(ri)) return { ...cell, value: `${Math.round(cell.value * 100)}%` };
        return { ...cell, value: Math.round(cell.value).toLocaleString('en-US') };
      })
    );

    const rowClasses = grid.map((_, ri) => {
      if (ri <= 2) return 'eqr-head';
      if (ri === 24 || ri === 25) return 'eqr-grand-total';
      if (totalRows.has(ri) || pctRows.has(ri)) return 'eqr-total';
      return '';
    });

    result.blocks.push({
      type: 'table',
      rows: grid,
      headerRowCount: 0,
      rowClasses,
      narrowCols: [18], // Remark열(마지막 열, D열 제거로 인덱스 19→18)은 폭을 좁게 고정하고 줄바꿈
      tableClassName: 'eqr-table', // 스크롤 없이 페이지 폭에 맞도록 촘촘한 스타일
      // Category열(idx1)은 줄바꿈 없이 한 줄로 다 보이도록 넉넉한 폭 배정, 나머지 숫자 열은 좁게.
      colWidths: [6.63, 15.47, 3.87, 3.87, 3.87, 4.42, 3.87, 3.87, 3.31, 3.31, 3.87, 3.31, 3.31, 3.31, 3.87, 3.31, 4.97, 6.08, 15.48],
    });
  }

  if (tabId === 'schedule-cooling-tower') {
    const ws = wb.Sheets['Detail schedule'];
    if (!ws) throw new Error(`필요한 시트를 찾을 수 없습니다 (Detail schedule).\n(시트 목록: ${wb.SheetNames.join(', ')})`);
    const items = extractCriticalPathCoolingTower(ws);
    if (!items.length) throw new Error('일정 데이터를 찾지 못했습니다.');
    result.title = cfg.name;

    const columns = [
      { label: 'Activity', width: 220, wrap: true },
      { label: 'Dur.', width: 46 },
      { label: 'Plan\nStart', width: 68 },
      { label: 'Plan\nFinish', width: 68 },
      { label: 'Actual\nStart', width: 68 },
      { label: 'Actual\nFinish', width: 68 },
      { label: 'Remark', width: 240, wrap: true },
    ];
    const rows = items.map((it) =>
      it.isHeading
        ? { isHeading: true, name: it.name }
        : {
            isHeading: false,
            cells: [
              it.name,
              it.duration ?? '',
              isoToDisplay(it.planStart),
              isoToDisplay(it.planFinish),
              isoToDisplay(it.actualStart),
              isoToDisplay(it.actualFinish),
              it.remark,
            ],
            bars: [
              { label: 'Plan', color: '#60a5fa', start: it.planStart, finish: it.planFinish },
              { label: 'Actual', color: '#10b981', start: it.actualStart, finish: it.actualFinish },
            ],
          }
    );

    result.blocks.push({
      type: 'critical-path-schedule',
      title: `${cfg.name} — Schedule`,
      columns,
      rows,
      legend: [
        { label: 'Plan', color: '#60a5fa' },
        { label: 'Actual', color: '#10b981' },
      ],
    });
  }

  if (tabId === 'schedule-ts003') {
    const ws = wb.Sheets['TS03_REAL'];
    if (!ws) throw new Error(`필요한 시트를 찾을 수 없습니다 (TS03_REAL).\n(시트 목록: ${wb.SheetNames.join(', ')})`);
    const items = extractCriticalPathTS003(ws);
    if (!items.length) throw new Error('일정 데이터를 찾지 못했습니다.');
    result.title = cfg.name;

    const columns = [
      { label: 'Activity', width: 220, wrap: true },
      { label: 'Dur.', width: 42 },
      { label: 'Plan\nStart', width: 64 },
      { label: 'Plan\nFinish', width: 64 },
      { label: 'Forecast\nStart', width: 64 },
      { label: 'Forecast\nFinish', width: 64 },
      { label: 'Actual\nStart', width: 64 },
      { label: 'Actual\nFinish', width: 64 },
      { label: 'Remark', width: 220, wrap: true },
    ];
    const rows = items.map((it) =>
      it.isHeading
        ? { isHeading: true, name: it.name, depth: it.depth }
        : {
            isHeading: false,
            depth: it.depth,
            cells: [
              it.name,
              it.duration ?? '',
              isoToDisplay(it.planStart),
              isoToDisplay(it.planFinish),
              isoToDisplay(it.forecastStart),
              isoToDisplay(it.forecastFinish),
              isoToDisplay(it.actualStart),
              isoToDisplay(it.actualFinish),
              it.remark,
            ],
            bars: [
              { label: 'Plan', color: '#60a5fa', start: it.planStart, finish: it.planFinish },
              { label: 'Forecast', color: '#f59e0b', start: it.forecastStart, finish: it.forecastFinish },
              { label: 'Actual', color: '#10b981', start: it.actualStart, finish: it.actualFinish },
            ],
          }
    );

    result.blocks.push({
      type: 'critical-path-schedule',
      title: `${cfg.name} — Schedule`,
      columns,
      rows,
      legend: [
        { label: 'Plan', color: '#60a5fa' },
        { label: 'Forecast', color: '#f59e0b' },
        { label: 'Actual', color: '#10b981' },
      ],
    });
  }

  // Incinerator PKG Area: 아직 실제 파일/정확한 열 구성을 전달받지 못해, 파일이 오기 전까지는
  // 라벨(Description/Plan/Forecast/Actual) 자동 인식 방식으로 임시 지원합니다.
  if (tabId === 'schedule-incinerator') {
    const found = findScheduleSheet(wb);
    if (!found) {
      throw new Error(
        `일정표 시트를 찾을 수 없습니다. "Description" 헤더가 있는 시트가 필요합니다.\n` +
        `(시트 목록: ${wb.SheetNames.join(', ')})`
      );
    }
    const cols = detectScheduleColumns(found.ws, found.headerRow);
    if (!cols) {
      throw new Error(`"${found.name}" 시트에서 "Description" 헤더는 찾았지만 열 구조를 해석하지 못했습니다.`);
    }
    const rows = extractGanttSchedule(found.ws, cols);
    if (!rows.length) {
      throw new Error(`"${found.name}" 시트에서 일정 데이터를 찾지 못했습니다.`);
    }

    result.title = cfg.name;
    result.blocks.push({
      type: 'gantt',
      title: `${cfg.name} — Schedule (${found.name})`,
      rows,
      planLabel: cols.planLabel,
      forecastLabel: cols.forecastLabel,
    });
  }

  return result;
}
