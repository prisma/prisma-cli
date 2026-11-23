export interface ApiErrorDetail {
  code?: string;
  message?: string;
  hint?: string;
}

/**
 * The body of a failed Management API response. A request that the
 * API's validation refuses (HTTP 400) carries a list of issues in
 * `error`, not the usual code, message and hint.
 */
export interface ApiErrorBody {
  error?: ApiErrorDetail | unknown[];
}

export function apiErrorDetail(body: ApiErrorBody | undefined): ApiErrorDetail {
  const error = body?.error;
  return error === undefined || Array.isArray(error) ? {} : error;
}
