// 실행: node server/src/main.ts [--env <path>]
import { fileURLToPath } from 'node:url';
import { ConfigError } from './config.ts';
import { startServer } from './server.ts';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const envPath = argValue('--env') ?? '.env';
const webDir = fileURLToPath(new URL('../../dist/web', import.meta.url));

try {
  const server = await startServer({ envPath, webDir });
  if (server.config.host === '0.0.0.0' || server.config.host === '::') {
    console.warn('[webcron] 경고: 모든 네트워크에서 접속할 수 있습니다. 방화벽이나 리버스 프록시(HTTPS)로 보호하세요.');
  }
  const onSignal = (sig: string) => {
    server.stop(sig).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(sig, () => onSignal(sig));
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`[webcron] 설정 오류: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
