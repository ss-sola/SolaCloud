export interface ApiResponse<T> {
  code: number;
  message?: string;
  data: T;
}

export interface RequestOptions extends RequestInit {
  query?: Record<string, string | number | boolean | undefined | null>;
}

export class ApiClient {
  static async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await fetch(ApiClient.buildUrl(path, options.query), {
      ...options,
      credentials: 'include',
      headers: ApiClient.buildHeaders(options),
    });
    const payload = (await response.json()) as ApiResponse<T>;
    if (!response.ok || payload.code >= 400) {
      throw new Error(payload.message || `Request failed: ${response.status}`);
    }
    return payload.data;
  }

  static get<T>(path: string, query?: RequestOptions['query']): Promise<T> {
    return ApiClient.request<T>(path, { query });
  }

  static post<T>(path: string, body?: unknown): Promise<T> {
    return ApiClient.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  static put<T>(path: string, body?: unknown, query?: RequestOptions['query']): Promise<T> {
    return ApiClient.request<T>(path, {
      method: 'PUT',
      query,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  static delete<T>(path: string, query?: RequestOptions['query'], body?: unknown): Promise<T> {
    return ApiClient.request<T>(path, {
      method: 'DELETE',
      query,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  static buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(path, ApiClient.gatewayOrigin());
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value === undefined || value === null || String(value).trim() === '') {
        return;
      }
      url.searchParams.set(key, String(value).trim());
    });
    return url.href;
  }

  private static gatewayOrigin(): string {
    const configured = import.meta.env.VITE_GATEWAY_ORIGIN?.trim();
    if (configured) {
      const url = new URL(configured);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      ) {
        throw new Error('VITE_GATEWAY_ORIGIN must be an HTTP(S) origin');
      }
      return url.origin;
    }

    const url = new URL(window.location.origin);
    url.port = '3100';
    return url.origin;
  }

  private static buildHeaders(options: RequestOptions): HeadersInit | undefined {
    if (!options.headers) {
      return undefined;
    }
    return options.headers;
  }
}
