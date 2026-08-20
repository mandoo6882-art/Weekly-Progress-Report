import { neon } from '@neondatabase/serverless';
import { TAB_CONFIGS } from './tabConfig';

// neon()은 호출 즉시 연결 문자열을 검증하므로, 빌드 타임(환경변수 미설정 시점)에
// 모듈이 로드되면서 바로 에러가 나지 않도록 실제 쿼리 시점에 지연 생성한다.
let sqlClient = null;

// Vercel의 Neon 연동은 프로젝트/DB 이름을 접두사로 붙인 환경변수를 만들기도 합니다
// (예: FGIP2_DATABASE_URL). 정확한 이름이 없으면 접두사가 붙은 변수를 찾아서 사용합니다.
function resolveConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
  if (process.env.POSTGRES_URL_NON_POOLING) return process.env.POSTGRES_URL_NON_POOLING;

  const keys = Object.keys(process.env);
  const byDatabaseUrl = keys.find((k) => k.endsWith('_DATABASE_URL') && !k.endsWith('_UNPOOLED'));
  if (byDatabaseUrl) return process.env[byDatabaseUrl];

  const byPostgresUrl = keys.find((k) => k.endsWith('_POSTGRES_URL'));
  if (byPostgresUrl) return process.env[byPostgresUrl];

  const byDatabaseUrlUnpooled = keys.find((k) => k.endsWith('_DATABASE_URL_UNPOOLED'));
  if (byDatabaseUrlUnpooled) return process.env[byDatabaseUrlUnpooled];

  return null;
}

function getSql() {
  if (sqlClient) return sqlClient;

  const connectionString = resolveConnectionString();

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL / POSTGRES_URL 환경변수가 설정되지 않았습니다. Vercel의 Storage 탭에서 Neon(Postgres)을 연결해주세요.'
    );
  }

  // Next.js는 fetch() 호출을 기본적으로 캐시하는데, Neon 드라이버 내부도 fetch를 사용하므로
  // 지정하지 않으면 쓰기 직후 조회 시 캐시된(오래된) 데이터가 나올 수 있다. 항상 최신 데이터를
  // 읽도록 명시적으로 캐시를 끈다.
  sqlClient = neon(connectionString, {
    fetchOptions: { cache: 'no-store' },
  });
  return sqlClient;
}

function sql(strings, ...values) {
  return getSql()(strings, ...values);
}

let schemaReady = false;

export async function ensureSchema() {
  if (schemaReady) return;

  await sql`
    CREATE TABLE IF NOT EXISTS tabs (
      id TEXT PRIMARY KEY,
      tab_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      source_file TEXT,
      as_of TEXT,
      data JSONB,
      updated_at TIMESTAMPTZ
    );
  `;

  // Equipment Control Register 탭의 "Equipment Status Viewer" HTML 파일(별도 프로젝트 산출물)을
  // 매주 업로드/갱신할 수 있도록 저장할 열. 엑셀 데이터(data 열)와는 별개로 관리되어
  // 매주 엑셀을 다시 업로드해도 이 값은 그대로 유지됩니다.
  await sql`ALTER TABLE tabs ADD COLUMN IF NOT EXISTS status_viewer_url TEXT;`;
  await sql`ALTER TABLE tabs ADD COLUMN IF NOT EXISTS status_viewer_file TEXT;`;
  await sql`ALTER TABLE tabs ADD COLUMN IF NOT EXISTS status_viewer_updated_at TIMESTAMPTZ;`;

  // 고정 4개 탭을 없으면 생성 (이름/순서는 최신 설정으로 갱신, note/data는 보존)
  for (const cfg of TAB_CONFIGS) {
    await sql`
      INSERT INTO tabs (id, tab_number, name)
      VALUES (${cfg.id}, ${cfg.tabNumber}, ${cfg.name})
      ON CONFLICT (id) DO UPDATE SET tab_number = EXCLUDED.tab_number, name = EXCLUDED.name;
    `;
  }

  schemaReady = true;
}

export async function getTabs() {
  await ensureSchema();
  const rows = await sql`
    SELECT id, tab_number, name, note, source_file, as_of, data, updated_at,
           status_viewer_url, status_viewer_file, status_viewer_updated_at
    FROM tabs
    ORDER BY tab_number ASC;
  `;
  return rows;
}

export async function saveTabData(id, { sourceFile, asOf, data }) {
  await ensureSchema();
  await sql`
    UPDATE tabs
    SET source_file = ${sourceFile}, as_of = ${asOf}, data = ${JSON.stringify(data)}::jsonb, updated_at = now()
    WHERE id = ${id};
  `;
}

export async function saveNote(id, note) {
  await ensureSchema();
  await sql`
    UPDATE tabs SET note = ${note} WHERE id = ${id};
  `;
}

// Equipment Status Viewer HTML(별도 프로젝트 산출물)의 Blob URL을 저장합니다.
// 엑셀 데이터(data 열)와 분리되어 있어 매주 엑셀을 새로 올려도 이 값은 유지됩니다.
export async function saveStatusViewer(id, { url, fileName }) {
  await ensureSchema();
  await sql`
    UPDATE tabs
    SET status_viewer_url = ${url}, status_viewer_file = ${fileName}, status_viewer_updated_at = now()
    WHERE id = ${id};
  `;
}
