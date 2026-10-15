import { ApiError } from './errors.js';

export async function readBoundedResponse(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError(
          502,
          'INVALID_RESEARCH_RESPONSE',
          'Research response exceeds the supported size.',
        );
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'RESEARCH_UNAVAILABLE', 'Research is unavailable. Please retry later.');
  } finally {
    reader.releaseLock();
  }
}
