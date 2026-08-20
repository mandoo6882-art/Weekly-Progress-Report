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
  {
    id: 'equipment-control',
    tabNumber: 6,
    name: 'Equipment Control Register',
    filePrefix: 'FGIP2 Equipment and Material Control Register_',
    fileExt: '.xlsb',
    sheets: ['Summary'],
    example: 'FGIP2 Equipment and Material Control Register_260807.xlsb',
  },
  // Tab 7: 여러 구역(sub tab)의 세부 일정표. 각 sub tab은 서로 다른 엑셀 파일을 따로 업로드하며,
  // (같은 tabNumber를 공유하는) 하나의 그룹으로 묶여 조회 화면에서 상위 탭 아래 서브 탭으로 보입니다.
  // 시트/열 구성이 파일마다 조금씩 달라도 되도록, 실제 추출 로직(lib/excel.js)은
  // "Description" 헤더와 Plan/Forecast/Actual 시작·종료일 열을 라벨 기준으로 자동 인식합니다.
  {
    id: 'schedule-cooling-tower',
    tabNumber: 7,
    groupId: 'schedule',
    groupLabel: 'Critical Path',
    name: 'Cooling Tower',
    filePrefix: 'Cooling tower detail schedule',
    fileExt: '.xlsx',
    sheets: [],
    example: 'Cooling tower detail schedule_updated_260814.xlsx',
  },
  {
    id: 'schedule-ts003',
    tabNumber: 7,
    groupId: 'schedule',
    groupLabel: 'Critical Path',
    name: 'TS003',
    filePrefix: 'TS003 Detail Schedule',
    fileExt: '.xlsx',
    sheets: [],
    example: 'TS003 Detail Schedule_260818.xlsx',
  },
  {
    id: 'schedule-incinerator',
    tabNumber: 7,
    groupId: 'schedule',
    groupLabel: 'Critical Path',
    name: 'Incinerator PKG Area',
    filePrefix: 'Incinerator',
    fileExt: '.xlsx',
    sheets: [],
    example: 'Incinerator PKG Area Detail Schedule_260814.xlsx',
  },
];

export function getTabConfig(id) {
  return TAB_CONFIGS.find((t) => t.id === id);
}
