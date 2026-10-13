// IR-WEBCRON-003: API·MCP 메시지 언어, OPS-WEBCRON-003: 서버 콘솔 메시지 언어
export type Locale = 'ko' | 'en';

/** 'ko' 로 시작하면 한국어, 그 외에는 영어 */
export function pickLocale(value: string | null | undefined): Locale {
  return /^\s*ko/i.test(value ?? '') ? 'ko' : 'en';
}

/** LC_ALL → LC_MESSAGES → LANG → OS 기본 로캘 순서로 서버 언어를 정한다. */
export function systemLocale(): Locale {
  const env = process.env;
  return pickLocale(env.LC_ALL || env.LC_MESSAGES || env.LANG || Intl.DateTimeFormat().resolvedOptions().locale);
}

let serverLocale: Locale = systemLocale();
export const getServerLocale = (): Locale => serverLocale;
export const setServerLocale = (l: Locale): void => { serverLocale = l; };

const ko = {
  // 설정
  'config.templateCreated': '설정 파일이 없어 템플릿을 생성했습니다: {path}\nWEBCRON_PASSWORD 를 설정한 뒤 다시 시작하세요.',
  'config.notInteger': '{key} 값은 정수여야 합니다: {raw}',
  'config.range': '{key} 값은 {min} 이상 {max} 이하여야 합니다: {raw}',
  'config.passwordEmpty': 'WEBCRON_PASSWORD 가 비어 있습니다.',
  'config.badTimezone': 'WEBCRON_TIMEZONE 이 유효한 IANA 타임존이 아닙니다: {tz}',
  'config.lineNotFound': '{key} 줄을 찾을 수 없습니다.',
  // 크론
  'cron.fields': '크론 표현식은 5필드(분 단위) 또는 6필드(초 단위)여야 합니다.',
  'cron.invalid': '크론 표현식이 올바르지 않습니다: {detail}',
  // 작업 검증
  'job.nameRequired': '이름을 입력하세요.',
  'job.nameTooLong': '이름은 100자 이하여야 합니다.',
  'job.descriptionTooLong': '설명은 500자 이하여야 합니다.',
  'job.type': '유형은 cli 또는 webhook 이어야 합니다.',
  'job.enabled': '활성 여부는 true 또는 false 여야 합니다.',
  'job.timeout': '타임아웃은 0 이상 {max} 이하의 정수(초)여야 합니다.',
  'job.command': '실행할 명령을 입력하세요.',
  'job.map': '키-값 객체여야 합니다.',
  'job.mapKey': '이름 형식이 올바르지 않습니다: {key}',
  'job.mapValue': '값은 문자열이어야 합니다.',
  'job.method': '메서드는 GET 또는 POST 여야 합니다.',
  'job.urlProtocol': 'http 또는 https URL이어야 합니다.',
  'job.url': '올바른 URL을 입력하세요.',
  'job.body': '본문은 1MB 이하여야 합니다.',
  'job.retry': '재시도 횟수는 0~5 사이의 정수여야 합니다.',
  // 실행
  'exec.cwdMissing': '작업 디렉터리가 없습니다: {cwd}',
  'exec.timeoutCli': '타임아웃({sec}초)으로 프로세스를 종료했습니다.',
  'exec.timeoutHook': '타임아웃({sec}초)으로 요청을 취소했습니다.',
  'exec.canceled': '사용자가 실행을 중지했습니다.',
  'exec.spawnFailed': '명령을 시작할 수 없습니다: {error}',
  'exec.truncated': '\n…[잘림: 64KB를 넘는 출력은 저장하지 않았습니다]',
  'exec.requestFailed': '요청 실패: {error}',
  'exec.tooManyRedirects': '리다이렉트가 {max}회를 넘었습니다.',
  'exec.readFailed': '응답 읽기 실패: {error}',
  'exec.error': '실행 중 오류: {error}',
  'exec.noCli': 'CLI 설정이 없습니다.',
  'exec.noWebhook': '웹훅 설정이 없습니다.',
  'exec.interrupted': '서버가 종료되어 실행이 중단되었습니다.',
  // 웹 API
  'api.loginRequired': '로그인이 필요합니다.',
  'api.jsonOnly': 'Content-Type: application/json 요청만 받습니다.',
  'api.serverError': '서버 오류가 발생했습니다.',
  'api.badJson': 'JSON 본문을 해석할 수 없습니다.',
  'api.locked': '로그인을 5회 연속 실패했습니다. {sec}초 뒤에 다시 시도하세요.',
  'api.badPassword': '비밀번호가 올바르지 않습니다.',
  'api.checkInput': '입력값을 확인하세요.',
  'api.enabledBool': 'true 또는 false 여야 합니다.',
  'api.jobNotFound': '작업을 찾을 수 없습니다.',
  'api.shuttingDown': '서버가 종료 중입니다.',
  'api.runNotFound': '실행 기록을 찾을 수 없습니다.',
  'api.runFinished': '이미 끝난 실행입니다.',
  'api.keyName': '이름은 1~100자로 입력하세요.',
  'api.keyNotFound': 'MCP 키를 찾을 수 없습니다.',
  'api.notFound': '찾을 수 없습니다.',
  // MCP
  'mcp.unauthorized': '유효한 MCP 키가 필요합니다 (Authorization: Bearer <키>).',
  'mcp.postOnly': '이 서버는 상태 비저장 모드라 POST만 지원합니다.',
  'mcp.createFailed': '작업을 만들지 못했습니다. 입력값을 확인하세요.\n{errors}',
  'mcp.jobNotFound': '작업을 찾을 수 없습니다: {id}',
  'mcp.serverError': '서버 오류',
  // 서버 콘솔
  'log.configError': '설정 오류: {message}',
  'log.passwordEncrypted': '평문 비밀번호를 enc 해시로 바꿔 저장했습니다: {path}',
  'log.scheduleFailed': '작업 {id}({name}) 일정을 등록하지 못했습니다: {error}',
  'log.purged': '보관 기간({days}일)이 지난 기록을 정리했습니다: 실행 {runs}건, 감사 {audit}건',
  'log.purgeFailed': '기록 정리 실패: {error}',
  'log.started': 'v{version} 시작: {url} (작업 {jobs}개, 타임존 {tz})',
  'log.interrupted': '이전 종료 때 실행 중이던 {count}건을 interrupted 로 마감했습니다.',
  'log.stopped': '종료했습니다 ({reason}).',
  'log.publicWarning': '경고: 모든 네트워크에서 접속할 수 있습니다. 방화벽이나 리버스 프록시(HTTPS)로 보호하세요.',
};

const en: Record<keyof typeof ko, string> = {
  'config.templateCreated': 'No settings file was found, so a template was created: {path}\nSet WEBCRON_PASSWORD and start again.',
  'config.notInteger': '{key} must be an integer: {raw}',
  'config.range': '{key} must be between {min} and {max}: {raw}',
  'config.passwordEmpty': 'WEBCRON_PASSWORD is empty.',
  'config.badTimezone': 'WEBCRON_TIMEZONE is not a valid IANA time zone: {tz}',
  'config.lineNotFound': 'Cannot find the {key} line.',
  'cron.fields': 'A cron expression must have 5 fields (minutes) or 6 fields (seconds).',
  'cron.invalid': 'The cron expression is not valid: {detail}',
  'job.nameRequired': 'Enter a name.',
  'job.nameTooLong': 'The name must be 100 characters or less.',
  'job.descriptionTooLong': 'The description must be 500 characters or less.',
  'job.type': 'The type must be cli or webhook.',
  'job.enabled': 'Enabled must be true or false.',
  'job.timeout': 'The timeout must be an integer from 0 to {max} (seconds).',
  'job.command': 'Enter a command to run.',
  'job.map': 'Must be a key-value object.',
  'job.mapKey': 'The name format is not valid: {key}',
  'job.mapValue': 'The value must be a string.',
  'job.method': 'The method must be GET or POST.',
  'job.urlProtocol': 'The URL must use http or https.',
  'job.url': 'Enter a valid URL.',
  'job.body': 'The body must be 1 MB or less.',
  'job.retry': 'The retry count must be an integer from 0 to 5.',
  'exec.cwdMissing': 'The working directory does not exist: {cwd}',
  'exec.timeoutCli': 'The process was stopped by the timeout ({sec} s).',
  'exec.timeoutHook': 'The request was canceled by the timeout ({sec} s).',
  'exec.canceled': 'The user stopped the run.',
  'exec.spawnFailed': 'Cannot start the command: {error}',
  'exec.truncated': '\n…[truncated: output over 64 KB was not saved]',
  'exec.requestFailed': 'Request failed: {error}',
  'exec.tooManyRedirects': 'More than {max} redirects.',
  'exec.readFailed': 'Failed to read the response: {error}',
  'exec.error': 'Error during the run: {error}',
  'exec.noCli': 'The CLI settings are missing.',
  'exec.noWebhook': 'The webhook settings are missing.',
  'exec.interrupted': 'The run stopped because the server shut down.',
  'api.loginRequired': 'You must sign in.',
  'api.jsonOnly': 'Only Content-Type: application/json requests are accepted.',
  'api.serverError': 'A server error occurred.',
  'api.badJson': 'Cannot parse the JSON body.',
  'api.locked': 'Sign-in failed 5 times in a row. Try again in {sec} seconds.',
  'api.badPassword': 'Incorrect password.',
  'api.checkInput': 'Check the input values.',
  'api.enabledBool': 'Must be true or false.',
  'api.jobNotFound': 'Job not found.',
  'api.shuttingDown': 'The server is shutting down.',
  'api.runNotFound': 'Run not found.',
  'api.runFinished': 'The run has already finished.',
  'api.keyName': 'Enter a name of 1 to 100 characters.',
  'api.keyNotFound': 'MCP key not found.',
  'api.notFound': 'Not found.',
  'mcp.unauthorized': 'A valid MCP key is required (Authorization: Bearer <key>).',
  'mcp.postOnly': 'This server is stateless and supports POST only.',
  'mcp.createFailed': 'Could not create the job. Check the input values.\n{errors}',
  'mcp.jobNotFound': 'Job not found: {id}',
  'mcp.serverError': 'Server error',
  'log.configError': 'Settings error: {message}',
  'log.passwordEncrypted': 'Replaced the plain-text password with an enc hash: {path}',
  'log.scheduleFailed': 'Could not schedule job {id} ({name}): {error}',
  'log.purged': 'Removed records older than the retention period ({days} days): {runs} runs, {audit} audit entries',
  'log.purgeFailed': 'Failed to remove old records: {error}',
  'log.started': 'v{version} started: {url} ({jobs} jobs, time zone {tz})',
  'log.interrupted': 'Closed {count} runs left running at the last shutdown as interrupted.',
  'log.stopped': 'Stopped ({reason}).',
  'log.publicWarning': 'Warning: the server accepts connections from all networks. Protect it with a firewall or a reverse proxy (HTTPS).',
};

export const MESSAGES: Record<Locale, Record<keyof typeof ko, string>> = { ko, en };
export type MsgKey = keyof typeof ko;

export function t(locale: Locale, key: MsgKey, params: Record<string, string | number> = {}): string {
  return MESSAGES[locale][key].replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** 서버 로캘 기준 메시지 */
export const ts = (key: MsgKey, params?: Record<string, string | number>) => t(serverLocale, key, params);
