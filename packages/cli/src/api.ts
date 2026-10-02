import type { z } from 'zod';
import { apiErrorSchema } from '@cybermind/shared/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions<T> = {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string;
  schema: z.ZodType<T>;
};

/** JSON request against the CyberMind server, validated with a shared schema. */
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
      parsed.success ? parsed.data.error : `HTTP ${response.status} from ${path}`
    );
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(response.status, `Unexpected response from ${path}`);
  }
  return parsed.data;
}
