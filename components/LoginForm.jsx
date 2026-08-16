'use client';

import { useState } from 'react';

export default function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    setLoading(false);

    if (res.ok) {
      window.location.href = '/admin';
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || '로그인에 실패했습니다.');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="login-form">
      <input
        type="password"
        placeholder="관리자 비밀번호"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
      />
      <button type="submit" disabled={loading}>
        {loading ? '확인 중...' : '로그인'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
