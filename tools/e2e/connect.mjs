import { chromium } from "playwright-core";
const url = process.argv[2] ?? "http://127.0.0.1:8790/";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url, { waitUntil: "networkidle" });
await page.getByText("Other ways to play").click();
await page.getByRole("button", { name: /Guided first game/ }).click();
await page.getByRole("button", { name: "Start building" }).click();
await page.getByRole("button", { name: /Application server, costs/ }).click();
await page.getByRole("button", { name: /Database, costs/ }).click();
const list = () => page.evaluate(() => [...document.querySelectorAll('ul[aria-label^="The pieces"] li')].map((l) => l.textContent));
const at = (i) => page.evaluate((i) => { const l = document.querySelectorAll('ul[aria-label^="The pieces"] li')[i]; const c = document.querySelector(".boardwrap canvas").getBoundingClientRect(); const s = Math.min(c.width / 1000, c.height / 640); return { x: c.left + (c.width - 1000 * s) / 2 + Number(l.dataset.x) * s, y: c.top + (c.height - 640 * s) / 2 + Number(l.dataset.y) * s }; }, i);
const click = async (i) => { const p = await at(i); await page.mouse.click(p.x, p.y); await page.waitForTimeout(150); };
console.log("before:", JSON.stringify(await list()));
// exactly what the mission says: click the visitors, then click the application server
await click(0); await click(1);
// then: click the application server, then click the database
await click(1); await click(2);
console.log("after: ", JSON.stringify(await list()));
console.log("step:", (await page.locator(".mission-now + .muted").first().innerText()).replace(/\n/g, " "));
// clicking the same pair again disconnects
await click(1); await click(2);
console.log("after clicking the pair again:", JSON.stringify(await list()));
console.log("errors:", JSON.stringify(errors));
await browser.close();
