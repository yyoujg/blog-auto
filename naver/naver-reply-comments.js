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
const DRAFTS_PATH = path.join(__dirname, "../reply-drafts.json");
const COLLAB_PATH = path.join(__dirname, "../collab-proposals.json");
const MY_BLOG_ID = "andn8740";
const MY_NICKNAME = "쑥쑥아리"; // 블로그 주인(본인) 닉네임
const MY_ALIASES = ["쑥쑥아리", "아리"]; // 댓글에서 이 이름들로 부르면 본인을 칭하는 것
const COMMENT_LIST_URL = `https://admin.blog.naver.com/${MY_BLOG_ID}/userfilter/commentlist`;

const isDryRun = process.argv.includes("--dry-run");
const isClaudeOnly = process.argv.includes("--claude-only");
const isAll = process.argv.includes("--all");
const isFixReplies = process.argv.includes("--fix-replies");
const isDraft = process.argv.includes("--draft");
const isPostDrafts = process.argv.includes("--post-drafts");
const isAudit = process.argv.includes("--audit");
const ignoreLog = process.argv.includes("--ignore-log");
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

// commentNo -> nickname Map (중복 체크 + 닉네임 기록)
function loadReplied() {
  if (fs.existsSync(REPLIED_PATH)) {
    const data = JSON.parse(fs.readFileSync(REPLIED_PATH, "utf-8"));
    const map = new Map();
    for (const item of data) {
      if (typeof item === "string") map.set(item, null); // 구버전: ID만
      else if (item && item.commentNo) map.set(item.commentNo, item.nickname || null);
    }
    return map;
  }
  return new Map();
}

function saveReplied(map) {
  const arr = [...map].map(([commentNo, nickname]) => ({ commentNo, nickname }));
  fs.writeFileSync(REPLIED_PATH, JSON.stringify(arr, null, 2), "utf-8");
}

function loadDrafts() {
  if (fs.existsSync(DRAFTS_PATH)) return JSON.parse(fs.readFileSync(DRAFTS_PATH, "utf-8"));
  return [];
}

function saveDrafts(arr) {
  fs.writeFileSync(DRAFTS_PATH, JSON.stringify(arr, null, 2), "utf-8");
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

// 답글이 본인(블로그 주인) 닉네임을 제3자처럼 언급하면 잘못된 답글
function mentionsSelf(text) {
  if (text.includes(MY_NICKNAME)) return true;
  if (new RegExp(`^\\s*${MY_NICKNAME.slice(0, 2)}[\\s,]`).test(text)) return true;
  return MY_ALIASES.some((a) => new RegExp(`${a}(님|씨|도|는|가|을|를|야|랑|한테|에게|의)`).test(text));
}

async function generateReply(nickname, commentText, postTitle) {
  if (isSpam(commentText)) return pickTemplate(commentText);

  const aliasList = MY_ALIASES.map((n) => `"${n}"`).join(", ");
  const prompt = `네이버 블로그에 달린 댓글에 블로그 주인으로서 답글을 작성해주세요.

내 닉네임(블로그 주인 본인): ${MY_NICKNAME}
포스트 제목: ${postTitle}
댓글 내용: ${commentText}

규칙:
- 나는 블로그 주인 본인이며 닉네임은 "${MY_NICKNAME}"입니다. 댓글에서 ${aliasList} 또는 거기에 "님"을 붙여 부르면(예: ${MY_ALIASES.map((n) => `"${n}님"`).join(", ")}) 그건 모두 나(본인)를 부르는 것입니다.
- 따라서 내 닉네임/별칭을 제3자처럼 칭찬하거나 언급하지 말 것. 칭찬을 받았으면 본인이 받은 칭찬으로 자연스럽게 감사 인사할 것.
- 자연스럽고 친근한 말투 (~요, ~네요, ~겠어요)
- 댓글 내용에 구체적으로 반응
- 1~2문장
- 이모지 1개 이하
- 서이추/소통/광고 언급 금지
- 답글 텍스트만 출력 (다른 설명 없이)`;

  const reply = await generateBlogComment(prompt);
  if (reply && mentionsSelf(reply)) {
    console.log(`  본인 닉네임 언급 답글 거부: "${reply}"`);
    return null;
  }
  return reply;
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

  // data-info 속성으로 댓글 li 찾기 (lazy-load 대비 최대 8초 대기)
  // ponytail: 타이밍만 처리. 댓글 페이지네이션/삭제/중첩프레임은 재발 시 추가.
  const commentNo = comment.commentNo;
  const selector = `li[data-info*="commentNo:'${commentNo}'"]`;
  try {
    await mainFrame.waitForSelector(selector, { timeout: 8000 });
  } catch {
    console.log(`  댓글 요소 못 찾음 (commentNo: ${commentNo})`);
    return false;
  }
  const commentLi = mainFrame.locator(selector).first();

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

// ponytail: 일회성 교정 겸 재발 대비 범용 수정 경로. 대상은 데이터로 분리.
// 이미 게시된 답글을 텍스트로 특정해 in-place 수정. matchText=현재 문구 고유 조각.
const FIX_TARGETS = [
  { postUrl: "https://blog.naver.com/andn8740/224329953142", matchText: "쑥쑥 우설", newText: "우설이랑 와규 무한리필이라 진짜 든든하게 먹고 왔어요, 일본 감성까지 있어서 저도 넘 만족했답니다><" },
  { postUrl: "https://blog.naver.com/andn8740/224315662977", matchText: "쿼리 조회 신청", newText: "대출 조회 신청부터 실행까지는 저는 서류 준비 포함해서 2주 정도 걸렸어요! 은행 심사가 빠르면 더 단축될 수 있어요 😊" },
  { postUrl: "https://blog.naver.com/andn8740/224315662977", matchText: "답글 실행부터 전입신고", newText: "포스팅에 순서대로 정리해두었는데 어느 부분이 궁금하신지 편하게 여쭤봐 주세요 😊" },
  { postUrl: "https://blog.naver.com/andn8740/224329953142", matchText: "답글 잘 봐주셔서 감사해요", newText: "포스팅 예쁘게 봐주셔서 감사해요, 우설은 부드럽고 쫄깃해서 꼭 한번 드셔보세요! 새로운 한 주 화이팅이에요 😊" },
];

// 게시된 내 답글을 찾아 수정. 성공 시 true.
async function editReply(page, target) {
  const { postUrl, matchText, newText } = target;
  const logNo = postUrl.split("/").pop();
  console.log(`\n[수정] ${postUrl}\n  대상: "${matchText}"`);

  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  const mf = page.frame({ name: "mainFrame" });
  if (!mf) { console.log("  mainFrame 없음"); return false; }
  await mf.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await mf.waitForTimeout(1500);

  const cmtBtn = mf.locator(`#Comi${logNo}, ._cmtList`).first();
  if (await cmtBtn.count()) { await cmtBtn.click(); await mf.waitForTimeout(3000); }

  // 텍스트로 대상 답글 li 특정
  const idx = await mf.evaluate((m) => {
    const lis = [...document.querySelectorAll(".u_cbox_reply_area li.u_cbox_comment")];
    return lis.findIndex((li) => ((li.querySelector(".u_cbox_contents") || {}).textContent || "").includes(m));
  }, matchText);
  if (idx < 0) { console.log("  대상 답글 못 찾음"); return false; }

  const li = mf.locator(".u_cbox_reply_area li.u_cbox_comment").nth(idx);
  await li.scrollIntoViewIfNeeded().catch(() => {});
  await mf.waitForTimeout(500);

  // 옵션 열기 → 수정 (수정 버튼은 옵션 토글 뒤에 숨어있음)
  const openBtn = li.locator("a.u_cbox_btn_open").first();
  if (await openBtn.count()) { await openBtn.click({ force: true }); await mf.waitForTimeout(800); }
  const editBtn = li.locator("a.u_cbox_btn_edit").first();
  if (!(await editBtn.count())) { console.log("  수정 버튼 못 찾음"); return false; }
  await editBtn.click({ force: true });
  await mf.waitForTimeout(1500);

  // 편집 입력창(contenteditable)에 새 문구 주입
  const editId = `naverComment_201_${logNo}__edit_textarea`;
  const set = await mf.evaluate((args) => {
    const el = document.getElementById(args.id);
    if (!el) return false;
    el.focus();
    el.textContent = args.text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { id: editId, text: newText });
  if (!set) { console.log("  편집 입력창 못 찾음"); return false; }
  await mf.waitForTimeout(500);

  // 등록 (edit#request) - 편집창은 한 번에 하나만 열리므로 프레임 전역에서 특정
  const saveBtn = mf.locator(".u_cbox_btn_upload[data-action='edit#request']").first();
  if (!(await saveBtn.count())) { console.log("  등록 버튼 못 찾음"); return false; }
  await saveBtn.click({ force: true });
  await mf.waitForTimeout(2500);

  // 반영 확인
  const ok = await mf.evaluate((m) =>
    [...document.querySelectorAll(".u_cbox_reply_area li.u_cbox_comment")]
      .some((li) => ((li.querySelector(".u_cbox_contents") || {}).textContent || "").includes(m)),
    newText.slice(0, 12));
  console.log(ok ? "  완료!" : "  저장 후 반영 확인 실패");
  return ok;
}

// 한 포스트의 대상 댓글들이 실제로 본인 답글을 가지고 있는지 검사(읽기 전용)
async function auditPost(page, logNo, postHref, items) {
  await page.goto(postHref, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  const mf = page.frame({ name: "mainFrame" });
  if (!mf) return items.map((t) => ({ ...t, found: false }));
  await mf.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await mf.waitForTimeout(1500);

  // 댓글이 아직 없으면 열기 (이미 로드돼 있으면 토글로 닫지 않도록)
  if (!(await mf.locator("li.u_cbox_comment[data-info]").count())) {
    const cmtBtn = mf.locator(`#Comi${logNo}`).first();
    if (await cmtBtn.count()) await cmtBtn.click();
  }
  await mf.waitForSelector("li.u_cbox_comment[data-info]", { timeout: 8000 }).catch(() => {});
  await mf.waitForTimeout(1500);

  const res = await mf.evaluate((args) => {
    const { targets, myNick } = args;
    const byNo = new Map();
    document.querySelectorAll("li.u_cbox_comment[data-info]").forEach((li) => {
      const m = (li.getAttribute("data-info") || "").match(/commentNo:'(\d+)'/);
      if (m) byNo.set(m[1], li);
    });
    return targets.map((t) => {
      const li = byNo.get(t.commentNo);
      if (!li) return { commentNo: t.commentNo, found: false };
      const replies = [...li.querySelectorAll(".u_cbox_reply_area li.u_cbox_comment")];
      const ownerReply = replies.some((r) => ((r.querySelector(".u_cbox_name") || {}).textContent || "").trim() === myNick);
      return { commentNo: t.commentNo, found: true, replyCount: replies.length, ownerReply };
    });
  }, { targets: items, myNick: MY_NICKNAME });
  return res.map((r, i) => ({ ...items[i], ...r }));
}

module.exports = { collectComments, MY_BLOG_ID, COMMENT_LIST_URL, NAVER_STATE_PATH };

if (require.main === module)
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

  if (isFixReplies) {
    console.log(`=== 게시된 답글 수정 모드: ${FIX_TARGETS.length}건 ===`);
    let ok = 0;
    for (const t of FIX_TARGETS) {
      if (await editReply(page, t)) ok++;
      await sleep(2000 + Math.random() * 2000);
    }
    await browser.close();
    console.log(`\n=== 수정 완료: ${ok}/${FIX_TARGETS.length}건 ===`);
    return;
  }

  // 답글 누락 감사: 로그와 무관하게 실제 사이트에서 본인 답글 유무 확인
  if (isAudit) {
    console.log("=== 답글 누락 감사: 전체 댓글 수집 중... ===");
    const all = await collectComments(page, 9999);
    const byPost = new Map();
    for (const c of all) {
      if (!byPost.has(c.logNo)) byPost.set(c.logNo, { postHref: c.postHref, items: [] });
      byPost.get(c.logNo).items.push(c);
    }
    const checked = [];
    for (const [logNo, { postHref, items }] of byPost) {
      process.stdout.write(`  ${logNo} (${items.length}건)... `);
      checked.push(...await auditPost(page, logNo, postHref, items));
      console.log("확인");
    }
    await browser.close();

    const missing = checked.filter((c) => c.found && !c.ownerReply);
    const notFound = checked.filter((c) => !c.found);
    console.log(`\n===== 답글 안 달린 댓글: ${missing.length}건 =====`);
    missing.forEach((c) => {
      console.log(`- ${c.nickname} | 로그:${repliedSet.has(c.commentNo) ? "있음(오탐)" : "없음"} | 답글수:${c.replyCount}`);
      console.log(`    "${(c.commentText || "").slice(0, 45)}"`);
      console.log(`    ${c.postHref} [${c.commentNo}]`);
    });
    if (notFound.length) {
      console.log(`\n===== 못 찾음(삭제/페이지네이션 가능): ${notFound.length}건 =====`);
      notFound.forEach((c) => console.log(`- ${c.nickname} | ${c.postHref} [${c.commentNo}]`));
    }
    console.log(`\n요약: 총 ${checked.length} / 답글있음 ${checked.filter((c) => c.ownerReply).length} / 미답글 ${missing.length} / 미확인 ${notFound.length}`);
    return;
  }

  // 컨펌된 초안만 게시
  if (isPostDrafts) {
    const drafts = loadDrafts();
    const toPost = drafts.filter((d) => d.confirmed === true && d.reply);
    const held = drafts.length - toPost.length;
    console.log(`=== 초안 게시 모드: 컨펌 ${toPost.length}건 / 미컨펌·미완성 ${held}건 ===`);

    let posted = 0, fail = 0;
    for (const d of toPost) {
      console.log(`\n[${d.nickname}] "${d.reply.slice(0, 40)}"`);
      const result = await replyToComment(page, d, d.reply);
      if (result === true || result === "skip") {
        repliedSet.set(d.commentNo, d.nickname);
        saveReplied(repliedSet);
        saveDrafts(loadDrafts().filter((x) => x.commentNo !== d.commentNo));
        posted++;
        if (result === true) console.log("  완료!");
      } else {
        console.log("  실패 - 초안 파일에 남김");
        fail++;
      }
      await sleep(2000 + Math.random() * 2000);
    }
    await browser.close();
    console.log(`\n=== 게시 ${posted} / 실패 ${fail} / 미컨펌·미완성 ${held} ===`);
    return;
  }

  console.log(`=== 댓글 목록 수집 중 (최대 ${ADMIN_PAGES}페이지)... ===`);
  const allComments = await collectComments(page, ADMIN_PAGES);

  // 필터: 이미 답글 달았거나 내 댓글 제외
  const toReply = allComments
    .filter((c) => ignoreLog || !repliedSet.has(c.commentNo))
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
  collabComments.forEach((c) => repliedSet.set(c.commentNo, c.nickname));
  if (collabComments.length > 0) saveReplied(repliedSet);

  const toReplyFiltered = toReply.filter((c) => !c.isCollab);

  console.log(`\n총 ${allComments.length}개 수집 / 미답글 대상: ${toReplyFiltered.length}개 (협업 제안 ${collabComments.length}개 제외)\n`);

  // 초안 생성 모드: 대상 전부를 reply-drafts.json에 저장(confirmed:false). 자동 게시/제외 없음.
  if (isDraft) {
    await browser.close(); // 생성은 API/CLI라 브라우저 불필요
    const drafts = loadDrafts();
    const existingNos = new Set(drafts.map((d) => d.commentNo));
    let added = 0, noReply = 0;
    for (const c of toReplyFiltered) {
      if (existingNos.has(c.commentNo)) continue; // 기존 초안(사용자 편집) 보존
      const reply = await generateReply(c.nickname, c.commentText, c.postTitle);
      if (!reply) noReply++;
      drafts.push({
        commentNo: c.commentNo, logNo: c.logNo, writerId: c.writerId, nickname: c.nickname,
        commentText: c.commentText, postTitle: c.postTitle, postHref: c.postHref,
        reply: reply || "", confirmed: false,
        note: reply ? "" : "AI 생성 실패/본인언급 - 직접 작성",
      });
      added++;
      saveDrafts(drafts);
      await sleep(1000 + Math.random() * 1000);
    }
    saveDrafts(drafts); // 신규 0건이어도 파일은 항상 생성/갱신
    console.log(`\n=== 초안 저장: 신규 ${added}건(문구없음 ${noReply}건) / 총 ${drafts.length}건 → ${DRAFTS_PATH} ===`);
    if (toReplyFiltered.length === 0) {
      console.log(`새로 초안 낼 미답글 댓글이 없습니다 (수집된 ${allComments.length}개 모두 답글 기록에 있음).`);
      console.log(`이미 답글 단 댓글까지 다시 검토하려면: node naver/naver-reply-comments.js --draft --all --ignore-log`);
    } else {
      console.log(`파일에서 문구 확인/수정 후 올릴 것만 "confirmed": true 로 바꾸고 'npm run reply-post' 실행`);
    }
    return;
  }

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
      repliedSet.set(comment.commentNo, comment.nickname);
      saveReplied(repliedSet);
    } else if (result === true) {
      repliedSet.set(comment.commentNo, comment.nickname);
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
        repliedSet.set(comment.commentNo, comment.nickname);
        saveReplied(repliedSet);
      } else if (result === true) {
        repliedSet.set(comment.commentNo, comment.nickname);
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
