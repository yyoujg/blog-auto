// npm 스크립트 도움말 — npm run help
const sections = [
  ["1 포스팅", [
    ["post", "리뷰노트(하루3개+최근20개) + revu.net(최근20개) 조건 충족 시 자동 포스팅"],
  ]],
  ["2 세션 저장", [
    ["login-note", "reviewnote.co.kr 세션 저장 -> storageState.json (수동 로그인)"],
    ["login-revu", "revu.net 세션 저장 -> storageState-revu.json (수동 로그인)"],
    ["login-naver", "네이버 세션 저장 -> naverState.json"],
  ]],
  ["3 네이버", [
    ["like", "이웃 블로그 포스트 공감 클릭 (Ctrl+C 종료)"],
    ["reply-comments", "댓글에 AI 답댓글 자동 (최대 10개, --limit N)"],
  ]],
  ["4 리뷰노트", [
    ["check-note", "리뷰노트 포스팅 조건 확인"],
    ["post-note", "리뷰노트 커뮤니티 포스팅"],
  ]],
  ["5 레뷰", [
    ["check-revu", "revu.net 최근 20개 중 내 글 확인 -> exit(0/1)"],
    ["post-revu", "revu.net 커뮤니티 포스팅"],
  ]],
];

const pad = Math.max(...sections.flatMap((s) => s[1].map((c) => c[0].length)));
for (const [title, cmds] of sections) {
  console.log(`\n${title}`);
  for (const [cmd, desc] of cmds) {
    console.log(`  npm run ${cmd.padEnd(pad)}  ${desc}`);
  }
}
console.log("");
