import type { z } from 'zod';
import { apiErrorSchema } from '@vibivibi/shared/api';
import { VERSION } from './version';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Machine-readable reason some error responses carry (e.g. "not_registered"). */
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions<T> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  body?: unknown;
  token?: string;
  /** Output type drives T; schemas with defaults have a different input type. */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
};

/** JSON request against the vibivibi server, validated with a shared schema. */
export async function request<T>(
  serverUrl: string,
  path: string,
  { method = 'GET', body, token, schema }: RequestOptions<T>
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(path, serverUrl), {
      method,
      headers: {
        accept: 'application/json',
        'x-vibi-client': VERSION,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    throw new ApiError(
      0,
      `Could not reach ${serverUrl}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error : `HTTP ${response.status} from ${path}`,
      parsed.success ? parsed.data.code : undefined
    );
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(response.status, `Unexpected response from ${path}`);
  }
  return parsed.data;
}

/**
 * Raw byte upload used by the development ("direct") transport. The body is
 * streamed in chunks so progress can be reported as bytes leave the process.
 */
export async function putBytes(
  url: URL,
  bytes: Uint8Array,
  token: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  const total = bytes.byteLength;
  const CHUNK = 256 * 1024;
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      const end = Math.min(sent + CHUNK, total);
      controller.enqueue(bytes.subarray(sent, end));
      sent = end;
      onProgress?.(sent, total);
    }
  });
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/octet-stream',
        'content-length': String(total)
      },
      body,
      duplex: 'half'
    } as RequestInit & { duplex: 'half' });
  } catch (error) {
    throw new ApiError(0, `Could not reach ${url.origin}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = `HTTP ${response.status} from ${url.pathname}`;
    try {
      const parsed = apiErrorSchema.safeParse(JSON.parse(text));
      if (parsed.success) message = parsed.data.error;
    } catch {}
    throw new ApiError(response.status, message);
  }
}

/** Downloads a binary body (ciphertext) with the device token. */
export async function getBytes(
  url: URL,
  token: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/octet-stream' } });
  } catch (error) {
    throw new ApiError(0, `Could not reach ${url.origin}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = `HTTP ${response.status} from ${url.pathname}`;
    try {
      const parsed = apiErrorSchema.safeParse(JSON.parse(text));
      if (parsed.success) message = parsed.data.error;
    } catch {}
    throw new ApiError(response.status, message);
  }
  const total = Number(response.headers.get('content-length') ?? 0);
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, total || loaded);
  }
  return Buffer.concat(chunks);
}
