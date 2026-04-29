require("dotenv").config({ override: true });
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { getNaverContext } = require("../core/utils");

const NAVER_STATE_PATH = path.join(__dirname, "../naverState.json");
const VISITED_PATH = path.join(__dirname, "../commenter-blog-urls.json");

const NON_POST_SEGMENTS = ["/clip/", "/series/", "/category/", "/tag/", "/search/", "/video/"];

function isPostUrl(href, blogId) {
  if (!href.includes(`blog.naver.com/${blogId}/`) && !href.includes(`/${blogId}/`)) return false;
  if (!(/\/\d{5,}/.test(href))) return false;
  if (NON_POST_SEGMENTS.some((s) => href.includes(s))) return false;
  return true;
}

async function getLatestPostUrl(page, blogId) {
  try {
    await page.goto(
      `https://blog.naver.com/PostList.naver?blogId=${blogId}&categoryNo=0&currentPage=1`,
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );
    await page.waitForTimeout(1500);

    const allLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)
    );
    for (const href of allLinks) {
      if (isPostUrl(href, blogId)) return href.replace(/^https?:\/\/m\.blog\.naver\.com/, "https://blog.naver.com");
    }

    const mainFrame = page.frame({ name: "mainFrame" });
    if (mainFrame) {
      await mainFrame.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
      const frameLinks = await mainFrame.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)
      ).catch(() => []);
      for (const href of frameLinks) {
        if (isPostUrl(href, blogId)) return href.replace(/^https?:\/\/m\.blog\.naver\.com/, "https://blog.naver.com");
      }
    }

    // JSON API fallback
    await page.goto(
      `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&currentPage=1&categoryNo=0&listStyle=post&countPerPage=1`,
      { waitUntil: "domcontentloaded", timeout: 10000 }
    );
    const json = await page.evaluate(() => {
      try { return JSON.parse(document.body.innerText); } catch { return null; }
    });
    const logNo = json?.postList?.[0]?.logNo;
    if (logNo) return `https://blog.naver.com/${blogId}/${logNo}`;
  } catch {}
  return null;
}

async function extractContent(page, postUrl, blogId) {
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(2000);

  const selectors = [".se-main-container", "#viewTypeSelector", ".post-view", ".se_component_wrap", "#postViewArea"];

  const mainFrame = page.frame({ name: "mainFrame" });
  let content = "";

  if (mainFrame) {
    await mainFrame.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    content = await mainFrame.evaluate((sels) => {
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 50) return el.innerText.trim();
      }
      return document.body.innerText.trim();
    }, selectors).catch(() => "");
  }

  if (!content || content.length < 50) {
    content = await page.evaluate((sels) => {
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 50) return el.innerText.trim();
      }
      return "";
    }, selectors).catch(() => "");
  }

  return content.slice(0, 800).replace(/\n+/g, " ").trim();
}

(async () => {
  const data = JSON.parse(fs.readFileSync(VISITED_PATH, "utf-8"));
  const ids = Array.isArray(data) ? data : Object.keys(data);

  const browser = await chromium.launch({ headless: true });
  const context = await getNaverContext(browser, NAVER_STATE_PATH);
  const page = await context.newPage();

  const results = [];

  for (const blogId of ids) {
    process.stderr.write(`[${blogId}] 수집 중...\n`);
    const postUrl = await getLatestPostUrl(page, blogId);
    if (!postUrl) {
      results.push({ blogId, postUrl: null, content: null });
      continue;
    }
    const content = await extractContent(page, postUrl, blogId);
    results.push({ blogId, postUrl, content });
    await new Promise(r => setTimeout(r, 1500));
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})().catch(e => { process.stderr.write(e.message + "\n"); process.exit(1); });
