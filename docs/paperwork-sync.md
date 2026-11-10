# Paperwork sync

The `Paperwork sync` tweak adds a checkbox in the second column, immediately after the site menu, to the PINC arrivals table. Checked means guards physically possess the paperwork at the guard shack, including an untouched to-do pile. It does not mean the ASN or packet is ready. No PINC fields, filters, reservations, or check-in actions are changed.

## Build and setup

The companion server is implemented in `alb-qol-helper`. No server files were changed in this client implementation. Follow that repository's README to run one Go/SQLite process and configure `ENROLLMENT_CODE`, `DATABASE_PATH`, `LISTEN_ADDR`, and optionally `PAPERWORK_TTL`. Use synthetic identifiers locally.

The default client targets `http://127.0.0.1:8080`. For an approved remote host, set the origin while building:

```sh
VITE_PAPERWORK_API_URL=https://your-approved-host.example pnpm build
```

Only that hostname is added to userscript `@connect`; existing PINC and replica `@match` rules stay scoped. HTTPS is required except for localhost development. Paths, queries, and credentials in the API URL are rejected. Export the variable in the shell; this build setting is read by `vite.config.ts`. Reinstall `dist/alb-qol-changes.user.js` when changing the host so Tampermonkey receives the new connection permission. Credentials are bound to the configured API origin and require enrollment again if it changes.

For GitHub Actions builds, the build workflow reads the repository variable `VITE_PAPERWORK_API_URL`. In GitHub, open **Settings > Secrets and variables > Actions > Variables > New repository variable**, name it `VITE_PAPERWORK_API_URL`, and set its value to the approved HTTPS server origin. The URL is public in the generated userscript, so use a variable rather than a secret. Push to `master` to trigger a new build after setting or changing it. If the variable is unset, builds use the localhost default.

On `/shipments` arrivals:

1. Open the ALB QOL sidebar and enable **Paperwork sync** (enabled by default for fresh installs).
2. Enter the shared enrollment code and an optional workstation label. Select **Connect device**.
3. Wait for **Paperwork sync connected** before using the boxes.
4. Repeat in each workstation's browser profile. Each browser receives an independent device credential.

The token is stored only in GM storage and sent in an Authorization header. The enrollment code is cleared from the input on submission and is never persisted. **Forget device** clears the local credential across tabs; it does not revoke the server device. Use the server's `devices list` and `devices revoke DEVICE_ID` admin commands for revocation, then forget and enroll again to replace a credential. Never put enrollment codes or tokens in source, URLs, screenshots, or console logs.

## Transport and correctness

**Default: authenticated full-snapshot polling, 2.5 seconds after each completed read.** Expected cross-workstation latency is around 2.5 seconds plus request time, rather than the sub-second SSE target. There is only one active snapshot request per tab. Failures disable editing and trigger bounded exponential retry with jitter. Revoked devices stop retrying until the operator intervenes.

The sidebar also offers **SSE (requires browser verification)**. This uses `GM_xmlhttpRequest` with `responseType: "stream"`, reads the response from `onloadstart`, decodes UTF-8 incrementally, parses frames across arbitrary chunks, checks heartbeat activity with a 45-second watchdog, and reconnects with backoff. It keeps cookie-free requests (`anonymous: true`) without depending on partial `responseText` delivery through `onprogress`, which varies by Tampermonkey version in fetch mode. Consumed chunks are discarded; incomplete frame buffering is bounded. Disabling or reconnecting cancels the reader and aborts the request. Reconnect always waits for the server's first `snapshot` event. Native EventSource is not used because the API requires bearer headers. See [Tampermonkey's GM request documentation](https://www.tampermonkey.net/documentation.php?q=GM_xmlhttpRequest).

SSE is tested with a GM adapter supplying real `ReadableStream` chunks, including frame boundaries, split UTF-8, ordering, expiration snapshots, failures, revocation, heartbeat timeout and reader cancellation. These automated tests do not establish compatibility with an installed Tampermonkey browser or the workplace network. The browser verification label means testing stream delivery in that runtime, not granting a separate SSE permission. Polling remains the default compatibility fallback; select SSE after verifying the installed build.

Initial, connecting, saving and disconnected states disable controls. Indeterminate boxes mean the state is unavailable; they must not be read as unchecked. Only a successful snapshot makes an absent record unchecked. During save the client preserves the confirmed state, pauses reads, and uses `expectedRevision`. After success or conflict it fetches a fresh snapshot (or reconnects to the stream) before enabling controls. This also handles ambiguous failed write acknowledgments without retrying an offline write. Conflicts display a sidebar notice and never automatically overwrite a colleague's newer status.

SSE updates apply only newer revisions. Every full snapshot replaces the map so expired and deleted statuses disappear. Polling observes TTL on its next successful read; streaming receives the server's periodic expiration snapshots (currently every 15 seconds). Separate tabs have independent connections and share enrollment changes through GM listeners.

The table observer handles insertion and replacement, derives the ID column from `sort_key=shipment_id`, preserves string IDs, and prefers `data-alb-qol-shipment-id` on synthetic rows. Missing/invalid IDs show `Unavailable` and a warning without shipment details. Owned columns are excluded from the new-row builder and from its duplicate and sort cell lookups. Disabling the tweak removes cells, styles, observers, GM listeners, timers and active requests.

## API used

| Method | Endpoint                     | Purpose                                                          |
| ------ | ---------------------------- | ---------------------------------------------------------------- |
| POST   | `/v1/enroll`                 | Code and optional label to independent device token              |
| GET    | `/v1/paperwork`              | Full nonexpired snapshot in polling mode                         |
| PUT    | `/v1/paperwork/{shipmentId}` | Boolean and expected revision, conflict returns HTTP 409         |
| GET    | `/v1/events`                 | Optional authenticated SSE, atomic initial snapshot then updates |

All protected calls use `Authorization: Bearer <device-token>` through GM requests; no page fetch/CORS changes are required. Only shipment identifiers and booleans are submitted in status writes. No PINC shipment details are uploaded. Snapshot state stays in memory rather than localStorage.

## Verification and remaining rollout checks

```sh
pnpm test
pnpm check
pnpm build
pnpm exec prettier --check src/tweaks/pinc/paperwork* src/lib/components/paperwork-settings.svelte tests
```

The Node tests use jsdom and a GM adapter, exercise the actual client modules and new-row tweak, and require Node 24+. They cover initial unknown state, failed writes, explicit false writes, conflicts, token rejection, stale callbacks, stream ordering, expiration snapshots, arbitrary SSE chunk splits, table rebuilds, missing IDs, synthetic rows, and both enable orders. They do not substitute for the browser checks below.

Before production rollout:

- Obtain workplace authorization before sending any real shipment IDs to a personally controlled service. This change deploys nothing and creates no Fly resources.
- Configure the approved hostname, build and reinstall. Confirm the generated `@connect` and GM grants in `dist/alb-qol-changes.user.js`.
- On the local PINC replica with synthetic IDs, record browser and Tampermonkey versions. Enroll two distinct browser profiles and verify check and uncheck propagation, dynamic rows, sorting/filtering, table replacement, and toggling either tweak in either order.
- Try SSE and confirm partial events arrive before request completion, including idle heartbeats. Verify 401/revocation, server restart, dropped connections, reconnect snapshot, expiration with a short development TTL, and abort when disabling the tweak. A buffering browser/proxy should trigger a visible disconnect within 45 seconds; select polling if streaming is unreliable.
- Repeat approved checks on guard workstations. Verify existing check-in notifications and PINC actions, and that a failed connection never resembles an authoritative unchecked state.
- For Fly hosting, follow the server README after explicit approval: use the existing Legacy Hobby organization, one Machine and one persistent volume, set `ENROLLMENT_CODE` privately, and review plan limits and billing. Single-Machine outages interrupt sync. Logical 48-hour expiration does not erase SQLite backups or Fly snapshots securely.

If no status loads, check the sidebar's server origin, network reachability, Tampermonkey connection permission, enrollment and token revocation. Retry refreshes authoritative state. A setup HTTP 429 requires waiting before another enrollment attempt. If a workstation's token was revoked, forget it and enroll again with the current shared code.

## Debugging

On the PINC page, run `localStorage.setItem("alb-qol-debug", "1")` in the console, then reload. Debug mode is read when the userscript starts. Filter the console for `alb-qol:paperwork` and enable the Info log level. Request start/completion logs include the method, endpoint category, HTTP status and duration; polling logs show snapshot record counts and the next poll delay. SSE logs show opening, chunk byte counts, event types, snapshots and shutdown. Retry logs include the transport and retry delay. Credentials, request bodies, shipment identifiers and snapshot contents are not logged. Warnings remain visible with debug mode off. To disable debug logs, set the same key to `"0"` and reload.

`GM_xmlhttpRequest` runs in Tampermonkey's extension background context, so its requests do not appear in the PINC page's Network tab. In Chromium browsers, open the extensions page, enable Developer mode, and inspect Tampermonkey's service worker or background page. Its DevTools Network panel can show requests issued by that context; open it before retrying. The available inspection targets depend on the browser and Tampermonkey version. If a separate extension context issues the request, inspect that context instead. The userscript logs above provide request visibility in the PINC console. Network request details can include the Authorization header; avoid sharing unredacted captures.
