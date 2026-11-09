import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
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
    let text = "";
    const send = (event, data) => {
      text += `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      stream.onprogress({ status: 200, responseText: text });
    };
    assert.match(stream.url, /\/v1\/events$/);
    send("snapshot", { shipments: {} });
    assert.equal(paperwork.phase, "connected");
    send("update", { shipmentId: "000123", ...row(true, 5) });
    send("update", { shipmentId: "000123", ...row(false, 4) });
    assert.equal(paperwork.rows.get("000123").received, true);
    send("snapshot", { shipments: {} });
    assert.equal(paperwork.rows.size, 0);
    stream.onerror();
    assert.equal(paperwork.phase, "disconnected");
    paperwork.restart();
    assert.equal(paperwork.phase, "connecting");
    const next = requests.at(-1);
    next.onprogress({
      status: 200,
      responseText: "event: unauthorized\ndata: {}\n\n",
    });
    assert.equal(paperwork.phase, "unauthorized");
    assert.equal(next.aborted, true);
  } finally {
    stop();
    storage.clear();
  }
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
    const originalInterval = globalThis.setInterval;
    const originalFetch = globalThis.fetch;
    let poll;
    globalThis.setInterval = (callback) => {
      poll = callback;
      return 0;
    };
    let shipments = [{ shipment_id: "000123" }];
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
      shipments.push({ shipment_id: "000456", asset_id: "3pty-FAKE" });
      await poll();
      await tick();
      const inserted = document.querySelector("tr.alb-qol-new-row");
      assert.equal(inserted.cells.length, 4);
      assert.equal(inserted.cells[2].textContent, "3pty-FAKE");
      assert.equal(inserted.querySelectorAll("input").length, 1);
      table.cleanup();
      assert.equal(inserted.cells.length, 3);
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
