// revu.net 이웃 커뮤니티 최근 20개 게시글 중 내 글 있으면 exit(0), 없으면 exit(1)
const { chromium } = require("playwright");
const { REVU_USER_ID } = require("../core/config");

const SESSION_FILE = "storageState-revu.json";
const LIST_URL = "https://www.revu.net/community/neighbor";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();

  // API 응답 가로채기
  let hasMyPost = false;
  page.on("response", async (res) => {
    if (res.url().includes("neighbor-posts") && res.status() === 200) {
      try {
        const json = await res.json();
        const items = json.items || json.posts || json.data || [];
        hasMyPost ||= items.some(
          (item) => item.user?.id === REVU_USER_ID
        );
      } catch (_) {}
    }
  });

  await page.goto(LIST_URL, { waitUntil: "networkidle", timeout: 30000 });
  await browser.close();

  console.log(hasMyPost ? "내 글 있음" : "내 글 없음");
  process.exit(hasMyPost ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(0); // 오류 시 안전하게 "있음"으로 처리 (게시 방지)
});
