"use strict";
const { chromium } = require("playwright");

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

function extractPlaceId(url) {
  const m = url.match(/place[\/=](\d+)/);
  return m ? m[1] : null;
}

async function resolveUrl(url) {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    return res.url;
  } catch (e) {
    return url;
  }
}

async function scrapePlaceInfo(placeUrl) {
  // 단축 URL(naver.me 등) → 실제 URL로 변환
  let resolvedUrl = placeUrl;
  if (!extractPlaceId(placeUrl)) {
    console.log("[scraper] 단축 URL 감지 — 리다이렉트 추적 중...");
    resolvedUrl = await resolveUrl(placeUrl);
    console.log(`[scraper] 실제 URL: ${resolvedUrl}`);
  }

  const placeId = extractPlaceId(resolvedUrl);
  if (!placeId) throw new Error(`플레이스 ID 추출 실패: ${resolvedUrl}`);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: MOBILE_UA,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();

    // 홈 페이지
    const homeUrl = `https://m.place.naver.com/place/${placeId}/home`;
    console.log(`[scraper] 수집 중: ${homeUrl}`);
    await page.goto(homeUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    const info = await page.evaluate(() => {
      function getText(...selectors) {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          const t = el?.textContent?.trim();
          if (t) return t;
        }
        return "";
      }
      return {
        name: getText(
          "h1.bh9OH", "h1.GHAhA", "span.GHAhO",
          'h1[class*="place"]', 'h1[class*="name"]', "h1"
        ),
        category: getText(
          "span.lnJFt", ".GFinb",
          '[class*="category"]', 'span[class*="Category"]'
        ),
        address: getText(
          "span.pz7wy", ".LDgIH", ".nQ7Lh",
          '[class*="address"]', "address"
        ),
        phone: getText(
          "span.xlx7Q", ".CNeFc",
          'a[href^="tel:"]', '[class*="phone"]', '[class*="Phone"]'
        ),
        hours: getText(
          "span.A_cdD", ".i8cFw", ".vV_z_",
          '[class*="hours"]', '[class*="Hours"]'
        ),
      };
    });

    // 메뉴 탭
    let menu = [];
    try {
      await page.goto(`https://m.place.naver.com/place/${placeId}/menu`, {
        waitUntil: "networkidle",
        timeout: 20000,
      });
      await page.waitForTimeout(1000);
      menu = await page.evaluate(() => {
        const items = document.querySelectorAll(
          '[class*="menu"] li, [class*="Menu"] li, [class*="item"] strong, [class*="Item"] strong'
        );
        return Array.from(items)
          .slice(0, 12)
          .map((el) => el.textContent.trim())
          .filter(Boolean);
      });
    } catch (e) {
      console.log("[scraper] 메뉴 수집 생략:", e.message);
    }

    info.menu = menu;
    console.log("[scraper] 수집 완료:", JSON.stringify(info, null, 2));
    return info;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapePlaceInfo };
