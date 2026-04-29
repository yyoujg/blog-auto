/**
 * 네이버 블로그 댓글에 AI 답댓글 자동 달기
 *
 * 사용법:
 *   node naver-reply-comments.js              # 최대 10개 답글
 *   node naver-reply-comments.js --max 5      # 최대 5개
 *   node naver-reply-comments.js --dry-run    # 목록만 출력
 *   node naver-reply-comments.js --pages 3    # 관리자 페이지 최대 3페이지 수집
 *   node naver-reply-comments.js --claude-only # API 스킵, Claude Code CLI로만 답변 생성
 */

require("dotenv").config({ override: true });
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { patchSessionCookies, sleep, getNaverContext, generateBlogComment, pickTemplate } = require("../core/utils");

const NAVER_STATE_PATH = path.join(__dirname, "../naverState.json");
const REPLIED_PATH = path.join(__dirname, "../replied-comments.json");
const COLLAB_PATH = path.join(__dirname, "../collab-proposals.json");
const MY_BLOG_ID = "andn8740";
const COMMENT_LIST_URL = `https://admin.blog.naver.com/${MY_BLOG_ID}/userfilter/commentlist`;

const isDryRun = process.argv.includes("--dry-run");
const isClaudeOnly = process.argv.includes("--claude-only");
const isAll = process.argv.includes("--all");
const maxIdx = process.argv.indexOf("--max");
const MAX_REPLIES = isAll ? Infinity : (maxIdx !== -1 ? parseInt(process.argv[maxIdx + 1]) || 10 : 10);
const pagesIdx = process.argv.indexOf("--pages");
const ADMIN_PAGES = isAll ? 9999 : (pagesIdx !== -1 ? parseInt(process.argv[pagesIdx + 1]) || 2 : 2);

// 협업 제안 패턴 - 감지 시 collab-proposals.json에 저장하고 답글 생략
const COLLAB_PATTERNS = [
  /협업/,
  /콜라보/,
  /광고.*문의|문의.*광고/,
  /협찬/,
  /ppl/i,
  /마케팅.*제안|제안.*마케팅/,
  /유료.*광고|광고.*유료/,
  /연락.*주세요|연락.*드려도/,
  /제안.*드리고|드리고.*제안/,
  /같이.*작업|작업.*같이/,
  // 글소문 등 체험단 캠페인 제안
  /geulsomun\.com/i,
  /쳄단/,
  /체험단.*신청|캠페인.*신청|신청.*주세요/,
  /캠페인 링크/,
  /중복신청가능/,
  // 뷰티샵/업체 후기 이벤트 제안
  /pf\.kakao\.com/i,
  /후기.*이벤트|이벤트.*후기/,
  /사업자 인증/,
];

function isCollab(text) {
  return COLLAB_PATTERNS.some((p) => p.test(text));
}

function loadCollab() {
  if (fs.existsSync(COLLAB_PATH)) {
    return JSON.parse(fs.readFileSync(COLLAB_PATH, "utf-8"));
  }
  return [];
}

function saveCollab(list) {
  fs.writeFileSync(COLLAB_PATH, JSON.stringify(list, null, 2), "utf-8");
}

// 스팸/광고 패턴 - 이 패턴에 해당하면 짧은 감사 답글로 처리
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
];

function isSpam(text) {
  return SPAM_PATTERNS.some((p) => p.test(text));
}

function loadReplied() {
  if (fs.existsSync(REPLIED_PATH)) {
    return new Set(JSON.parse(fs.readFileSync(REPLIED_PATH, "utf-8")));
  }
  return new Set();
}

function saveReplied(set) {
  fs.writeFileSync(REPLIED_PATH, JSON.stringify([...set], null, 2), "utf-8");
}

// 관리자 댓글 목록에서 댓글 정보 수집
async function collectComments(page, maxPages) {
  await page.goto(COMMENT_LIST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  if (page.url().includes("nidlogin")) {
    console.log("세션 만료 - 브라우저에서 로그인 후 엔터를 누르세요...");
    await new Promise((resolve) => { process.stdin.resume(); process.stdin.once("data", resolve); });
    await page.context().storageState({ path: NAVER_STATE_PATH });
    patchSessionCookies(NAVER_STATE_PATH);
    await page.goto(COMMENT_LIST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  const comments = [];
  let pageNum = 1;

  while (pageNum <= maxPages) {
    const frame = page.frame({ name: "papermain" });
    if (!frame) { console.log("papermain 프레임 없음"); break; }

    await frame.waitForSelector("#tableListById", { timeout: 8000 }).catch(() => {});

    const rows = await frame.evaluate((myBlogId) => {
      const result = [];
      document.querySelectorAll("#tableListById tr").forEach((tr) => {
        const keyInput = tr.querySelector("input[name='commentKey']");
        if (!keyInput) return;

        // commentKey 형식: "{blogNo}_{type}_{logNo}|{writerId}|{commentNo}"
        const commentKey = keyInput.value;
        const [prefix, writerId, commentNo] = commentKey.split("|");
        if (!writerId || !commentNo) return;

        const logNo = prefix.split("_")[2];
        if (!logNo) return;

        const nickname = (tr.querySelector("._writerNickname") || {}).textContent?.trim() || writerId;
        // 실제 댓글 내용 (hidden span에 전체 내용)
        const commentText = (tr.querySelector("._replyRealContents") || {}).textContent?.trim()
          || (tr.querySelector(".hand._replyContents") || {}).textContent?.trim()
          || "";
        const postHref = (tr.querySelector("a.link") || {}).href || "";
        const postTitle = (tr.querySelector("._titleContents") || {}).textContent?.trim() || "";

        // 내 답글은 제외
        if (writerId === myBlogId) return;

        result.push({ commentKey, logNo, writerId, commentNo, nickname, commentText, postHref, postTitle });
      });
      return result;
    }, MY_BLOG_ID);

    comments.push(...rows);
    console.log(`  관리자 페이지 ${pageNum}: ${rows.length}개 댓글`);

    const nextLink = frame.locator(`a:has-text("${pageNum + 1}")`).first();
    if (!(await nextLink.count())) break;
    await nextLink.click();
    await frame.waitForTimeout(1500);
    pageNum++;
  }

  return comments;
}

async function generateReply(nickname, commentText, postTitle) {
  if (isSpam(commentText)) return pickTemplate(commentText);

  const prompt = `네이버 블로그에 달린 댓글에 블로그 주인으로서 답글을 작성해주세요.

포스트 제목: ${postTitle}
댓글 내용: ${commentText}

규칙:
- 자연스럽고 친근한 말투 (~요, ~네요, ~겠어요)
- 댓글 내용에 구체적으로 반응
- 1~2문장
- 이모지 1개 이하
- 서이추/소통/광고 언급 금지
- 답글 텍스트만 출력 (다른 설명 없이)`;

  return generateBlogComment(prompt);
}

// 블로그 포스트에서 댓글에 답글 달기
async function replyToComment(page, comment, replyText) {
  const postUrl = comment.postHref || `https://blog.naver.com/${MY_BLOG_ID}/${comment.logNo}`;

  console.log(`  포스트 이동: ${postUrl}`);
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);

  // mainFrame 접근
  const mainFrame = page.frame({ name: "mainFrame" });
  if (!mainFrame) {
    console.log("  mainFrame 없음");
    return false;
  }

  await mainFrame.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await mainFrame.waitForTimeout(1500);

  // 댓글 섹션이 닫혀있으면 먼저 열기 (#Comi{logNo} 버튼 클릭)
  const cmtBtn = mainFrame.locator(`#Comi${comment.logNo}, ._cmtList`).first();
  if (await cmtBtn.count()) {
    console.log("  댓글 버튼 클릭...");
    await cmtBtn.click();
    await mainFrame.waitForTimeout(3000);
  }

  // data-info 속성으로 댓글 li 찾기
  const commentNo = comment.commentNo;
  const commentLi = mainFrame.locator(`li[data-info*="commentNo:'${commentNo}'"]`).first();

  if (!(await commentLi.count())) {
    console.log(`  댓글 요소 못 찾음 (commentNo: ${commentNo})`);
    return false;
  }

  await commentLi.scrollIntoViewIfNeeded().catch(() => {});
  await mainFrame.waitForTimeout(500);

  // 이미 답글이 달려있으면 스킵
  const existingReplies = await commentLi.locator(".u_cbox_reply_area li.u_cbox_comment").count();
  if (existingReplies > 0) {
    console.log(`  이미 답글 있음 (${existingReplies}개) - 스킵`);
    return "skip";
  }

  // 답글 버튼 클릭 (state:'off' = 아직 안 열린 상태)
  const replyBtn = commentLi.locator(`.u_cbox_btn_reply[data-ui-indexes*="state:'off'"]`).first();
  if (!(await replyBtn.count())) {
    console.log("  답글달기 버튼 못 찾음");
    return false;
  }

  await replyBtn.click();
  await mainFrame.waitForTimeout(2000);

  // 답글 입력창: ID 패턴 naverComment_{type}_{logNo}__reply_textarea_{commentNo}
  const replyInputId = `#naverComment_201_${comment.logNo}__reply_textarea_${commentNo}`;
  let replyInput = mainFrame.locator(replyInputId).first();

  if (!(await replyInput.count())) {
    // fallback: reply_area 안 contenteditable
    const replyArea = commentLi.locator(".u_cbox_reply_area").first();
    replyInput = replyArea.locator('[contenteditable="true"]').first();
  }

  if (!(await replyInput.count())) {
    console.log("  답글 입력창 못 찾음");
    return false;
  }

  // floating header가 가리므로 force click + evaluate로 텍스트 입력
  await replyInput.click({ force: true });
  await mainFrame.waitForTimeout(300);

  // contenteditable에 텍스트 입력 (React 상태 트리거 포함)
  await mainFrame.evaluate((args) => {
    const el = document.querySelector(args.selector);
    if (!el) return;
    el.focus();
    el.textContent = args.text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, { selector: replyInputId, text: replyText });
  await mainFrame.waitForTimeout(500);

  // 등록 버튼: reply_area 내부 또는 frame 전체 마지막
  const replyArea = commentLi.locator(".u_cbox_reply_area").first();
  let submitBtn = replyArea.locator("button.u_cbox_btn_upload").first();
  if (!(await submitBtn.count())) {
    submitBtn = mainFrame.locator("button.u_cbox_btn_upload[data-action='write#request']").last();
  }

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
    console.log("=== --claude-only: Claude Code CLI로만 답변 생성 ===");
  }

  const repliedSet = loadReplied();

  const browser = await chromium.launch({ headless: false });
  const context = await getNaverContext(browser, NAVER_STATE_PATH);
  const page = await context.newPage();

  console.log(`=== 댓글 목록 수집 중 (최대 ${ADMIN_PAGES}페이지)... ===`);
  const allComments = await collectComments(page, ADMIN_PAGES);

  // 필터: 이미 답글 달았거나 내 댓글 제외
  const toReply = allComments
    .filter((c) => !repliedSet.has(c.commentNo))
    .slice(0, MAX_REPLIES);

  // 스팸/협업 여부 표시
  toReply.forEach((c) => {
    c.isSpam = isSpam(c.commentText);
    c.isCollab = isCollab(c.commentText);
  });

  // 협업 제안 댓글 별도 저장
  const collabComments = toReply.filter((c) => c.isCollab);
  if (collabComments.length > 0) {
    const existing = loadCollab();
    const existingKeys = new Set(existing.map((c) => c.commentNo));
    const newCollabs = collabComments
      .filter((c) => !existingKeys.has(c.commentNo))
      .map((c) => ({
        commentNo: c.commentNo,
        nickname: c.nickname,
        writerId: c.writerId,
        commentText: c.commentText,
        postTitle: c.postTitle,
        postHref: c.postHref,
        savedAt: new Date().toISOString(),
      }));
    if (newCollabs.length > 0) {
      saveCollab([...existing, ...newCollabs]);
      console.log(`\n[협업 제안] ${newCollabs.length}개 신규 저장 → ${COLLAB_PATH}`);
      newCollabs.forEach((c) => console.log(`  - ${c.nickname} (${c.writerId}): "${c.commentText.slice(0, 60)}"`));
    }
  }

  // 협업 제안은 answered 처리 (자동 답글 제외)
  collabComments.forEach((c) => repliedSet.add(c.commentNo));
  if (collabComments.length > 0) saveReplied(repliedSet);

  const toReplyFiltered = toReply.filter((c) => !c.isCollab);

  console.log(`\n총 ${allComments.length}개 수집 / 미답글 대상: ${toReplyFiltered.length}개 (협업 제안 ${collabComments.length}개 제외)\n`);

  if (isDryRun) {
    toReplyFiltered.forEach((c, i) => {
      const spamMark = c.isSpam ? " [스팸]" : "";
      console.log(`[${i + 1}] ${c.nickname} (${c.writerId})${spamMark}`);
      console.log(`     "${c.commentText.slice(0, 70)}"`);
      console.log(`     ${c.postHref}`);
    });
    if (collabComments.length > 0) {
      console.log(`\n=== 협업 제안 (${collabComments.length}개, 자동 답글 제외) ===`);
      collabComments.forEach((c, i) => {
        console.log(`[${i + 1}] ${c.nickname} (${c.writerId})`);
        console.log(`     "${c.commentText.slice(0, 70)}"`);
      });
    }
    await browser.close();
    return;
  }

  let successCount = 0;
  const failed = [];

  for (const comment of toReplyFiltered) {
    const spamMark = comment.isSpam ? " [스팸]" : "";
    console.log(`\n[${successCount + 1}/${toReplyFiltered.length}] ${comment.nickname}${spamMark}`);
    console.log(`  댓글: "${comment.commentText.slice(0, 60)}"`);

    const replyText = await generateReply(comment.nickname, comment.commentText, comment.postTitle);
    if (!replyText) {
      console.log("  AI 실패 - 스킵 (다음 실행에서 재시도)");
      await sleep(2000 + Math.random() * 2000);
      continue;
    }
    console.log(`  답글: "${replyText}"`);

    const result = await replyToComment(page, comment, replyText);

    if (result === "skip") {
      repliedSet.add(comment.commentNo);
      saveReplied(repliedSet);
    } else if (result === true) {
      repliedSet.add(comment.commentNo);
      saveReplied(repliedSet);
      successCount++;
      console.log("  완료!");
    } else {
      console.log("  실패 - 재시도 목록에 추가");
      failed.push(comment);
    }

    await sleep(2000 + Math.random() * 2000);
  }

  // 실패한 댓글 재시도 (1회)
  if (failed.length > 0) {
    console.log(`\n=== 실패 ${failed.length}개 재시도 중... ===`);
    await sleep(3000);

    for (const comment of failed) {
      console.log(`\n[재시도] ${comment.nickname}`);
      console.log(`  댓글: "${comment.commentText.slice(0, 60)}"`);

      const replyText = await generateReply(comment.nickname, comment.commentText, comment.postTitle);
      if (!replyText) { console.log("  AI 실패 - 스킵"); continue; }
      console.log(`  답글: "${replyText}"`);

      const result = await replyToComment(page, comment, replyText);

      if (result === "skip") {
        repliedSet.add(comment.commentNo);
        saveReplied(repliedSet);
      } else if (result === true) {
        repliedSet.add(comment.commentNo);
        saveReplied(repliedSet);
        successCount++;
        console.log("  완료!");
      } else {
        console.log("  재시도 실패 - 다음 실행에서 재시도됩니다");
      }

      await sleep(2000 + Math.random() * 2000);
    }
  }

  await browser.close();
  console.log(`\n=== 완료: ${successCount}/${toReplyFiltered.length}개 답글 달기 성공 ===`);
  console.log(`누적 답글 기록: ${repliedSet.size}개 (${REPLIED_PATH})`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
