'use client';

import { useState } from 'react';
import { TAB_CONFIGS } from '../lib/tabConfig';
import { validateFile, parseTabFile } from '../lib/excel';

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
          data: { tables: result.tables, charts: result.charts, cutoffDate: result.cutoffDate },
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
