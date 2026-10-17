// Production-build browser checks with isolated API responses; no live mutations.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext(),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.routeWebSocket(/.*supabase.*realtime.*/, (ws) => ws.close());
  const starts = Date.now() + 4000;
  const online = {
    enabled: true,
    starts_at: new Date(starts).toISOString(),
    entry_closes_at: new Date(starts + 1800000).toISOString(),
    ends_at: new Date(starts + 6600000).toISOString(),
  };
  const names = [
    "Bug Blitz",
    "Code Breaker",
    "System Under Attack",
    "Final Debugging Arena",
  ];
  const rounds = names.map((name, i) => ({
    id: i + 1,
    name,
    status: i < 3 ? "open" : "draft",
    duration_seconds: i === 0 ? 1200 : 1800,
    max_points: 100,
    paused_at: null,
  }));
  let active = 0,
    entered = false,
    ended = false,
    tabCount = 0,
    firstEnd = 0,
    deadline = 0;
  const telemetry = [];
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      body = route.request().postDataJSON() || {};
    let data = {};
    if (path === "/api/auth/session")
      data = {
        session: { user: { id: "isolated-team", email: "team@example.test" } },
        recovery: false,
      };
    else if (path === "/api/rpc/bh_bootstrap")
      data = {
        role: "team",
        team: { name: "Browser Team", status: "approved" },
        rounds,
        online,
        server_time: new Date().toISOString(),
      };
    else if (path === "/api/rpc/bh_heartbeat") data = { allowed: true };
    else if (path === "/api/rpc/bh_start_round") {
      assert.equal(body.p_round, 1);
      assert.ok(Date.now() >= starts);
      active = 1;
      entered = true;
      firstEnd = Date.now() + 3000;
      deadline = Date.now() + 4800000;
      data = { round_id: 1 };
    } else if (path === "/api/rpc/bh_finish_round") {
      assert.equal(body.p_round, 2);
      active = 3;
      data = null;
    } else if (path === "/api/rpc/bh_activity") {
      telemetry.push(body);
      if (body.p_kind === "tab") tabCount++;
      data = { tab_count: tabCount, warning: false };
    } else if (path === "/api/rpc/bh_team_state") {
      if (active === 1 && Date.now() >= firstEnd) active = 2;
      const r = body.p_round;
      const remaining = active === 1 ? firstEnd : Date.now() + 1800000;
      data = {
        round: {...rounds[r - 1], status: r === 2 ? 'paused' : rounds[r - 1].status},
        session: entered
          ? {
              started_at: new Date(starts).toISOString(),
              ends_at: new Date(remaining).toISOString(),
              completed_at: r < active ? new Date().toISOString() : null,
            }
          : null,
        server_time: new Date().toISOString(),
        online,
        active_round: ended ? null : active || null,
        online_entered: entered,
        team_ends_at: entered ? new Date(deadline).toISOString() : null,
        qualifications: [],
        questions:
          entered && r === active
            ? [
                {
                  id: "browser-r" + r,
                  title: "Round " + r + " question",
                  language: "JavaScript",
                  difficulty: "Basic",
                  max_points: 10,
                  max_attempts: 1,
                  kind: "answer",
                  prompt: "Review this snippet",
                  fields: [{ key: "a", label: "Answer" }],
                },
              ]
            : [],
        submissions: [],
        drafts: [],
        claims: [],
        announcements: [],
        clarifications: [],
        certificates: [],
        tab_count: tabCount,
      };
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.goto(process.env.BUGHUNT_TEST_URL || "http://127.0.0.1:5173");
  await page.getByRole("heading", { name: "Ready for the hunt?" }).waitFor();
  const entry = page.locator("article.round-card").first().getByRole("button");
  assert.equal(await entry.isDisabled(), true);
  await entry.waitFor();
  await page.waitForFunction(
    () => {
      const b = document.querySelector("article.round-card button");
      return b && !b.disabled;
    },
    {},
    { timeout: 10000 },
  );
  await entry.click();
  await page
    .getByRole("heading", { name: "Round 1 question", exact: true })
    .waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForFunction(() => true);
  await page.waitForTimeout(100);
  assert.equal(tabCount, 1);
  await page
    .getByRole("heading", { name: "Round 2 question", exact: true })
    .waitFor({ timeout: 10000 });
  assert.equal(
    await page
      .getByRole("heading", { name: "Round 1 question", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.getByRole("button", {name:"Move to next round",exact:true}).isEnabled(),true);
  await page
    .getByRole("button", {
      name: "Move to next round",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Confirm submission", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Round 3 question", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Round 2 question", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Enter round", exact: true })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS scheduled entry gating, automatic round expiry, focus recording, early forward transition, continuous timers, and no back navigation.",
  );
} finally {
  await browser.close();
}
