// 네이버 세션(naverState.json)을 이용해 리뷰노트에 자동 로그인 후 storageState.json 저장
const { chromium } = require("playwright");
const path = require("path");

const NAVER_STATE_PATH = path.join(__dirname, "../naverState.json");
const REVIEWNOTE_STATE_PATH = path.join(__dirname, "../storageState.json");
const SNS_LOGIN_URL = "https://www.reviewnote.co.kr/sns/login";
const HOME_URL = "https://www.reviewnote.co.kr";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: NAVER_STATE_PATH });
  const page = await context.newPage();

  await page.goto(SNS_LOGIN_URL, { waitUntil: "domcontentloaded" });

  // 네이버 로그인 버튼 클릭
  const naverBtn = page.locator('a[href*="naver"], button:has-text("네이버"), a:has-text("네이버")').first();
  if ((await naverBtn.count()) === 0) {
    console.error("[auto-login] 네이버 로그인 버튼을 찾지 못했습니다.");
    await browser.close();
    process.exit(1);
  }
  await naverBtn.click();

  // 네이버 OAuth 완료 후 리뷰노트로 돌아올 때까지 대기
  // URL이 reviewnote.co.kr 이고 로그인 페이지가 아닐 때까지 기다림
  try {
    await page.waitForURL(
      (url) =>
        url.hostname.includes("reviewnote.co.kr") && !url.pathname.includes("/sns/login"),
      { timeout: 30000 }
    );
  } catch {
    // OAuth 승인 페이지가 뜰 수 있으므로 한 번 더 시도
    const currentUrl = page.url();
    if (currentUrl.includes("nid.naver.com") || currentUrl.includes("naver.com")) {
      // 네이버 측 동의/확인 버튼이 있으면 클릭
      const agreeBtn = page.locator('button:has-text("동의"), button:has-text("확인"), input[value="동의"]').first();
      if ((await agreeBtn.count()) > 0) {
        await agreeBtn.click();
        await page.waitForURL(
          (url) =>
            url.hostname.includes("reviewnote.co.kr") && !url.pathname.includes("/sns/login"),
          { timeout: 20000 }
        );
      } else {
        console.error("[auto-login] 네이버 OAuth 완료 실패. 현재 URL:", page.url());
        await browser.close();
        process.exit(1);
      }
    } else {
      console.error("[auto-login] 로그인 리다이렉트 실패. 현재 URL:", page.url());
      await browser.close();
      process.exit(1);
    }
  }

  await context.storageState({ path: REVIEWNOTE_STATE_PATH });
  console.log("[auto-login] 리뷰노트 로그인 성공 → storageState.json 저장 완료");
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("[auto-login] 오류:", e.message);
  process.exit(1);
});
