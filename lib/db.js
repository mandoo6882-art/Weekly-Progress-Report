import { neon } from '@neondatabase/serverless';
import { TAB_CONFIGS } from './tabConfig';

// neon()은 호출 즉시 연결 문자열을 검증하므로, 빌드 타임(환경변수 미설정 시점)에
// 모듈이 로드되면서 바로 에러가 나지 않도록 실제 쿼리 시점에 지연 생성한다.
let sqlClient = null;

function getSql() {
  if (sqlClient) return sqlClient;

  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL / POSTGRES_URL 환경변수가 설정되지 않았습니다. Vercel의 Storage 탭에서 Neon(Postgres)을 연결해주세요.'
    );
  }

  sqlClient = neon(connectionString);
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
    SELECT id, tab_number, name, note, source_file, as_of, data, updated_at
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
