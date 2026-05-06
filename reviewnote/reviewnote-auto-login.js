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
  await naverBtn.scrollIntoViewIfNeeded().catch(() => {});
  // 사이트에 따라 (1) 같은 탭 이동, (2) 새 탭, (3) 팝업 으로 OAuth가 열릴 수 있음
  const popupPromise = page.waitForEvent("popup", { timeout: 7000 }).catch(() => null);
  const newPagePromise = context.waitForEvent("page", { timeout: 7000 }).catch(() => null);
  const sameTabToNaverPromise = page
    .waitForURL((url) => url.hostname.includes("naver.com") || url.hostname.includes("nid.naver.com"), { timeout: 7000 })
    .then(() => page)
    .catch(() => null);

  await naverBtn.click({ force: true });

  const oauthPage = (await Promise.race([popupPromise, newPagePromise, sameTabToNaverPromise])) || null;
  if (oauthPage) {
    await oauthPage.waitForLoadState("domcontentloaded").catch(() => {});
  }

  // 네이버 OAuth 완료 후 리뷰노트로 돌아올 때까지 대기
  // (기존 탭 또는 팝업 중) URL이 reviewnote.co.kr 이고 로그인 페이지가 아닐 때까지 기다림
  const waitForReviewnoteReturn = async ({ timeoutMs }) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      for (const p of context.pages()) {
        try {
          const u = new URL(p.url());
          if (u.hostname.includes("reviewnote.co.kr") && !u.pathname.includes("/sns/login")) {
            return p;
          }
        } catch {
          // ignore invalid/blank urls like about:blank
        }
      }
      await page.waitForTimeout(250);
    }
    return null;
  };

  try {
    const returnedPage = await waitForReviewnoteReturn({ timeoutMs: 30000 });
    if (!returnedPage) throw new Error("timeout");
  } catch {
    // OAuth 승인 페이지가 뜰 수 있으므로 한 번 더 시도
    const pagesToCheck = [oauthPage, page].filter(Boolean);
    const currentUrls = pagesToCheck.map((p) => p.url());
    const seemsNaver = currentUrls.some((u) => u.includes("nid.naver.com") || u.includes("naver.com"));

    if (seemsNaver) {
      // 네이버 측 동의/확인 버튼이 있으면 클릭
      // (OAuth 페이지가 있으면 그 페이지를 우선)
      const agreeBtn = (oauthPage || page)
        .locator('button:has-text("동의"), button:has-text("확인"), input[value="동의"]')
        .first();
      if ((await agreeBtn.count()) > 0) {
        await agreeBtn.click({ timeout: 5000 }).catch(() => {});
        const returnedPage = await waitForReviewnoteReturn({ timeoutMs: 20000 });
        if (!returnedPage) {
          console.error("[auto-login] 네이버 OAuth 이후 리다이렉트 실패. 현재 URL들:", context.pages().map((p) => p.url()));
          await browser.close();
          process.exit(1);
        }
      } else {
        console.error("[auto-login] 네이버 OAuth 완료 실패. 현재 URL들:", context.pages().map((p) => p.url()));
        await browser.close();
        process.exit(1);
      }
    } else {
      console.error("[auto-login] 로그인 리다이렉트 실패. 현재 URL들:", context.pages().map((p) => p.url()));
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
