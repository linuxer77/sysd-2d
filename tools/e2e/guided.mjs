import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const url = process.argv[2] ?? "http://127.0.0.1:8790/", out = "/tmp/claude-1000/shots"; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
await page.goto(url, { waitUntil: "networkidle" });

await page.getByText("Other ways to play").click();
await page.getByRole("button", { name: /Guided first game/ }).click();
await page.waitForSelector("text=Keep a website running");
await page.screenshot({ path: `${out}/guided-intro.png` });
await page.getByRole("button", { name: "Start building" }).click();

// world -> client coordinates for the board
const piece = async (i) => page.evaluate((i) => { const li = document.querySelectorAll('ul[aria-label^="The pieces"]')[0].querySelectorAll("li")[i]; return [Number(li.dataset.x), Number(li.dataset.y)]; }, i);
const toClient = async (wx, wy) => page.evaluate(([wx, wy]) => {
  const c = document.querySelector(".boardwrap canvas"); const r = c.getBoundingClientRect();
  const s = Math.min(r.width / 1000, r.height / 640);
  return { x: r.left + (r.width - 1000 * s) / 2 + wx * s, y: r.top + (r.height - 640 * s) / 2 + wy * s };
}, [wx, wy]);

// place an application server and a database by tapping them in the list
await page.getByRole("button", { name: /Application server, costs/ }).click();
await page.getByRole("button", { name: /Database, costs/ }).click();
await page.waitForTimeout(300);
const progress = async () => (await page.locator(".mission-now + .muted").first().innerText()).replace(/\n/g, " ");
console.log("after placing:", await progress());

// connect visitors -> app -> database using the explicit "Connect" button
const [vw, aw, dw] = [await piece(0), await piece(1), await piece(2)];
const visitors = await toClient(...vw);
await page.mouse.click(visitors.x, visitors.y);
const app = await toClient(...aw);
await page.mouse.click(app.x, app.y);
await page.mouse.click(app.x, app.y);          // click the server again to start its connection
const db = await toClient(...dw);
await page.mouse.click(db.x, db.y);
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/guided-step1.png` });
console.log("after connecting:", await progress());
console.log("mission step:", await page.locator(".pill.info", { hasText: "Step" }).first().innerText());
console.log("coach tips:", (await page.locator(".issue > button").allInnerTexts()).slice(0, 5).join(" | "));
console.log("errors:", JSON.stringify(errors));
await browser.close();
