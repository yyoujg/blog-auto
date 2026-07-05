// Lightweight naver session pre-check (fast, no browser).
// Exit 0 -> session file present and recently refreshed
// Exit 1 -> session missing or stale beyond MAX_AGE_DAYS
//
// True invalidation (cookie revoked server-side) is detected by the main
// task and the wrapper's keyword-based post-check.

const fs = require("fs");
const path = require("path");

const STATE_PATH = path.join(__dirname, "..", "naverState.json");
const MAX_AGE_DAYS = 30;

if (!fs.existsSync(STATE_PATH)) {
  console.log("세션 만료 - naverState.json 없음 (네이버 재로그인 필요)");
  process.exit(1);
}

const stat = fs.statSync(STATE_PATH);
const ageMs = Date.now() - stat.mtimeMs;
const ageDays = ageMs / (1000 * 60 * 60 * 24);

if (ageDays > MAX_AGE_DAYS) {
  console.log(`세션 만료 - naverState.json ${ageDays.toFixed(1)}일 전 갱신 (재로그인 필요)`);
  process.exit(1);
}

console.log(`naver session OK (마지막 갱신 ${ageDays.toFixed(1)}일 전)`);
process.exit(0);
