/**
 * 내 블로그에 댓글 달아준 사람들의 블로그에 방문해서 최신 글에 댓글 달기
 *
 * 사용법:
 *   node naver-comment-visitors.js              # 최대 10명
 *   node naver-comment-visitors.js --max 5      # 최대 5명
 *   node naver-comment-visitors.js --dry-run    # 목록만 출력
 *   node naver-comment-visitors.js --pages 3    # 관리자 댓글 3페이지 수집
 *   node naver-comment-visitors.js --all        # 전체 수집
 *   node naver-comment-visitors.js --claude-only # API 스킵, Claude Code CLI로만 댓글 생성
 */

require("dotenv").config({ override: true });
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { getNaverContext, sleep, patchSessionCookies, generateBlogComment } = require("../core/utils");

const NAVER_STATE_PATH = path.join(__dirname, "../naverState.json");
const VISITED_PATH = path.join(__dirname, "../commenter-blog-urls.json");
const VISITED_POSTS_PATH = path.join(__dirname, "../visited-posts.json");
const MY_BLOG_ID = "andn8740";
const COMMENT_LIST_URL = `https://admin.blog.naver.com/${MY_BLOG_ID}/userfilter/commentlist`;

const isDryRun = process.argv.includes("--dry-run");
const isClaudeOnly = process.argv.includes("--claude-only");
const isAll = process.argv.includes("--all");
const maxIdx = process.argv.indexOf("--max");
const MAX_VISITS = isAll ? Infinity : maxIdx !== -1 ? parseInt(process.argv[maxIdx + 1]) || 10 : 10;
const pagesIdx = process.argv.indexOf("--pages");
const ADMIN_PAGES = isAll ? 9999 : pagesIdx !== -1 ? parseInt(process.argv[pagesIdx + 1]) || 2 : 2;

const SPAM_PATTERNS = [
  /체험단/,
  /카카오톡|오픈채팅|open\.kakao/i,
  /서이추|서로이웃/,
  /소통방/,
  /WE:U|weu\.kr/i,
  /이웃님의 소중한 하루/,
  /좋은 포스팅 잘 읽고/,
  /모든 일들이 잘 이루어/,
  /https?:\/\/open\.kakao/,
  /맞구독|구독해요|팔로우/,
  /광고|협찬|홍보/,
];

function isSpamComment(text) {
  return SPAM_PATTERNS.some((p) => p.test(text));
}


function buildCommentPrompt(content) {
  return `다음은 네이버 블로그 글의 본문입니다. 글 내용을 읽고 진심으로 공감하는 댓글을 한~두 문장으로 작성해주세요.

규칙:
- 자연스럽고 친근한 말투 (~요, ~네요, ~겠어요)
- 글에서 언급된 구체적인 내용(장소, 음식, 경험 등)을 한 가지 이상 언급
- 이모지는 1개 이하
- 광고나 홍보 느낌 없이 순수한 독자 반응
- 서이추/소통 언급 금지
- 댓글 텍스트만 출력 (다른 설명 없이)

블로그 글 내용:
${content.slice(0, 1500)}`;
}

async function generateAIComment(postContent) {
  return generateBlogComment(buildCommentPrompt(postContent));
}

function loadVisited() {
  if (fs.existsSync(VISITED_PATH)) {
    const data = JSON.parse(fs.readFileSync(VISITED_PATH, "utf-8"));
    if (Array.isArray(data)) return new Set(data);
    if (typeof data === "object" && data !== null) {
      return new Set(Object.keys(data).filter((k) => data[k]));
    }
  }
  return new Set();
}

function saveVisited(set) {
  fs.writeFileSync(VISITED_PATH, JSON.stringify([...set], null, 2), "utf-8");
}

function saveVisitedPost(blogId, postUrl) {
  const data = fs.existsSync(VISITED_POSTS_PATH)
    ? JSON.parse(fs.readFileSync(VISITED_POSTS_PATH, "utf-8"))
    : [];
  if (!data.find((d) => d.blogId === blogId && d.postUrl === postUrl)) {
    data.push({ blogId, postUrl, date: new Date().toISOString().slice(0, 10) });
    fs.writeFileSync(VISITED_POSTS_PATH, JSON.stringify(data, null, 2), "utf-8");
  }
}

// 관리자 댓글 목록에서 작성자 ID 수집
async function collectCommenterIds(page, maxPages) {
  await page.goto(COMMENT_LIST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

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

  const allIds = [];
  const seenIds = new Set();
  let pageNum = 1;

  while (pageNum <= maxPages) {
    const frame = page.frame({ name: "papermain" });
    if (!frame) { console.log("papermain 프레임 없음"); break; }

    await frame.waitForSelector("#tableListById", { timeout: 8000 }).catch(() => {});

    const rows = await frame.evaluate((myId) => {
      const result = [];
      document.querySelectorAll("#tableListById tr").forEach((tr) => {
        const idSpan = tr.querySelector("span._writerId");
        if (!idSpan) return;
        const id = idSpan.textContent?.trim() || "";
        if (!id || id === myId) return;
        const commentText = (tr.querySelector("._replyRealContents") || {}).textContent?.trim()
          || (tr.querySelector(".hand._replyContents") || {}).textContent?.trim()
          || "";
        result.push({ id, commentText });
      });
      return result;
    }, MY_BLOG_ID);

    let newCount = 0;
    for (const { id, commentText } of rows) {
      if (!seenIds.has(id)) {
        seenIds.add(id);
        if (isSpamComment(commentText)) {
          console.log(`  스팸 스킵: ${id} — "${commentText.slice(0, 40)}"`);
        } else {
          allIds.push(id);
          newCount++;
        }
      }
    }
    console.log(`  관리자 페이지 ${pageNum}: ${newCount}명 신규 (누적 ${allIds.length}명)`);

    const nextLink = frame.locator(`a:has-text("${pageNum + 1}")`).first();
    if (!(await nextLink.count())) break;
    await nextLink.click();
    await frame.waitForTimeout(1500);
    pageNum++;
  }

  return allIds;
}

function normalizePostUrl(href) {
  // m.blog.naver.com -> blog.naver.com
  return href.replace(/^https?:\/\/m\.blog\.naver\.com/, "https://blog.naver.com");
}

const NON_POST_SEGMENTS = ["/clip/", "/series/", "/category/", "/tag/", "/search/", "/video/"];

function isPostUrl(href, blogId) {
  if (!href.includes(`blog.naver.com/${blogId}/`) && !href.includes(`/${blogId}/`)) return false;
  if (!(/\/\d{5,}/.test(href))) return false;
  if (NON_POST_SEGMENTS.some((s) => href.includes(s))) return false;
  return true;
}

function findPostUrlInDom(links, blogId) {
  for (const href of links) {
    if (isPostUrl(href, blogId)) {
      const full = href.startsWith("http") ? href : `https://blog.naver.com${href}`;
      return normalizePostUrl(full);
    }
  }
  return null;
}

// 블로거 최신 글 URL 가져오기
async function getLatestPostUrl(page, blogId) {
  try {
    await page.goto(`https://blog.naver.com/${blogId}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(2500);

    // 신형 레이아웃: iframe 없이 직접 DOM에 링크 있음
    const directLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)
    );
    const directUrl = findPostUrlInDom(directLinks, blogId);
    if (directUrl) return directUrl;

    // 구형 레이아웃: mainFrame iframe
    const mainFrame = page.frame({ name: "mainFrame" });
    if (mainFrame) {
      await mainFrame.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
      await mainFrame.waitForSelector("a[href]", { timeout: 5000 }).catch(() => {});
      const frameLinks = await mainFrame.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)
      );
      const frameUrl = findPostUrlInDom(frameLinks, blogId);
      if (frameUrl) return frameUrl;
    }

    // fallback: PostList
    await page.goto(
      `https://blog.naver.com/PostList.naver?blogId=${blogId}&categoryNo=0&currentPage=1`,
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );
    await page.waitForTimeout(1500);

    const listLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)
    );
    const listUrl = findPostUrlInDom(listLinks, blogId);
    if (listUrl) return listUrl;

    const listFrame = page.frame({ name: "mainFrame" });
    if (listFrame) {
      await listFrame.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
      const listFrameLinks = await listFrame.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)
      );
      const listFrameUrl = findPostUrlInDom(listFrameLinks, blogId);
      if (listFrameUrl) return listFrameUrl;
    }

    // API fallback: 블로그 포스트 목록 JSON API
    try {
      await page.goto(
        `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&currentPage=1&categoryNo=0&listStyle=post&countPerPage=1`,
        { waitUntil: "domcontentloaded", timeout: 10000 }
      );
      const json = await page.evaluate(() => {
        try { return JSON.parse(document.body.innerText); } catch { return null; }
      });
      const logNo = json?.postList?.[0]?.logNo || json?.postList?.[0]?.post?.logNo;
      if (logNo) return `https://blog.naver.com/${blogId}/${logNo}`;
    } catch {}

    return null;
  } catch (e) {
    console.log(`  [${blogId}] 접근 실패: ${e.message}`);
    return null;
  }
}

function extractLogNo(postUrl) {
  const m = postUrl.match(/\/(\d{5,})(?:\?|$)/);
  return m ? m[1] : null;
}

// 타인 블로그 글에 댓글 달기
async function leaveComment(page, postUrl) {
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);

  const logNo = extractLogNo(postUrl);
  const mainFrame = page.frame({ name: "mainFrame" });
  if (!mainFrame) {
    console.log("  mainFrame 없음");
    return false;
  }

  await mainFrame.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await mainFrame.waitForTimeout(1500);

  // 글 내용 추출 (mainFrame 우선, 신형 레이아웃 fallback)
  const selectors = [".se-main-container", "#viewTypeSelector", ".post-view", ".se_component_wrap", "#postViewArea"];
  let postContent = await mainFrame.evaluate((sels) => {
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 50) return el.innerText.trim();
    }
    return document.body.innerText.trim();
  }, selectors).catch(() => "");

  if (!postContent || postContent.length < 50) {
    postContent = await page.evaluate((sels) => {
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 50) return el.innerText.trim();
      }
      return "";
    }, selectors).catch(() => "");
  }

  console.log(`  글 내용 추출: ${postContent.slice(0, 60).replace(/\n/g, " ")}...`);
  const commentText = await generateAIComment(postContent);
  if (!commentText) return "skip_ai";
  console.log(`  생성된 댓글: "${commentText}"`);

  // 댓글 섹션 열기
  if (logNo) {
    const cmtBtn = mainFrame.locator(`#Comi${logNo}, ._cmtList`).first();
    if (await cmtBtn.count()) {
      await cmtBtn.click();
      await mainFrame.waitForTimeout(2500);
    }
  }

  // 댓글 입력창 찾기
  let writeInput = null;
  const idSelector = logNo ? `#naverComment_201_${logNo}__write_textarea` : null;

  if (idSelector) {
    const byId = mainFrame.locator(idSelector).first();
    if (await byId.count()) writeInput = byId;
  }
  if (!writeInput) {
    const byClass = mainFrame.locator('.u_cbox_write_area [contenteditable="true"]').first();
    if (await byClass.count()) writeInput = byClass;
  }
  if (!writeInput) {
    console.log("  댓글 입력창 못 찾음");
    return false;
  }

  await writeInput.click({ force: true });
  await mainFrame.waitForTimeout(300);

  const selector = idSelector || '.u_cbox_write_area [contenteditable="true"]';
  await mainFrame.evaluate(
    (args) => {
      const el = document.querySelector(args.selector);
      if (!el) return;
      el.focus();
      el.textContent = args.text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { selector, text: commentText }
  );
  await mainFrame.waitForTimeout(500);

  // 등록 버튼
  const submitBtn = mainFrame
    .locator("button.u_cbox_btn_upload[data-action='write#request']")
    .first();
  if (!(await submitBtn.count())) {
    console.log("  등록 버튼 못 찾음");
    return false;
  }

  await submitBtn.click({ force: true });
  await mainFrame.waitForTimeout(2500);
  return true;
}

(async () => {
  if (isClaudeOnly) {
    process.env.GEMINI_API_KEY = "";
    process.env.ANTHROPIC_API_KEY = "";
    console.log("=== --claude-only: Claude Code CLI로만 댓글 생성 ===");
  }

  const visitedSet = loadVisited();

  const browser = await chromium.launch({ headless: false });
  const context = await getNaverContext(browser, NAVER_STATE_PATH);
  const page = await context.newPage();

  console.log(`=== 댓글 작성자 수집 중 (최대 ${ADMIN_PAGES}페이지)... ===`);
  const commenterIds = await collectCommenterIds(page, ADMIN_PAGES);

  const toVisit = commenterIds.filter((id) => !visitedSet.has(id)).slice(0, MAX_VISITS);

  console.log(`\n총 ${commenterIds.length}명 수집 / 미방문 대상: ${toVisit.length}명\n`);

  if (isDryRun) {
    toVisit.forEach((id, i) => {
      console.log(`[${i + 1}] ${id} — https://blog.naver.com/${id}`);
    });
    await browser.close();
    return;
  }

  let successCount = 0;

  for (const blogId of toVisit) {
    console.log(`\n[${successCount + 1}/${toVisit.length}] ${blogId} 방문 중...`);

    const postUrl = await getLatestPostUrl(page, blogId);
    if (!postUrl) {
      console.log("  최신 글 URL 못 찾음 - 스킵");
      visitedSet.add(blogId);
      saveVisited(visitedSet);
      continue;
    }

    console.log(`  최신 글: ${postUrl}`);
    const result = await leaveComment(page, postUrl);

    if (result === "skip_ai") {
      console.log("  AI 실패로 댓글 스킵 - 다음 실행에서 재시도됩니다");
    } else if (result) {
      visitedSet.add(blogId);
      saveVisited(visitedSet);
      saveVisitedPost(blogId, postUrl);
      successCount++;
      console.log("  완료!");
    } else {
      console.log("  실패 - 다음 실행에서 재시도됩니다");
    }

    await sleep(3000 + Math.random() * 2000);
  }

  await browser.close();
  console.log(`\n=== 완료: ${successCount}/${toVisit.length}명 댓글 달기 성공 ===`);
  console.log(`누적 방문 기록: ${visitedSet.size}명 (${VISITED_PATH})`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
