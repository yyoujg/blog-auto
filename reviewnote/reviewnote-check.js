// reviewnote 이웃 커뮤니티 첫 페이지에 내 글 있으면 exit(0), 없으면 exit(1)
const { chromium } = require("playwright");
const { myAuthorName } = require("../core/config");

const SESSION_FILE = "storageState.json";
const LIST_URL = "https://www.reviewnote.co.kr/communities/friend";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();

  let hasMyPost = false;

  // API 응답 가로채기
  page.on("response", async (res) => {
    if (res.url().includes("/api/v2/communities") && res.status() === 200) {
      try {
        const json = await res.json();
        const items = json.objects || [];
        if (items.some((item) => item.user?.username === myAuthorName)) {
          hasMyPost = true;
        }
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
