// OPS-WEBCRON-001: .env 설정 파일 로드, SEC-WEBCRON-002: 평문 비밀번호 자동 변환
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { hashPassword, isEncrypted } from './password.ts';

export interface Config {
  envPath: string;
  host: string;
  port: number;
  passwordHash: string;
  sessionTtlMinutes: number;
  timezone: string;
  logRetentionDays: number;
  dataDir: string;
}

export class ConfigError extends Error {}

export const ENV_TEMPLATE = `# WebCron 설정 파일
# 서버를 시작하면 평문 WEBCRON_PASSWORD 는 enc: 로 시작하는 해시로 자동 변환된다.

# 바인딩 주소와 포트. 외부에서 접속하려면 0.0.0.0 으로 바꾼다.
WEBCRON_HOST=127.0.0.1
WEBCRON_PORT=8080

# 로그인 비밀번호 (아이디 없이 비밀번호로만 로그인한다)
WEBCRON_PASSWORD=

# 마지막 요청 후 세션이 만료되기까지의 시간(분)
WEBCRON_SESSION_TTL_MINUTES=720

# 크론 타임존 (IANA 이름, 예: Asia/Seoul). 비우면 시스템 타임존을 쓴다.
WEBCRON_TIMEZONE=

# 감사 로그와 실행 이력 보관 기간(일)
WEBCRON_LOG_RETENTION_DAYS=30

# 데이터(SQLite) 디렉터리. 상대 경로는 이 파일이 있는 디렉터리 기준이다.
WEBCRON_DATA_DIR=./data
`;

function intVar(env: Record<string, string>, key: string, def: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = (env[key] ?? '').trim();
  if (raw === '') return def;
  if (!/^-?\d+$/.test(raw)) throw new ConfigError(`${key} 값은 정수여야 합니다: ${raw}`);
  const n = Number(raw);
  if (n < min || n > max) throw new ConfigError(`${key} 값은 ${min} 이상 ${max} 이하여야 합니다: ${raw}`);
  return n;
}

export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function checkTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** .env 파일에서 key 줄만 바꾼다. 다른 줄과 줄바꿈 문자는 그대로 둔다. 임시 파일에 쓴 뒤 교체한다. */
export function rewriteEnvVar(path: string, key: string, value: string): void {
  const text = readFileSync(path, 'utf8');
  const re = new RegExp(`^([ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=).*?(\\r?)$`, 'm');
  if (!re.test(text)) throw new ConfigError(`${key} 줄을 찾을 수 없습니다.`);
  const next = text.replace(re, (_m, _head: string, cr: string) => `${key}='${value}'${cr}`);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, next, { mode: 0o600 });
  renameSync(tmp, path);
}

export function loadConfig(envPath: string): { config: Config; passwordEncrypted: boolean } {
  const path = resolve(envPath);
  if (!existsSync(path)) {
    writeFileSync(path, ENV_TEMPLATE, { mode: 0o600 });
    throw new ConfigError(`설정 파일이 없어 템플릿을 생성했습니다: ${path}\nWEBCRON_PASSWORD 를 설정한 뒤 다시 시작하세요.`);
  }
  const env = parseEnv(readFileSync(path, 'utf8')) as Record<string, string>;

  let password = env.WEBCRON_PASSWORD ?? '';
  if (!password) throw new ConfigError('WEBCRON_PASSWORD 가 비어 있습니다.');

  const port = intVar(env, 'WEBCRON_PORT', 8080, 1, 65535);
  const sessionTtlMinutes = intVar(env, 'WEBCRON_SESSION_TTL_MINUTES', 720, 1);
  const logRetentionDays = intVar(env, 'WEBCRON_LOG_RETENTION_DAYS', 30, 1);

  const tzRaw = (env.WEBCRON_TIMEZONE ?? '').trim();
  const timezone = tzRaw || systemTimezone();
  if (!checkTimezone(timezone)) throw new ConfigError(`WEBCRON_TIMEZONE 이 유효한 IANA 타임존이 아닙니다: ${timezone}`);

  let passwordEncrypted = false;
  if (!isEncrypted(password)) {
    password = hashPassword(password);
    rewriteEnvVar(path, 'WEBCRON_PASSWORD', password);
    passwordEncrypted = true;
  }

  return {
    passwordEncrypted,
    config: {
      envPath: path,
      host: (env.WEBCRON_HOST ?? '').trim() || '127.0.0.1',
      port,
      passwordHash: password,
      sessionTtlMinutes,
      timezone,
      logRetentionDays,
      dataDir: resolve(dirname(path), (env.WEBCRON_DATA_DIR ?? '').trim() || './data'),
    },
  };
}
