const { chromium } = require("playwright");
const path = require("path");
const { patchSessionCookies } = require("../core/utils");

const NAVER_STATE_PATH = path.join(__dirname, "../naverState.json");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded" });

  console.log("브라우저에서 네이버 로그인 완료 후 터미널에서 엔터를 누르세요...");
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", resolve);
  });

  await context.storageState({ path: NAVER_STATE_PATH });
  patchSessionCookies(NAVER_STATE_PATH);
  console.log(`로그인 세션 저장 완료 → ${NAVER_STATE_PATH}`);
  await browser.close();
  process.exit(0);
})();
