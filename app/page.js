import { getTabs } from '../lib/db';
import TabView from '../components/TabView';

export const dynamic = 'force-dynamic';

export default async function Page() {
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
        <h1>Weekly Progress Dashboard</h1>
        <p className="subtitle">Fadhili Gas Increment Program - Package 2</p>
      </header>
      {dbError ? <p className="error">{dbError}</p> : <TabView tabs={tabs} />}
    </main>
  );
}
