/**
 * Two-step end-to-end captcha verification for issue #7.
 *
 * Step 1 (no arg): trigger the real connector flow up to captcha-required,
 *   fetch the captcha image via the new kdsvc endpoint, write the PNG to disk
 *   and persist the session cookies. (Operator reads the 4 chars from the PNG.)
 * Step 2 (arg = code): reload the session, submit the code, then run the
 *   business RPC that used to 401 (GetExtendObjectTypeId) to prove a WPF
 *   session passes FlatShake.
 *
 * Uses the REAL production modules (captcha.ts / login.ts), ClientType=1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { KdSession } from '../../src/main/erp/k3cloud/rpc/http-client';
import { login } from '../../src/main/erp/k3cloud/rpc/login';
import { fetchCaptchaImage } from '../../src/main/erp/k3cloud/rpc/captcha';
import { getExtendObjectTypeId } from '../../src/main/erp/k3cloud/rpc/metadata';

const settings = JSON.parse(readFileSync(join(homedir(), '.opendeploy', 'settings.json'), 'utf-8'));
const bos = settings.projects[0].bos;
const creds = { baseUrl: bos.baseUrl, acctId: bos.acctId, username: bos.username, password: bos.password };

const SESS_FILE = join(homedir(), '.opendeploy', 'diag-captcha-session.json');
const PNG_FILE = join(homedir(), '.opendeploy', 'diag-captcha.png');

async function step1() {
  const session: KdSession = { baseUrl: creds.baseUrl };
  // First login (no code) → expect captcha-required, mirrors connector.connect()
  const r1 = await login(creds, { session });
  console.log('login(no code):', r1.messageCode ?? r1.message);
  // Fetch captcha via the kdsvc endpoint (writes KDServiceSession on this session)
  const img = await fetchCaptchaImage(session);
  writeFileSync(PNG_FILE, img.bytes);
  writeFileSync(
    SESS_FILE,
    JSON.stringify({
      baseUrl: session.baseUrl,
      aspNetSessionId: session.aspNetSessionId,
      kdServiceSessionId: session.kdServiceSessionId,
      obfuscatedKey: session.obfuscatedKey,
    }),
  );
  console.log(`\n✅ captcha PNG saved: ${PNG_FILE} (${img.bytes.length} bytes, ${img.contentType})`);
  console.log(`   session saved: ${SESS_FILE}`);
  console.log('   → read the 4 chars from the PNG, then re-run with the code as arg.');
}

async function step2(code: string) {
  const saved = JSON.parse(readFileSync(SESS_FILE, 'utf-8'));
  const session: KdSession = { ...saved };
  const r = await login(creds, { session, validationCode: code });
  console.log(`login(code=${code}): isSuccess=${r.isSuccess} code=${r.messageCode} msg=${r.message}`);
  const usable = r.isSuccess || r.messageCode === 'CheckPasswordPolicy';
  if (!usable) {
    console.log('❌ login did not yield a usable session — captcha wrong/expired or other.');
    return;
  }
  console.log('   session usable (login ok or password-policy advisory). Running business RPC…');
  try {
    const ids = await getExtendObjectTypeId(session, 'SAL_SaleOrder');
    console.log(`\n✅✅ GetExtendObjectTypeId OK — ${ids.length} extension(s). NO FlatShake 401.`);
    console.log('   端到端跑通:WPF+验证码登录 → 业务 RPC 正常,防篡改不再拦。');
  } catch (e) {
    console.log(`\n❌ business RPC failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
  }
}

const code = process.argv[2];
(code ? step2(code) : step1()).catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
