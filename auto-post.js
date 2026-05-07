const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { urls, maxPostsPerDay, USER_ID } = require("./core/config");

function formatError(err) {
  if (!err) return "Unknown error";
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? `\n[cause]\n${err.cause.stack || err.cause.message}` : "";
    return `${err.stack || err.message}${cause}`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function logError(tag, err, extra) {
  const extraText = extra ? `\n[context]\n${JSON.stringify(extra, null, 2)}` : "";
  console.error(`[error] ${tag}\n${formatError(err)}${extraText}`);
}

process.on("unhandledRejection", (reason) => {
  logError("unhandledRejection", reason);
  process.exitCode = 1;
});
process.on("uncaughtException", (err) => {
  logError("uncaughtException", err);
  process.exit(1);
});

// 실행 전 기존 Chrome for Testing 프로세스 종료 (다른 스크립트가 사용 중이면 스킵)
const BROWSER_SCRIPTS = [
  "reviewnote-login.js", "revu-login.js",
  "reviewnote/reviewnote-auto-login.js", "save-session-revu.js",
  "naver-login.js", "naver-like.js",
  "naver-collect-commenters.js",
  "naver-blog-post.js",
];
try {
  const running = execSync("pgrep -fl node 2>/dev/null || true").toString();
  const otherRunning = BROWSER_SCRIPTS.some((s) => running.includes(s));
  if (otherRunning) {
    console.log("[init] 다른 스크립트가 Chrome 사용 중 - 종료 스킵");
  } else {
    execSync('pkill -f "Google Chrome for Testing" 2>/dev/null || true');
    console.log("[init] 기존 Chrome for Testing 창 종료 완료");
  }
} catch (e) {
  // 무시
}

function getCookieHeader() {
  const statePath = path.join(__dirname, "storageState.json");
  let raw;
  try {
    raw = fs.readFileSync(statePath, "utf8");
  } catch (err) {
    const e = new Error(
      [
        "storageState.json을 읽지 못했습니다.",
        "  → 아래 명령 1개 실행 후 다시 시도하세요:",
        "  npm run login-auto",
      ].join("\n"),
      {
      cause: err,
      },
    );
    logError("getCookieHeader.readFile", e, { statePath });
    throw e;
  }

  let state;
  try {
    state = JSON.parse(raw);
  } catch (err) {
    const e = new Error("storageState.json 파싱 실패 (JSON 형식 오류)", { cause: err });
    logError("getCookieHeader.parseJson", e, { statePath });
    throw e;
  }

  return state.cookies
    .filter((c) => c.domain.endsWith("reviewnote.co.kr"))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

const API_BASE =
  "https://www.reviewnote.co.kr/api/v2/communities?" +
  "where=%7B%22isMustRead%22:false%7D&q=&searchCategory=" +
  "&orderBy=%7B%22createdAt%22:%22desc%22%7D&communityType=friend&category=all" +
  `&currentUserId=${USER_ID}`;

async function getTodayPostCount() {
  const today = new Date().toISOString().slice(0, 10);
  const headers = { Cookie: getCookieHeader() };
  let count = 0;
  for (let page = 1; page <= 500; page++) {
    const url = `${API_BASE}&page=${page}&limit=20`;
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      const e = new Error("Reviewnote API 요청 실패 (fetch)", { cause: err });
      logError("getTodayPostCount.fetch", e, { url, page });
      throw e;
    }
    if (!res.ok) {
      if (res.status === 401) {
        console.error(
          [
            "[오류] Reviewnote 세션 만료",
            "  → 아래 명령 1개 실행 후 다시 시도하세요:",
            "  npm run login-auto",
          ].join("\n"),
        );
      }
      let bodyPreview = "";
      try {
        const text = await res.text();
        bodyPreview = text.slice(0, 500);
      } catch {
        // ignore
      }
      const e = new Error(`Reviewnote API error: ${res.status}`);
      logError("getTodayPostCount.http", e, { url, page, status: res.status, bodyPreview });
      throw e;
    }
    let data;
    try {
      data = await res.json();
    } catch (err) {
      const e = new Error("Reviewnote API 응답 JSON 파싱 실패", { cause: err });
      logError("getTodayPostCount.json", e, { url, page, status: res.status });
      throw e;
    }
    if (!data.objects || data.objects.length === 0) return count;
    for (const post of data.objects) {
      if (!post.createdAt.startsWith(today)) return count;
      if (post.userId === USER_ID) count++;
    }
    if (count >= maxPostsPerDay) return count;
    if (data.objects.length < 20) return count;
  }
  return count;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
const titles = [
  "꼼꼼히 읽고 찐소통하실 서이추 환영해요 🌸",
  "좋은 글 함께 읽고 진심으로 소통해요 💖",
  "의미 없는 공감보단 따뜻한 소통 원해요 ✨",
  "꾸준히 찐소통 이어갈 서로이웃 찾아요 🩷",
  "글 읽고 생각 나누는 서이추 대환영입니다 💝",
  "솔직한 후기 공유하며 소통할 이웃 찾아요 😊",
  "복붙 댓글 말고 찐소통할 서이추 환영해요 💗",
  "형식적인 이웃 말고 진짜 소통 원해요 🌿",
  "편하게 일상 나누고 대화할 서이추 환영 💬",
  "자주 방문해서 댓글로 소통할 찐이웃 구해요 🌹",
  "서이추 환영! 공감되면 편하게 댓글 남겨요 💚",
  "기본 멘트 사양 🙅‍♀️ 글 읽고 소통해요 🩵",
  "좋은 정보와 일상 함께 나누실 분 서이추 ❤",
  "오래오래 찐소통 이어갈 소중한 이웃 찾아요 💞",
  "초보 블로거 서이추 환영! 편하게 소통해요 🐣",
  "공감만 꾹? 다정하게 댓글로 소통해요 🙌",
  "서이추 대환영 💖 후기 읽고 의견 나눠봐요",
  "성의 있는 댓글로 쫀쫀하게 소통해요 🌸",
  "꼼꼼히 읽고 남겨주신 댓글 환영! 서이추 💝",
  "부담 없이 편하게 대화 나눌 이웃 환영해요 🩷",
];

function shouldPost() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "reviewnote/reviewnote-check.js")], {
      stdio: "ignore",
    });
    child.on("error", (err) => {
      logError("shouldPost.spawn", err, { script: "reviewnote/reviewnote-check.js" });
      resolve(false);
    });
    child.on("close", (code) => resolve(code === 1));
  });
}

function shouldRevuPost() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "revu/revu-check.js")], {
      stdio: "ignore",
    });
    child.on("error", (err) => {
      logError("shouldRevuPost.spawn", err, { script: "revu/revu-check.js" });
      resolve(false);
    });
    child.on("close", (code) => resolve(code === 1));
  });
}

function runAutoLogin() {
  return new Promise((resolve) => {
    console.log("[auto-login] 세션 만료 감지 → 자동 재로그인 시도...");
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "reviewnote/reviewnote-auto-login.js")],
      { stdio: "inherit" }
    );
    child.on("error", (err) => {
      logError("runAutoLogin.spawn", err, { script: "reviewnote/reviewnote-auto-login.js" });
      resolve(1);
    });
    child.on("close", (code) => resolve(code));
  });
}

function runPost(title, url) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "reviewnote/reviewnote-post.js"), title, url, "블로그"],
      { stdio: "inherit" }
    );
    child.on("error", (err) => {
      logError("runPost.spawn", err, { script: "reviewnote/reviewnote-post.js", title, url });
      resolve(1);
    });
    child.on("close", (code) => {
      console.log("종료 코드:", code);
      resolve(code);
    });
  });
}

function runRevuPost(title, url) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "revu/revu-post.js"), title, url],
      { stdio: "inherit" }
    );
    child.on("error", (err) => {
      logError("runRevuPost.spawn", err, { script: "revu/revu-post.js", title, url });
      resolve(1);
    });
    child.on("close", (code) => {
      if (code !== 0) console.log("[revu.net] 게시 실패 (종료 코드:", code + ")");
      resolve(code);
    });
  });
}

(async () => {
  try {
    // revu.net: 1회 체크 후 필요하면 1회 게시
    const revuNeedPost = await shouldRevuPost();
    if (!revuNeedPost) {
      console.log("[revu.net] 최근 페이지에 내 글 있음 - 완료");
    } else {
      console.log("[revu.net] 최근 페이지에 내 글 없음 - 포스팅");
      const revuCode = await runRevuPost(pick(titles), pick(urls));
      if (revuCode !== 0) console.log("[revu.net] 포스팅 실패");
      else console.log("[revu.net] 글 작성 완료!");
    }

    // reviewnote: 1회 체크 후 필요하면 1회 게시
    const needPost = await shouldPost();
    if (!needPost) {
      console.log("최근 페이지에 내 글이 있음 - 완료");
      return;
    }

    const todayCount = await getTodayPostCount();
    if (todayCount >= maxPostsPerDay) {
      console.log(`오늘 글 작성 한도(${maxPostsPerDay}회) 도달 - 완료`);
      return;
    }

    console.log(`[오늘 ${todayCount + 1}/${maxPostsPerDay}회] 최근 페이지에 내 글 없음 - 포스팅`);
    const exitCode = await runPost(pick(titles), pick(urls));
    if (exitCode !== 0) {
      console.error("[reviewnote] 포스팅 실패. (세션 만료 가능) 자동 재로그인 시도합니다.");
      const loginCode = await runAutoLogin();
      if (loginCode !== 0) console.log("자동 재로그인 실패");
      else console.log("재로그인 성공 - 다음 cron 실행 시 재시도됩니다");
    } else {
      console.log("[reviewnote] 글 작성 완료!");
    }
  } catch (err) {
    logError("auto-post.main", err);
    process.exitCode = 1;
  }
})();
