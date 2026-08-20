import { NextResponse } from 'next/server';
import { getTabs } from '../../../lib/db';

export const dynamic = 'force-dynamic';

// Vercel Blob은 보안 정책상 .html 파일을 요청하면 항상 강제 다운로드
// (Content-Disposition: attachment)로 내려준다(HTML을 Blob에서 직접 호스팅하지 못하게
// 막는 정책). 그래서 클릭 시 새 탭에서 바로 열리게 하려면, 우리 서버가 Blob에서 파일을
// 대신 받아온 뒤 Content-Type만 text/html로 다시 지정해서 내려줘야 한다.
export async function GET() {
  let tabs = [];
  try {
    tabs = await getTabs();
  } catch (err) {
    return new NextResponse(`DB 조회 실패: ${err.message}`, { status: 500 });
  }

  const tab = tabs.find((t) => t.id === 'equipment-control');
  const url = tab?.status_viewer_url;
  if (!url) {
    return new NextResponse('Equipment Status Viewer 파일이 아직 업로드되지 않았습니다.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const blobRes = await fetch(url, { cache: 'no-store' });
  if (!blobRes.ok || !blobRes.body) {
    return new NextResponse('파일을 불러오지 못했습니다.', { status: 502 });
  }

  return new NextResponse(blobRes.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
