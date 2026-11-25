import { GoogleGenAI } from '@google/genai';

/**
 * Shared singleton cache of GoogleGenAI clients keyed by API key.
 * Eliminates repeated SDK instantiation, config normalization, and HTTP client
 * setup on every voice HTTP request and WebSocket connection.
 */
const clientCache = new Map<string, GoogleGenAI>();

export function getSharedGeminiClient(apiKey: string): GoogleGenAI {
  const normalizedKey = (apiKey || '').trim();
  if (!normalizedKey) {
    throw new Error('GEMINI_API_KEY is required to initialize GoogleGenAI.');
  }

  let client = clientCache.get(normalizedKey);
  if (!client) {
    client = new GoogleGenAI({
      apiKey: normalizedKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    // Bound cache size defensively in case rotating keys are ever passed in tests.
    if (clientCache.size >= 8) {
      const oldestKey = clientCache.keys().next().value;
      if (oldestKey !== undefined) {
        clientCache.delete(oldestKey);
      }
    }
    clientCache.set(normalizedKey, client);
  }
  return client;
}
