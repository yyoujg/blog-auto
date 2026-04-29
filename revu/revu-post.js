const { chromium } = require("playwright");
const fs = require("fs");
const { pickFirstVisibleLocator, debugDump } = require("../core/utils");

const WRITE_URL = "https://www.revu.net/community/neighbor/write";
const SESSION_FILE = "storageState-revu.json";

(async () => {
  const [,, title, content] = process.argv;

  if (!title || !content) {
    console.error('Usage: node post-revu.js "제목" "본문"');
    process.exit(1);
  }

  if (!fs.existsSync(SESSION_FILE)) {
    console.error(`[revu.net] 세션 파일(${SESSION_FILE})이 없습니다. 먼저 "node save-session-revu.js"를 실행하세요.`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();

  await page.goto(WRITE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // 리다이렉트 감지
  const currentUrl = page.url();
  if (!currentUrl.includes("/community/neighbor/write")) {
    console.error(`[revu.net] 글쓰기 페이지로 이동 실패. 현재 URL: ${currentUrl}`);
    console.error("  → 세션이 만료되었을 수 있습니다. 'node save-session-revu.js'를 다시 실행하세요.");
    await browser.close();
    process.exit(1);
  }

  // 1) 제목 입력
  const titleLocator = await pickFirstVisibleLocator(page, [
    page.locator('input[name="title"]'),
    page.locator('input[placeholder*="제목"]'),
    page.locator('input[type="text"]').first(),
    page.getByRole("textbox", { name: /제목/ }),
  ]);
  if (!titleLocator) {
    console.error("[revu.net] 제목 입력칸을 찾지 못했습니다.");
    await debugDump(page);
    await browser.close();
    process.exit(1);
  }
  await titleLocator.fill(title);

  // 2) 본문 입력
  const bodyLocator = await pickFirstVisibleLocator(page, [
    page.locator("div.ProseMirror.toastui-editor-contents"),
    page.locator("div.ProseMirror"),
    page.locator('[contenteditable="true"]'),
    page.locator('textarea[name="content"]'),
    page.locator("textarea"),
  ]);
  if (!bodyLocator) {
    console.error("[revu.net] 본문 입력칸(에디터)을 찾지 못했습니다.");
    await debugDump(page);
    await browser.close();
    process.exit(1);
  }
  await bodyLocator.click({ force: true });
  await page.keyboard.down("Meta");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Meta");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(content, { delay: 5 });
  await page.waitForTimeout(200);

  // 3) 등록 버튼 클릭
  const submit = await pickFirstVisibleLocator(page, [
    page.getByRole("button", { name: /등록|작성|올리기|게시/ }),
    page.locator('button:has-text("등록")'),
    page.locator('button:has-text("작성")'),
    page.locator('button:has-text("게시")'),
  ]);
  if (!submit) {
    console.error("[revu.net] 등록 버튼을 찾지 못했습니다.");
    await debugDump(page);
    await browser.close();
    process.exit(1);
  }
  await submit.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  await submit.click({ force: true });
  await page.waitForTimeout(2000);

  await browser.close();
  console.log("[revu.net] 글 작성 완료!");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
