import { NextResponse } from 'next/server';
import { ADMIN_COOKIE } from '../../../../lib/auth';

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { password } = body;

  if (password && password === process.env.ADMIN_PASSWORD) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, password, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }

  return NextResponse.json({ ok: false, error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
}
