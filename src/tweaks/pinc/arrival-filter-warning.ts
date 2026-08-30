import type { Tweak } from "../types";
import { createLogger, injectHostCss, onElement } from "../helpers";

const WARNING_CLASS = "alb-qol-arrival-filter-warning";
const BAD_INPUT_CLASS = "alb-qol-arrival-filter-bad-input";
const SECTION_SELECTOR = "#shipment_filter_section_planned_arrival_time";

const { log, warn } = createLogger("arrival-filter-warning");

export const arrivalFilterWarning: Tweak = {
  id: "arrival-filter-warning",
  siteId: "pinc",
  title: "Arrival date filter warning",
  description:
    "Warn when the Planned Arrival Time filter range would hide current check-ins.",
  pathPattern: /^\/shipments/,
  apply() {
    if (!isArrivalsView()) return;

    const removeCss = injectHostCss(`
      .${WARNING_CLASS} {
        color: #9c4500 !important;
        font-weight: bold !important;
      }
      input.${BAD_INPUT_CLASS} {
        border: 2px solid #e08600 !important;
        background-color: #fff4e0 !important;
      }
    `);

    let section: HTMLElement | null = null;
    let midnightId: ReturnType<typeof setTimeout> | undefined;

    const cancelWatch = onElement<HTMLElement>(SECTION_SELECTOR, (el) => {
      section = el;
      evaluate(el);
      scheduleMidnightCheck();
    });

    return () => {
      cancelWatch();
      clearTimeout(midnightId);
      if (section) clearMarks(section);
      removeCss();
      log("stopped");
    };

    //* The thresholds move at midnight, so a page left open overnight
    //* re-checks even though the inputs themselves cannot change.
    function scheduleMidnightCheck() {
      const now = new Date();
      const next = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        5,
      );
      midnightId = setTimeout(() => {
        if (section?.isConnected) evaluate(section);
        scheduleMidnightCheck();
      }, next.getTime() - now.getTime());
    }

    function evaluate(el: HTMLElement) {
      clearMarks(el);

      //* Other operators are deliberate choices; only ranges get checked.
      const operator = el.querySelector<HTMLSelectElement>(
        'select[id$="__operator"]',
      );
      if (!operator || operator.value !== "between") return;

      const startInput = el.querySelector<HTMLInputElement>(
        'input[id$="_operand_start_date"]',
      );
      const endInput = el.querySelector<HTMLInputElement>(
        'input[id$="_operand_end_date"]',
      );
      const start = parseSiteDate(startInput?.value);
      const end = parseSiteDate(endInput?.value);

      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const tomorrowEnd = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        23,
        59,
      );

      const problems: string[] = [];
      if (startInput && start && start > todayStart) {
        startInput.classList.add(BAD_INPUT_CLASS);
        problems.push(
          "Start date is after today at 00:00. Drivers who checked in earlier today may be hidden.",
        );
      }
      if (endInput && end && end < tomorrowEnd) {
        endInput.classList.add(BAD_INPUT_CLASS);
        problems.push(
          "End date is before tomorrow at 23:59. New check-ins may not show up.",
        );
      }
      if (problems.length === 0) return;

      const box = document.createElement("div");
      box.className = `${WARNING_CLASS} small-10 small-offset-2 large-offset-1 cell text-small`;
      for (const problem of problems) {
        const line = document.createElement("div");
        line.textContent = `⚠ ${problem}`;
        box.appendChild(line);
      }
      el.appendChild(box);
      log("flagged", problems);
    }

    function clearMarks(el: HTMLElement) {
      el.querySelector(`.${WARNING_CLASS}`)?.remove();
      el.querySelectorAll(`.${BAD_INPUT_CLASS}`).forEach((input) =>
        input.classList.remove(BAD_INPUT_CLASS),
      );
    }
  },
};

//* The view_type param is only present after a manual filter submit, so
//* fall back to the server-rendered active tab.
function isArrivalsView(): boolean {
  const param = new URLSearchParams(location.search).get("view_type");
  if (param) return param === "arrivals";
  const active = document.querySelector<HTMLAnchorElement>(
    "#shipment-tabs dd.active a",
  );
  if (!active) {
    warn("could not determine the active tab; skipping");
    return false;
  }
  try {
    return new URL(active.href).searchParams.get("view_type") === "arrivals";
  } catch {
    return false;
  }
}

//* Site format: "YYYY-MM-DD HH:mm" in local time.
function parseSiteDate(value: string | undefined): Date | null {
  const match = value
    ?.trim()
    .match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return null;
  const date = new Date(
    +match[1],
    +match[2] - 1,
    +match[3],
    +match[4],
    +match[5],
  );
  return Number.isNaN(date.getTime()) ? null : date;
}
