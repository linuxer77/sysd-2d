import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const url = process.argv[2] ?? "http://127.0.0.1:5173/", out = "/tmp/claude-1000/shots"; mkdirSync(out, { recursive: true });
const phone = process.argv[3] === "phone";
const vp = phone ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const tag = phone ? "phone-" : "";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: vp });
page.setDefaultTimeout(20000);
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load|404/.test(m.text())) errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
const log = (...a) => console.log(...a);
const tab = async (name) => { if (phone) { const t = page.locator(".tabs button", { hasText: name }); if (await t.count()) await t.first().click(); } };
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("sysd.run.v1"));
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start a run/ }).first().click();
await page.getByText("Keep it standing.").waitFor();
await page.screenshot({ path: `${out}/${tag}run-story.png` });
await page.getByRole("button", { name: "Start building" }).click();
await tab("Board");
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/${tag}run-prepare-1.png` });
log("wave 1 forecast:", (await page.locator(".battle-bar").innerText()).replace(/\s+/g, " ").slice(0, 160));
// start wave 1 without building anything
await page.getByRole("button", { name: /Start wave 1/ }).click();
await page.getByText("Visitors arriving").waitFor();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/${tag}run-watch.png` });
await page.getByRole("button", { name: "Skip" }).click();
await page.waitForTimeout(300);
log("wave 1 result:", (await page.locator(".battle-dialog .bd-text").innerText()).replace(/\s+/g, " ").slice(0, 260));
await page.screenshot({ path: `${out}/${tag}run-result-1.png` });
await page.getByRole("button", { name: "Continue" }).click();
await page.getByText("Pick one reward").waitFor();
await page.screenshot({ path: `${out}/${tag}run-reward.png` });
const names = await page.locator(".battle-menu .move b").allInnerTexts();
log("rewards offered:", names.join(" | "));
await page.locator(".battle-menu .move").first().click();
await page.getByText(/Start wave 2/).waitFor();
await tab("Pieces");
// add a cache by tapping it in the list, and see the spend update
await page.getByRole("button", { name: /^Cache/ }).first().click();
await page.waitForTimeout(400);
await tab("Board");
log("after adding a cache:", (await page.locator(".battle-bar").innerText()).replace(/\s+/g, " ").slice(0, 200));
await page.screenshot({ path: `${out}/${tag}run-prepare-2.png` });
// play on without more building until the run ends
for (let guard = 0; guard < 40; guard++) {
  if (await page.getByText(/The run is over|You made it/).count()) break;
  const start = page.getByRole("button", { name: /Start wave/ });
  if (await start.count() && await start.isEnabled()) { await start.click(); await page.waitForTimeout(200); continue; }
  const skip = page.getByRole("button", { name: "Skip" });
  if (await skip.count()) { await skip.click(); await page.waitForTimeout(200); continue; }
  const cont = page.getByRole("button", { name: "Continue" });
  if (await cont.count()) { await cont.click(); await page.waitForTimeout(200); continue; }
  const pick = page.locator(".battle-menu .move");
  if (await pick.count()) { await pick.first().click(); await page.waitForTimeout(200); continue; }
  await page.waitForTimeout(300);
}
await page.screenshot({ path: `${out}/${tag}run-over.png` });
log("ended:", (await page.locator(".battle-menu h2").first().innerText().catch(() => "?")));
log("errors:", JSON.stringify(errors));
await browser.close();
