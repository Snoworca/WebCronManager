// OPS-WEBCRON-001: .env 설정 파일 로드, SEC-WEBCRON-002: 평문 비밀번호 자동 변환
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { getServerLocale, ts, type Locale } from './i18n.ts';
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

const TEMPLATE_COMMENTS = {
  ko: {
    head: '# WebCron 설정 파일\n# 서버를 시작하면 평문 WEBCRON_PASSWORD 는 enc: 로 시작하는 해시로 자동 변환된다.',
    host: '# 바인딩 주소와 포트. 외부에서 접속하려면 0.0.0.0 으로 바꾼다.',
    password: '# 로그인 비밀번호 (아이디 없이 비밀번호로만 로그인한다)',
    ttl: '# 마지막 요청 후 세션이 만료되기까지의 시간(분)',
    tz: '# 크론 타임존 (IANA 이름, 예: Asia/Seoul). 비우면 시스템 타임존을 쓴다.',
    retention: '# 감사 로그와 실행 이력 보관 기간(일)',
    data: '# 데이터(SQLite) 디렉터리. 상대 경로는 이 파일이 있는 디렉터리 기준이다.',
  },
  en: {
    head: '# WebCron settings file\n# When the server starts, a plain-text WEBCRON_PASSWORD is replaced with a hash that starts with enc:.',
    host: '# Bind address and port. To accept connections from other hosts, use 0.0.0.0.',
    password: '# Sign-in password (there is no user name; you sign in with the password only)',
    ttl: '# Minutes from the last request until the session expires',
    tz: '# Cron time zone (IANA name, for example Asia/Seoul). Leave empty to use the system time zone.',
    retention: '# Retention period for audit logs and run history (days)',
    data: '# Data (SQLite) directory. A relative path is relative to the directory of this file.',
  },
};

/** OPS-WEBCRON-003: 템플릿 주석은 서버 로캘 언어를 따른다. 변수는 언어와 무관하게 같다. */
export function envTemplate(locale: Locale = getServerLocale()): string {
  const c = TEMPLATE_COMMENTS[locale];
  return `${c.head}

${c.host}
WEBCRON_HOST=127.0.0.1
WEBCRON_PORT=8080

${c.password}
WEBCRON_PASSWORD=

${c.ttl}
WEBCRON_SESSION_TTL_MINUTES=720

${c.tz}
WEBCRON_TIMEZONE=

${c.retention}
WEBCRON_LOG_RETENTION_DAYS=30

${c.data}
WEBCRON_DATA_DIR=./data
`;
}

function intVar(env: Record<string, string>, key: string, def: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = (env[key] ?? '').trim();
  if (raw === '') return def;
  if (!/^-?\d+$/.test(raw)) throw new ConfigError(ts('config.notInteger', { key, raw }));
  const n = Number(raw);
  if (n < min || n > max) throw new ConfigError(ts('config.range', { key, min, max, raw }));
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
  if (!re.test(text)) throw new ConfigError(ts('config.lineNotFound', { key }));
  const next = text.replace(re, (_m, _head: string, cr: string) => `${key}='${value}'${cr}`);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, next, { mode: 0o600 });
  renameSync(tmp, path);
}

export function loadConfig(envPath: string): { config: Config; passwordEncrypted: boolean } {
  const path = resolve(envPath);
  if (!existsSync(path)) {
    writeFileSync(path, envTemplate(), { mode: 0o600 });
    throw new ConfigError(ts('config.templateCreated', { path }));
  }
  const env = parseEnv(readFileSync(path, 'utf8')) as Record<string, string>;

  let password = env.WEBCRON_PASSWORD ?? '';
  if (!password) throw new ConfigError(ts('config.passwordEmpty'));

  const port = intVar(env, 'WEBCRON_PORT', 8080, 1, 65535);
  const sessionTtlMinutes = intVar(env, 'WEBCRON_SESSION_TTL_MINUTES', 720, 1);
  const logRetentionDays = intVar(env, 'WEBCRON_LOG_RETENTION_DAYS', 30, 1);

  const tzRaw = (env.WEBCRON_TIMEZONE ?? '').trim();
  const timezone = tzRaw || systemTimezone();
  if (!checkTimezone(timezone)) throw new ConfigError(ts('config.badTimezone', { tz: timezone }));

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
