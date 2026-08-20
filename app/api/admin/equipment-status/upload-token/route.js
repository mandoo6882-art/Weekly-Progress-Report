import { NextResponse } from 'next/server';
import { handleUpload } from '@vercel/blob/client';
import { requireAdmin } from '../../../../../lib/auth';

// Equipment Status Viewer HTML(별도 프로젝트 산출물, 수 MB 크기)을 브라우저에서
// Vercel Blob으로 직접 업로드하기 위한 클라이언트 토큰 발급 라우트.
// 파일 자체는 이 서버(Vercel 서버리스 함수)를 거치지 않으므로 body 크기 제한에
// 걸리지 않는다. 완료 후 URL 저장은 이 라우트가 아니라
// /api/admin/tabs/[id]/status-viewer 에서 별도로 처리한다.
export async function POST(request) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const body = await request.json();

  // handleUpload가 던지는 에러는 브라우저의 @vercel/blob 클라이언트가 자세한 내용 없이
  // 뭉뚱그려버리므로, 가장 흔한 원인(토큰 미설정)은 여기서 먼저 명확하게 걸러낸다.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          'BLOB_READ_WRITE_TOKEN 환경변수가 없습니다. Vercel 프로젝트의 Storage 탭에서 Public Blob 저장소를 이 프로젝트에 연결했는지, 연결 후 Redeploy까지 했는지 확인해주세요.',
      },
      { status: 400 }
    );
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: ['text/html'],
          addRandomSuffix: true,
          maximumSizeInBytes: 200 * 1024 * 1024, // 200MB
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json({ error: err.message || '업로드 토큰 발급에 실패했습니다.' }, { status: 400 });
  }
}
