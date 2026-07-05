/**
 * 내 블로그에 댓글 단 사람들(이웃인 경우)을 '답방' 이웃그룹으로 이동
 *
 * 사용법:
 *   node naver/naver-set-commenter-group.js              # 실제 이동
 *   node naver/naver-set-commenter-group.js --dry-run    # 미리보기(이동 안 함)
 */

require("dotenv").config({ override: true });
const { chromium } = require("playwright");
const path = require("path");
const { getNaverContext } = require("../core/utils");
const { collectComments, MY_BLOG_ID } = require("./naver-reply-comments");

const NAVER_STATE_PATH = path.join(__dirname, "../naverState.json");
const BUDDY_URL = `https://admin.blog.naver.com/${MY_BLOG_ID}/buddy/manage`;
const DAPBANG_GROUP_ID = "5"; // 이웃그룹 '답방'
const DAPBANG_LABEL = "답방";

const isDryRun = process.argv.includes("--dry-run");
const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1]) || Infinity : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 현재 buddy 목록 페이지의 데이터 행 읽기
async function readBuddyRows(frame) {
  return frame.evaluate(() => {
    const rows = [];
    document.querySelectorAll("table tr").forEach((tr) => {
      const cb = tr.querySelector('input[name="buddyBlogNo"]');
      const link = tr.querySelector('a[href*="blog.naver.com"]');
      if (!cb || !link) return;
      const m = (link.getAttribute("href") || "").match(/blog\.naver\.com\/([^/?#"']+)/);
      if (!m) return;
      rows.push({
        blogId: m[1],
        buddyBlogNo: cb.value,
        group: cb.getAttribute("alt") || "",
      });
    });
    return rows;
  });
}

async function goToPage(frame, n) {
  await frame.evaluate((p) => {
    if (typeof goPage === "function") goPage(p);
  }, n);
  await sleep(2200);
}

// 모든 페이지 순회하며 blogId -> {buddyBlogNo, group, page} 맵 구성
async function readAllBuddies(frame) {
  const map = new Map();
  let p = 1;
  let prevFirst = null;
  while (p <= 80) {
    if (p > 1) await goToPage(frame, p);
    const rows = await readBuddyRows(frame);
    if (rows.length === 0) break;
    if (rows[0].buddyBlogNo === prevFirst) break; // 더 이상 진행 안 됨(마지막 페이지)
    prevFirst = rows[0].buddyBlogNo;
    for (const r of rows) {
      if (!map.has(r.blogId)) map.set(r.blogId, { ...r, page: p });
    }
    console.log(`  이웃 페이지 ${p}: ${rows.length}명 (누적 ${map.size}명)`);
    p++;
  }
  return map;
}

// 현재 페이지에서 주어진 buddyBlogNo 들을 체크하고 '답방'으로 이동
async function moveOnPage(frame, page, buddyBlogNos) {
  // 1) 대상 체크박스 체크
  const checked = await frame.evaluate((nos) => {
    let c = 0;
    document.querySelectorAll('input[name="buddyBlogNo"]').forEach((cb) => {
      if (nos.includes(cb.value)) {
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        c++;
      }
    });
    return c;
  }, buddyBlogNos);

  if (checked === 0) return 0;

  // 2) '그룹이동' 클릭 → #dropdown.groupselectlayer 레이어가 뜸
  await frame.locator("button.btn_movegroup").first().click();

  // 3) 레이어에서 '답방' 그룹 링크 클릭 (confirm/alert 는 page.on('dialog') 가 수락)
  const dapbang = frame.locator(`#dropdown.groupselectlayer a.group`, { hasText: DAPBANG_LABEL }).first();
  await dapbang.waitFor({ state: "visible", timeout: 5000 });
  await dapbang.click();
  await sleep(3000);
  return checked;
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await getNaverContext(browser, NAVER_STATE_PATH);
  const page = await context.newPage();

  // 다이얼로그(이동 확인/완료 알림) 자동 수락
  page.on("dialog", async (d) => {
    console.log(`  [dialog] ${d.message().slice(0, 50)} → 확인`);
    await d.accept().catch(() => {});
  });

  // 1) 댓글 단 사람 writerId 수집 (관리자 댓글 페이지 전체 스캔)
  console.log("=== 댓글 단 사람 수집 중 (전체 페이지)... ===");
  const comments = await collectComments(page, 9999);
  const commenterIds = new Set(
    comments.map((c) => c.writerId).filter((w) => w && w !== MY_BLOG_ID)
  );
  console.log(`댓글 단 사람: ${commenterIds.size}명 (고유 ID)\n`);

  // 2) 내 이웃 전체 읽기
  console.log("=== 내 이웃 목록 읽는 중... ===");
  await page.goto(BUDDY_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(4000);
  let frame = page.frame({ name: "papermain" });
  if (!frame) {
    console.log("papermain 프레임 없음 - 세션 만료 가능. 종료.");
    await browser.close();
    return;
  }
  const buddyMap = await readAllBuddies(frame);
  console.log(`내 이웃: ${buddyMap.size}명\n`);

  // 3) 분류
  const toMove = []; // 이웃이고 답방 아님
  const already = []; // 이미 답방
  const nonNeighbor = []; // 댓글 달았지만 이웃 아님
  for (const id of commenterIds) {
    const b = buddyMap.get(id);
    if (!b) {
      nonNeighbor.push(id);
    } else if (b.group === DAPBANG_GROUP_ID) {
      already.push(id);
    } else {
      toMove.push(b);
    }
  }

  console.log(`=== 분류 결과 ===`);
  console.log(`이동 대상(이웃 & 답방아님): ${toMove.length}명`);
  console.log(`이미 답방: ${already.length}명`);
  console.log(`이웃 아님(건너뜀): ${nonNeighbor.length}명`);

  if (isDryRun) {
    console.log(`\n[미리보기] 이동 대상:`);
    toMove.forEach((b, i) => console.log(`  ${i + 1}. ${b.blogId} (현재그룹 ${b.group}, ${b.page}p)`));
    console.log(`\n[미리보기] 이웃 아님 - 그룹 지정 불가:`);
    nonNeighbor.forEach((id, i) => console.log(`  ${i + 1}. ${id}`));
    await browser.close();
    return;
  }

  if (toMove.length === 0) {
    console.log("\n이동할 대상 없음.");
    printNonNeighbor(nonNeighbor);
    await browser.close();
    return;
  }

  // 4) 이동: 이동하면 목록이 1페이지로 리로드되므로, 매 이동 후 1페이지부터 재스캔.
  //    이미 옮긴 사람은 그룹이 5가 되어 자동으로 건너뛰어진다.
  const moveList = LIMIT === Infinity ? toMove : toMove.slice(0, LIMIT);
  if (moveList.length < toMove.length) {
    console.log(`\n[--limit ${LIMIT}] ${moveList.length}명만 이동(테스트)`);
  }
  const targetIds = new Set(moveList.map((b) => b.blogId));

  // 그룹이동 직후의 AJAX 리로드 상태에서는 goPage() 가 불안정하므로,
  // 매 이동마다 buddy 페이지를 새로( page.goto ) 로드한 뒤 1페이지부터 스캔한다.
  let moved = 0;
  let safety = 0;
  while (targetIds.size > 0 && safety++ < 60) {
    await page.goto(BUDDY_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3500);
    frame = page.frame({ name: "papermain" });
    if (!frame) break;

    // 첫 hit 페이지 찾기
    let hits = null;
    let p = 1;
    let guardFirst = null;
    while (p <= 80) {
      if (p > 1) await goToPage(frame, p);
      const rows = await readBuddyRows(frame);
      if (rows.length === 0) break;
      if (rows[0].buddyBlogNo === guardFirst) break; // 마지막 페이지
      guardFirst = rows[0].buddyBlogNo;
      const h = rows.filter((r) => targetIds.has(r.blogId) && r.group !== DAPBANG_GROUP_ID);
      if (h.length) { hits = { p, list: h }; break; }
      p++;
    }
    if (!hits) break; // 남은 대상 없음

    console.log(`\n=== ${hits.p}페이지: ${hits.list.length}명 이동 (${hits.list.map((h) => h.blogId).join(", ")}) ===`);
    const n = await moveOnPage(frame, page, hits.list.map((h) => h.buddyBlogNo));
    hits.list.forEach((h) => targetIds.delete(h.blogId));
    moved += n;
    console.log(`  → ${n}명 '답방'으로 이동`);
  }

  if (targetIds.size > 0) {
    console.log(`\n[경고] 못 옮긴 ${targetIds.size}명: ${[...targetIds].join(", ")}`);
  }
  console.log(`\n=== 완료: 총 ${moved}명 '답방' 그룹으로 이동 ===`);
  printNonNeighbor(nonNeighbor);

  await context.storageState({ path: NAVER_STATE_PATH });
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

function printNonNeighbor(ids) {
  if (!ids.length) return;
  console.log(`\n=== 이웃이 아니라 그룹 지정 못 한 댓글러 ${ids.length}명 ===`);
  ids.forEach((id, i) => console.log(`  ${i + 1}. https://blog.naver.com/${id}`));
}
