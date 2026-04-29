const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // SNS 로그인 페이지 (네이버/Apple) :contentReference[oaicite:3]{index=3}
  await page.goto("https://www.reviewnote.co.kr/sns/login", { waitUntil: "domcontentloaded" });

  console.log("브라우저에서 네이버/Apple로 로그인 완료 후, 아무 키나 누르세요.");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", async () => {
    await context.storageState({ path: "storageState.json" });
    await browser.close();
    process.exit(0);
  });
})();
