import { GeminiVerifier } from './GeminiVerifier';
import { MockVerifier } from './MockVerifier';
import type { Verifier } from './types';
import { loadVerifierConfig, type VerifierConfig } from '../lib/keyStore';

export function createVerifier(config: VerifierConfig = loadVerifierConfig()): Verifier {
  if (config.provider === 'gemini' && config.apiKey.trim()) {
    return new GeminiVerifier({ apiKey: config.apiKey, model: config.model });
  }
  // No key, or the user chose offline drafting.
  return new MockVerifier();
}

export function isConfigured(config: VerifierConfig = loadVerifierConfig()): boolean {
  return config.provider === 'gemini' && config.apiKey.trim().length > 0;
}
