"use strict";
/**
 * main.js — 3단계 전체 파이프라인 원클릭 실행
 *
 * 사용법:
 *   node main.js <placeUrl> [캠페인유형]
 *   예) node main.js "https://map.naver.com/v5/entry/place/12345" 레뷰
 *
 * 단계:
 *   1. 플레이스 크롤링 (scraper.js)
 *   2. Claude API 글 생성 → post-config.json (setup-post-config.js)
 *   3. 네이버 SE3 자동 입력 (naver-blog-post.js)
 */
const { spawn } = require("child_process");
const path = require("path");

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script), ...args], {
      stdio: "inherit",
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} 실패 (exit ${code})`));
    });
  });
}

(async () => {
  const [placeUrl, campaignType] = process.argv.slice(2);

  if (!placeUrl) {
    console.error("사용법: node main.js <placeUrl> [캠페인유형]");
    console.error("예시:  node main.js \"https://map.naver.com/v5/entry/place/12345\" 레뷰");
    process.exit(1);
  }

  try {
    // 1 + 2단계: 수집 + 글 생성
    console.log("\n[main] 1·2단계: 플레이스 수집 + 글 생성 시작");
    const setupArgs = [placeUrl];
    if (campaignType) setupArgs.push(campaignType);
    await run("setup-post-config.js", setupArgs);

    // 3단계: 블로그 자동 입력
    console.log("\n[main] 3단계: 네이버 블로그 자동 입력 시작");
    await run("naver/naver-blog-post.js");

    console.log("\n[main] 완료!");
  } catch (e) {
    console.error(`[main] 오류: ${e.message}`);
    process.exit(1);
  }
})();
