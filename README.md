# Weekly Progress Dashboard (FGIP2)

4개의 엑셀 파일에서 지정된 범위의 데이터를 매주 가져와 4개의 고정 탭으로 보여주는 대시보드입니다.

- **관리자(`/admin`)**: 비밀번호로 로그인해 탭별로 정해진 엑셀 파일을 업로드합니다. 파일은 브라우저에서 바로 파싱되어 필요한 부분만 서버에 저장되므로(원본 파일 자체는 서버로 전송되지 않음) 50MB가 넘는 파일도 문제없이 처리됩니다. 각 탭 상단에는 담당자가 작성하는 노트란이 있습니다.
- **조회자(`/`)**: 로그인 없이 바로 접속해 4개 탭(Overall Progress / Critical Milestone / Procurement / Construction)을 클릭하며 표와 차트를 확인합니다. 업로드/수정 권한은 없습니다.

기술 스택: **Next.js + Vercel + Neon(Postgres)**

---

## 탭별 데이터 소스

| Tab | 이름 | 파일명 (앞부분 고정, 날짜만 매주 변경) | 가져오는 범위 |
|---|---|---|---|
| 1 | Overall Progress | `FGIP2_Weekly Progress Table_as of [날짜].xlsx` | "Progress Table_weekly (JP)" 행3~11, "Var. Trend (JP)" 행2~33 (+ 행27~33 기준 콤보차트) |
| 2 | Critical Milestone | `FGIP Weekly Progress Report_[날짜].xlsx` | "CM" 시트 행19~43 |
| 3 | Procurement | `FGIP2_PMS for Procurement_as of [날짜].xlsx` | "Dashboard" X50:AO62, "Delayed List" 앵커 텍스트 이후 표(BJ~BS, 자동 인식) |
| 4 | Construction | `FGIP2_PMS for Construction_E_Improve_JP Rev_[날짜].xlsb` | "Dashboard(JP)" X29:AO43, H47:AD71, "WeeklyProgTrend" 디시플린별 반복 블록 전체(자동 인식, 블록당 콤보차트) |

업로드 시 파일명이 위 표의 접두사와 정확히 일치하지 않으면 업로드가 거부됩니다(엉뚱한 파일이 잘못된 탭에 들어가는 것을 방지).

---

## 1. GitHub에 올리기

```bash
cd weekly-progress-dashboard
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin <본인의 GitHub 저장소 URL>
git push -u origin main
```

## 2. Vercel에 배포

1. [vercel.com](https://vercel.com) 에서 New Project → 방금 만든 GitHub 저장소 Import
2. Framework는 Next.js로 자동 인식됩니다. 별도 설정 없이 "Deploy" 클릭

## 3. 데이터베이스 연결 (Neon Postgres)

1. 배포된 프로젝트 화면에서 **Storage** 탭 클릭
2. **Create Database** → **Neon (Postgres)** 선택 (무료 티어 있음)
3. 생성 후 **Connect to Project**를 눌러 방금 만든 프로젝트에 연결
   → `DATABASE_URL` 환경변수가 자동으로 추가됩니다.

## 4. 관리자 비밀번호 설정

1. 프로젝트 **Settings → Environment Variables**로 이동
2. `ADMIN_PASSWORD` 라는 이름으로 원하는 비밀번호 값을 추가 (Production/Preview/Development 모두 체크)
3. 저장 후 **Deployments → 최신 배포 → Redeploy** 로 다시 배포 (환경변수는 재배포해야 적용됩니다)

## 5. 매주 사용하는 방법

1. `https://<프로젝트도메인>/admin` 접속 → 비밀번호 로그인
2. 각 탭 카드에서 그 주의 엑셀 파일을 선택해 업로드 (파일명은 표에 안내된 접두사로 시작해야 함)
3. 필요하면 담당자 노트 작성 후 저장
4. `https://<프로젝트도메인>/` 에서 모든 사용자가 최신 데이터를 바로 확인

---

## 로컬에서 개발하기 (선택)

```bash
npm install -g vercel
vercel link
vercel env pull .env.local

npm install
npm run dev
```

`http://localhost:3000` 에서 확인할 수 있습니다.

---

## 폴더 구조

```
weekly-progress-dashboard/
  app/
    page.js                    # 조회자 화면
    admin/page.js               # 관리자 화면 (로그인 게이트)
    api/admin/
      login/route.js
      logout/route.js
      tabs/[id]/data/route.js   # 파싱된 데이터 저장
      tabs/[id]/note/route.js   # 노트 저장
  components/
    TabView.jsx                 # 조회자: 탭 전환 + 표 + 차트
    DataTable.jsx                # 표 렌더링
    TrendChart.jsx               # 막대+꺾은선 콤보 차트 (Chart.js)
    AdminDashboard.jsx           # 관리자: 업로드 + 노트
    LoginForm.jsx
  lib/
    tabConfig.js                 # 탭별 파일명 규칙 정의
    excel.js                     # 브라우저에서 실행되는 엑셀 파싱/추출 로직
    db.js                        # Neon(Postgres) 스키마/쿼리
    auth.js                      # 관리자 비밀번호 인증
```

## 참고 사항

- 엑셀 원본 파일은 관리자의 브라우저에서만 파싱되고, 추출된 결과(표/차트용 소량 JSON)만 서버에 저장됩니다. 원본 파일 용량이 커도(.xlsb 50MB 이상) 서버 업로드 용량 제한에 걸리지 않습니다.
- 매주 새 파일을 업로드하면 해당 탭의 데이터가 통째로 교체됩니다(과거 주차 데이터는 보관하지 않음).
- WeeklyProgTrend 차트는 시트 내 반복되는 43행 간격의 디시플린 블록을 자동으로 인식합니다. 원본 시트 구조가 바뀌면(행 간격 등) `lib/excel.js`의 `extractWeeklyProgTrendBlocks` 설정을 조정해야 할 수 있습니다.
- 인증은 단일 관리자 비밀번호 방식입니다.
