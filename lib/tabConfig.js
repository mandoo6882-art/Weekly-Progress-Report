// 고정 4개 탭 정의. 업로드 파일명은 filePrefix로 시작해야 하며(대소문자 무시),
// 확장자는 fileExt와 일치해야 합니다. 날짜(주차)는 파일명 뒷부분에서 자동 인식합니다.
export const TAB_CONFIGS = [
  {
    id: 'overall-progress',
    tabNumber: 1,
    name: 'Overall Progress',
    filePrefix: 'FGIP2_Weekly Progress Table_as of',
    fileExt: '.xlsx',
    sheets: ['Progress Table_weekly (JP)', 'Var. Trend (JP)'],
    example: 'FGIP2_Weekly Progress Table_as of 7-Aug-2026.xlsx',
  },
  {
    id: 'critical-milestone',
    tabNumber: 2,
    name: 'Critical Milestone',
    filePrefix: 'FGIP Weekly Progress Report_',
    fileExt: '.xlsx',
    sheets: ['CM'],
    example: 'FGIP Weekly Progress Report__20260807.xlsx',
  },
  {
    id: 'procurement',
    tabNumber: 3,
    name: 'Procurement',
    filePrefix: 'FGIP2_PMS for Procurement_as of',
    fileExt: '.xlsx',
    sheets: ['Dashboard', 'Delayed List'],
    example: 'FGIP2_PMS for Procurement_as of 260807.xlsx',
  },
  {
    id: 'construction',
    tabNumber: 4,
    name: 'Construction',
    filePrefix: 'FGIP2_PMS for Construction_E_Improve_JP Rev_',
    fileExt: '.xlsb',
    sheets: ['Dashboard(JP)', 'WeeklyProgTrend'],
    example: 'FGIP2_PMS for Construction_E_Improve_JP Rev_260807.xlsb',
  },
  {
    id: 'key-qty',
    tabNumber: 5,
    name: 'Key Qty',
    // Construction과 같은 파일(같은 워크북)의 다른 시트를 사용합니다.
    filePrefix: 'FGIP2_PMS for Construction_E_Improve_JP Rev_',
    fileExt: '.xlsb',
    sheets: ['Weekly QTY Curve'],
    example: 'FGIP2_PMS for Construction_E_Improve_JP Rev_260807.xlsb',
  },
];

export function getTabConfig(id) {
  return TAB_CONFIGS.find((t) => t.id === id);
}
