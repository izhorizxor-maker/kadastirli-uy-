const TOKEN_STORAGE_KEY = 'ekadastr_session_token';

let memoryToken: string | null =
  typeof window !== 'undefined' ? window.sessionStorage.getItem(TOKEN_STORAGE_KEY) : null;

export function setAuthToken(token: string | null): void {
  memoryToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }
}

export function getAuthToken(): string | null {
  return memoryToken;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ekadastr-network-status', { detail: { online: true } }));
    }
  } catch (networkErr) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ekadastr-network-status', { detail: { online: false } }));
    }
    throw new Error(
      'Server bilan aloqa uzildi. Internet tarmog‘ini tekshiring — kiritilgan ma’lumotlaringiz oynada saqlanib turibdi.'
    );
  }

  if (response.status === 401 && path !== '/api/auth/login') {
    setAuthToken(null);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ekadastr-unauthorized'));
    }
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || `So‘rov xatoligi (${response.status})`);
    }
    return data as T;
  }

  if (!response.ok) {
    throw new Error(`Server xatoligi (${response.status})`);
  }
  return (await response.text()) as unknown as T;
}

export async function downloadAuthenticatedFile(url: string, fallbackFilename: string): Promise<void> {
  const headers = new Headers();
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    let msg = 'Faylni yuklab olishda xatolik yuz berdi.';
    try {
      const errJson = await response.json();
      if (errJson?.error) msg = errJson.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || fallbackFilename;

  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
}
