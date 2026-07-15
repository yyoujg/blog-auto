/**
 * 여러 후보 중 첫 번째로 보이는 locator 반환
 */
async function pickFirstVisibleLocator(page, candidates) {
  for (const loc of candidates) {
    try {
      if ((await loc.count()) > 0) {
        const first = loc.first();
        if (await first.isVisible().catch(() => false)) return first;
      }
    } catch (_) {}
  }
  return null;
}

/**
 * 페이지의 input/contenteditable/button 정보를 콘솔에 출력 (디버그용)
 */
async function debugDump(page) {
  const inputs = await page.$$eval("input, textarea, select", (els) =>
    els.map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type"),
      name: el.getAttribute("name"),
      id: el.getAttribute("id"),
      placeholder: el.getAttribute("placeholder"),
      ariaLabel: el.getAttribute("aria-label"),
      className: el.className,
      value:
        el.tagName.toLowerCase() === "input" || el.tagName.toLowerCase() === "textarea"
          ? (el.value || "").slice(0, 80)
          : undefined,
    }))
  );
  const editables = await page.$$eval('[contenteditable="true"]', (els) =>
    els.map((el) => ({
      ariaLabel: el.getAttribute("aria-label"),
      id: el.getAttribute("id"),
      className: el.className,
      textSample: (el.innerText || "").slice(0, 80),
    }))
  );
  const buttons = await page.$$eval("button", (els) =>
    els
      .map((b) => ({
        text: (b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80),
        ariaLabel: b.getAttribute("aria-label"),
        className: b.className,
        disabled: b.disabled,
      }))
      .filter((b) => b.text || b.ariaLabel)
      .slice(0, 80)
  );
  console.log("=== inputs/textareas/select ===");
  console.log(JSON.stringify(inputs, null, 2));
  console.log("=== contenteditable ===");
  console.log(JSON.stringify(editables, null, 2));
  console.log("=== buttons ===");
  console.log(JSON.stringify(buttons, null, 2));
}

/**
 * ms 만큼 대기
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 랜덤 배열 선택
 */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 댓글 텍스트 키워드 기반 답글 템플릿 선택
 */
function pickTemplate(commentText) {
  const t = commentText;
  if (/가족|가구원|형제|부모|동생|오빠|언니|같이 사/.test(t))
    return pick([
      "같이 살고 계신 분들 기준으로 작성하시면 돼요! 포스팅에 자세히 나와 있으니 참고해 보세요 😊",
      "가족관계증명서에 등록된 분들 기준으로 적어주시면 됩니다! 헷갈리는 부분은 댓글로 다시 남겨주세요 😊",
    ]);
  if (/신청|어떻게|방법|절차|준비|서류/.test(t))
    return pick([
      "포스팅에 단계별로 정리해 뒀으니 천천히 따라해 보시면 어렵지 않을 거예요! 궁금한 점 있으면 편하게 댓글 남겨주세요 😊",
      "저도 처음엔 어렵게 느껴졌는데 하고 나니 생각보다 간단하더라고요! 포스팅 참고해 보세요 🙂",
    ]);
  if (/얼마|가격|비용|요금/.test(t))
    return pick([
      "포스팅에 가격 정보 정리해 뒀어요! 방문 전에 한번 확인해 보세요 😊",
      "가격은 포스팅 본문에 자세히 적어뒀으니 참고해 보세요! 생각보다 합리적이었어요 🙂",
    ]);
  if (/주차|위치|어디|찾아/.test(t))
    return pick([
      "주차 정보도 포스팅에 같이 정리해 뒀어요! 네이버 지도 검색하시면 쉽게 찾으실 수 있을 거예요 😊",
      "위치는 포스팅 본문에 적어뒀는데 찾기 어려우시면 댓글 남겨주세요! 바로 알려드릴게요 🙂",
    ]);
  if (/맛있|먹고 싶|군침|배고|츄릅|먹보|먹방/.test(t))
    return pick([
      "저도 먹으면서 너무 행복했어요 ㅎㅎ 근처 오실 일 있으면 꼭 한번 들러보세요! 😋",
      "사진으로 봐도 맛있어 보이죠 ㅎㅎ 직접 가보시면 더 맛있으실 거예요! 😄",
      "저도 쓰면서 다시 먹고 싶어졌어요 ㅋㅋ 강추드려요! 🍴",
    ]);
  if (/가보고 싶|방문|가볼게|들러/.test(t))
    return pick([
      "꼭 한번 가보세요! 후기 나중에 알려주시면 좋겠어요 😊",
      "가보시면 분명 만족하실 거예요! 다녀오시고 어떠셨는지 알려주세요 🙂",
    ]);
  if (/양|푸짐|가성비|착하|저렴/.test(t))
    return pick([
      "맞아요 양도 푸짐하고 가성비도 너무 좋았어요! 자주 가고 싶은 곳이에요 😄",
      "가성비 맛집이에요 진짜로 ㅎㅎ 또 가고 싶다는 생각 계속 들더라고요 😋",
    ]);
  if (/분위기|인테리어|예쁘|이쁘|감성|힐링/.test(t))
    return pick([
      "분위기 너무 좋았어요! 직접 가보시면 사진보다 더 예쁘실 거예요 😊",
      "저도 분위기에 완전 반했어요 ㅎㅎ 꼭 한번 가보세요! 🤎",
    ]);
  if (/사진|잘 찍|찍어|비주얼/.test(t))
    return pick([
      "좋게 봐주셔서 감사해요 ㅎㅎ 실물이 더 예뻐요! 😊",
      "칭찬 감사해요! 현장에서 봤을 때 너무 예뻐서 저도 신나서 찍었어요 📸",
    ]);
  if (/공감|저도|나도|그렇죠|맞아|ㅋㅋ|ㅎㅎ/.test(t))
    return pick([
      "공감해 주셔서 너무 반가워요 ㅎㅎ 앞으로도 자주 놀러 오세요! 😄",
      "그쵸그쵸 ㅎㅎ 저도 그 생각 했었어요! 댓글 감사해요 😊",
      "맞죠 ㅎㅎ 저만 그런 줄 알았는데 반가워요! 😄",
    ]);
  if (/설레|기대|두근|궁금/.test(t))
    return pick([
      "저도 정말 설렜어요 ㅎㅎ 직접 경험해 보시면 더 재밌으실 거예요! 😊",
      "기대하셔도 좋아요! 저도 다시 가고 싶을 만큼 좋았거든요 😄",
    ]);
  if (/정보|팁|꿀팁|도움|유용|참고|몰랐/.test(t))
    return pick([
      "도움이 되셨다니 정말 기뻐요! 앞으로도 유용한 정보 많이 올릴게요 😊",
      "저도 알고 나서 완전 유용하게 쓰고 있어요 ㅎㅎ 잘 활용해 보세요! 🙂",
    ]);
  if (/소개팅|이벤트|행사|파티|모임/.test(t))
    return pick([
      "저도 엄청 설레는 경험이었어요 ㅎㅎ 기회 되시면 꼭 한번 해보세요! 😊",
      "진짜 색다른 경험이었어요! 댓글 감사해요 😄",
    ]);
  return pick([
    "댓글 남겨주셔서 감사해요! 앞으로도 자주 놀러 오세요 😊",
    "읽어주셔서 감사해요! 도움이 됐으면 좋겠어요 🙂",
    "방문해 주셔서 감사해요! 좋은 하루 보내세요 😊",
    "댓글 너무 감사해요! 앞으로도 좋은 정보 나눌게요 😄",
  ]);
}

/**
 * 네이버 세션 로드 또는 수동 로그인 후 context 반환
 * @param {import('playwright').Browser} browser
 * @param {string} statePath  naverState.json 경로
 */
async function getNaverContext(browser, statePath) {
  const fs = require("fs");
  if (fs.existsSync(statePath)) {
    return browser.newContext({ storageState: statePath, viewport: { width: 1280, height: 900 } });
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded" });
  console.log("로그인 완료 후 터미널에서 엔터를 누르세요...");
  await new Promise((resolve) => { process.stdin.resume(); process.stdin.once("data", resolve); });
  await context.storageState({ path: statePath });
  patchSessionCookies(statePath);
  await page.close();
  return context;
}

/**
 * storageState.json 저장 후 세션 쿠키(expires: -1)에 30일 만료일 부여
 * Playwright는 세션 쿠키를 저장하지만 새 브라우저에서 복원이 불안정하므로 실제 만료일로 패치
 */
function patchSessionCookies(statePath) {
  const fs = require("fs");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const thirtyDays = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
  let patched = false;
  state.cookies = state.cookies.map((c) => {
    if (c.expires === -1 || c.expires <= 0) {
      patched = true;
      return { ...c, expires: thirtyDays };
    }
    return c;
  });
  if (patched) fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Gemini(우선) → Claude(fallback) 로 블로그 댓글/답글 생성
 * 429 시 retryDelay 만큼 대기 후 1회 재시도
 * AI 모두 실패하면 null 반환
 */
/**
 * 지시문 echo/분석 서론(주로 Claude Code CLI fallback가 붙임) 판정
 */
function looksLikeMeta(p) {
  return /출력(?:하|한|할|합)|지시(?:문|사항|대로)|답글 텍스트만|이건 (?:실제 )?댓글이 아니|먼저 이 ?댓글|프롬프트|규칙(?:에 따라|대로)|^\s*(?:답글|답변|쿼리)[\s,은는이가을를]/.test(p);
}

/**
 * 게시 가능한 깨끗한 답글인지 검증 (실패 시 게시하지 않음)
 */
function isCleanReply(text) {
  if (!text) return false;
  if (text.length > 200) return false;         // 답글은 1~2문장
  if (/\*\*|```|\n/.test(text)) return false;  // 마크다운/여러 줄
  return !looksLikeMeta(text);
}

/**
 * AI 답글 응답에서 지시문 echo 머리말/코드블록/감싼 따옴표 제거
 */
function sanitizeComment(text) {
  if (!text) return text;
  let t = text.trim();
  t = t.replace(/^```[\s\S]*?\n/, "").replace(/```\s*$/, "").trim();
  // 여러 문단이면 지시문 echo/분석 서론 문단 제거
  const paras = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const kept = paras.filter((p) => !looksLikeMeta(p));
  if (kept.length) t = kept.join(" ");
  const stripped = t
    .replace(
      /^["'“‘]?\s*(?:네[,.]?\s*)?[^:\n]*?(?:출력|작성|답글|답변|하셨|말씀|드릴게요|드리겠|할게요)[^:\n]*:\s*/u,
      "",
    )
    .trim();
  t = stripped || t;
  t = t.replace(/^["'“‘]+/, "").replace(/["'”’]+$/, "").trim();
  return t;
}

async function generateBlogComment(prompt) {
  function parseRetryDelay(errMsg) {
    const m = (errMsg || "").match(/retry in (\d+(?:\.\d+)?)s/i)
           || (errMsg || "").match(/"retryDelay"\s*:\s*"(\d+)s"/);
    return m ? Math.ceil(parseFloat(m[1])) * 1000 : 0;
  }

  // 1순위: Gemini (실패 시 retryDelay 만큼 대기 후 재시도)
  if (process.env.GEMINI_API_KEY?.trim()) {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const text = sanitizeComment(result.response.text());
        if (isCleanReply(text)) return text;
      } catch (e) {
        const delay = parseRetryDelay(e.message);
        if (delay > 0 && attempt === 0) {
          console.log(`  Gemini 429 - ${delay / 1000}초 대기 후 재시도...`);
          await sleep(delay);
        } else {
          console.log(`  Gemini 실패 (${e.message.slice(0, 60)})`);
          break;
        }
      }
    }
  }

  // 2순위: Claude
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    try {
      const { default: Anthropic } = require("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 120,
        messages: [{ role: "user", content: prompt }],
      });
      const text = sanitizeComment(response.content[0].text);
      if (isCleanReply(text)) return text;
    } catch (e) {
      console.log(`  Claude 실패 (${e.message.slice(0, 60)})`);
    }
  }

  // 3순위: Claude Code CLI fallback
  try {
    console.log("  AI 모두 실패 - Claude Code CLI로 대체");
    const { execFileSync } = require("child_process");
    const sys = "너는 네이버 블로그 답글 문장만 생성한다. 서론, 분석, 설명, 따옴표, 마크다운 없이 답글 한 줄만 출력하라.";
    const result = sanitizeComment(execFileSync(
      "claude",
      ["-p", prompt, "--append-system-prompt", sys, "--output-format", "text"],
      { timeout: 30000, encoding: "utf-8", env: process.env, cwd: __dirname }
    ));
    if (isCleanReply(result)) return result;
  } catch (e) {
    console.log(`  Claude Code CLI 실패 (${e.message.slice(0, 60)})`);
  }

  console.log("  모든 방법 실패 - 스킵");
  return null;
}

/**
 * 네이버 블로그 RSS에서 최신 글 URL N개 반환 (실패 시 빈 배열)
 */
async function fetchLatestBlogUrls(blogId, count = 3) {
  try {
    const res = await fetch(`https://rss.blog.naver.com/${blogId}.xml`);
    if (!res.ok) return [];
    const xml = await res.text();
    const urls = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRe.exec(xml)) !== null && urls.length < count) {
      const block = m[1];
      const guid = block.match(/<guid>([\s\S]*?)<\/guid>/);
      let url = guid ? guid[1].trim() : null;
      if (!url) {
        const link = block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
        url = link ? link[1].trim() : null;
      }
      if (url) urls.push(url.split("?")[0]);
    }
    return urls;
  } catch (_) {
    return [];
  }
}

module.exports = {
  fetchLatestBlogUrls,
  sanitizeComment,
  isCleanReply,
  pickFirstVisibleLocator,
  debugDump,
  sleep,
  patchSessionCookies,
  pick,
  pickTemplate,
  getNaverContext,
  generateBlogComment,
};
