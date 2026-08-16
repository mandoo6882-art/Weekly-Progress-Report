import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/auth';
import { saveTabData } from '../../../../../../lib/db';
import { getTabConfig } from '../../../../../../lib/tabConfig';

// 브라우저에서 이미 파싱을 끝낸 작은 JSON을 저장한다 (원본 엑셀 파일은 서버로 오지 않음).
export async function POST(request, { params }) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const { id } = params;
  if (!getTabConfig(id)) {
    return NextResponse.json({ error: '알 수 없는 탭입니다.' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.data) {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const { sourceFile, asOf, data } = body;

  await saveTabData(id, { sourceFile, asOf, data });
  return NextResponse.json({ ok: true });
}
