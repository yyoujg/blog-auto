/**
 * 내 블로그 관리자 댓글 목록에서 댓글 달아준 사람들(나 제외)의
 * 블로그를 새 탭으로 모두 엽니다.
 *
 * 사용법: node naver-collect-commenters.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { patchSessionCookies, getNaverContext } = require("../core/utils");

const NAVER_STATE_PATH = path.join(__dirname, "../naverState.json");
const MY_BLOG_ID = "andn8740";
const COMMENT_LIST_URL = `https://admin.blog.naver.com/${MY_BLOG_ID}/userfilter/commentlist`;

// ── papermain 프레임에서 현재 페이지 댓글 작성자 ID 수집 ──────────────────
async function getIdsFromFrame(frame) {
  return frame.evaluate((myId) => {
    const seen = new Set();
    const result = [];
    document.querySelectorAll("span._writerId").forEach((span) => {
      const id = (span.textContent || "").trim();
      if (id && id !== myId && !seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    });
    return result;
  }, MY_BLOG_ID);
}

// ── 모든 페이지를 순회하며 댓글 작성자 ID 수집 ───────────────────────────
async function collectAllCommenterIds(page) {
  await page.goto(COMMENT_LIST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // 세션 만료 감지
  if (page.url().includes("nidlogin")) {
    console.log("세션 만료 — 브라우저에서 로그인 후 엔터를 누르세요...");
    await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once("data", resolve);
    });
    await page.context().storageState({ path: NAVER_STATE_PATH });
    patchSessionCookies(NAVER_STATE_PATH);
    await page.goto(COMMENT_LIST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  const allIds = new Set();
  let pageNum = 1;

  while (true) {
    // papermain 프레임 접근
    const frame = page.frame({ name: "papermain" });
    if (!frame) {
      console.log("papermain 프레임을 찾을 수 없습니다.");
      break;
    }

    await frame.waitForSelector("#tableListById", { timeout: 8000 }).catch(() => {});

    const ids = await getIdsFromFrame(frame);
    ids.forEach((id) => allIds.add(id));
    console.log(`  페이지 ${pageNum}: ${ids.length}명 발견 (누적 ${allIds.size}명)`);

    // 다음 페이지 링크 찾기 (프레임 내부)
    const nextPageNum = pageNum + 1;
    const nextLink = frame.locator(`a:has-text("${nextPageNum}")`).first();
    const exists = await nextLink.count();
    if (!exists) break;

    await nextLink.click();
    await frame.waitForTimeout(1500);
    pageNum++;
  }

  return [...allIds];
}

// ── 블로거의 최신 게시글 URL 가져오기 ────────────────────────────────────
async function getLatestPostUrl(page, blogId) {
  try {
    await page.goto(`https://blog.naver.com/${blogId}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    // mainFrame iframe이 나타날 때까지 대기
    await page.waitForSelector('iframe[name="mainFrame"]', { timeout: 8000 }).catch(() => {});

    const mainFrame = page.frame({ name: "mainFrame" });
    if (mainFrame) {
      // mainFrame 콘텐츠가 로드될 때까지 대기
      await mainFrame.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
      await mainFrame.waitForSelector("a[href]", { timeout: 5000 }).catch(() => {});

      const postUrl = await mainFrame.evaluate((blogId) => {
        const links = Array.from(document.querySelectorAll("a[href]"));
        for (const a of links) {
          const href = a.href || "";
          if (
            (href.includes(`blog.naver.com/${blogId}/`) || href.includes(`/${blogId}/`)) &&
            /\/\d{5,}/.test(href)
          ) {
            return href.startsWith("http") ? href : `https://blog.naver.com${href}`;
          }
        }
        return null;
      }, blogId);

      if (postUrl) return postUrl;
    }

    // fallback: PostList 페이지에서 직접 탐색
    await page.goto(
      `https://blog.naver.com/PostList.naver?blogId=${blogId}&categoryNo=0&currentPage=1`,
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );
    const listFrame = page.frame({ name: "mainFrame" });
    if (listFrame) {
      await listFrame.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
      const fromList = await listFrame.evaluate((blogId) => {
        for (const a of document.querySelectorAll("a[href]")) {
          const href = a.href || "";
          if (href.includes(blogId) && /\/\d{5,}/.test(href)) {
            return href.startsWith("http") ? href : `https://blog.naver.com${href}`;
          }
        }
        return null;
      }, blogId);
      if (fromList) return fromList;
    }

    return null;
  } catch (e) {
    console.log(`  [${blogId}] 접근 실패: ${e.message}`);
    return null;
  }
}

// ── 메인 ─────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await getNaverContext(browser, NAVER_STATE_PATH);
  const page = await context.newPage();

  console.log("=== 댓글 작성자 수집 중... ===");
  const commenterIds = await collectAllCommenterIds(page);

  if (commenterIds.length === 0) {
    console.log("댓글 작성자를 찾지 못했습니다.");
    await browser.close();
    return;
  }

  console.log(`\n총 ${commenterIds.length}명 — 블로그 탭 열기 중...`);
  for (const id of commenterIds) {
    const tab = await context.newPage();
    await tab.goto(`https://blog.naver.com/${id}`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    console.log(`  열림: https://blog.naver.com/${id}`);
  }

  console.log("\n모든 탭을 열었습니다. 브라우저를 수동으로 닫아주세요.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
