import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/auth';
import { saveNote } from '../../../../../../lib/db';
import { getTabConfig } from '../../../../../../lib/tabConfig';

export async function POST(request, { params }) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const { id } = params;
  if (!getTabConfig(id)) {
    return NextResponse.json({ error: '알 수 없는 탭입니다.' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const note = typeof body.note === 'string' ? body.note : '';

  await saveNote(id, note);
  return NextResponse.json({ ok: true });
}
