# WebCron

[English](README.md) | **한국어**

WebCron은 웹 화면에서 크론 작업을 관리하는 서버입니다. 24시간 실행되면서 정해진 일정에 맞춰 작업을 실행합니다.

- **CLI 작업**: node, python, sh, bat 같은 셸 명령을 실행합니다. 종료 코드가 0이면 성공입니다.
- **웹훅 작업**: GET 또는 POST 요청을 보냅니다. 리다이렉트를 최대 10회까지 따라가며, 최종 응답이 2xx이면 성공입니다.
- **실행 이력**: 실행마다 성공·실패·시간 초과·중지 결과와 출력(최대 64KB)을 기록합니다.
- **감사 로그**: 로그인, 작업 변경, 수동 실행, 실행 중지, MCP 키 발급·폐기, 서버 시작·종료를 기록합니다.
- **MCP**: MCP 클라이언트(Claude Code 등)에서 작업을 조회·생성·삭제할 수 있습니다.
- **다국어**: 웹 화면, API 메시지, 서버 메시지를 한국어와 영어로 제공합니다.

요구사항 명세는 [docs/spec/01.webcron.srs.md](docs/spec/01.webcron.srs.md)에 있습니다.

## 1. 필요 환경

| 항목 | 조건 |
|---|---|
| Node.js | 24 이상 (TypeScript 서버 코드를 빌드 없이 바로 실행합니다) |
| OS | Windows 10/11, Windows Server, Linux |
| DB | 따로 설치할 필요가 없습니다 (내장 `node:sqlite` 사용) |

## 2. 설치와 첫 실행

```bash
npm install
npm run build      # 웹 화면(Svelte 5)을 dist/web 에 빌드합니다
npm start          # node server/src/main.ts
```

시스템에 `NODE_ENV=production`이 설정되어 있으면 npm이 빌드 도구(vite, svelte)를 설치하지 않습니다. 이때는 `npm run build` 전에 `npm install --include=dev`(또는 `npm ci --include=dev`)로 설치하세요.

처음 실행하면 `.env` 파일이 없으므로 서버가 템플릿을 만들고 종료합니다. `.env`에 `WEBCRON_PASSWORD`를 정한 뒤 다시 실행하세요. 로그인할 때는 아이디 없이 이 비밀번호만 입력합니다.

```dotenv
WEBCRON_PASSWORD=원하는-비밀번호
```

서버가 시작되면 브라우저에서 `http://127.0.0.1:8080`에 접속합니다.

다른 위치의 설정 파일을 쓰려면 `--env` 인자로 경로를 지정합니다.

```bash
node server/src/main.ts --env /etc/webcron/.env
```

## 3. 설정 (.env)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `WEBCRON_HOST` | `127.0.0.1` | 바인딩 주소. 외부에서 접속하려면 `0.0.0.0`으로 바꿉니다. |
| `WEBCRON_PORT` | `8080` | 포트 |
| `WEBCRON_PASSWORD` | (필수) | 로그인 비밀번호. 아이디는 없습니다. 아래 "비밀번호 자동 변환"을 참고하세요. |
| `WEBCRON_SESSION_TTL_MINUTES` | `720` | 마지막 요청 후 세션이 만료되기까지의 시간(분) |
| `WEBCRON_TIMEZONE` | 시스템 타임존 | 크론 일정 계산에 쓰는 IANA 타임존(예: `Asia/Seoul`) |
| `WEBCRON_LOG_RETENTION_DAYS` | `30` | 감사 로그와 실행 이력의 보관 기간(일) |
| `WEBCRON_DATA_DIR` | `./data` | SQLite 파일을 두는 디렉터리. 상대 경로는 `.env` 파일 위치를 기준으로 합니다. |

값이 잘못되면 서버는 원인이 된 변수 이름을 출력하고 종료 코드 1로 끝납니다.

### 비밀번호 자동 변환

`WEBCRON_PASSWORD`에 평문을 적고 서버를 시작하면, 서버가 그 값을 scrypt 해시로 바꿔 `.env`에 다시 씁니다. 다른 줄과 주석은 그대로 남습니다.

```dotenv
# 변환 전
WEBCRON_PASSWORD=원하는-비밀번호
# 변환 후
WEBCRON_PASSWORD='enc:scrypt$16384$8$1$...$...'
```

- 해시는 복호화할 수 없습니다. 비밀번호를 잊었다면 이 줄에 새 평문을 적고 서버를 다시 시작하세요.
- 변환할 때마다 감사 로그에 `config.password_encrypted` 이벤트가 남습니다.

## 4. 사용 방법

| 화면 | 할 수 있는 일 |
|---|---|
| 작업 | 작업 목록과 최근 24시간 성공·실패 집계를 봅니다. 작업을 켜고 끄거나, "지금 실행"으로 바로 실행합니다. |
| 작업 편집 | 이름, 크론 표현식, 타임아웃, 실행 방식(CLI 또는 웹훅)을 설정합니다. 저장하기 전에 다음 실행 예정 시각 5개를 미리 볼 수 있습니다. |
| 실행 이력 | 작업·결과·기간으로 기록을 걸러 봅니다. 상세 화면에서 출력을 확인하고, 실행 중인 작업을 중지할 수 있습니다. |
| 감사 로그 | 이벤트 종류와 기간으로 기록을 걸러 봅니다. 작업을 수정한 기록에서는 변경 전·후 값을 볼 수 있습니다. |
| MCP | MCP 키를 발급하고 폐기합니다. MCP 클라이언트 등록 방법을 보여 줍니다. |

### 크론 표현식

5필드(분 단위)와 6필드(초 단위)를 모두 지원합니다.

| 표현식 | 의미 |
|---|---|
| `*/5 * * * *` | 5분마다 |
| `0 3 * * *` | 매일 03:00 |
| `0 9 * * 1` | 매주 월요일 09:00 |
| `*/30 * * * * *` | 30초마다 (6필드) |

### 실행 규칙

- 같은 작업의 이전 실행이 끝나지 않았어도, 예정 시각이 되면 새 실행을 따로 시작합니다.
- 타임아웃의 기본값은 0(무제한)입니다. 값을 지정하면 그 시간이 지났을 때 자식 프로세스까지 모두 종료하고 결과를 "시간 초과"로 기록합니다.
- CLI 명령은 Windows에서 `cmd.exe`, Linux에서 `/bin/sh`로 실행합니다.
- 웹훅은 실패하면 지정한 횟수(0~5회)만큼 다시 시도합니다.
- 서버가 꺼져 있던 동안 지나간 일정은 다시 실행하지 않습니다.
- 서버가 종료될 때 실행 중이던 작업은 "중단됨"으로 기록합니다.

## 5. 언어 (한국어·영어)

| 대상 | 언어를 정하는 방법 |
|---|---|
| 웹 화면 | 처음 방문할 때 브라우저 언어가 한국어면 한국어, 그 외에는 영어로 보여 줍니다. 상단 메뉴나 로그인 화면의 **한국어 / English** 버튼으로 바꿀 수 있고, 고른 언어는 브라우저에 저장됩니다. |
| API 오류·검증 메시지 | 요청의 `Accept-Language` 헤더가 `ko`로 시작하면 한국어, 그 외이거나 헤더가 없으면 영어입니다. 웹 화면은 고른 언어를 이 헤더로 보냅니다. |
| MCP | 도구 설명은 영어입니다. 도구 결과 메시지는 `Accept-Language`를 따르고, 헤더가 없으면 영어입니다. |
| 서버 콘솔 메시지, `.env` 템플릿 주석, 실행 이력의 오류 메시지 | OS 로캘(`LC_ALL` → `LC_MESSAGES` → `LANG` 순서, 없으면 OS 기본 로캘)이 `ko`로 시작하면 한국어, 그 외에는 영어입니다. |

서버 메시지를 영어로 보고 싶으면 다음처럼 실행합니다.

```bash
LANG=en_US.UTF-8 npm start
```

실행 이력의 오류 메시지는 실행할 때의 서버 언어로 저장됩니다. 나중에 화면 언어를 바꿔도 이미 저장된 메시지는 바뀌지 않습니다.

## 6. MCP 연동

WebCron은 `/mcp` 경로에서 MCP 서버를 제공합니다. 전송 방식은 Streamable HTTP(상태 비저장)입니다.

| 도구 | 기능 |
|---|---|
| `list_jobs` | 모든 작업의 ID, 이름, 유형, 크론 표현식, 활성 여부, 다음 실행 시각, 마지막 결과를 조회합니다. |
| `create_job` | CLI 또는 웹훅 작업을 만들고 바로 일정에 등록합니다. 입력 검증은 웹 화면과 같습니다. |
| `delete_job` | ID로 작업을 삭제합니다. 실행 이력은 남습니다. |

### 키 발급과 등록

1. 웹 화면의 **MCP** 메뉴에서 키 이름을 입력하고 **키 발급**을 누릅니다.
2. 화면에 나온 키(`wcmcp_`로 시작)를 복사합니다. 키는 이때 한 번만 표시됩니다.
3. MCP 클라이언트에 등록합니다. Claude Code를 쓰는 경우는 다음과 같습니다.

```bash
claude mcp add --transport http webcron http://127.0.0.1:8080/mcp --header "Authorization: Bearer <발급한 키>"
```

`.mcp.json`으로 등록할 수도 있습니다.

```json
{
  "mcpServers": {
    "webcron": {
      "type": "http",
      "url": "http://127.0.0.1:8080/mcp",
      "headers": { "Authorization": "Bearer <발급한 키>" }
    }
  }
}
```

- 키는 만료되지 않습니다. 필요 없어진 키는 MCP 화면에서 **폐기**하세요. 폐기한 키로 요청하면 곧바로 HTTP 401을 받습니다.
- 서버는 키를 SHA-256 해시로만 저장합니다. 키를 잃어버리면 새로 발급하세요.
- MCP로 만들거나 지운 작업은 감사 로그에 경로(`mcp`)와 키 이름이 함께 기록됩니다.
- 도구 설명은 영어입니다. 결과 메시지 언어는 위 "언어" 절을 참고하세요.
- AI 도구에 새 MCP 서버를 등록하기 전에 사내 정보보호팀 승인 절차를 확인하세요.

## 7. 서비스로 등록하기

서버는 `SIGINT`, `SIGTERM`, Windows `Ctrl+C`를 받으면 새 실행을 멈추고 감사 로그에 `server.stop`을 남긴 뒤 종료합니다.

### pm2 (Windows, Linux)

```bash
npm install -g pm2
pm2 start server/src/main.ts --name webcron --interpreter node -- --env /opt/webcron/.env
pm2 save
pm2 startup        # 부팅 시 자동 시작 (출력된 명령을 실행합니다)
```

### systemd (Linux)

`/etc/systemd/system/webcron.service` 파일을 만듭니다.

```ini
[Unit]
Description=WebCron
After=network.target

[Service]
Type=simple
User=webcron
WorkingDirectory=/opt/webcron
ExecStart=/usr/bin/node server/src/main.ts --env /opt/webcron/.env
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now webcron
journalctl -u webcron -f     # 로그 보기
```

### Windows 서비스 (NSSM)

[NSSM](https://nssm.cc/)을 설치한 뒤 관리자 권한 명령 프롬프트에서 실행합니다.

```bat
nssm install WebCron "C:\Program Files\nodejs\node.exe" "server\src\main.ts --env C:\webcron\.env"
nssm set WebCron AppDirectory C:\webcron
nssm set WebCron AppStopMethodConsole 15000
nssm set WebCron AppStdout C:\webcron\logs\webcron.log
nssm set WebCron AppStderr C:\webcron\logs\webcron.log
nssm start WebCron
```

## 8. 보안 주의사항

- CLI 작업은 서버 프로세스와 같은 OS 계정 권한으로 실행됩니다. 이 서버의 비밀번호를 아는 사람은 서버에서 명령을 실행할 수 있습니다. 서버는 권한이 낮은 전용 계정으로 실행하세요.
- 기본 바인딩 주소는 `127.0.0.1`입니다. 외부에 공개해야 한다면 방화벽으로 접속을 제한하고, 리버스 프록시(nginx 등)에서 HTTPS를 적용하세요.
- MCP 키가 있으면 CLI 작업도 만들 수 있습니다. 즉 MCP 키는 서버에서 명령을 실행할 수 있는 권한과 같습니다. 키는 비밀번호처럼 보관하세요.
- 같은 IP에서 로그인이 5회 연속 실패하면 그 IP는 5분 동안 로그인할 수 없습니다.
- 감사 로그에는 웹훅 헤더 값과 환경 변수 값이 `***`로 가려져 기록됩니다. 비밀번호와 해시는 어디에도 출력하지 않습니다.
- `.env` 파일에는 비밀번호 해시가 들어 있으므로 저장소에 커밋하지 마세요(`.gitignore`에 포함되어 있습니다).

## 9. 개발

```bash
npm test           # 서버 테스트 (node:test)
npm run typecheck  # tsc + svelte-check
npm run dev:web    # 화면 개발 서버 (/api 는 127.0.0.1:8080 으로 프록시)
```

| 경로 | 내용 |
|---|---|
| `server/src/` | 서버 (Fastify, croner, node:sqlite, MCP SDK) |
| `server/test/` | 서버 테스트. 테스트 이름에 요구사항 ID가 들어 있습니다. |
| `server/src/i18n.ts` | 서버 메시지 사전(한국어·영어) |
| `web/src/` | 웹 화면 (Svelte 5, Vite) |
| `web/src/lib/messages.ts` | 화면 문구 사전(한국어·영어). 두 사전의 키는 테스트로 맞춰 둡니다. |
| `docs/spec/` | 요구사항 명세(SRS) |
| `docs/design/webcron-mockup.html` | 화면 시안 |
