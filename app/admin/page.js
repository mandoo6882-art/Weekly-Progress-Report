import { cookies } from 'next/headers';
import { isAdminAuthed } from '../../lib/auth';
import { getTabs } from '../../lib/db';
import LoginForm from '../../components/LoginForm';
import AdminDashboard from '../../components/AdminDashboard';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const cookieStore = cookies();
  const authed = isAdminAuthed(cookieStore);

  if (!authed) {
    return (
      <main>
        <header className="page-header">
          <h1>관리자 로그인</h1>
          <p className="subtitle">엑셀 업로드 및 노트 작성은 담당자만 가능합니다.</p>
        </header>
        <LoginForm />
      </main>
    );
  }

  let tabs = [];
  let dbError = null;
  try {
    tabs = await getTabs();
  } catch (err) {
    dbError = err.message;
  }

  return (
    <main>
      <header className="page-header">
        <h1>관리자 페이지</h1>
        <p className="subtitle">각 탭에 맞는 엑셀 파일을 업로드하고, 상단 노트를 작성하세요.</p>
      </header>
      {dbError ? <p className="error">{dbError}</p> : <AdminDashboard initialTabs={tabs} />}
    </main>
  );
}
