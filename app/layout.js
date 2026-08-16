import './globals.css';

export const metadata = {
  title: 'Weekly Progress Dashboard',
  description: 'FGIP2 Weekly Progress Dashboard',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        <nav className="nav">
          <a href="/">대시보드</a>
          <a href="/admin">관리자</a>
        </nav>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}
