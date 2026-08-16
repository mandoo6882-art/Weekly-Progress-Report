export const ADMIN_COOKIE = 'admin_session';

// API 라우트(app/api/**)에서 요청의 쿠키를 검사할 때 사용
export function requireAdmin(request) {
  const cookie = request.cookies.get(ADMIN_COOKIE);
  return Boolean(cookie?.value) && cookie.value === process.env.ADMIN_PASSWORD;
}

// 서버 컴포넌트(app/admin/page.js)에서 next/headers의 cookies()로 검사할 때 사용
export function isAdminAuthed(cookieStore) {
  const value = cookieStore.get(ADMIN_COOKIE)?.value;
  return Boolean(value) && value === process.env.ADMIN_PASSWORD;
}
