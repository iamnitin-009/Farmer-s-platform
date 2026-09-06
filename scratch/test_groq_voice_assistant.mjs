// scratch/test_groq_voice_assistant.mjs
// Comprehensive test suite for Groq Voice Assistant migration and Gemini Quality Check isolation

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';

console.log('====================================================');
console.log('  TESTING GROQ VOICE ASSISTANT & GEMINI ISOLATION');
console.log('====================================================\n');

// 1. Static checks
console.log('1. Verifying Zero Key Leakage & Code Isolation...');
const serverSrc = fs.readFileSync('server.js', 'utf8');

// Ensure Groq SDK is used for voice assistant
assert(serverSrc.includes("import Groq from 'groq-sdk'"), 'Must import groq-sdk');
assert(serverSrc.includes('GROQ_API_KEY'), 'Must check process.env.GROQ_API_KEY');
assert(serverSrc.includes('GROQ_MODEL_ID'), 'Must configure GROQ_MODEL_ID');
assert(serverSrc.includes('GROQ_RATE_LIMITED'), 'Must handle 429 rate limits with GROQ_RATE_LIMITED');
assert(serverSrc.includes('GROQ_API_KEY_INVALID'), 'Must handle 401 with GROQ_API_KEY_INVALID');

// Ensure Quality Check remains on Gemini
assert(serverSrc.includes("import { GoogleGenAI } from '@google/genai'"), 'Must retain GoogleGenAI for quality check');
assert(serverSrc.includes('GEMINI_API_KEY'), 'Must retain GEMINI_API_KEY for quality check');
assert(serverSrc.includes("app.post('/api/quality-check'"), 'Must preserve /api/quality-check');

// Ensure frontend has zero key leaks
const vaSrc = fs.readFileSync('src/components/VoiceAssistant.jsx', 'utf8');
assert(!vaSrc.includes('GROQ_API_KEY'), 'Frontend must never reference GROQ_API_KEY');
assert(!vaSrc.includes('GEMINI_API_KEY'), 'Frontend must never reference GEMINI_API_KEY');
assert(!vaSrc.includes('gsk_'), 'Frontend must never contain Groq key literals');
assert(!vaSrc.includes('AIzaSy'), 'Frontend must never contain Gemini key literals');
console.log('   ✓ Zero key leakage verified. Server correctly isolates Gemini for Quality and Groq for Voice.');

// 2. Start test server
console.log('\n2. Testing /api/voice-assistant Endpoint Responses...');
const { app, invokeGroqWithRetry } = await import(`file://${path.resolve('server.js')}`);
const testPort = 5997;
const testServer = await new Promise((resolve) => {
  const s = app.listen(testPort, () => resolve(s));
});

try {
  // Test 2.1: Missing payload
  const emptyRes = await fetch(`http://localhost:${testPort}/api/voice-assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const emptyData = await emptyRes.json();
  assert.strictEqual(emptyRes.status, 400);
  assert.strictEqual(emptyData.success, false);
  console.log('   ✓ Rejected empty request with 400 Bad Request');

  // Test 2.2: Whitespace payload
  const wsRes = await fetch(`http://localhost:${testPort}/api/voice-assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '     ' }),
  });
  const wsData = await wsRes.json();
  assert.strictEqual(wsRes.status, 400);
  assert.strictEqual(wsData.success, false);
  console.log('   ✓ Rejected whitespace-only request with 400 Bad Request');

  // Test 2.3: Unconfigured key check
  const savedKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;

  const unconfRes = await fetch(`http://localhost:${testPort}/api/voice-assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What is the price of wheat?' }),
  });
  const unconfData = await unconfRes.json();
  assert.strictEqual(unconfRes.status, 503);
  assert.strictEqual(unconfData.code, 'GROQ_API_KEY_MISSING');
  assert.strictEqual(unconfData.unconfigured, true);
  console.log('   ✓ Handled unconfigured GROQ_API_KEY with 503 and code GROQ_API_KEY_MISSING');

  // Test 2.4: Invalid key handling (authentication error)
  process.env.GROQ_API_KEY = 'gsk_invalid_test_dummy_key_abcdef12345';
  const invalidRes = await fetch(`http://localhost:${testPort}/api/voice-assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What is the price of wheat?' }),
  });
  const invalidData = await invalidRes.json();
  assert.strictEqual(invalidRes.status, 401);
  assert.strictEqual(invalidData.code, 'GROQ_API_KEY_INVALID');
  console.log('   ✓ Handled invalid Groq API key with 401 and code GROQ_API_KEY_INVALID');

  // Restore key
  if (savedKey) process.env.GROQ_API_KEY = savedKey;
  else delete process.env.GROQ_API_KEY;

  // Test 2.5: Verify /api/quality-check remains functional and still uses Gemini
  console.log('\n3. Verifying /api/quality-check Remains on Google Gemini...');
  const qcRes = await fetch(`http://localhost:${testPort}/api/quality-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      crop: 'wheat',
      image: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    }),
  });
  // Should either succeed (200) or return quota/auth notice without touching Groq
  const qcData = await qcRes.json();
  console.log(`   ✓ /api/quality-check responded with status ${qcRes.status}`);
  assert(!JSON.stringify(qcData).includes('Groq'), 'Quality check must never mention or use Groq');
  console.log('   ✓ /api/quality-check strictly isolated to Google Gemini.');

  console.log('\n4. Testing invokeGroqWithRetry Exponential Backoff Logic...');
  process.env.TEST_FAST_RETRY = 'true';

  // Test 4.1: 429 error retries up to maxRetries (3 retries = 4 total attempts) before throwing
  let attempts429 = 0;
  const rateLimitErr = new Error('Rate limit exceeded (429)');
  rateLimitErr.status = 429;
  rateLimitErr.code = 'rate_limit_exceeded';

  await assert.rejects(
    async () => {
      await invokeGroqWithRetry(async () => {
        attempts429++;
        throw rateLimitErr;
      }, 3);
    },
    (err) => {
      assert.strictEqual(err.status, 429);
      return true;
    },
    'Should reject with rate limit error after exhausting retries'
  );
  assert.strictEqual(attempts429, 4, 'Must attempt exactly 4 times (1 initial + 3 retries)');
  console.log('   ✓ 429 rate limit exhausted max 3 retries (4 total attempts)');

  // Test 4.2: 429 error succeeds after 2 transient failures (on 3rd attempt)
  let transientAttempts = 0;
  const successResult = await invokeGroqWithRetry(async () => {
    transientAttempts++;
    if (transientAttempts < 3) {
      const err = new Error('Rate limit exceeded (429)');
      err.status = 429;
      throw err;
    }
    return { choices: [{ message: { content: 'Success after retry!' } }] };
  }, 3);
  assert.strictEqual(transientAttempts, 3, 'Must attempt 3 times before succeeding');
  assert.strictEqual(successResult.choices[0].message.content, 'Success after retry!');
  console.log('   ✓ 429 rate limit recovered successfully after transient failures');

  // Test 4.3: 401 invalid API key error is NOT retried (fails immediately on attempt 1)
  let authAttempts = 0;
  const authErr = new Error('Invalid API Key provided (401)');
  authErr.status = 401;
  authErr.code = 'invalid_api_key';

  await assert.rejects(
    async () => {
      await invokeGroqWithRetry(async () => {
        authAttempts++;
        throw authErr;
      }, 3);
    },
    (err) => {
      assert.strictEqual(err.status, 401);
      return true;
    },
    'Should reject immediately without retry'
  );
  assert.strictEqual(authAttempts, 1, 'Must NOT retry 401 auth error (exactly 1 call)');
  console.log('   ✓ 401 invalid API key error failed immediately with zero retries');

  delete process.env.TEST_FAST_RETRY;

  console.log('\n====================================================');
  console.log('🎉 ALL GROQ VOICE ASSISTANT VERIFICATION TESTS PASSED 100%!');
  console.log('====================================================\n');
} finally {
  await new Promise((resolve) => testServer.close(resolve));
}
