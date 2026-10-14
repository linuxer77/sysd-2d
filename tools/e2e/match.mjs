import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const url = process.argv[2] ?? "http://127.0.0.1:5173/", out = "/tmp/claude-1000/shots"; mkdirSync(out, { recursive: true });
const vp = process.argv[3] === "phone" ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const tag = process.argv[3] === "phone" ? "phone-" : "";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: vp });
page.setDefaultTimeout(60000);
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
const log = (...a) => console.log(...a);
const crumb = async () => (await page.locator(".crumb .cur").innerText().catch(() => "")).trim();
const wait = (ms) => page.waitForTimeout(ms);
const tab = async (name) => { if (vp.width < 900) { const t = page.locator(".tabs button", { hasText: name }); if (await t.count()) await t.first().click(); } };

await page.goto(url, { waitUntil: "networkidle" });
await page.getByText("Other ways to play").click();
await page.getByRole("button", { name: /Versus the computer: easy/ }).click();
await page.waitForFunction(() => document.querySelector(".crumb .cur")?.textContent === "the problem");
log("phase:", await crumb());
await page.screenshot({ path: `${out}/${tag}brief.png` });
// the draft must NOT be reachable until the problem has been read
log("choices visible during the briefing:", await page.getByRole("button", { name: /^Take this$/ }).count());
await page.getByRole("button", { name: /I understand/ }).click();
await page.waitForFunction(() => document.querySelector(".crumb .cur")?.textContent === "draft");
log("phase:", await crumb());
await page.screenshot({ path: `${out}/${tag}draft.png` });

// ---- draft: take option A whenever it is my turn
for (let guard = 0; guard < 120 && (await crumb()) === "draft"; guard++) {
  const take = page.getByRole("button", { name: /^Take this$/ });
  if (await take.count() && await take.first().isEnabled()) {
    await take.first().click(); await wait(400);
    if (!globalThis.__shot) { globalThis.__shot = 1; log("after picking:", (await page.locator(".banner b").first().innerText())); await page.screenshot({ path: `${out}/${tag}draft-reveal.png` }); }
  } else await wait(250);
}
await page.waitForFunction(() => document.querySelector(".crumb .cur")?.textContent === "build");
log("phase:", await crumb());

// ---- build: load balancer, two app servers, database
await tab("Pieces");
const tap = async (re) => { await page.getByRole("button", { name: re }).first().click(); await wait(150); };
await tap(/Load balancer, costs/); await tap(/Application server, costs/); await tap(/Application server, costs/); await tap(/Database, costs/);
await tab("Board");
const piece = async (i) => page.evaluate((i) => { const li = document.querySelectorAll('ul[aria-label^="The pieces"]')[0].querySelectorAll("li")[i]; return [Number(li.dataset.x), Number(li.dataset.y)]; }, i);
const toClient = (wx, wy) => page.evaluate(([wx, wy]) => {
  const c = document.querySelector(".boardwrap canvas"); const r = c.getBoundingClientRect();
  const s = Math.min(r.width / 1000, r.height / 640);
  return { x: r.left + (r.width - 1000 * s) / 2 + wx * s, y: r.top + (r.height - 640 * s) / 2 + wy * s };
}, [wx, wy]);
const connect = async (a, b) => {
  const pa = await toClient(...a); await page.mouse.click(pa.x, pa.y);
  const pb = await toClient(...b); await page.mouse.click(pb.x, pb.y); await wait(120);
};
const [V, LB, A1, A2, DB] = [await piece(0), await piece(1), await piece(2), await piece(3), await piece(4)];
await connect(V, LB); await connect(LB, A1); await connect(LB, A2); await connect(A1, DB); await connect(A2, DB);
await page.screenshot({ path: `${out}/${tag}build.png` });
await tab("Coach");
const lock = page.getByRole("button", { name: /Lock in my design/ });
log("lock enabled:", await lock.isEnabled());
await lock.click();
await page.waitForFunction(() => document.querySelector(".crumb .cur")?.textContent === "scout", null, { timeout: 30000 });
log("phase:", await crumb());
await page.screenshot({ path: `${out}/${tag}recon.png` });
await tab("Scout");
await page.getByRole("button", { name: /I am done scouting/ }).click();
await page.waitForFunction(() => document.querySelector(".crumb .cur")?.textContent === "siege", null, { timeout: 30000 });
log("phase:", await crumb());

// ---- siege: attack with a traffic spike every round, defend by saving the defence
let shot = 0, rounds = new Set();
for (let guard = 0; guard < 600 && (await crumb()) === "siege"; guard++) {
  const pill = await page.locator(".pill.info", { hasText: /Round/ }).first().innerText().catch(() => "");
  rounds.add(pill);
  const spike = page.getByRole("button", { name: /Traffic spike/ }).first();
  const lockAtk = page.getByRole("button", { name: /^Lock in/ });
  const noDefence = page.getByRole("button", { name: /^Do not defend$/ });
  const next = page.getByRole("button", { name: /^Next$/ });
  if (await lockAtk.count()) { if (await spike.count() && await spike.isEnabled()) await spike.click(); if (await lockAtk.isEnabled()) { if (shot < 1) { await page.screenshot({ path: `${out}/${tag}siege-declare.png` }); shot++; } await lockAtk.click(); } }
  else if (await noDefence.count()) { if (shot < 2) { await page.screenshot({ path: `${out}/${tag}siege-respond.png` }); shot++; } await noDefence.click(); }
  else if (await next.count()) { if (shot === 2) { await wait(600); await page.screenshot({ path: `${out}/${tag}siege-resolve.png` }); shot++; } await next.click(); }
  await wait(300);
}
log("rounds seen:", [...rounds].filter(Boolean).join(", "));
await page.waitForFunction(() => document.querySelector(".crumb .cur")?.textContent === "review", null, { timeout: 90000 });
log("phase:", await crumb());
await tab("Board"); await wait(800);
await page.screenshot({ path: `${out}/${tag}review.png` });
await tab("Lessons");
log("headline:", (await page.locator(".banner b").first().innerText()));
log("why:", (await page.locator(".banner > div > div").first().innerText()));
log("lesson tips:", (await page.locator(".tip h5").allInnerTexts()).slice(0, 4).join(" | "));
await page.screenshot({ path: `${out}/${tag}review-lessons.png` });
log("errors:", JSON.stringify(errors));
await browser.close();
