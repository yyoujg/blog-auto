"use strict";
/**
 * setup-post-config.js
 * 네이버 플레이스 URL → 데이터 수집 + Claude API 글 생성 → post-config.json 저장
 *
 * 사용법:
 *   npm run setup-blog
 *   npm run setup-blog -- <placeUrl> [캠페인유형]
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
require("dotenv").config({ override: true });

const { scrapePlaceInfo } = require("./core/scraper");
const { generatePost } = require("./core/generator");

const IMAGES_DIR = path.join(__dirname, "images");
const POST_CONFIG_PATH = path.join(__dirname, "post-config.json");
const IMAGE_EXTS = /\.(jpg|jpeg|png|webp|gif)$/i;
const VIDEO_EXTS = /\.(mp4|mov|avi|mkv|webm)$/i;

function ask(rl, q) {
  return new Promise((r) => rl.question(q, r));
}

async function askMultiLine(rl, prompt) {
  console.log(prompt);
  console.log("  (입력 완료 후 빈 줄에서 엔터)\n");
  const lines = [];
  return new Promise((resolve) => {
    function onLine(line) {
      if (line === "") {
        rl.removeListener("line", onLine);
        resolve(lines.join("\n"));
      } else {
        lines.push(line);
      }
    }
    rl.on("line", onLine);
  });
}

(async () => {
  const args = process.argv.slice(2);
  const placeUrlArg = args[0];
  const campaignTypeArg = args[1];

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // ── 입력 수집 ──────────────────────────────────────────────────────────────
  const placeUrl = placeUrlArg
    ? placeUrlArg
    : (await ask(rl, "네이버 플레이스 URL: ")).trim();

  const campaignType = campaignTypeArg
    ? campaignTypeArg
    : (await ask(rl, "캠페인 유형 [내돈내산/레뷰/리뷰노트] (기본: 리뷰노트): ")).trim() || "리뷰노트";

  const topPosts = await askMultiLine(
    rl,
    "\n상위노출 글 텍스트 붙여넣기 (키워드 추출용, 없으면 그냥 엔터):"
  );

  rl.close();

  // ── 이미지/동영상 목록 ──────────────────────────────────────────────────────
  let photos = [];
  let videos = [];
  if (fs.existsSync(IMAGES_DIR)) {
    const files = fs.readdirSync(IMAGES_DIR).sort();
    photos = files.filter((f) => IMAGE_EXTS.test(f));
    videos = files.filter((f) => VIDEO_EXTS.test(f));
  }
  console.log(`\n📁 이미지 ${photos.length}장 / 동영상 ${videos.length}개`);
  if (photos.length === 0) {
    console.log("⚠  images 폴더에 이미지가 없습니다. photo_slot은 비어 있게 됩니다.");
  }

  // ── 1단계: 플레이스 정보 수집 ────────────────────────────────────────────────
  console.log("\n[1단계] 플레이스 정보 수집 중...");
  let placeInfo;
  try {
    placeInfo = await scrapePlaceInfo(placeUrl);
  } catch (e) {
    console.log(`⚠  자동 수집 실패: ${e.message}`);
    console.log("   빈 placeInfo로 계속 진행합니다.");
    placeInfo = { name: "", category: "", address: "", phone: "", hours: "", menu: [] };
  }

  // ── 2단계: Claude API 글 생성 ───────────────────────────────────────────────
  console.log("\n[2단계] Claude API로 글 구조 생성 중...");
  const generated = await generatePost({
    placeInfo,
    topPosts,
    campaignType,
    photoCount: photos.length,
    videoCount: videos.length,
  });

  // ── photo_slot / video_slot → 실제 파일 블록으로 치환 ───────────────────────
  let photoIdx = 0;
  let videoIdx = 0;
  const body = [];

  for (const block of generated.blocks || []) {
    if (block.type === "photo_slot") {
      const count = Math.min(block.count || 1, photos.length - photoIdx);
      for (let i = 0; i < count; i++) {
        if (photoIdx < photos.length) {
          body.push({ type: "image", file: photos[photoIdx++] });
        }
      }
    } else if (block.type === "video_slot") {
      if (videoIdx < videos.length) {
        body.push({ type: "video", file: videos[videoIdx++] });
      }
    } else {
      body.push(block);
    }
  }

  // 남은 사진 뒤에 추가
  while (photoIdx < photos.length) {
    body.push({ type: "image", file: photos[photoIdx++] });
  }

  // ── post-config.json 저장 ───────────────────────────────────────────────────
  const titles = Array.isArray(generated.title) ? generated.title : [generated.title || ""];

  const config = {
    title: titles[0],
    titleCandidates: titles,
    placeUrl,
    placeInfo,
    campaignType,
    body,
    hashtags: generated.hashtags || [],
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(POST_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");

  console.log("\n✅ post-config.json 저장 완료");
  console.log("\n제목 후보:");
  titles.forEach((t, i) => console.log(`  [${i + 1}] ${t}`));
  console.log(`\nbody 블록: ${body.length}개`);
  console.log(
    `  이미지 ${body.filter((b) => b.type === "image").length}장 ` +
    `/ 스티커 ${body.filter((b) => b.type === "sticker").length}개 ` +
    `/ 동영상 ${body.filter((b) => b.type === "video").length}개`
  );
  console.log(`해시태그: ${config.hashtags.length}개`);
  console.log("\n필요하면 post-config.json 직접 수정 후 → npm run blog-post");
})();
