import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/auth';
import { saveStatusViewer } from '../../../../../../lib/db';
import { getTabConfig } from '../../../../../../lib/tabConfig';

// Blob 업로드가 끝난 뒤, 그 URL만 작은 JSON으로 저장한다(엑셀 데이터와 별개 열).
export async function POST(request, { params }) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const { id } = params;
  if (!getTabConfig(id)) {
    return NextResponse.json({ error: '알 수 없는 탭입니다.' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.url) {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  await saveStatusViewer(id, { url: body.url, fileName: body.fileName || null });
  return NextResponse.json({ ok: true });
}
