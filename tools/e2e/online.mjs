import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const url = process.argv[2] ?? "http://127.0.0.1:8790/", out = "/tmp/claude-1000/shots"; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const errors = [];
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(40000);
  page.on("console", (m) => { if (m.type() === "error" && !/404|favicon/.test(m.text())) errors.push(name + ": " + m.text()); });
  page.on("pageerror", (e) => errors.push(name + " PAGEERROR " + e.message));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator(".status-dot.up").waitFor();
  await page.getByRole("button", { name: "Choose a name" }).click();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Save my name" }).click();
  await page.waitForSelector("text=Play with a friend");
  return page;
}
const crumb = (p) => p.locator(".crumb .cur").innerText().then((t) => t.trim()).catch(() => "");
const stamp = Date.now() % 10000;
const [A, B] = [await player("Ada" + stamp), await player("Bob" + stamp)];

await A.getByText("Other ways to play").click();
await A.getByRole("button", { name: "With a friend" }).click();
await A.getByRole("button", { name: "Make a room code" }).click();
const code = (await A.locator('div[aria-label^="Room code "]').first().innerText()).trim();
console.log("room code:", code);
await A.screenshot({ path: `${out}/online-room.png` });

await B.getByText("Other ways to play").click();
await B.getByRole("button", { name: "With a friend" }).click();
await B.getByLabel("Room code").fill(code);
await B.getByRole("button", { name: "Join", exact: true }).click();

for (const [n, p] of [["A", A], ["B", B]]) {
  await p.waitForFunction(() => document.querySelector(".crumb .cur")?.textContent === "the problem"); console.log(n, "sees:", await crumb(p));
  await p.getByRole("button", { name: /I understand/ }).click();
}
for (const [n, p] of [["A", A], ["B", B]]) { await p.waitForFunction(() => document.querySelector(".crumb .cur")?.textContent === "draft"); console.log(n, "reached:", await crumb(p)); }
for (let g = 0; g < 200; g++) {
  const phases = [await crumb(A), await crumb(B)];
  if (phases.every((x) => x === "build")) break;
  for (const p of [A, B]) { const t = p.getByRole("button", { name: /^Take this$/ }); if (await t.count() && await t.first().isEnabled()) await t.first().click().catch(() => {}); }
  await A.waitForTimeout(200);
}
console.log("A:", await crumb(A), " B:", await crumb(B));
await A.screenshot({ path: `${out}/online-build.png` });
console.log("A sees rival:", (await A.locator(".grp", { hasText: "Your rival" }).first().innerText()).replace(/\s+/g, " "));
B.on("dialog", (d) => d.accept());
await B.getByRole("button", { name: "Leave" }).click();
await A.waitForFunction(() => document.querySelector(".crumb .cur")?.textContent === "review");
console.log("A after B left:", (await A.locator(".banner b").first().innerText()), "/", (await A.locator(".banner > div > div").first().innerText()));
console.log("errors:", JSON.stringify(errors));
await browser.close();
