const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { patchSessionCookies } = require("../core/utils");

const NAVER_STATE_PATH = path.join(__dirname, "../naverState.json");
const BLOG_HOME_BASE =
  "https://section.blog.naver.com/BlogHome.naver?directoryNo=0&groupId=0&currentPage=";

async function isLoggedIn(context) {
  // 네이버 로그인 페이지는 봇 감지로 로그인 상태여도 리다이렉트가 안 됨
  // 쿠키 존재 여부로 확인 (NID_AUT = 네이버 인증 쿠키)
  const cookies = await context.cookies(["https://www.naver.com", "https://nid.naver.com"]);
  const hasAuth = cookies.some((c) => c.name === "NID_AUT");
  console.log(`[isLoggedIn] NID_AUT 쿠키 ${hasAuth ? "있음 → 로그인 유지" : "없음 → 재로그인 필요"}`);
  return hasAuth;
}

async function doLogin(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("https://nid.naver.com/nidlogin.login", {
    waitUntil: "domcontentloaded",
  });

  console.log("로그인 완료 후 터미널에서 엔터를 누르세요...");
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", resolve);
  });

  await context.storageState({ path: NAVER_STATE_PATH });
  patchSessionCookies(NAVER_STATE_PATH);
  console.log("로그인 세션 저장 완료");
  await page.close();
  return context;
}

async function ensureNaverLogin(browser) {
  if (fs.existsSync(NAVER_STATE_PATH)) {
    console.log("기존 네이버 로그인 세션 로드 — 유효성 확인 중...");
    const context = await browser.newContext({
      storageState: NAVER_STATE_PATH,
      viewport: { width: 1280, height: 900 },
    });
    let loggedIn;
    try {
      loggedIn = await isLoggedIn(context);
    } catch(err) {
      await context.close().catch(()=>{});
      throw err;
    }
    if (loggedIn) {
      console.log("로그인 세션 유효 — 계속 진행합니다.");
      return context;
    }
    console.log("세션 만료 — 재로그인이 필요합니다.");
    await context.close().catch(() => {});
    fs.unlinkSync(NAVER_STATE_PATH);
  }

  console.log("네이버 로그인이 필요합니다. 브라우저에서 로그인해주세요.");
  return doLogin(browser);
}

let stopping = false;
process.on("SIGINT", () => {
  console.log("\n중지 요청 감지 — 현재 페이지 완료 후 종료합니다...");
  stopping = true;
});

(async () => {
  const startPage = parseInt(process.argv[2]) || 1;

  const browser = await chromium.launch({ headless: false });
  const context = await ensureNaverLogin(browser);
  const page = await context.newPage();

  let totalLiked = 0;
  let totalSkipped = 0;
  let currentPage = startPage;

  while (!stopping) {
    const pageUrl = BLOG_HOME_BASE + currentPage;
    console.log(`\n===== ${currentPage}페이지 =====`);
    console.log(pageUrl);

    try {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch (e) {
      console.error(`페이지 이동 실패: ${e.message}`);
      if (e.message.includes("has been closed") || e.message.includes("Target closed")) {
        stopping = true;
        break;
      }
      currentPage++;
      continue;
    }
    await page.waitForTimeout(3000);

    const buttons = page.locator("a.u_likeit_button._face");
    const total = await buttons.count();

    if (total === 0) {
      if (currentPage === startPage) {
        console.log("첫 페이지에서 공감 버튼 없음 — 세션이 만료되었거나 비밀번호가 변경된 것 같습니다.");
        console.log("저장된 세션을 삭제합니다. 다시 실행하면 재로그인 창이 열립니다.");
        fs.unlinkSync(NAVER_STATE_PATH);
      } else {
        console.log("공감 버튼 없음 — 마지막 페이지 도달");
      }
      break;
    }

    console.log(`공감 버튼 ${total}개 발견`);
    let pageLiked = 0;
    let pageSkipped = 0;

    for (let i = 0; i < total; i++) {
      if (stopping) break;

      const btn = buttons.nth(i);
      try {
        const isOn = await btn.evaluate((el) => el.classList.contains("on"));
        if (isOn) {
          pageSkipped++;
          continue;
        }

        await btn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await btn.click({ timeout: 5000, force: true });
        await page.waitForTimeout(800);

        const afterOn = await btn.evaluate((el) => el.classList.contains("on"));
        if (afterOn) {
          pageLiked++;
          totalLiked++;
          console.log(`  [${i + 1}/${total}] 공감 완료 (페이지 ${pageLiked}개 / 전체 ${totalLiked}개)`);
        } else {
          pageSkipped++;
          totalSkipped++;
          console.log(`  [${i + 1}/${total}] 반영 안 됨`);
        }
      } catch (e) {
        console.error(`  [${i + 1}/${total}] 에러: ${e.message}`);
        pageSkipped++;
        totalSkipped++;
        if (e.message.includes("has been closed")) {
          stopping = true;
          break;
        }
      }

      await page.waitForTimeout(1000 + Math.random() * 2000);
    }

    console.log(`${currentPage}페이지 완료: 공감 ${pageLiked}개, 건너뜀 ${pageSkipped}개`);
    currentPage++;
  }

  console.log(`\n===== 최종 결과 =====`);
  console.log(`총 공감: ${totalLiked}개, 총 건너뜀: ${totalSkipped}개`);
  await context.storageState({ path: NAVER_STATE_PATH });
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
