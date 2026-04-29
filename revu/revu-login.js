const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://www.revu.net/login", { waitUntil: "domcontentloaded" });

  console.log("브라우저에서 revu.net 로그인 완료 후, 아무 키나 누르세요.");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", async () => {
    await context.storageState({ path: "storageState-revu.json" });
    console.log("storageState-revu.json 저장 완료!");
    await browser.close();
    process.exit(0);
  });
})();
