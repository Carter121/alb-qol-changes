import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  createTextEdits,
  getShipmentsView,
  INJECTED_COLUMN,
  siteCells,
  subscribeToShipmentTables,
} from "../src/tweaks/pinc/shipments-table.ts";
import { attachPaperworkTable } from "../src/tweaks/pinc/paperwork-table.ts";
import { preferredLocations } from "../src/tweaks/pinc/preferred-locations.ts";
import { tableStriping } from "../src/tweaks/pinc/table-striping.ts";
import { newCheckInRows } from "../src/tweaks/pinc/new-check-in-rows.ts";
import { TweakManager } from "../src/tweaks/manager.svelte.ts";
import { paperworkStatus } from "../src/tweaks/pinc/paperwork-status.ts";
import { storage, listeners } from "./userscript-mock.mjs";
import { rowHtml, tableHtml } from "./fixtures/shipments.mjs";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture(html = tableHtml()) {
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:8730/shipments?view_type=arrivals",
  });
  const keys = [
    "document",
    "location",
    "MutationObserver",
    "CSS",
    "CSSStyleSheet",
    "fetch",
    "setInterval",
    "clearInterval",
  ];
  const original = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, {
    document: dom.window.document,
    location: dom.window.location,
    MutationObserver: dom.window.MutationObserver,
    CSS: { escape: (value) => value },
    CSSStyleSheet: dom.window.CSSStyleSheet,
  });
  document.adoptedStyleSheets = [];
  let poll;
  let shipments = [{ shipment_id: "SEED" }];
  let activeTimers = 0;
  globalThis.setInterval = (callback) => {
    poll = callback;
    activeTimers++;
    return 1;
  };
  globalThis.clearInterval = () => {
    if (activeTimers) activeTimers--;
  };
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify(shipments),
  });
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  const stops = [];
  const state = { phase: "connected", rows: new Map() };
  const writes = [];
  return {
    dom,
    state,
    writes,
    stops,
    start(index) {
      const handle =
        index === 1
          ? attachPaperworkTable(
              () => state,
              (...args) => writes.push(args),
            )
          : [newCheckInRows, null, preferredLocations, tableStriping][
              index
            ].apply();
      const stop = typeof handle === "function" ? handle : handle.cleanup;
      stops.push(stop);
      return stop;
    },
    async send(fresh) {
      shipments.push(...fresh);
      await poll();
      await tick();
    },
    get timers() {
      return activeTimers;
    },
    close() {
      for (const stop of stops.reverse()) stop();
      dom.window.close();
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      console.error = originalError;
      assert.deepEqual(errors, [], "Unexpected consumer errors");
    },
  };
}
function invariant(enabled) {
  for (const table of document.querySelectorAll("table.grid-table")) {
    const header = table.tHead.rows[0];
    assert.equal(siteCells(header).length, 3);
    assert.equal(
      header.querySelectorAll(`[${INJECTED_COLUMN}="paperwork"]`).length,
      enabled.has(1) ? 1 : 0,
    );
    for (const row of table.tBodies[0].rows) {
      const cells = siteCells(row);
      assert.equal(cells.length, 3);
      assert.equal(
        row.querySelectorAll("input").length,
        enabled.has(1) ? 1 : 0,
      );
      assert.match(cells[1].textContent, /^\d+$/);
      assert.equal(
        cells[2].textContent,
        enabled.has(2) ? "Persh:99-101" : "Persh:99,Persh:100,Persh:101",
      );
    }
    assert.equal(
      table.tBodies[0].classList.contains("alb-qol-table-striping"),
      enabled.has(3),
    );
  }
}

for (let mask = 0; mask < 16; mask++) {
  test(
    `all four tweaks: enabled combination ${mask}`,
    { timeout: 5000 },
    async () => {
      const f = fixture();
      try {
        const enabled = new Set();
        for (let i = 0; i < 4; i++)
          if (mask & (1 << i)) {
            f.start(i);
            enabled.add(i);
          }
        await tick();
        if (enabled.has(0))
          await f.send([
            {
              shipment_id: "000456",
              integrations: {
                preferred_locations: {
                  inbound: "Persh:99,Persh:100,Persh:101",
                },
              },
            },
          ]);
        invariant(enabled);
        document.querySelector("table").outerHTML = tableHtml();
        await tick();
        invariant(enabled);
        const stable = document.body.innerHTML;
        await tick();
        assert.equal(document.body.innerHTML, stable);
      } finally {
        f.close();
      }
      assert.equal(f.timers, 0);
    },
  );
}
function permutations(values) {
  return values.length
    ? values.flatMap((value) =>
        permutations(values.filter((x) => x !== value)).map((rest) => [
          value,
          ...rest,
        ]),
      )
    : [[]];
}
for (const order of permutations([0, 1, 2, 3])) {
  test(`enable order ${order.join(",")} and reverse cleanup`, async () => {
    const f = fixture();
    try {
      const enabled = new Set();
      const stops = order.map((index) => {
        const stop = f.start(index);
        enabled.add(index);
        invariant(enabled);
        return stop;
      });
      await tick();
      await f.send([
        {
          shipment_id: "000456",
          integrations: {
            preferred_locations: { inbound: "Persh:99,Persh:100,Persh:101" },
          },
        },
      ]);
      invariant(enabled);
      for (let i = 3; i >= 0; i--) {
        stops[i]();
        enabled.delete(order[i]);
        invariant(enabled);
      }
      assert.equal(document.adoptedStyleSheets.length, 0);
    } finally {
      f.close();
    }
  });
}

test("discovery, replacement, multiple tables, column identities and malformed links", async () => {
  const f = fixture("<main></main>");
  let contexts;
  const subscription = subscribeToShipmentTables({
    name: "inspect",
    phase: "text",
    update: (tables) => {
      contexts = tables;
    },
  });
  try {
    assert.deepEqual(contexts, []);
    document.querySelector("main").innerHTML =
      '<table class="grid-table"><tbody></tbody></table>';
    await tick();
    assert.equal(contexts.length, 0);
    document.querySelector("table").outerHTML =
      tableHtml() +
      tableHtml() +
      "<table><thead><tr><th>Other</th></tr></thead></table>";
    await tick();
    assert.equal(contexts.length, 2);
    const header = contexts[0].header;
    header.insertAdjacentHTML(
      "afterbegin",
      `<th ${INJECTED_COLUMN}="one">One</th><th ${INJECTED_COLUMN}="two">Two</th>`,
    );
    header.cells[3].querySelector("a").textContent = "Renamed";
    await tick();
    assert.deepEqual(
      contexts[0].columns.map((c) => c.field),
      [null, "shipment_id", "integrations.preferred_locations.inbound"],
    );
    header.append(header.cells[3]);
    await tick();
    assert.equal(contexts[0].sort.index, 2);
    header.lastElementChild.querySelector("a").href =
      "http://[?sort_key=broken";
    await tick();
    assert.equal(contexts[0].columns[2].field, null);
    assert.equal(contexts[0].sort, null);
    header.lastElementChild.querySelector("a").removeAttribute("href");
    await tick();
    assert.equal(contexts[0].columns[2].field, null);
    document.querySelector("main").replaceChildren();
    await tick();
    assert.equal(contexts.length, 0);
  } finally {
    subscription.cleanup();
    f.close();
  }
});

test("view selection prefers URL and falls back to active tabs", () => {
  const f = fixture(
    '<dl id="shipment-tabs"><dd class="active"><a href="?view_type=outbound">Tab</a></dd></dl>',
  );
  try {
    assert.equal(getShipmentsView(), "arrivals");
    f.dom.reconfigure({ url: "http://127.0.0.1:8730/shipments" });
    assert.equal(getShipmentsView(), "outbound");
    document.querySelector("a").href = "http://[";
    assert.equal(getShipmentsView(), null);
    document.querySelector("dl").remove();
    assert.equal(getShipmentsView(), null);
  } finally {
    f.close();
  }
});

test("one observer, phase ordering, quiescence, failure isolation and shutdown", async () => {
  const f = fixture();
  const Native = f.dom.window.MutationObserver;
  let created = 0,
    observing = false,
    disconnects = 0;
  f.dom.window.MutationObserver = class extends Native {
    constructor(callback) {
      super(callback);
      created++;
    }
    observe(...args) {
      observing = true;
      return super.observe(...args);
    }
    disconnect() {
      observing = false;
      disconnects++;
      return super.disconnect();
    }
  };
  let calls = 0;
  const order = [],
    logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  let first;
  const text = subscribeToShipmentTables({
    name: "text",
    phase: "text",
    update(tables) {
      calls++;
      order.push("text");
      if (tables.length) tables[0].header.cells[0].textContent = "Owned";
      first?.refresh();
    },
  });
  first = subscribeToShipmentTables({
    name: "rows",
    phase: "rows",
    update() {
      order.push("rows");
    },
    cleanup() {
      throw Error("cleanup-test");
    },
  });
  const bad = subscribeToShipmentTables({
    name: "bad",
    phase: "columns",
    update() {
      throw Error("update-test");
    },
  });
  try {
    assert.equal(created, 1);
    order.length = 0;
    first.refresh();
    assert.deepEqual(order, ["rows", "text"]);
    const before = calls;
    for (let i = 0; i < 100; i++)
      document.querySelector("tbody").setAttribute("class", `burst-${i}`);
    await tick();
    assert.equal(calls, before + 1);
    await tick();
    assert.equal(calls, before + 1);
    const div = document.createElement("div");
    document.body.append(div);
    div.textContent = "Unrelated";
    await tick();
    assert.equal(calls, before + 1);
    document.querySelector("tbody").className = "queued";
    text.cleanup();
    const stopped = calls;
    await tick();
    assert.equal(calls, stopped);
    first.cleanup();
    bad.cleanup();
    bad.cleanup();
    assert.equal(observing, false);
    assert.ok(disconnects > 0);
    assert.ok(logs.some((entry) => entry.join(" ").includes("bad")));
    assert.ok(logs.some((entry) => entry.join(" ").includes("rows")));
    document.querySelector("table").outerHTML = tableHtml();
    await tick();
    assert.equal(calls, stopped);
    const again = subscribeToShipmentTables({
      name: "restart",
      phase: "text",
      update() {
        calls++;
      },
    });
    assert.equal(created, 1);
    again.cleanup();
    assert.equal(observing, false);
  } finally {
    text.cleanup();
    first.cleanup();
    bad.cleanup();
    console.error = originalError;
    f.close();
  }
});

test("text edits preserve elements, handlers and host updates, and release detached edits", () => {
  const f = fixture(
    '<div><a href="?sort_key=shipment_id">Old<img alt="Icon"></a></div>',
  );
  const edits = createTextEdits();
  try {
    const link = document.querySelector("a"),
      image = document.querySelector("img");
    let clicks = 0;
    link.onclick = (event) => {
      event.preventDefault();
      clicks++;
    };
    edits.replace(link, (s) => s.replace("Old", "New"));
    link.click();
    assert.equal(clicks, 1);
    assert.equal(document.querySelector("img"), image);
    edits.replace(link, (s) => s.replace("New", "Newest"));
    edits.cleanup();
    assert.equal(link.firstChild.data, "Old");
    edits.replace(link, () => "Owned");
    link.firstChild.data = "Host";
    edits.cleanup();
    assert.equal(link.firstChild.data, "Host");
    edits.replace(link, () => "Temporary");
    link.remove();
    edits.prune();
    edits.cleanup();
    assert.equal(link.firstChild.data, "Temporary");
  } finally {
    edits.cleanup();
    f.close();
  }
});

test("empty-state and merged rows are skipped; replacement bodies are decorated", async () => {
  const f = fixture(
    tableHtml(
      '<tr><td colspan="3">No shipments</td></tr><tr><td rowspan="2">Merged</td><td>000123</td><td>Persh:99,Persh:100</td></tr>',
    ),
  );
  try {
    f.start(1);
    f.start(2);
    f.start(3);
    assert.equal(document.querySelectorAll("input").length, 0);
    const oldBody = document.querySelector("tbody");
    oldBody.outerHTML = `<tbody>${rowHtml()}</tbody>`;
    await tick();
    assert.equal(oldBody.classList.contains("alb-qol-table-striping"), false);
    invariant(new Set([1, 2, 3]));
    document.querySelector("tbody td").colSpan = 2;
    await tick();
    assert.equal(document.querySelectorAll("input").length, 0);
  } finally {
    f.close();
  }
});

for (const phase of ["connecting", "disconnected", "saving", "connected"]) {
  test(`paperwork state ${phase} and single-write checkbox`, () => {
    const f = fixture();
    try {
      f.state.phase = phase;
      f.start(1);
      const input = document.querySelector("input");
      assert.equal(input.disabled, phase !== "connected");
      assert.equal(input.indeterminate, phase !== "connected");
      input.click();
      assert.equal(f.writes.length, phase === "connected" ? 1 : 0);
    } finally {
      f.close();
    }
  });
}

test("pending shipments survive absent/incomplete tables and use latest column order", async () => {
  const f = fixture("");
  try {
    f.start(0);
    f.start(1);
    f.start(2);
    f.start(3);
    await tick();
    await f.send([
      {
        shipment_id: "000456",
        integrations: {
          preferred_locations: { inbound: "Persh:99,Persh:100,Persh:101" },
        },
      },
    ]);
    document.body.innerHTML =
      '<table class="grid-table"><tbody></tbody></table>';
    await tick();
    assert.equal(document.querySelectorAll("tr").length, 0);
    document.querySelector("table").outerHTML = tableHtml();
    const header = document.querySelector("thead tr");
    header.append(header.cells[1]);
    const nativeRow = document.querySelector("tbody tr");
    nativeRow.append(nativeRow.cells[1]);
    await tick();
    const inserted = document.querySelector("[data-alb-qol-shipment-id]");
    assert.equal(siteCells(inserted)[2].textContent, "000456");
    assert.equal(siteCells(inserted)[1].textContent, "Persh:99-101");
    assert.equal(inserted.querySelectorAll("input").length, 1);
    await tick();
    assert.equal(
      document.querySelectorAll("[data-alb-qol-shipment-id]").length,
      1,
    );
  } finally {
    f.close();
  }
});

for (const [field, direction, initial, fresh, expected] of [
  [
    "shipment_id",
    "asc",
    ["2", "10", ""],
    ["3", "1", ""],
    ["1", "2", "3", "10", ""],
  ],
  [
    "shipment_id",
    "desc",
    ["10", "2", ""],
    ["3", "11", ""],
    ["11", "10", "3", "2", ""],
  ],
  [
    "asset_id",
    "asc",
    ["Apple", "Pear", ""],
    ["Banana", "", "Zebra"],
    ["Apple", "Banana", "Pear", "Zebra", "", ""],
  ],
  [
    "asset_id",
    "desc",
    ["Pear", "Apple", ""],
    ["Banana", "", "Zebra"],
    ["Zebra", "Pear", "Banana", "Apple", "", ""],
  ],
]) {
  test(`new rows preserve ${field} ${direction} sorting and blank placement`, async () => {
    const f = fixture(
      tableHtml(
        initial.map((value) => rowHtml(value)).join(""),
        field,
        direction,
      ),
    );
    try {
      f.start(0);
      await tick();
      await f.send(
        fresh.map((value, index) => ({
          shipment_id: field === "shipment_id" ? value : String(100 + index),
          asset_id: value,
        })),
      );
      assert.deepEqual(
        Array.from(
          document.querySelectorAll("tbody tr"),
          (row) => siteCells(row)[1].textContent,
        ),
        expected,
      );
    } finally {
      f.close();
    }
  });
}

test("invalid location values remain unchanged and unlinked header fallback works", () => {
  const f = fixture(tableHtml(rowHtml("000123", "Unrecognized location")));
  try {
    document.querySelector("thead th:last-child a").removeAttribute("href");
    f.start(2);
    assert.equal(
      document.querySelector("thead th:last-child").textContent,
      "Preferred Locations",
    );
    assert.equal(
      document.querySelector("tbody td:last-child").textContent,
      "Unrecognized location",
    );
  } finally {
    f.close();
  }
});

test(
  "seeded 500-operation lifecycle stress test",
  { timeout: 20000 },
  async () => {
    const f = fixture();
    const stops = new Map(),
      enabled = new Set(),
      history = [];
    let seed = 0x51a7;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    try {
      for (let step = 0; step < 500; step++) {
        const op = random() % 7,
          index = (random() >>> 8) % 4;
        history.push([op, index]);
        if (op < 3) {
          if (stops.has(index)) {
            stops.get(index)();
            stops.delete(index);
            enabled.delete(index);
          } else {
            stops.set(index, f.start(index));
            enabled.add(index);
          }
        } else if (op === 3)
          document.querySelector("table").outerHTML = tableHtml();
        else if (op === 4)
          document
            .querySelector("tbody")
            .insertAdjacentHTML("beforeend", rowHtml(String(100000 + step)));
        else if (op === 5)
          document.querySelector("thead a").textContent = `Shipment ${step}`;
        else document.querySelector("tbody").classList.toggle("host-class");
        await tick();
        invariant(enabled);
      }
    } catch (cause) {
      throw new Error(`seed=0x51a7 operations=${JSON.stringify(history)}`, {
        cause,
      });
    } finally {
      for (const stop of stops.values()) stop();
      f.close();
    }
    assert.equal(f.timers, 0);
  },
);

test(
  "1000-row table batches host writes and reaches quiescence",
  { timeout: 10000 },
  async () => {
    const f = fixture(
      tableHtml(
        Array.from({ length: 1000 }, (_, i) =>
          rowHtml(String(100000 + i)),
        ).join(""),
      ),
    );
    let calls = 0;
    const subscription = subscribeToShipmentTables({
      name: "count",
      phase: "decoration",
      update() {
        calls++;
      },
    });
    try {
      f.start(1);
      f.start(2);
      f.start(3);
      const before = calls;
      for (const row of document.querySelector("tbody").rows)
        siteCells(row)[2].firstChild.data = "Persh:99,Persh:100,Persh:101";
      await tick();
      assert.equal(calls, before + 1);
      invariant(new Set([1, 2, 3]));
      await tick();
      assert.equal(calls, before + 1);
    } finally {
      subscription.cleanup();
      f.close();
    }
  },
);

test("tweak manager preserves stored IDs, disabled settings and remote toggles", async () => {
  const f = fixture();
  const tweaks = [
    newCheckInRows,
    paperworkStatus,
    preferredLocations,
    tableStriping,
  ];
  storage.clear();
  listeners.clear();
  for (const tweak of tweaks) storage.set(`tweak-enabled:${tweak.id}`, false);
  const manager = new TweakManager(tweaks);
  try {
    manager.start();
    await tick();
    assert.deepEqual(
      tweaks.map((t) => manager.enabled[t.id]),
      [false, false, false, false],
    );
    assert.equal(document.querySelectorAll(`[${INJECTED_COLUMN}]`).length, 0);
    manager.setEnabled("preferred-locations", true);
    await tick();
    assert.equal(storage.get("tweak-enabled:preferred-locations"), true);
    assert.equal(
      document.querySelector("tbody td:last-child").textContent,
      "Persh:99-101",
    );
    listeners.get("tweak-enabled:preferred-locations")(
      "tweak-enabled:preferred-locations",
      true,
      false,
      true,
    );
    await tick();
    assert.equal(
      document.querySelector("tbody td:last-child").textContent,
      "Persh:99,Persh:100,Persh:101",
    );
    manager.setEnabled("paperwork-status", true);
    await tick();
    const checkbox = document.querySelector("input");
    assert.equal(checkbox.disabled, true);
    assert.equal(checkbox.indeterminate, true);
    manager.setEnabled("paperwork-status", false);
    await tick();
    assert.equal(document.querySelectorAll("input").length, 0);
    assert.deepEqual(
      [...storage.keys()].sort(),
      tweaks.map((t) => `tweak-enabled:${t.id}`).sort(),
    );
  } finally {
    for (const tweak of tweaks) manager.setEnabled(tweak.id, false);
    await tick();
    storage.clear();
    listeners.clear();
    f.close();
  }
});

test("duplicate/missing IDs, unknown sorting and unsupported rows do not corrupt insertion", async () => {
  const f = fixture(tableHtml(rowHtml("000123"), "shipment_id", "unknown"));
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    f.start(0);
    await tick();
    await f.send([
      { shipment_id: "000123" },
      {},
      { shipment_id: "000456" },
      { shipment_id: "000456" },
    ]);
    assert.equal(document.querySelectorAll("tbody tr").length, 2);
    assert.deepEqual(
      Array.from(
        document.querySelectorAll("tbody tr"),
        (row) => siteCells(row)[1].textContent,
      ),
      ["000123", "000456"],
    );
    assert.ok(
      warnings.some((args) => args.join(" ").includes("no shipment_id")),
    );
    assert.ok(
      warnings.some((args) => args.join(" ").includes("determine sort")),
    );
    document.querySelector("tbody tr").outerHTML =
      '<tr><td colspan="3">Empty</td></tr>';
    document.querySelector("thead img").src = "/sort_asc.png";
    await tick();
    await f.send([{ shipment_id: "000222" }]);
    assert.equal(document.querySelector("tbody tr").cells.length, 1);
    assert.deepEqual(
      Array.from(
        document.querySelectorAll("[data-alb-qol-shipment-id]"),
        (row) => row.dataset.albQolShipmentId,
      ),
      ["000222", "000456"],
    );
  } finally {
    console.warn = originalWarn;
    f.close();
  }
});

test("structural edits are visible to later phases and unsubscribe during dispatch is safe", () => {
  const f = fixture();
  const subscriptions = [];
  let columns = 0,
    cancelledCalls = 0,
    cancel;
  try {
    subscriptions.push(
      subscribeToShipmentTables({
        name: "text",
        phase: "text",
        update(tables) {
          columns = tables[0]?.columns.length;
        },
      }),
    );
    subscriptions.push(
      subscribeToShipmentTables({
        name: "columns",
        phase: "columns",
        update(tables) {
          const header = tables[0]?.header;
          if (header && !header.querySelector(`[${INJECTED_COLUMN}]`))
            header.insertAdjacentHTML(
              "afterbegin",
              `<th ${INJECTED_COLUMN}="synthetic">Owned</th>`,
            );
          cancel?.cleanup();
        },
        cleanup() {
          document.querySelector(`[${INJECTED_COLUMN}]`)?.remove();
        },
      }),
    );
    assert.equal(columns, 3);
    cancel = subscribeToShipmentTables({
      name: "cancelled",
      phase: "decoration",
      update() {
        cancelledCalls++;
      },
    });
    const before = cancelledCalls;
    subscriptions[0].refresh();
    assert.equal(cancelledCalls, before);
    assert.equal(columns, 3);
  } finally {
    cancel?.cleanup();
    for (const sub of subscriptions.reverse()) sub.cleanup();
    f.close();
  }
});
