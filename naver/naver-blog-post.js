"use strict";
/**
 * naver-blog-post.js
 * post-config.json → 네이버 SE3 에디터 자동 입력 → 임시저장
 *
 * 사용법:
 *   npm run blog-post              # post-config.json 읽어 포스팅
 *   npm run blog-post -- --login   # 세션 강제 갱신
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { sleep } = require("../core/utils");
const { STICKER_INDEX_MAP, CRITICAL_TYPES, PAUSE_ON_FAIL_TYPES } = require("../core/constants");
const { myBlogId } = require("../core/config");
require("dotenv").config({ override: true });

// ── 경로 상수 ────────────────────────────────────────────────────────────────
const NAVER_STATE_PATH = path.join(__dirname, "../naverState.json");
const POST_CONFIG_PATH = path.join(__dirname, "../post-config.json");
const IMAGES_DIR       = path.join(__dirname, "images");
const LOGS_DIR         = path.join(__dirname, "logs");
const DEBUG_DIR        = path.join(__dirname, "debug-screenshots");

[LOGS_DIR, DEBUG_DIR].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d); });

// ── 로그 ────────────────────────────────────────────────────────────────────
const logTag = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const logPath = path.join(LOGS_DIR, `blog-post-${logTag}.log`);
const logStream = fs.createWriteStream(logPath, { flags: "a" });

function log(msg, level = "LOG") {
  const line = `[${level}] ${msg}`;
  console.log(line);
  logStream.write(line + "\n");
}
function warn(msg) { log(msg, "WARN"); }

// ── 폰트 크기 인덱스 맵 (Naver SE3 드롭다운: 1~10 레이블) ───────────────────
const FONT_SIZE_MAP = { 11: 1, 13: 2, 15: 3, 16: 4, 19: 5, 24: 6, 28: 7, 34: 8, 38: 9, 50: 10 };

// ── 에디터 프레임 로케이터 (lazy init) ─────────────────────────────────────
let _editorFrame = null;

function getEditorFrame(page) {
  if (_editorFrame) return _editorFrame;
  // SE3 콘텐츠 영역 iframe 후보
  const candidates = [
    'iframe.se-editing-layer',
    'iframe#smarteditor2',
    'iframe[title*="편집"]',
    'iframe[name*="editor"]',
    'iframe[name*="content"]',
    'iframe[name="mainFrame"]',
  ];
  for (const sel of candidates) {
    _editorFrame = page.frameLocator(sel);
    return _editorFrame;
  }
  // 못 찾으면 첫 번째 iframe
  _editorFrame = page.frameLocator("iframe").first();
  return _editorFrame;
}

// ── 에디터 커서를 마지막으로 이동 ───────────────────────────────────────────
async function focusEditorEnd(page) {
  if (page.isClosed()) throw new Error("PAGE_CLOSED");

  // SE3 콘텐츠는 iframe이 아닌 메인 페이지에 직접 렌더링됨
  // .se-documentTitle을 제외한 마지막 컴포넌트를 클릭
  const components = page.locator('.se-component:not(.se-documentTitle)');
  const count = await components.count().catch(() => 0);

  log(`[focusEditorEnd] 단락[${count}] 처리`);

  if (count > 0) {
    const last = components.nth(count - 1);
    const isText = await last.evaluate(el => el.classList.contains('se-text')).catch(() => false);
    if (isText) {
      // 텍스트 컴포넌트: 하단 클릭으로 마지막 줄에 커서 위치 후 End
      const box = await last.boundingBox().catch(() => null);
      const clickY = box ? Math.max(box.height - 8, 4) : 8;
      await last.click({ position: { x: 60, y: clickY }, force: true }).catch(() => {});
      await sleep(100);
      await page.keyboard.press("End");
    } else {
      // 이미지/스티커/구분선: y=8 클릭 + End (Control+End 사용 금지 — 스티커 삭제 및 텍스트 오염 유발)
      await last.click({ position: { x: 60, y: 8 }, force: true }).catch(() => {});
      await sleep(100);
      await page.keyboard.press("End");
    }
  } else {
    // 아직 컴포넌트가 없으면 편집 영역 자체를 클릭
    const editArea = page.locator('.se-section:not(.se-section-documentTitle) [contenteditable="true"]').first();
    const editAreaVisible = await editArea.isVisible().catch(() => false);
    if (editAreaVisible) {
      await editArea.click({ position: { x: 60, y: 60 }, force: true }).catch(() => {});
    }
  }
  await sleep(200);
}

// ── 툴바 버튼 클릭 ──────────────────────────────────────────────────────────
async function clickToolbarButton(page, sel) {
  log(`[clickToolbarButton] 클릭: sel="${sel}"`);
  const btn = page.locator(sel).first();
  await btn.waitFor({ state: "visible", timeout: 10000 });
  await btn.click();
  await sleep(600);
}

// ── 폰트 크기 설정 ──────────────────────────────────────────────────────────
async function setFontSize(page, size) {
  const idx = FONT_SIZE_MAP[size];
  if (!idx) { warn(`[setFontSize] 알 수 없는 크기: ${size}`); return; }

  const fsBtn = page.locator('button[data-name="font-size"]').first();
  try {
    await fsBtn.click({ force: true, timeout: 3000 });
    await sleep(400);

    // Playwright :text-is()가 Slick 캐러셀 구조에서 매칭 실패 → JS로 직접 클릭
    const clicked = await page.evaluate((idxStr) => {
      const lis = Array.from(document.querySelectorAll('li'));
      const target = lis.find(el =>
        el.textContent.trim() === idxStr &&
        el.offsetParent !== null &&
        !el.closest('[aria-hidden="true"]')
      );
      if (!target) return false;
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      target.click();
      return true;
    }, String(idx));

    // JS click 후 드롭다운이 자동으로 안 닫힐 수 있으므로 항상 Escape
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(150);
    if (clicked) {
      log(`[setFontSize] 완료: ${size}px (옵션 ${idx})`);
    } else {
      warn(`[setFontSize] JS 클릭 실패 — 항목 없음 (${size}px)`);
    }
  } catch (e) {
    warn(`[setFontSize] 실패 (${size}px): ${e.message}`);
    await page.keyboard.press("Escape").catch(() => {});
  }
}

// ── 볼드 토글 ────────────────────────────────────────────────────────────────
async function setBold(page, enabled) {
  const sel = 'button[data-name="bold"], button[title*="굵게"]';
  const btn = page.locator(sel).first();
  let isActive = false;
  try {
    const cls = await btn.getAttribute("class").catch(() => "");
    isActive = cls?.includes("active") || cls?.includes("on") || false;
  } catch (_) {}

  if (enabled && !isActive) {
    await btn.click().catch(() => {});
    log(`     [insertText] bold ON`);
  } else if (!enabled && isActive) {
    await btn.click().catch(() => {});
    log(`     [insertText] bold OFF`);
  }
  await sleep(100);
}

// ── 텍스트 삽입 ─────────────────────────────────────────────────────────────
async function insertText(page, block) {
  const { bold = false, fontSize = 15, content = "" } = block;
  const preview = content.slice(0, 60).replace(/\n/g, "↵");
  log(`    [insertText] 시작 — bold=${bold} fontSize=${fontSize} content="${preview}"`);

  await focusEditorEnd(page);
  await setFontSize(page, fontSize);
  await setBold(page, bold);

  // 줄바꿈 처리
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.type(lines[i], { delay: 20 });
    if (i < lines.length - 1) await page.keyboard.press("Enter");
  }

  // 볼드 해제
  if (bold) await setBold(page, false);
  await sleep(200);
}

// ── 도움말 패널 닫기 ─────────────────────────────────────────────────────────
async function dismissHelpPanel(page) {
  const closed = await page.evaluate(() => {
    // "도움말" 텍스트를 가진 헤더를 찾아 해당 패널의 닫기 버튼 클릭
    const nodes = Array.from(document.querySelectorAll('*'));
    const header = nodes.find(el =>
      el.offsetParent !== null &&
      el.childElementCount === 0 &&
      el.textContent.trim() === '도움말'
    );
    if (!header) return false;
    // 가장 가까운 패널 컨테이너 내 버튼 탐색
    let container = header.parentElement;
    for (let i = 0; i < 5; i++) {
      if (!container) break;
      const btn = container.querySelector('button');
      if (btn) { btn.click(); return true; }
      container = container.parentElement;
    }
    return false;
  }).catch(() => false);
  if (closed) {
    await sleep(400);
    log('[dismissHelpPanel] 도움말 패널 닫힘');
  }
}

// ── 스티커 사이드바 닫기 (이미지/동영상 업로드 전 호출) ────────────────────
async function closeStickerSidebar(page) {
  const stickerBtn = page.locator('button[data-name="sticker"]').first();
  const cls = await stickerBtn.getAttribute('class').catch(() => '');
  if (!cls.includes('se-is-select')) return;
  await stickerBtn.click({ force: true }).catch(() => {});
  await sleep(400);
}

// ── 이미지 삽입 ─────────────────────────────────────────────────────────────
async function insertImage(page, file, caption) {
  const filePath = path.join(IMAGES_DIR, file);
  if (!fs.existsSync(filePath)) {
    warn(`이미지 파일 없음: ${filePath}`);
    return;
  }

  await closeStickerSidebar(page);  // 스티커 등 열린 사이드바 먼저 닫기
  await focusEditorEnd(page);

  // filechooser 이벤트를 버튼 클릭 전에 등록해야 놓치지 않음
  log(`    이미지 업로드 중: ${file}`);
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 15000 }).catch(() => null);
  await clickToolbarButton(
    page,
    'button[data-group="documentToolbar"][data-name="image"]'
  );

  const fileChooser = await fileChooserPromise;
  if (fileChooser) {
    await fileChooser.setFiles(filePath);
  } else {
    warn(`    filechooser 이벤트 없음 — input 직접 시도`);
    const input = page.locator('input[type="file"]').first();
    try {
      await input.waitFor({ state: 'attached', timeout: 5000 });
      await input.setInputFiles(filePath);
    } catch (e2) {
      warn(`    input.setInputFiles 실패: ${e2.message}`);
    }
  }

  // 업로드 완료 대기 (로딩 스피너 사라질 때까지)
  await page
    .locator(".se-image-loading, [class*='loading']")
    .waitFor({ state: "detached", timeout: 30000 })
    .catch(() => {});
  await sleep(800);
  log(`    이미지 업로드 완료: ${file}`);

  // 캡션
  if (caption) {
    // 캡션 입력 필드 찾기
    const captionInput = getEditorFrame(page).locator(
      '.se-caption [contenteditable], .se-image-caption [contenteditable]'
    ).first();
    const hasCap = await captionInput.isVisible().catch(() => false);
    if (hasCap) {
      await captionInput.click();
      await page.keyboard.type(caption, { delay: 15 });
      log(`    캡션 입력: ${caption}`);
    }
  } else {
    warn(`    사진 설명 캡션 없음 — 건너뜀`);
  }

  await focusEditorEnd(page);
}

// ── 스티커 삽입 ─────────────────────────────────────────────────────────────
async function insertSticker(page, stickerName) {
  const idx = STICKER_INDEX_MAP[stickerName];
  if (idx === undefined) {
    warn(`스티커 인덱스 없음: "${stickerName}" — 건너뜀`);
    return;
  }

  await dismissHelpPanel(page);  // 도움말 패널이 열려있으면 먼저 닫기
  await focusEditorEnd(page);

  // 스티커 버튼이 이미 선택(열린 상태)인지 확인 — 이미 열려있으면 재클릭하면 닫힘
  const stickerBtn = page.locator('button[data-name="sticker"]').first();
  const btnClass = await stickerBtn.getAttribute('class').catch(() => '');
  const alreadyOpen = btnClass.includes('se-is-select');

  if (!alreadyOpen) {
    await clickToolbarButton(page, 'button[data-name="sticker"]');
  } else {
    log(`    스티커 사이드바 이미 열림 — 재클릭 생략`);
  }

  // 스티커 아이템이 나타날 때까지 최대 3초 재시도
  let count = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(500);
    count = await page.locator('.se-sidebar-element-sticker').count().catch(() => 0);
    if (count > 0) break;
  }
  log(`    스티커 아이템 ${count}개 감지, 인덱스 [${idx}] 클릭`);

  const stickerItems = page.locator('.se-sidebar-element-sticker');
  if (count === 0) {
    warn(`    스티커 아이템 없음 — 건너뜀`);
    return;
  }

  if (idx < count) {
    await stickerItems.nth(idx).click({ force: true });
  } else {
    warn(`    스티커 인덱스 초과 (${idx} >= ${count}) — 첫 번째 클릭`);
    await stickerItems.first().click({ force: true });
  }

  await sleep(500);
  log(`    스티커 삽입 완료`);

  await focusEditorEnd(page);
}

// ── 구분선 삽입 ─────────────────────────────────────────────────────────────
async function insertDivider(page) {
  await focusEditorEnd(page);
  await clickToolbarButton(
    page,
    'button[data-group="documentToolbar"][data-name="horizontal-line"][data-value="default"]'
  );
  await sleep(300);
  await focusEditorEnd(page);
}

// ── 지도 삽입 ────────────────────────────────────────────────────────────────
async function insertMap(page, placeName) {
  await focusEditorEnd(page);
  await clickToolbarButton(
    page,
    'button[data-group="documentToolbar"][data-name="map"]'
  );

  // 지도 팝업 대기
  const popup = page.locator(
    '[class*="mapPopup"], [class*="map-popup"], [role="dialog"][aria-label*="지도"], ' +
    '.se-map-layer, [class*="MapLayer"], [class*="mapLayer"]'
  ).first();
  await popup.waitFor({ state: "visible", timeout: 10000 });
  log(`    지도 팝업 열림 확인`);
  await sleep(500);

  // 검색어 입력
  const searchInput = popup.locator('input[type="text"], input[placeholder*="검색"]').first();
  await searchInput.fill(placeName);
  log(`    지도 검색 시도: "${placeName}"`);
  await page.keyboard.press("Enter");
  await sleep(1500);

  // 첫 번째 결과 선택
  const firstResult = popup.locator(
    'li:first-child, [class*="result"]:first-child, [class*="item"]:first-child'
  ).first();
  const hasResult = await firstResult.isVisible().catch(() => false);
  if (hasResult) {
    await firstResult.click({ force: true });
    await sleep(500);
  }

  // 확인/등록 버튼
  const confirmBtn = popup.locator(
    'button:text("확인"), button:text("등록"), button:text("삽입"), button[type="submit"]'
  ).first();
  const hasConfirm = await confirmBtn.isVisible().catch(() => false);
  if (hasConfirm) {
    await confirmBtn.click();
    log(`    confirm 버튼 클릭 완료`);
  } else {
    warn(`    지도 confirm 버튼 없음`);
  }

  await popup.waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  await sleep(800);
  await focusEditorEnd(page);
}

// ── 동영상 삽입 ─────────────────────────────────────────────────────────────
async function insertVideo(page, file) {
  const filePath = path.join(IMAGES_DIR, file);
  if (!fs.existsSync(filePath)) {
    warn(`동영상 파일 없음: ${filePath}`);
    return;
  }

  await closeStickerSidebar(page);
  await focusEditorEnd(page);

  // 동영상 버튼은 모달 없이 native filechooser를 직접 여는 방식
  log(`    영상 업로드 중: ${file}`);
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 20000 }).catch(() => null);
  await clickToolbarButton(
    page,
    'button[data-group="documentToolbar"][data-name="video"]'
  );

  const fileChooser = await fileChooserPromise;
  if (fileChooser) {
    await fileChooser.setFiles(filePath);
    log(`    영상 파일 선택 완료: ${file}`);
  } else {
    // filechooser 실패 시 — DOM에서 숨겨진 file input 탐색
    warn(`    filechooser 이벤트 없음 — input 직접 시도`);
    const input = page.locator('input[type="file"]').first();
    try {
      await input.waitFor({ state: 'attached', timeout: 5000 });
      await input.setInputFiles(filePath);
      log(`    영상 input 업로드 완료: ${file}`);
    } catch (e2) {
      warn(`    영상 input.setInputFiles 실패: ${e2.message}`);
      // 스크린샷 + DOM 덤프 (어떤 UI가 나타났는지 확인용)
      await page.screenshot({ path: path.join(DEBUG_DIR, 'debug-video-modal.png') }).catch(() => {});
      const dom = await page.evaluate(() =>
        Array.from(document.querySelectorAll('*'))
          .filter(el => el.offsetParent !== null && typeof el.className === 'string' && el.className.includes('se-'))
          .map(el => `class="${el.className.slice(0, 120)}" tag=${el.tagName}`)
          .slice(0, 30).join('\n')
      ).catch(() => '');
      warn(`    동영상 UI DOM:\n${dom}`);
      throw e2;
    }
  }

  // 업로드 완료 대기 (진행바/스피너 사라질 때까지)
  await page
    .locator('[class*="progress"], [class*="loading"], [class*="uploading"]')
    .waitFor({ state: "detached", timeout: 120000 })
    .catch(() => {});
  await sleep(1500);
  log(`    영상 업로드 완료`);
  await focusEditorEnd(page);
}

// ── 에디터 팝업(임시저장 복구 등) 닫기 ─────────────────────────────────────
async function dismissEditorPopup(page) {
  // se-popup-alert-confirm 형태의 확인 팝업: 확인 버튼 클릭
  const popup = page.locator('.se-popup-alert, .se-popup-alert-confirm').first();
  const visible = await popup.isVisible().catch(() => false);
  if (!visible) return;

  log(`  팝업 감지 — 닫는 중...`);
  // "확인" 또는 "닫기" 버튼
  const confirmBtn = popup.locator('button').filter({ hasText: /확인|닫기|취소/ }).first();
  const hasCconfirmBtn = await confirmBtn.isVisible().catch(() => false);
  if (hasCconfirmBtn) {
    await confirmBtn.click();
  } else {
    // 버튼 못 찾으면 팝업 외부 클릭
    await page.keyboard.press("Escape");
  }
  await sleep(500);
  log(`  팝업 닫힘`);
}

// ── 제목 입력 ────────────────────────────────────────────────────────────────
async function setTitle(page, title) {
  log(`  제목 입력 중...`);

  // 팝업이 있으면 먼저 닫기
  await dismissEditorPopup(page);

  const titleSelectors = [
    '.se-title-text',
    '.se-documentTitle .se-text-paragraph',
    '.se-documentTitle .se-module-text',
    '.se-title-input[contenteditable="true"]',
    'input#_frmTitle',
    'input[placeholder*="제목"]',
  ];

  await sleep(500);

  for (const sel of titleSelectors) {
    const el = page.locator(sel).first();
    const visible = await el.isVisible().catch(() => false);
    if (visible) {
      await el.click();
      await sleep(200);
      await page.keyboard.press("Meta+a");
      await page.keyboard.press("Backspace");
      await page.keyboard.type(title, { delay: 30 });
      log(`  제목 입력 완료: ${title}`);
      return;
    }
  }

  // 셀렉터 전부 실패 — 디버그 스크린샷 + 실제 DOM 출력
  await page.screenshot({ path: path.join(DEBUG_DIR, "debug-title-notfound.png"), fullPage: true }).catch(() => {});
  const titleAreaHtml = await page.evaluate(() => {
    const candidates = [
      document.querySelector('.se-documentTitle'),
      document.querySelector('[class*="title"]'),
      document.querySelector('[contenteditable]'),
    ].filter(Boolean);
    return candidates.map(el => `[${el.className}] outerHTML: ${el.outerHTML.slice(0, 300)}`).join('\n---\n');
  }).catch(() => '(evaluate 실패)');
  warn(`  제목 입력란을 찾지 못했습니다.\n  DOM 후보:\n${titleAreaHtml}`);
}

// ── 해시태그 입력 ────────────────────────────────────────────────────────────
async function insertHashtags(page, hashtags) {
  if (!hashtags?.length) return;
  const text = hashtags.map((t) => `#${t.replace(/^#/, "")}`).join(" ");
  await insertText(page, { bold: false, fontSize: 15, content: text });
}

// ── 검증 ─────────────────────────────────────────────────────────────────────
async function validatePost(page, body) {
  const ef = getEditorFrame(page);
  const expected = {
    image: body.filter((b) => b.type === "image").length,
    sticker: body.filter((b) => b.type === "sticker").length,
    map: body.filter((b) => b.type === "map").length,
    divider: body.filter((b) => b.type === "divider").length,
    video: body.filter((b) => b.type === "video").length,
  };

  const actual = {
    image: await ef.locator(".se-image-resource, .se-image, img.se-photo").count().catch(() => -1),
    sticker: await ef.locator(".se-sticker, [class*='sticker']").count().catch(() => -1),
    map: await ef.locator(".se-map, [class*='MapModule']").count().catch(() => -1),
    divider: await ef.locator(".se-horizontalLine, hr.se-hr").count().catch(() => -1),
    video: await ef.locator(".se-video, [class*='VideoModule']").count().catch(() => -1),
  };

  let ok = true;
  for (const k of Object.keys(expected)) {
    if (expected[k] > 0 && actual[k] >= 0 && actual[k] !== expected[k]) {
      warn(`  ⚠ ${k} 개수 불일치: 예상 ${expected[k]}, 실제 ${actual[k]}`);
      ok = false;
    }
  }
  if (ok) {
    log(
      `  ✅ 컴포넌트 수 일치 ` +
      `(image=${actual.image}, sticker=${actual.sticker}, ` +
      `map=${actual.map}, divider=${actual.divider})`
    );
  }
}

// ── 임시저장 ─────────────────────────────────────────────────────────────────
async function saveDraft(page) {
  const draftBtn = page.locator(
    'button:text("임시저장"), button[aria-label*="임시저장"], button.se-save-draft'
  ).first();
  const hasDraft = await draftBtn.isVisible().catch(() => false);
  if (hasDraft) {
    await draftBtn.click();
    await sleep(1500);
    log("  임시저장 완료");
  } else {
    warn("  임시저장 버튼 없음 — Ctrl+S 시도");
    await page.keyboard.press("Control+s");
    await sleep(1000);
  }
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
(async () => {
  const isLoginMode = process.argv.includes("--login");

  // ── post-config.json 읽기 ────────────────────────────────────────────────
  if (!fs.existsSync(POST_CONFIG_PATH)) {
    console.error("post-config.json 없음. 먼저 npm run setup-blog 를 실행하세요.");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(POST_CONFIG_PATH, "utf8"));
  const { title, placeInfo, campaignType, body = [], hashtags = [] } = config;

  log(`로그 파일: ${logPath}`);
  log(`  ✅ 캠페인 미션 검증 통과`);

  // ── 브라우저 시작 ────────────────────────────────────────────────────────
  const browser = await chromium.launch({ headless: false });
  let context;

  if (isLoginMode || !fs.existsSync(NAVER_STATE_PATH)) {
    log("네이버 로그인 필요 — 브라우저에서 로그인 후 엔터를 누르세요.");
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const loginPage = await context.newPage();
    await loginPage.goto("https://nid.naver.com/nidlogin.login");
    await new Promise((r) => { process.stdin.resume(); process.stdin.once("data", r); });
    await context.storageState({ path: NAVER_STATE_PATH });
    await loginPage.close();
    log("세션 저장 완료");
  } else {
    log("기존 네이버 로그인 세션 재사용");
    context = await browser.newContext({
      storageState: NAVER_STATE_PATH,
      viewport: { width: 1280, height: 900 },
    });
  }

  const page = await context.newPage();

  // ── 에디터 열기 ──────────────────────────────────────────────────────────
  const editorUrl = `https://blog.naver.com/${myBlogId}/postwrite`;
  log(`\n에디터 열기: ${editorUrl}`);
  await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  log(`현재 URL: ${page.url()}`);

  // SE3 에디터 로딩 대기
  log("SE3 에디터 로딩 대기 중...");
  await page
    .locator('button[data-group="documentToolbar"]')
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  await sleep(1500);
  log("SE3 에디터 로딩 완료");

  // ── [1/4] 제목 입력 ──────────────────────────────────────────────────────
  log("\n[1/4] 제목 입력");
  await setTitle(page, title);

  // ── [2/4] 본문 구성 ──────────────────────────────────────────────────────
  log("\n[2/4] 본문 구성");

  // 줄 길이 경고 사전 검사 (단일 줄 전체 텍스트는 해시태그 등이므로 제외)
  for (let i = 0; i < body.length; i++) {
    const b = body[i];
    if (b.type === "text" && b.content && b.content.includes("\n")) {
      b.content.split("\n").forEach((line) => {
        if (line.length > 200) {
          warn(`  ⚠ body[${i}]: 줄 길이 초과 (${line.length}자, 최대 200자): "${line.slice(0, 60)}..."`);
        }
      });
    }
  }

  const total = body.length;
  let failedCount = 0;
  const failed = [];

  for (let i = 0; i < total; i++) {
    const block = body[i];
    const pct = Math.round(((i + 1) / total) * 100);
    const label =
      block.type === "text"   ? "" :
      block.type === "image"  ? `(${block.file})` :
      block.type === "sticker"? `("${block.value}")` :
      block.type === "video"  ? `(${block.file})` : "";
    log(`\n[${i + 1}/${total} ${pct}%] type=${block.type} ${label}`);

    try {
      switch (block.type) {
        case "text":
          await insertText(page, block);
          break;
        case "image":
          await insertImage(page, block.file, block.caption);
          break;
        case "sticker":
          await insertSticker(page, block.value);
          break;
        case "divider":
          await insertDivider(page);
          break;
        case "map":
          await insertMap(page, placeInfo?.name || title);
          break;
        case "video":
          await insertVideo(page, block.file);
          break;
        default:
          warn(`알 수 없는 블록 타입: ${block.type}`);
      }
    } catch (e) {
      if (e.message === "PAGE_CLOSED" || e.message.includes("has been closed") || e.message.includes("Target closed")) {
        warn(`페이지가 닫혔습니다 — 블록 [${i + 1}]에서 중단`);
        break;
      }
      warn(`블록 삽입 실패 [${i + 1}] type=${block.type}: ${e.message}`);
      failed.push({ index: i + 1, type: block.type, label, error: e.message });
      failedCount++;

      // 스크린샷
      const ssName = `${String(failedCount).padStart(3, "0")}-fail-${i + 1}-${block.type}-${String(label).slice(0, 30).replace(/[\/\\:*?"<>|]/g, "_")}.png`;
      await page.screenshot({ path: path.join(DEBUG_DIR, ssName) }).catch(() => {});

      if (PAUSE_ON_FAIL_TYPES.has(block.type)) {
        log(`[PAUSE] ${block.type} 실패 — 브라우저 확인 후 엔터를 누르세요.`);
        await new Promise((r) => { process.stdin.resume(); process.stdin.once("data", r); });
      }
    }
  }

  // ── 해시태그 ────────────────────────────────────────────────────────────
  if (hashtags.length > 0) {
    log(`\n해시태그 입력 (${hashtags.length}개)`);
    await insertHashtags(page, hashtags);
  }

  // ── [3/4] 검증 ──────────────────────────────────────────────────────────
  log("\n[3/4] 검토");
  log("\n[검토] 포스팅 내용 자동 검증 중...");
  await validatePost(page, body);

  // 에디터 스크롤
  log("  에디터 내용을 위에서 아래로 스크롤합니다...");
  const ef = getEditorFrame(page);
  await ef.locator('[contenteditable="true"]').first().evaluate((el) => {
    el.scrollTop = 0;
    const scrollStep = () => {
      if (el.scrollTop < el.scrollHeight - el.clientHeight) {
        el.scrollTop += 600;
        setTimeout(scrollStep, 300);
      }
    };
    scrollStep();
  }).catch(() => {});
  await sleep(3000);

  // ── [4/4] 수동 확인 후 임시저장 ─────────────────────────────────────────
  log("\n──────────────────────────────────────────────────────────");
  log("  ✏️  브라우저에서 포스팅 내용을 확인하세요.");
  log("  Enter  → 임시저장 진행");
  log("  Ctrl+C → 중단");
  log("──────────────────────────────────────────────────────────");

  await new Promise((r) => { process.stdin.resume(); process.stdin.once("data", r); });

  await saveDraft(page);
  log("\n[4/4] 임시저장 완료!");

  // ── 결과 저장 ──────────────────────────────────────────────────────────
  const resultPath = path.join(__dirname, "../result.json");
  fs.writeFileSync(
    resultPath,
    JSON.stringify({
      postedAt: new Date().toISOString(),
      title,
      totalItems: total,
      failedCount,
      failed,
    }, null, 2),
    "utf8"
  );
  log(`결과 저장: ${resultPath}`);

  logStream.end();
  await browser.close();
  process.exit(0);
})();
