/**
 * Decompresses a gzip-encoded ArrayBuffer into a UTF-8 string using the Web standard
 * DecompressionStream API, supported natively in Chromium Service Workers and Node.
 */
export async function decompressGzip(buffer: ArrayBuffer): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is not supported in this runtime environment.');
  }

  const stream = new Response(buffer).body;
  if (!stream) {
    throw new Error('Failed to create stream from buffer.');
  }

  const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
  const response = new Response(decompressedStream);
  return await response.text();
}
