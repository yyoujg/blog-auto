require("dotenv").config();

module.exports = {
  myAuthorName: process.env.MY_AUTHOR_NAME,
  maxPostsPerDay: 3,
  urls: process.env.FALLBACK_BLOG_URL ? [process.env.FALLBACK_BLOG_URL] : [],
  myBlogId: process.env.MY_BLOG_ID,

  // API 키 및 기준 주소 (.env)
  KAKAO_REST_API_KEY: process.env.KAKAO_REST_API_KEY,
  ODSAY_API_KEY: process.env.ODSAY_API_KEY,
  ORIGIN_ADDRESS: process.env.ORIGIN_ADDRESS,

  // 노션 API (.env)
  NOTION_TOKEN: process.env.NOTION_TOKEN,
  NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID,

  USER_ID: process.env.USER_ID,
  REVU_USER_ID: process.env.REVU_USER_ID ? Number(process.env.REVU_USER_ID) : undefined,
};
