/**
 * http_client.js - Zero-dependency HTTP client wrapper around native WHATWG fetch.
 */

class HttpClient {
  constructor(baseUrl = '', defaultHeaders = {}) {
    this.baseUrl = baseUrl;
    this.defaultHeaders = defaultHeaders;
  }

  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...this.defaultHeaders,
      ...options.headers,
    };

    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof Buffer) && !(body instanceof Uint8Array)) {
      body = JSON.stringify(body);
    }

    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body,
      signal: options.signal,
    });

    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    } else {
      try {
        data = await res.text();
      } catch {
        data = null;
      }
    }

    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      data,
    };
  }

  get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'GET' });
  }

  post(endpoint, body, options = {}) {
    return this.request(endpoint, { ...options, method: 'POST', body });
  }

  put(endpoint, body, options = {}) {
    return this.request(endpoint, { ...options, method: 'PUT', body });
  }

  delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  }
}

module.exports = {
  HttpClient,
};
