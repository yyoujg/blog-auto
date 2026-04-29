/**
 * 방문한 블로그에 달아둔 성의없는 댓글을 찾아 AI 생성 댓글로 수정
 *
 * 사용법:
 *   node naver-edit-visitor-comments.js           # commenter-blog-urls.json 전체
 *   node naver-edit-visitor-comments.js --max 5   # 최대 5개 블로그
 *   node naver-edit-visitor-comments.js --dry-run # 찾기만 하고 수정 안 함
 *   node naver-edit-visitor-comments.js --pages 3 # 블로그당 최근 글 몇 페이지
 */

require("dotenv").config({ override: true });
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { getNaverContext, sleep, patchSessionCookies, generateBlogComment } = require("../core/utils");

const NAVER_STATE_PATH = path.join(__dirname, "../naverState.json");
const VISITED_PATH = path.join(__dirname, "../commenter-blog-urls.json");
const EDITED_PATH = path.join(__dirname, "../edited-visitor-comments.json");
const MY_BLOG_ID = "andn8740";

const isDryRun = process.argv.includes("--dry-run");
const maxIdx = process.argv.indexOf("--max");
const MAX_BLOGS = maxIdx !== -1 ? parseInt(process.argv[maxIdx + 1]) || Infinity : Infinity;
const pagesIdx = process.argv.indexOf("--pages");
const POST_PAGES = pagesIdx !== -1 ? parseInt(process.argv[pagesIdx + 1]) || 2 : 2;

// 수정 대상인 구형 성의없는 댓글 패턴
const OLD_PATTERNS = [
  "포스팅 잘 읽고 가요",
  "좋은 글 잘 보고 갑니다",
  "블로그 너무 좋아요",
  "포스팅 감사히 읽고 가요",
  "잘 읽고 갑니다",
  "포스팅 구경 잘 하고 가요",
  "좋은 포스팅 잘 읽었어요",
  "블로그 너무 좋네요",
  "잘 읽고 가요",
  "포스팅 재밌게 읽었어요",
  "글 잘 읽고 가요",
  "좋은 글 감사해요",
  "포스팅 잘 읽었어요",
];

function isOldComment(text) {
  return OLD_PATTERNS.some((p) => text.includes(p));
}

function loadEdited() {
  if (fs.existsSync(EDITED_PATH)) {
    return new Set(JSON.parse(fs.readFileSync(EDITED_PATH, "utf-8")));
  }
  return new Set();
}

function saveEdited(set) {
  fs.writeFileSync(EDITED_PATH, JSON.stringify([...set], null, 2), "utf-8");
}

function loadVisited() {
  if (!fs.existsSync(VISITED_PATH)) return [];
  const data = JSON.parse(fs.readFileSync(VISITED_PATH, "utf-8"));
  if (Array.isArray(data)) return data;
  if (typeof data === "object") return Object.keys(data).filter((k) => data[k]);
  return [];
}

// 글 내용을 직접 읽어 작성한 맞춤 댓글 (AI API 없이 바로 사용)
const PRESET_COMMENTS = {
  dahaja26: "오랜만에 필라테스 개인레슨이라 긴장되셨을 텐데, 바디다움은 강사분 프로필도 다 공개되어 있어서 믿고 맡길 수 있겠더라고요!",
  suhyalee: "런던에서 직접 위키드를 보셨군요, Defying Gravity 현장에서 들으면 얼마나 소름이었을지 너무 부러워요!",
  reviewfocus: "거위가 날아오르는 장면까지 담으셨네요, 원목 인테리어에 탁 트인 자연환경이라니 다음엔 꼭 가봐야겠어요!",
  dudals_s2: "예산부터 상견례까지 단계별로 이렇게 정리해주시니 결혼 준비 막막했던 분들한테 진짜 구세주 같은 글이에요!",
  ongdin_: "하이디라오 주문법 항상 헷갈렸는데 이렇게 정리해주셔서 이제 걱정 없이 갈 수 있겠어요, 부산역 바로 앞이라 접근성도 좋네요!",
};

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

function findPostUrlInDom(links, blogId) {
  for (const href of links) {
    if (
      (href.includes(`blog.naver.com/${blogId}/`) || href.includes(`/${blogId}/`)) &&
      /\/\d{5,}/.test(href)
    ) {
      return href.startsWith("http") ? href : `https://blog.naver.com${href}`;
    }
  }
  return null;
}

// 블로그의 최근 포스트 URL 목록 가져오기 (여러 페이지 순회)
async function getRecentPostUrls(page, blogId, maxPosts) {
  const allUrls = new Set();

  function collectFromLinks(links) {
    for (const href of links) {
      if (
        (href.includes(`blog.naver.com/${blogId}/`) || href.includes(`/${blogId}/`)) &&
        /\/\d{5,}/.test(href) &&
        !["/clip/", "/series/", "/category/", "/tag/"].some((s) => href.includes(s))
      ) {
        const url = (href.startsWith("http") ? href : `https://blog.naver.com${href}`)
          .replace(/^https?:\/\/m\.blog\.naver\.com/, "https://blog.naver.com");
        allUrls.add(url);
      }
    }
  }

  try {
    let pageNum = 1;
    while (allUrls.size < maxPosts) {
      await page.goto(
        `https://blog.naver.com/PostList.naver?blogId=${blogId}&categoryNo=0&currentPage=${pageNum}`,
        { waitUntil: "domcontentloaded", timeout: 20000 }
      );
      await page.waitForTimeout(1500);

      const prevSize = allUrls.size;

      collectFromLinks(await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)
      ));

      const mainFrame = page.frame({ name: "mainFrame" });
      if (mainFrame) {
        await mainFrame.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
        collectFromLinks(await mainFrame.evaluate(() =>
          Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)
        ).catch(() => []));
      }

      if (allUrls.size === prevSize) break; // 더 이상 새 글 없음
      pageNum++;
    }
  } catch (e) {
    console.log(`  [${blogId}] 포스트 목록 실패: ${e.message}`);
  }

  return [...allUrls].slice(0, maxPosts);
}

// 포스트에서 내 구형 댓글 찾기
async function findMyOldComment(page, postUrl) {
  try {
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

    const logNo = (postUrl.match(/\/(\d{5,})(?:\?|$)/) || [])[1];
    const mainFrame = page.frame({ name: "mainFrame" });
    if (!mainFrame) return null;

    await mainFrame.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    await mainFrame.waitForTimeout(1500);

    // 댓글 섹션 열기
    if (logNo) {
      const cmtBtn = mainFrame.locator(`#Comi${logNo}, ._cmtList`).first();
      if (await cmtBtn.count()) {
        await cmtBtn.click();
        await mainFrame.waitForTimeout(3000);
      }
    }

    // 구형 텍스트 패턴으로만 댓글 찾기 (writerId 체크 제거 - 남의 블로그에서 형식 다름)
    // 실제 내 댓글인지는 나중에 수정 버튼 유무로 확인
    const found = await mainFrame.evaluate(({ patterns }) => {
      const result = [];
      document.querySelectorAll("li.u_cbox_comment").forEach((li) => {
        const infoAttr = li.getAttribute("data-info") || "";
        const textEl = li.querySelector(".u_cbox_contents");
        if (!textEl) return;

        const text = textEl.textContent?.trim() || "";
        if (!patterns.some((p) => text.includes(p))) return;

        const commentNoMatch = infoAttr.match(/commentNo:'(\d+)'/)
                            || infoAttr.match(/"commentNo"\s*:\s*"?(\d+)"?/);
        const commentNo = commentNoMatch ? commentNoMatch[1] : null;
        if (commentNo) result.push({ commentNo, text });
      });
      return result;
    }, { patterns: OLD_PATTERNS });

    if (!found || found.length === 0) return null;

    // 글 내용도 추출
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

    return { logNo, comments: found, postContent, mainFrame };
  } catch (e) {
    console.log(`  포스트 탐색 오류: ${e.message}`);
    return null;
  }
}

// 내 댓글 수정
async function editMyComment(page, postUrl, commentNo, newText) {
  // 이미 해당 포스트에 있으므로 mainFrame 재사용
  const mainFrame = page.frame({ name: "mainFrame" });
  if (!mainFrame) return false;

  const commentLi = mainFrame.locator(`li[data-info*="commentNo:'${commentNo}'"]`).first();
  if (!(await commentLi.count())) {
    console.log(`  댓글 요소 못 찾음 (commentNo: ${commentNo})`);
    return false;
  }

  await commentLi.scrollIntoViewIfNeeded().catch(() => {});
  await mainFrame.waitForTimeout(500);

  // 옵션 버튼 열기
  const openBtn = commentLi.locator(".u_cbox_btn_open, [data-action='list#toggleButtons']").first();
  if (await openBtn.count()) {
    await openBtn.click({ force: true });
    await mainFrame.waitForTimeout(500);
  }

  // 수정 버튼
  const editBtn = commentLi.locator("[data-action='edit#show'], .u_cbox_btn_edit").first();
  if (!(await editBtn.count())) {
    console.log("  수정 버튼 못 찾음 (내 댓글이 아닌 것 같음)");
    return false;
  }

  await editBtn.click({ force: true });
  await mainFrame.waitForTimeout(1500);

  // 수정 입력창
  const editInput = commentLi.locator('[contenteditable="true"]').first();
  if (!(await editInput.count())) {
    console.log("  수정 입력창 못 찾음");
    return false;
  }

  await editInput.click({ force: true });
  await mainFrame.evaluate(({ commentNo: cNo, text }) => {
    const li = document.querySelector(`li[data-info*="commentNo:'${cNo}'"]`);
    if (!li) return;
    const el = li.querySelector('[contenteditable="true"]');
    if (!el) return;
    el.focus();
    el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, { commentNo, text: newText });
  await mainFrame.waitForTimeout(500);

  // 저장 버튼
  const saveBtn = commentLi.locator("button[data-action='edit#request'], button.u_cbox_btn_upload, button:has-text('등록')").first();
  if (!(await saveBtn.count())) {
    console.log("  저장 버튼 못 찾음");
    return false;
  }

  await saveBtn.click({ force: true });
  await mainFrame.waitForTimeout(2000);
  return true;
}

(async () => {
  const editedSet = loadEdited();
  const visitedIds = loadVisited();

  const toProcess = visitedIds.slice(0, MAX_BLOGS);
  console.log(`=== 방문 블로그 ${visitedIds.length}개 중 ${toProcess.length}개 처리 예정 ===\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await getNaverContext(browser, NAVER_STATE_PATH);
  const page = await context.newPage();

  // 세션 확인
  await page.goto("https://blog.naver.com", { waitUntil: "domcontentloaded", timeout: 20000 });
  if (page.url().includes("nidlogin")) {
    console.log("세션 만료 - 로그인 후 엔터를 누르세요...");
    await new Promise((resolve) => { process.stdin.resume(); process.stdin.once("data", resolve); });
    await page.context().storageState({ path: NAVER_STATE_PATH });
    patchSessionCookies(NAVER_STATE_PATH);
  }

  let successCount = 0;
  let foundCount = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const blogId = toProcess[i];
    console.log(`\n[${i + 1}/${toProcess.length}] ${blogId} 탐색 중...`);

    const postUrls = await getRecentPostUrls(page, blogId, POST_PAGES * 15);
    console.log(`  최근 포스트 ${postUrls.length}개 발견`);

    let foundInBlog = false;

    for (const postUrl of postUrls) {
      const key = `${blogId}::${postUrl}`;
      if (editedSet.has(key)) {
        console.log(`  이미 처리됨: ${postUrl}`);
        continue;
      }

      const result = await findMyOldComment(page, postUrl);
      if (!result || result.comments.length === 0) continue;

      foundInBlog = true;
      foundCount++;

      for (const { commentNo, text } of result.comments) {
        console.log(`  내 구형 댓글 발견: "${text.slice(0, 50)}"`);

        const newText = PRESET_COMMENTS[blogId] || await generateAIComment(result.postContent);
        if (!newText) {
          console.log("  AI 댓글 생성 실패 - 스킵");
          continue;
        }
        if (PRESET_COMMENTS[blogId]) console.log("  [프리셋 댓글 사용]");

        console.log(`  새 댓글: "${newText}"`);

        if (isDryRun) {
          console.log("  [dry-run] 실제 수정 건너뜀");
          editedSet.add(key);
          saveEdited(editedSet);
          successCount++;
          continue;
        }

        const ok = await editMyComment(page, postUrl, commentNo, newText);
        if (ok) {
          editedSet.add(key);
          saveEdited(editedSet);
          successCount++;
          console.log("  수정 완료!");
        } else {
          console.log("  수정 실패");
        }

        await sleep(1500);
      }

      await sleep(2000 + Math.random() * 1500);
    }

    if (!foundInBlog) {
      console.log("  내 구형 댓글 없음");
    }

    await sleep(2000 + Math.random() * 2000);
  }

  await browser.close();
  console.log(`\n=== 완료: ${foundCount}개 발견, ${successCount}개 수정 성공 ===`);
  console.log(`누적 처리 기록: ${editedSet.size}개 (${EDITED_PATH})`);
})().catch((e) => { console.error(e); process.exit(1); });
