'use client';

import { useState } from 'react';
import { upload } from '@vercel/blob/client';
import { TAB_CONFIGS } from '../lib/tabConfig';
import { validateFile, parseTabFile } from '../lib/excel';

// 파일명 앞부분("Equipment_Status_Viewer")만 같으면 인식합니다. 뒤에 버전/날짜가
// 붙어 매주 이름이 바뀌어도(예: Equipment_Status_Viewer_v02.html) 그대로 인식됩니다.
const STATUS_VIEWER_PREFIX = 'equipment_status_viewer';

function validateStatusViewerFile(file) {
  const nameLower = file.name.toLowerCase().replace(/\s+/g, '_');
  if (!nameLower.startsWith(STATUS_VIEWER_PREFIX)) {
    return {
      ok: false,
      error: `파일명이 "Equipment_Status_Viewer"로 시작해야 합니다.\n(예: Equipment_Status_Viewer_v02.html)`,
    };
  }
  if (!nameLower.endsWith('.html') && !nameLower.endsWith('.htm')) {
    return { ok: false, error: '파일 확장자는 .html 이어야 합니다.' };
  }
  return { ok: true };
}

// Equipment Control Register 탭 전용: 별도 프로젝트에서 만든 Equipment Status Viewer
// HTML 파일을 매주 업로드/갱신하기 위한 UI. 엑셀 업로드와는 완전히 별개로 동작하며,
// 파일이 커서(수 MB) 서버를 거치지 않고 브라우저에서 Vercel Blob으로 직접 올린다.
function StatusViewerUpload({ tabId, initial }) {
  const [status, setStatus] = useState('idle'); // idle | uploading | done | error
  const [message, setMessage] = useState('');
  const [meta, setMeta] = useState({
    url: initial?.status_viewer_url || null,
    fileName: initial?.status_viewer_file || null,
    updatedAt: initial?.status_viewer_updated_at || null,
  });

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const v = validateStatusViewerFile(file);
    if (!v.ok) {
      setStatus('error');
      setMessage(v.error);
      return;
    }

    try {
      setStatus('uploading');
      setMessage('업로드하는 중입니다... (파일 용량에 따라 시간이 걸릴 수 있습니다)');

      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/admin/equipment-status/upload-token',
      });

      const res = await fetch(`/api/admin/tabs/${tabId}/status-viewer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: blob.url, fileName: file.name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '저장에 실패했습니다.');
      }

      setStatus('done');
      setMessage('업로드 완료.');
      setMeta({ url: blob.url, fileName: file.name, updatedAt: new Date().toISOString() });
    } catch (err) {
      // @vercel/blob 클라이언트는 토큰 발급이 실패하면 자세한 이유 없이 이 일반 메시지만
      // 던집니다. 대부분 Blob 저장소 연결이 안 되어 있거나(BLOB_READ_WRITE_TOKEN 없음)
      // 연결 후 재배포를 하지 않은 경우이므로, 원인을 바로 알 수 있게 힌트를 덧붙입니다.
      const raw = err.message || '업로드 중 오류가 발생했습니다.';
      const hint = /retrieve the client token/i.test(raw)
        ? '\n(Vercel 프로젝트 Storage 탭에서 Blob 저장소를 연결했는지, 연결 후 재배포(Redeploy)까지 했는지 확인해주세요.)'
        : '';
      setStatus('error');
      setMessage(raw + hint);
    }
  }

  return (
    <div className="panel status-viewer-panel">
      <h3>Equipment Status Viewer (HTML)</h3>
      <p className="hint">
        다른 프로젝트에서 만든 Equipment_Status_Viewer.html 파일을 매주 여기에 새로 업로드하면,
        조회 화면의 &quot;Equipment Status 확인&quot; 링크가 최신 파일로 자동 갱신됩니다.
      </p>
      <div className="upload-form">
        <input type="file" accept=".html" onChange={handleFile} disabled={status === 'uploading'} />
      </div>
      {message && <p className={status === 'error' ? 'error' : 'message'}>{message}</p>}
      <div className="meta-box">
        <div>현재 파일: {meta.fileName || '(업로드된 파일 없음)'}</div>
        {meta.updatedAt && <div>마지막 업데이트: {new Date(meta.updatedAt).toLocaleString('ko-KR')}</div>}
        {meta.url && (
          <div>
            <a href={meta.url} target="_blank" rel="noopener noreferrer">
              현재 파일 열어보기 →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function TabCard({ cfg, initial }) {
  const [status, setStatus] = useState('idle'); // idle | parsing | uploading | done | error
  const [message, setMessage] = useState('');
  const [meta, setMeta] = useState({
    sourceFile: initial?.source_file || null,
    asOf: initial?.as_of || null,
    updatedAt: initial?.updated_at || null,
  });
  const [note, setNote] = useState(initial?.note || '');
  const [noteStatus, setNoteStatus] = useState('idle'); // idle | saving | saved | error

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일 재선택 가능하도록 초기화
    if (!file) return;

    const v = validateFile(cfg.id, file);
    if (!v.ok) {
      setStatus('error');
      setMessage(v.error);
      return;
    }

    try {
      setStatus('parsing');
      setMessage('파일을 읽는 중입니다...');
      const arrayBuffer = await file.arrayBuffer();
      const result = await parseTabFile(cfg.id, arrayBuffer, file.name);

      setStatus('uploading');
      setMessage('저장하는 중입니다...');
      const res = await fetch(`/api/admin/tabs/${cfg.id}/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceFile: result.sourceFile,
          asOf: result.asOf,
          data: { blocks: result.blocks, cutoffDate: result.cutoffDate, title: result.title },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '저장에 실패했습니다.');
      }

      setStatus('done');
      setMessage('업로드 완료.');
      setMeta({ sourceFile: result.sourceFile, asOf: result.asOf, updatedAt: new Date().toISOString() });
    } catch (err) {
      setStatus('error');
      setMessage(err.message || '처리 중 오류가 발생했습니다.');
    }
  }

  async function handleSaveNote() {
    setNoteStatus('saving');
    const res = await fetch(`/api/admin/tabs/${cfg.id}/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    setNoteStatus(res.ok ? 'saved' : 'error');
    if (res.ok) {
      setTimeout(() => setNoteStatus('idle'), 1500);
    }
  }

  return (
    <section className="panel">
      <h2>
        Tab {cfg.tabNumber}. {cfg.name}
      </h2>
      <p className="hint">
        파일명은 <code>{cfg.filePrefix}</code> 로 시작해야 합니다.
        <br />
        예: {cfg.example}
      </p>

      <div className="upload-form">
        <input type="file" accept={cfg.fileExt} onChange={handleFile} disabled={status === 'parsing' || status === 'uploading'} />
      </div>

      {message && (
        <p className={status === 'error' ? 'error' : 'message'}>{message}</p>
      )}

      <div className="meta-box">
        <div>현재 파일: {meta.sourceFile || '(업로드된 파일 없음)'}</div>
        <div>기준일(as of): {meta.asOf || '-'}</div>
        {meta.updatedAt && <div>마지막 업데이트: {new Date(meta.updatedAt).toLocaleString('ko-KR')}</div>}
      </div>

      <div className="note-box">
        <label className="note-label">담당자 노트</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="이 탭에 대한 코멘트를 입력하세요. 조회자에게 그대로 보입니다."
          rows={3}
        />
        <button type="button" onClick={handleSaveNote} disabled={noteStatus === 'saving'}>
          {noteStatus === 'saving' ? '저장 중...' : noteStatus === 'saved' ? '저장됨 ✓' : '노트 저장'}
        </button>
      </div>

      {cfg.id === 'equipment-control' && <StatusViewerUpload tabId={cfg.id} initial={initial} />}
    </section>
  );
}

export default function AdminDashboard({ initialTabs }) {
  const [tabs] = useState(initialTabs);

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin';
  }

  return (
    <div>
      {TAB_CONFIGS.map((cfg) => {
        const initial = tabs.find((t) => t.id === cfg.id);
        return <TabCard key={cfg.id} cfg={cfg} initial={initial} />;
      })}

      <button type="button" className="logout-btn" onClick={handleLogout}>
        로그아웃
      </button>
    </div>
  );
}
