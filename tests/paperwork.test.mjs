import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { execFileSync } from "node:child_process";
import { stream as connectStream } from "../src/tweaks/pinc/paperwork-api.ts";
import { EventFrames, snapshot } from "../src/tweaks/pinc/paperwork-model.ts";
import { requests, storage, listeners } from "./userscript-mock.mjs";
import { paperwork } from "../src/tweaks/pinc/paperwork-state.svelte.ts";
import { attachPaperworkTable } from "../src/tweaks/pinc/paperwork-table.ts";
import { newCheckInRows } from "../src/tweaks/pinc/new-check-in-rows.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const row = (received = true, revision = 1) => ({
  received,
  revision,
  updatedAt: 100,
});
const device = {
  apiUrl: "http://127.0.0.1:8080",
  token: "a".repeat(64),
  deviceId: "test",
  transport: "poll",
};

test("SSE frames survive every split boundary, comments and multiline data", () => {
  const text =
    ': heartbeat\r\n\r\nevent: snapshot\r\ndata: {"shipments":{}}\r\n\r\nevent: update\ndata: one\ndata: two\n\n';
  for (let split = 0; split <= text.length; split++) {
    const parser = new EventFrames();
    assert.deepEqual(
      [...parser.push(text.slice(0, split)), ...parser.push(text.slice(split))],
      [
        { event: "snapshot", data: '{"shipments":{}}' },
        { event: "update", data: "one\ntwo" },
      ],
    );
  }
  assert.throws(() => new EventFrames().push("x".repeat(2_000_001)));
  assert.equal(
    snapshot({ shipments: { "000123": row() } }).get("000123").received,
    true,
  );
  assert.throws(() => snapshot({ shipments: { id: { received: "true" } } }));
});

test("loading, CAS conflict, failed writes, revoked tokens and cleanup", async () => {
  storage.set("paperwork-device:v1", device);
  const stop = paperwork.start();
  try {
    assert.equal(paperwork.phase, "connecting");
    requests.at(-1).respond(200, { shipments: {} });
    await tick();
    assert.equal(paperwork.phase, "connected");
    const save = paperwork.save("000123", true);
    assert.equal(paperwork.phase, "saving");
    assert.deepEqual(JSON.parse(requests.at(-1).data), {
      received: true,
      expectedRevision: 0,
    });
    requests
      .at(-1)
      .respond(409, { current: { shipmentId: "000123", ...row() } });
    await save;
    assert.equal(paperwork.phase, "connecting");
    requests.at(-1).respond(200, { shipments: { "000123": row() } });
    await tick();
    assert.equal(paperwork.rows.get("000123").received, true);
    assert.match(paperwork.notice, /another workstation/);
    const uncheck = paperwork.save("000123", false);
    assert.deepEqual(JSON.parse(requests.at(-1).data), {
      received: false,
      expectedRevision: 1,
    });
    requests.at(-1).onerror();
    await uncheck;
    assert.equal(paperwork.phase, "disconnected");
    const count = requests.length;
    await paperwork.save("000123", false);
    assert.equal(requests.length, count);
    paperwork.restart();
    requests.at(-1).respond(401, {});
    await tick();
    assert.equal(paperwork.phase, "unauthorized");
    paperwork.restart();
    const pending = requests.at(-1);
    stop();
    assert.equal(pending.aborted, true);
    pending.respond(200, { shipments: {} });
    await tick();
    assert.equal(paperwork.phase, "off");
    assert.equal(listeners.size, 0);
  } finally {
    stop();
    storage.clear();
  }
});

test("SSE snapshot, ordered revisions, expiry and reconnect", async () => {
  storage.set("paperwork-device:v1", { ...device, transport: "sse" });
  const stop = paperwork.start();
  try {
    const stream = requests.at(-1);
    assert.equal(stream.responseType, "stream");
    assert.equal(stream.anonymous, true);
    assert.equal(stream.onprogress, undefined);
    const source = stream.openStream();
    const send = async (event, data) => {
      source.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      await tick();
    };
    assert.match(stream.url, /\/v1\/events$/);
    await send("snapshot", { shipments: {} });
    assert.equal(paperwork.phase, "connected");
    await send("update", { shipmentId: "000123", ...row(true, 5) });
    await send("update", { shipmentId: "000123", ...row(false, 4) });
    assert.equal(paperwork.rows.get("000123").received, true);
    await send("snapshot", { shipments: {} });
    assert.equal(paperwork.rows.size, 0);
    stream.onerror();
    assert.equal(paperwork.phase, "disconnected");
    paperwork.restart();
    assert.equal(paperwork.phase, "connecting");
    const next = requests.at(-1);
    next.openStream().push("event: unauthorized\ndata: {}\n\n");
    await tick();
    assert.equal(paperwork.phase, "unauthorized");
    assert.equal(next.aborted, true);
    assert.equal(next.readerCanceled, true);
  } finally {
    stop();
    storage.clear();
  }
});

test("SSE decodes split UTF-8, handles EOF and cancels pending reads", async () => {
  const events = [];
  const failures = [];
  const stop = connectStream(
    "test-token",
    (...event) => events.push(event),
    (error) => failures.push(error),
  );
  const request = requests.at(-1);
  const source = request.openStream();
  const bytes = new TextEncoder().encode(
    'event: message\ndata: {"text":"caf\u00e9"}\n\n',
  );
  const split = bytes.indexOf(0xc3) + 1;
  source.bytes(bytes.slice(0, split));
  source.bytes(bytes.slice(split));
  await tick();
  assert.deepEqual(events, [["message", { text: "caf\u00e9" }]]);
  source.close();
  await tick();
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /closed/);
  assert.equal(request.aborted, true);
  stop();

  const cancel = connectStream(
    "test-token",
    () => assert.fail("late event"),
    () => assert.fail("intentional stop"),
  );
  const pending = requests.at(-1);
  pending.openStream();
  cancel();
  await tick();
  assert.equal(pending.readerCanceled, true);
  assert.equal(pending.aborted, true);
});

test("SSE rejects HTTP errors, missing streams, redirects and malformed events", async () => {
  for (const scenario of [
    "401",
    "503",
    "missing",
    "redirect",
    "invalid",
    "read-error",
  ]) {
    const failures = [];
    const stop = connectStream(
      "test-token",
      () => assert.fail("unexpected event"),
      (error) => failures.push(error),
    );
    const request = requests.at(-1);
    if (scenario === "401" || scenario === "503")
      request.openStream(Number(scenario));
    else if (scenario === "missing") request.onloadstart({ status: 200 });
    else if (scenario === "redirect")
      request.onloadstart({
        status: 200,
        finalUrl: "https://other.example/v1/events",
      });
    else {
      const source = request.openStream();
      if (scenario === "invalid")
        source.push("event: update\ndata: invalid\n\n");
      else source.error();
    }
    await tick();
    assert.equal(failures.length, 1, scenario);
    assert.equal(request.aborted, true, scenario);
    if (scenario === "401") assert.equal(failures[0].status, 401);
    stop();
  }
});

test("SSE drains queued frames before EOF without progress callbacks", async () => {
  const events = [];
  const failures = [];
  const stop = connectStream(
    "test-token",
    (event, data) => events.push([event, data]),
    (error) => failures.push(error),
  );
  try {
    const source = requests.at(-1).openStream();
    for (const byte of new TextEncoder().encode(
      'event: snapshot\ndata: {"shipments":{}}\n\nevent: update\ndata: {"revision":2}\n\n',
    ))
      source.bytes(Uint8Array.of(byte));
    source.close();
    await tick();
    assert.deepEqual(events, [
      ["snapshot", { shipments: {} }],
      ["update", { revision: 2 }],
    ]);
    assert.equal(failures.length, 1);
  } finally {
    stop();
  }
});

test("SSE heartbeats reset the watchdog and stalled streams disconnect", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const failures = [];
  const stop = connectStream(
    "test-token",
    () => assert.fail("heartbeat is not an event"),
    (error) => failures.push(error),
  );
  try {
    const request = requests.at(-1);
    const source = request.openStream();
    t.mock.timers.tick(30000);
    source.push(": heartbeat\n\n");
    await Promise.resolve();
    t.mock.timers.tick(30000);
    assert.equal(failures.length, 0);
    t.mock.timers.tick(15000);
    assert.equal(failures.length, 1);
    assert.match(failures[0].message, /stalled/);
    assert.equal(request.readerCanceled, true);
    assert.equal(request.aborted, true);
  } finally {
    stop();
    t.mock.timers.reset();
  }
});

for (const debug of ["0", "1"])
  test(`paperwork debug=${debug} logs respect the setting and hide credentials and shipment data`, () => {
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        "./tests/register.mjs",
        "--input-type=module",
        "-e",
        `
    globalThis.localStorage = { getItem: () => "${debug}" };
    const { paperwork } = await import("./src/tweaks/pinc/paperwork-state.svelte.ts");
    const { requests, storage } = await import("./tests/userscript-mock.mjs");
    storage.set("paperwork-device:v1", {
      apiUrl: "http://127.0.0.1:8080", token: "PRIVATE_TOKEN", deviceId: "PRIVATE_DEVICE", transport: "poll"
    });
    const stop = paperwork.start();
    requests.at(-1).respond(200, { shipments: { PRIVATE_SHIPMENT: { received: true, revision: 1, updatedAt: 1 } } });
    await new Promise(resolve => setTimeout(resolve, 0));
    paperwork.setTransport("sse");
    const source = requests.at(-1).openStream();
    source.push('event: snapshot\\ndata: {"shipments":{}}\\n\\n');
    await new Promise(resolve => setTimeout(resolve, 0));
    requests.at(-1).onerror();
    stop();
  `,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    for (const message of [
      "request started",
      "request completed",
      "poll snapshot applied",
      "next poll scheduled",
      "SSE response opened",
      "SSE chunk received",
      "SSE snapshot applied",
      "reconnect scheduled",
    ])
      assert.equal(output.includes(message), debug === "1", message);
    assert.doesNotMatch(
      output,
      /PRIVATE_TOKEN|PRIVATE_DEVICE|PRIVATE_SHIPMENT/,
    );
  });

const tableHtml = () =>
  `<table class="grid-table"><thead><tr><th>Actions</th><th><a href="?sort_key=shipment_id">Shipment</a></th><th><a href="?sort_key=asset_id">Asset</a></th></tr></thead><tbody><tr><td>Edit</td><td>000123</td><td>3pty-FAKE</td></tr></tbody></table>`;

test("table rebuilds, unknown status, missing IDs, synthetic rows and arrivals gating", async () => {
  const dom = new JSDOM(tableHtml(), {
    url: "http://127.0.0.1:8730/shipments?view_type=arrivals",
  });
  Object.assign(globalThis, {
    document: dom.window.document,
    location: dom.window.location,
    MutationObserver: dom.window.MutationObserver,
  });
  const state = { phase: "connecting", rows: new Map([["000123", row()]]) };
  const writes = [];
  const table = attachPaperworkTable(
    () => state,
    (...args) => writes.push(args),
  );
  try {
    assert.equal(
      document.querySelector("tbody tr").cells[1].className,
      "alb-qol-paperwork-column",
    );
    let input = document.querySelector("input");
    assert.equal(input.disabled, true);
    assert.equal(input.indeterminate, true);
    state.phase = "connected";
    table.refresh();
    assert.equal(input.checked, true);
    input.click();
    assert.deepEqual(writes, [["000123", false]]);
    const synthetic = document.createElement("tr");
    synthetic.dataset.albQolShipmentId = "000456";
    synthetic.innerHTML = "<td></td><td>wrong</td><td>3pty-FAKE</td>";
    document.querySelector("tbody").append(synthetic);
    await tick();
    assert.match(
      synthetic.querySelector("input").getAttribute("aria-label"),
      /000456/,
    );
    assert.equal(synthetic.cells.length, 4);
    table.refresh();
    table.refresh();
    assert.equal(synthetic.cells.length, 4);
    document.querySelector("table").outerHTML = tableHtml();
    await tick();
    assert.equal(
      document.querySelectorAll("th.alb-qol-paperwork-column").length,
      1,
    );
    document.querySelector("thead a").href = "?sort_key=unique_id";
    await tick();
    assert.equal(document.querySelector("input"), null);
    dom.reconfigure({
      url: "http://127.0.0.1:8730/shipments?view_type=outbound",
    });
    table.refresh();
    assert.equal(
      document.querySelectorAll(".alb-qol-paperwork-column").length,
      0,
    );
    dom.reconfigure({ url: "http://127.0.0.1:8730/shipments" });
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<dl id="shipment-tabs"><dd class="active"><a href="?view_type=arrivals">Arrivals</a></dd></dl>',
    );
    await tick();
    assert.equal(
      document.querySelectorAll("th.alb-qol-paperwork-column").length,
      1,
    );
  } finally {
    table.cleanup();
    assert.equal(
      document.querySelectorAll(".alb-qol-paperwork-column").length,
      0,
    );
    dom.window.close();
  }
});

for (const paperworkFirst of [true, false])
  test(`new-check-in rows coexist in enable order ${paperworkFirst}`, async () => {
    const dom = new JSDOM(tableHtml(), {
      url: "http://127.0.0.1:8730/shipments?view_type=arrivals",
    });
    Object.assign(globalThis, {
      document: dom.window.document,
      location: dom.window.location,
      MutationObserver: dom.window.MutationObserver,
      CSS: { escape: (value) => value },
      CSSStyleSheet: dom.window.CSSStyleSheet,
    });
    document.adoptedStyleSheets = [];
    const shipmentHeader = document.querySelectorAll("th")[1];
    shipmentHeader.classList.add("active_sort_tag");
    shipmentHeader.insertAdjacentHTML(
      "beforeend",
      '<img src="sort_asc.png" alt="Ascending">',
    );
    const originalInterval = globalThis.setInterval;
    const originalFetch = globalThis.fetch;
    let poll;
    globalThis.setInterval = (callback) => {
      poll = callback;
      return 0;
    };
    let shipments = [{ shipment_id: "SYNTHETIC-SEED" }];
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => JSON.stringify(shipments),
    });
    let table, stopRows;
    const attach = () =>
      attachPaperworkTable(
        () => ({ phase: "connected", rows: new Map() }),
        () => {},
      );
    try {
      if (paperworkFirst) {
        table = attach();
        stopRows = newCheckInRows.apply();
      } else {
        stopRows = newCheckInRows.apply();
        table = attach();
      }
      await tick();
      shipments.push(
        { shipment_id: "000123" },
        { shipment_id: "000456", asset_id: "3pty-FAKE" },
        { shipment_id: "000111" },
        { shipment_id: "000789" },
      );
      await poll();
      await tick();
      const inserted = document.querySelector(
        'tr[data-alb-qol-shipment-id="000456"]',
      );
      const ids = () =>
        Array.from(
          document.querySelectorAll("tbody tr"),
          (row) =>
            Array.from(row.cells).filter(
              (cell) => !cell.classList.contains("alb-qol-paperwork-column"),
            )[1].textContent,
        );
      assert.deepEqual(ids(), ["000111", "000123", "000456", "000789"]);
      assert.equal(
        document.querySelector("thead tr").cells[1].textContent,
        "BOLs",
      );
      assert.equal(inserted.cells.length, 4);
      assert.equal(inserted.cells[1].className, "alb-qol-paperwork-column");
      assert.equal(inserted.cells[2].textContent, "000456");
      assert.equal(inserted.cells[3].textContent, "3pty-FAKE");
      assert.equal(inserted.querySelectorAll("input").length, 1);
      table.cleanup();
      assert.equal(inserted.cells.length, 3);
      shipments.push({ shipment_id: "000333" });
      await poll();
      await tick();
      assert.deepEqual(ids(), [
        "000111",
        "000123",
        "000333",
        "000456",
        "000789",
      ]);
      table = attach();
      assert.equal(inserted.cells.length, 4);
      stopRows();
      await tick();
      assert.equal(document.querySelectorAll("tbody tr").length, 1);
    } finally {
      stopRows?.();
      table?.cleanup();
      globalThis.setInterval = originalInterval;
      globalThis.fetch = originalFetch;
      dom.window.close();
    }
  });

test("enrollment persists only the device credential, forget syncs across tabs, and late enrollment is ignored", async () => {
  storage.clear();
  const stop = paperwork.start();
  try {
    assert.equal(paperwork.phase, "setup");
    const enrollment = paperwork.enroll(
      "synthetic-enrollment-code",
      "Synthetic PC",
      "poll",
    );
    assert.equal(requests.at(-1).headers.Authorization, undefined);
    requests
      .at(-1)
      .respond(201, { token: device.token, deviceId: device.deviceId });
    await enrollment;
    assert.equal(paperwork.phase, "connecting");
    assert.deepEqual(storage.get("paperwork-device:v1"), device);
    assert.equal(
      JSON.stringify([...storage.values()]).includes(
        "synthetic-enrollment-code",
      ),
      false,
    );
    const pending = requests.at(-1);
    storage.delete("paperwork-device:v1");
    listeners.get("paperwork-device:v1")(
      "paperwork-device:v1",
      device,
      undefined,
      true,
    );
    assert.equal(pending.aborted, true);
    assert.equal(paperwork.phase, "setup");
    const late = paperwork.enroll("synthetic-enrollment-code", "", "poll");
    const request = requests.at(-1);
    stop();
    request.respond(201, { token: device.token, deviceId: device.deviceId });
    await assert.rejects(late, /canceled/);
    assert.equal(storage.size, 0);
    assert.equal(paperwork.phase, "off");
  } finally {
    stop();
    storage.clear();
  }
});

test("credentials for a different API origin are never sent", () => {
  storage.set("paperwork-device:v1", {
    ...device,
    apiUrl: "https://other.example",
  });
  const count = requests.length;
  const stop = paperwork.start();
  try {
    assert.equal(paperwork.phase, "setup");
    assert.equal(paperwork.configured, false);
    assert.equal(requests.length, count);
  } finally {
    stop();
    storage.clear();
  }
});
