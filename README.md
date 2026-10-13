# WebCron

**English** | [한국어](README.ko.md)

WebCron is a server that runs cron jobs and lets you manage them in a web UI. It runs all the time and starts each job on its schedule.

- **CLI jobs**: run shell commands such as node, python, sh, or bat. Exit code 0 means success.
- **Webhook jobs**: send a GET or POST request. WebCron follows up to 10 redirects. A final 2xx response means success.
- **Run history**: every run records its result (succeeded, failed, timed out, stopped) and its output (up to 64 KB).
- **Audit log**: records sign-ins, job changes, manual runs, stopped runs, MCP key issue and revoke, and server start and stop.
- **MCP**: MCP clients (such as Claude Code) can list, create, and delete jobs.
- **Languages**: the web UI, API messages, and server messages are available in Korean and English.

The requirements specification is in [docs/spec/01.webcron.srs.md](docs/spec/01.webcron.srs.md) (Korean).

## 1. Requirements

| Item | Requirement |
|---|---|
| Node.js | 24 or later (the TypeScript server code runs directly, with no build step) |
| OS | Windows 10/11, Windows Server, Linux |
| Database | No installation needed (uses the built-in `node:sqlite`) |

## 2. Install and first run

```bash
npm install
npm run build      # builds the web UI (Svelte 5) into dist/web
npm start          # node server/src/main.ts
```

If `NODE_ENV=production` is set on your system, npm skips the build tools (vite, svelte). In that case install with `npm install --include=dev` (or `npm ci --include=dev`) before you run `npm run build`.

On the first run there is no `.env` file, so the server creates a template and stops. Set `WEBCRON_PASSWORD` in `.env` and start the server again. To sign in, enter this password only. There is no user name.

```dotenv
WEBCRON_PASSWORD=your-password
```

When the server is running, open `http://127.0.0.1:8080` in a browser.

To use a settings file in a different location, give its path with `--env`.

```bash
node server/src/main.ts --env /etc/webcron/.env
```

## 3. Settings (.env)

| Variable | Default | Description |
|---|---|---|
| `WEBCRON_HOST` | `127.0.0.1` | Bind address. To accept connections from other hosts, use `0.0.0.0`. |
| `WEBCRON_PORT` | `8080` | Port |
| `WEBCRON_PASSWORD` | (required) | Sign-in password. There is no user name. See "Automatic password hashing" below. |
| `WEBCRON_SESSION_TTL_MINUTES` | `720` | Minutes from the last request until the session expires |
| `WEBCRON_TIMEZONE` | System time zone | IANA time zone for cron schedules (for example `Asia/Seoul`) |
| `WEBCRON_LOG_RETENTION_DAYS` | `30` | Retention period for audit logs and run history (days) |
| `WEBCRON_DATA_DIR` | `./data` | Directory for the SQLite file. A relative path is relative to the `.env` file. |

If a value is not valid, the server prints the name of the variable and exits with code 1.

### Automatic password hashing

If `WEBCRON_PASSWORD` contains plain text when the server starts, the server replaces it with a scrypt hash in `.env`. All other lines and comments stay the same.

```dotenv
# Before
WEBCRON_PASSWORD=your-password
# After
WEBCRON_PASSWORD='enc:scrypt$16384$8$1$...$...'
```

- The hash cannot be decrypted. If you forget the password, write a new plain-text password on this line and restart the server.
- Each time the password is hashed, the audit log records a `config.password_encrypted` event.

## 4. Using the web UI

| Screen | What you can do |
|---|---|
| Jobs | See the job list and the success and failure counts for the last 24 hours. Turn jobs on or off, or start a job at once with **Run now**. |
| Job edit | Set the name, cron expression, timeout, and execution type (CLI or webhook). Before you save, you can see the next 5 run times. |
| Run history | Filter runs by job, result, and date. Open a run to see its output, or stop a run that is still running. |
| Audit log | Filter entries by event type and date. For a job change, you can see the values before and after. |
| MCP | Issue and revoke MCP keys. See how to register the MCP server in a client. |

### Cron expressions

Both 5-field (minutes) and 6-field (seconds) expressions are supported.

| Expression | Meaning |
|---|---|
| `*/5 * * * *` | Every 5 minutes |
| `0 3 * * *` | Every day at 03:00 |
| `0 9 * * 1` | Every Monday at 09:00 |
| `*/30 * * * * *` | Every 30 seconds (6 fields) |

### Run rules

- When a scheduled time comes, a new run starts even if the previous run of the same job has not finished.
- The default timeout is 0 (no limit). If you set a timeout, WebCron stops the process and all of its child processes when the time is up, and records the run as "Timed out".
- CLI commands run with `cmd.exe` on Windows and `/bin/sh` on Linux.
- A failed webhook is tried again as many times as you set (0 to 5).
- Scheduled times that pass while the server is down are not run later.
- Runs that are still running when the server stops are recorded as "Interrupted".

## 5. Languages (Korean and English)

| Part | How the language is chosen |
|---|---|
| Web UI | On the first visit, Korean if the browser language is Korean, otherwise English. Change it with the **한국어 / English** buttons in the top menu or on the sign-in screen. The browser remembers your choice. |
| API error and validation messages | Korean if the `Accept-Language` request header starts with `ko`, otherwise English (also when there is no header). The web UI sends the selected language in this header. |
| MCP | Tool descriptions are in English. Tool result messages follow `Accept-Language`, and are in English when there is no header. |
| Server console messages, `.env` template comments, error messages in the run history | Korean if the OS locale (`LC_ALL`, then `LC_MESSAGES`, then `LANG`, then the OS default locale) starts with `ko`, otherwise English. |

To see server messages in English, start the server like this:

```bash
LANG=en_US.UTF-8 npm start
```

Error messages in the run history are saved in the server language at the time of the run. If you change the UI language later, saved messages do not change.

## 6. MCP

WebCron provides an MCP server at `/mcp`. The transport is Streamable HTTP (stateless).

| Tool | What it does |
|---|---|
| `list_jobs` | Lists every job with its ID, name, type, cron expression, enabled flag, next run time, and last result. |
| `create_job` | Creates a CLI or webhook job and schedules it at once. Input checks are the same as in the web UI. |
| `delete_job` | Deletes a job by ID. Its run history is kept. |

### Issue a key and register the server

1. In the web UI, open **MCP**, enter a key name, and select **Issue key**.
2. Copy the key that is shown (it starts with `wcmcp_`). The key is shown only this one time.
3. Register the server in your MCP client. For Claude Code:

```bash
claude mcp add --transport http webcron http://127.0.0.1:8080/mcp --header "Authorization: Bearer <your key>"
```

You can also register it in `.mcp.json`:

```json
{
  "mcpServers": {
    "webcron": {
      "type": "http",
      "url": "http://127.0.0.1:8080/mcp",
      "headers": { "Authorization": "Bearer <your key>" }
    }
  }
}
```

- Keys do not expire. Revoke keys you no longer need on the MCP screen. A request with a revoked key gets HTTP 401 at once.
- The server stores only the SHA-256 hash of each key. If you lose a key, issue a new one.
- When a job is created or deleted through MCP, the audit log records the path (`mcp`) and the key name.
- Tool descriptions are in English. For the language of result messages, see "Languages" above.
- Before you register a new MCP server in an AI tool, check your organization's security approval process.

## 7. Run as a service

When the server gets `SIGINT`, `SIGTERM`, or `Ctrl+C` on Windows, it stops starting new runs, records `server.stop` in the audit log, and exits.

### pm2 (Windows, Linux)

```bash
npm install -g pm2
pm2 start server/src/main.ts --name webcron --interpreter node -- --env /opt/webcron/.env
pm2 save
pm2 startup        # start at boot (run the command that it prints)
```

### systemd (Linux)

Create `/etc/systemd/system/webcron.service`:

```ini
[Unit]
Description=WebCron
After=network.target

[Service]
Type=simple
User=webcron
WorkingDirectory=/opt/webcron
Environment=LANG=en_US.UTF-8
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
journalctl -u webcron -f     # show the log
```

### Windows service (NSSM)

Install [NSSM](https://nssm.cc/), then run these commands in a Command Prompt as administrator:

```bat
nssm install WebCron "C:\Program Files\nodejs\node.exe" "server\src\main.ts --env C:\webcron\.env"
nssm set WebCron AppDirectory C:\webcron
nssm set WebCron AppStopMethodConsole 15000
nssm set WebCron AppStdout C:\webcron\logs\webcron.log
nssm set WebCron AppStderr C:\webcron\logs\webcron.log
nssm start WebCron
```

## 8. Security notes

- CLI jobs run with the same OS account as the server process. Anyone who knows the server password can run commands on the server. Run the server with a dedicated account that has few permissions.
- The default bind address is `127.0.0.1`. If you must expose the server, limit access with a firewall and use HTTPS through a reverse proxy (such as nginx).
- An MCP key can also create CLI jobs. This means an MCP key gives the right to run commands on the server. Keep keys as safe as passwords.
- After 5 failed sign-ins in a row from the same IP, that IP cannot sign in for 5 minutes.
- In the audit log, webhook header values and environment variable values are masked as `***`. The password and its hash are never shown anywhere.
- The `.env` file contains the password hash. Do not commit it to a repository (it is in `.gitignore`).

## 9. Development

```bash
npm test           # server tests (node:test)
npm run typecheck  # tsc + svelte-check
npm run dev:web    # UI dev server (/api is proxied to 127.0.0.1:8080)
```

| Path | Contents |
|---|---|
| `server/src/` | Server (Fastify, croner, node:sqlite, MCP SDK) |
| `server/src/i18n.ts` | Server message catalog (Korean and English) |
| `server/test/` | Server tests. Each test name includes its requirement ID. |
| `web/src/` | Web UI (Svelte 5, Vite) |
| `web/src/lib/messages.ts` | UI text catalog (Korean and English). A test keeps the keys of both catalogs the same. |
| `docs/spec/` | Requirements specification (SRS, Korean) |
| `docs/design/webcron-mockup.html` | UI mockup (Korean) |
