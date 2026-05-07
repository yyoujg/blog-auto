const { chromium } = require("playwright");
const path = require("path");

const ROOT_STATE_PATH = path.resolve(__dirname, "..", "storageState-revu.json");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://www.revu.net/login", { waitUntil: "domcontentloaded" });

  console.log(
    [
      "브라우저에서 revu.net 로그인 완료 후, 아무 키나 누르세요.",
      "",
      `저장 위치: ${ROOT_STATE_PATH}`,
    ].join("\n"),
  );
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", async () => {
    await context.storageState({ path: ROOT_STATE_PATH });
    console.log("세션이 storageState-revu.json에 저장되었습니다.");
    await browser.close();
    process.exit(0);
  });
})();
