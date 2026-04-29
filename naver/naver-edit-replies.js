/**
 * "댓글 남겨주셔서 감사해요! 😊" 로 잘못 달린 답글을 찾아 수정
 *
 * 사용법: node naver-edit-replies.js [--dry-run] [--pages N]
 */

require("dotenv").config({ override: true });
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { patchSessionCookies, sleep, pick, pickTemplate, getNaverContext } = require("../core/utils");

const NAVER_STATE_PATH = path.join(__dirname, "../naverState.json");
const MY_BLOG_ID = "andn8740";
const COMMENT_LIST_URL = `https://admin.blog.naver.com/${MY_BLOG_ID}/userfilter/commentlist`;
const BAD_REPLY = "댓글 남겨주셔서 감사해요! 😊";

const isDryRun = process.argv.includes("--dry-run");
const pagesIdx = process.argv.indexOf("--pages");
const ADMIN_PAGES = pagesIdx !== -1 ? parseInt(process.argv[pagesIdx + 1]) || 99 : 99;

// 관리자 페이지에서 내(andn8740) 답글 중 BAD_REPLY 인 것 수집
async function collectBadReplies(page, maxPages) {
  await page.goto(COMMENT_LIST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  if (page.url().includes("nidlogin")) {
    console.log("세션 만료 - 로그인 후 엔터를 누르세요...");
    await new Promise((resolve) => { process.stdin.resume(); process.stdin.once("data", resolve); });
    await page.context().storageState({ path: NAVER_STATE_PATH });
    patchSessionCookies(NAVER_STATE_PATH);
    await page.goto(COMMENT_LIST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  const bad = [];
  let pageNum = 1;

  while (pageNum <= maxPages) {
    const frame = page.frame({ name: "papermain" });
    if (!frame) break;

    await frame.waitForSelector("#tableListById", { timeout: 8000 }).catch(() => {});

    const rows = await frame.evaluate(({ myId, badPrefix }) => {
      const result = [];
      document.querySelectorAll("#tableListById tr").forEach((tr) => {
        const keyInput = tr.querySelector("input[name='commentKey']");
        if (!keyInput) return;

        const commentKey = keyInput.value;
        const [prefix, writerId, commentNo] = commentKey.split("|");
        // 내 댓글만
        if (writerId !== myId) return;

        const logNo = prefix.split("_")[2];
        const commentText = (tr.querySelector("._replyRealContents") || {}).textContent?.trim() || "";

        // BAD_REPLY 인 것만
        if (!commentText.includes(badPrefix)) return;

        const postHref = (tr.querySelector("a.link") || {}).href || "";
        result.push({ logNo, commentNo, commentText, postHref });
      });
      return result;
    }, { myId: MY_BLOG_ID, badPrefix: BAD_REPLY.slice(0, 10) });

    bad.push(...rows);
    console.log(`  페이지 ${pageNum}: ${rows.length}개 수정 대상 발견`);

    const nextLink = frame.locator(`a:has-text("${pageNum + 1}")`).first();
    if (!(await nextLink.count())) break;
    await nextLink.click();
    await frame.waitForTimeout(1500);
    pageNum++;
  }

  return bad;
}

// 포스트에서 내 답글 찾아 수정
async function editReply(page, item) {
  const postUrl = item.postHref || `https://blog.naver.com/${MY_BLOG_ID}/${item.logNo}`;
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  const mainFrame = page.frame({ name: "mainFrame" });
  if (!mainFrame) { console.log("  mainFrame 없음"); return false; }

  await mainFrame.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await mainFrame.waitForTimeout(1500);

  // 댓글 버튼 클릭 (닫혀있으면 열기)
  const cmtBtn = mainFrame.locator(`#Comi${item.logNo}, ._cmtList`).first();
  if (await cmtBtn.count()) {
    await cmtBtn.click();
    await mainFrame.waitForTimeout(3000);
  }

  // 내 답글 li 찾기 (mine:true, commentNo 일치)
  const myReplyLi = mainFrame.locator(`li[data-info*="commentNo:'${item.commentNo}'"][data-info*="mine:true"]`).first();
  if (!(await myReplyLi.count())) {
    console.log(`  내 답글 요소 못 찾음 (commentNo: ${item.commentNo})`);
    return false;
  }

  // 부모 댓글 텍스트 가져오기 (답글이 속한 ul > li 의 부모 li)
  const parentText = await mainFrame.evaluate((commentNo) => {
    const myLi = document.querySelector(`li[data-info*="commentNo:'${commentNo}'"]`);
    if (!myLi) return "";
    // 부모 li = reply_area를 포함한 상위 u_cbox_comment
    const replyArea = myLi.closest(".u_cbox_reply_area");
    if (!replyArea) return "";
    const parentLi = replyArea.closest("li.u_cbox_comment");
    if (!parentLi) return "";
    return parentLi.querySelector(".u_cbox_contents")?.textContent?.trim() || "";
  }, item.commentNo);

  const newReply = parentText ? pickTemplate(parentText) : pickTemplate("");
  console.log(`  부모 댓글: "${parentText.slice(0, 50)}"`);
  console.log(`  새 답글: "${newReply}"`);

  if (isDryRun) return true;

  await myReplyLi.scrollIntoViewIfNeeded().catch(() => {});
  await mainFrame.waitForTimeout(500);

  // 옵션 열기 버튼 클릭 (수정 버튼 노출)
  const openBtn = myReplyLi.locator(".u_cbox_btn_open, [data-action='list#toggleButtons']").first();
  if (await openBtn.count()) {
    await openBtn.click({ force: true });
    await mainFrame.waitForTimeout(500);
  }

  // 수정 버튼
  const editBtn = myReplyLi.locator("[data-action='edit#show'], .u_cbox_btn_edit").first();
  if (!(await editBtn.count())) {
    console.log("  수정 버튼 못 찾음");
    return false;
  }

  await editBtn.click({ force: true });
  await mainFrame.waitForTimeout(1500);

  // 수정 입력창 (contenteditable)
  const editInput = myReplyLi.locator('[contenteditable="true"]').first();
  if (!(await editInput.count())) {
    console.log("  수정 입력창 못 찾음");
    return false;
  }

  // 기존 내용 지우고 새 내용 입력
  await editInput.click({ force: true });
  await mainFrame.evaluate(({ commentNo, text }) => {
    const myLi = document.querySelector(`li[data-info*="commentNo:'${commentNo}'"]`);
    if (!myLi) return;
    const el = myLi.querySelector('[contenteditable="true"]');
    if (!el) return;
    el.focus();
    el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, { commentNo: item.commentNo, text: newReply });
  await mainFrame.waitForTimeout(500);

  // 수정 완료 버튼
  const saveBtn = myReplyLi.locator("button[data-action='edit#request'], button.u_cbox_btn_upload, button:has-text('등록')").first();
  if (!(await saveBtn.count())) {
    console.log("  수정 완료 버튼 못 찾음");
    return false;
  }

  await saveBtn.click({ force: true });
  await mainFrame.waitForTimeout(2000);
  return true;
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await getNaverContext(browser, NAVER_STATE_PATH);
  const page = await context.newPage();

  console.log(`=== 수정 대상 수집 중 (최대 ${ADMIN_PAGES}페이지)... ===`);
  const badList = await collectBadReplies(page, ADMIN_PAGES);

  console.log(`\n수정 대상: ${badList.length}개\n`);
  if (badList.length === 0) {
    console.log("수정할 답글이 없습니다.");
    await browser.close();
    return;
  }

  if (isDryRun) {
    badList.forEach((b, i) => console.log(`[${i + 1}] commentNo:${b.commentNo} - ${b.postHref}`));
    await browser.close();
    return;
  }

  let successCount = 0;
  const failed = [];

  for (let i = 0; i < badList.length; i++) {
    const item = badList[i];
    console.log(`\n[${i + 1}/${badList.length}] commentNo: ${item.commentNo}`);

    const ok = await editReply(page, item);
    if (ok) {
      successCount++;
      console.log("  완료!");
    } else {
      failed.push(item);
    }
    await sleep(2000 + Math.random() * 2000);
  }

  // 실패 재시도
  if (failed.length > 0) {
    console.log(`\n=== 실패 ${failed.length}개 재시도... ===`);
    await sleep(3000);
    for (const item of failed) {
      console.log(`\n[재시도] commentNo: ${item.commentNo}`);
      const ok = await editReply(page, item);
      if (ok) { successCount++; console.log("  완료!"); }
      else console.log("  재시도 실패");
      await sleep(2000 + Math.random() * 2000);
    }
  }

  await browser.close();
  console.log(`\n=== 완료: ${successCount}/${badList.length}개 수정 성공 ===`);
})().catch((e) => { console.error(e); process.exit(1); });
