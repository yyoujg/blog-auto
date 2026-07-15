require("dotenv").config();

module.exports = {
  myAuthorName: process.env.MY_AUTHOR_NAME,
  maxPostsPerDay: 3,
  urls: process.env.FALLBACK_BLOG_URL ? [process.env.FALLBACK_BLOG_URL] : [],
  myBlogId: process.env.MY_BLOG_ID,

  USER_ID: process.env.USER_ID,
  REVU_USER_ID: process.env.REVU_USER_ID ? Number(process.env.REVU_USER_ID) : undefined,
};
