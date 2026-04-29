"use strict";
const Anthropic = require("@anthropic-ai/sdk");
const { STICKER_INDEX_MAP } = require("./constants");

const STICKER_LIST = Object.keys(STICKER_INDEX_MAP);

/**
 * GPT API로 블로그 포스팅 구조(JSON) 생성
 * @returns {{ title: string[], blocks: object[], hashtags: string[] }}
 */
async function generatePost({ placeInfo, topPosts, campaignType, photoCount, videoCount = 0 }) {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY가 없습니다. .env 파일을 확인하세요.");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const disclosureText =
    campaignType === "내돈내산"
      ? "※ 본 포스팅은 내돈내산\\n솔직한 후기임을\\n미리 밝힙니다"
      : `※ 본 포스팅은 ${campaignType}을 통해\\n업체로부터 서비스를 제공받아\\n작성된 솔직한 후기입니다`;

  const prompt = `당신은 네이버 블로그 체험단 전문 작가입니다.
아래 정보를 바탕으로 블로그 포스팅 구조를 JSON으로 생성하세요.

[업체 정보]
${JSON.stringify(placeInfo, null, 2)}

[상위노출 글 키워드 참고]
${topPosts || "(없음)"}

[캠페인 유형] ${campaignType}
[사진 수] ${photoCount}장
[동영상 수] ${videoCount}개

[사용 가능한 스티커 (이 목록에서만 선택)]
${STICKER_LIST.join(", ")}

[출력 규칙 — 반드시 준수]
- JSON만 반환. 마크다운 코드블록, 설명 텍스트 절대 없음.
- title: SEO 최적화 제목 후보 5개 배열 (각 35~50자, 핵심 키워드 포함)
- blocks: 아래 타입 객체 배열
  { "type": "sticker", "value": "스티커 이름" }
  { "type": "text", "bold": false, "fontSize": 16, "content": "내용 (\\n으로 줄바꿈, 한 줄 24자 이내)" }
  { "type": "photo_slot", "count": N }   ← 사진 N장 삽입 위치
  { "type": "divider" }
  { "type": "map" }
  { "type": "video_slot" }              ← 동영상 삽입 위치
- hashtags: 25~30개 배열 (# 없이, 지역명+업종+특징 혼합)

[글 구성 가이드]
① 도입: 캠페인 스티커("오늘의 포스팅"/"내돈내산"/"오늘의 맛집"/"오늘의 카페" 중 택1)
   → 캠페인 고지 텍스트 fontSize=16: "${disclosureText}"
   → 외부 사진 2~3장 (photo_slot)

② 인사: "안녕하세요" 스티커
   → 소개글 fontSize=16 (3~4줄, 방문 계기·기대감)
   → 외부/내부 사진 2~3장

③ 본문 (섹션당: 스티커 → 텍스트 fontSize=16 → 사진 → 사진 설명 fontSize=13):
   - "외부&내부" 또는 "체크사항": 공간·분위기 묘사
   - "메뉴판": 메뉴 소개 (메뉴 있으면)
   - "시그니처메뉴" 또는 "추천하는메뉴": 추천 메뉴 상세
   - "주문리스트": 주문한 것 목록 (텍스트+사진)
   - "기본세팅": 기본 세팅·분위기
   - "디테일샷": 클로즈업·디테일 사진
   (동영상 있으면 본문 중간에 video_slot 1개)

④ 위치 정보: divider → "위치정보" 스티커
   → 업체명 bold fontSize=19
   → 주소/영업시간/전화 fontSize=15
   → map (지도)
   → 주소: ${placeInfo.address || ""}
   → 영업시간: ${placeInfo.hours || ""}
   → 전화: ${placeInfo.phone || ""}

⑤ 마무리: "좋았던점" 스티커 → 총평 fontSize=16 (3~4줄)
   → divider → "마무리 총평" 스티커 → 마무리 인사 fontSize=16
   → "감사합니다" 스티커
   → 해시태그 텍스트 fontSize=15 (hashtags 배열 내용을 # 붙여 나열)

[중요]
- photo_slot count 합계 = ${photoCount}장 (모든 사진 소진)
- 동영상 수 ${videoCount}개에 맞춰 video_slot 배치
- 텍스트는 24자 이내/줄, 자연스럽고 진솔한 말투
- 지도(map)는 반드시 1개만 포함`;

  console.log("[generator] Claude API 호출 중...");
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8096,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content[0].text.trim();

  // JSON 파싱 (코드블록 제거 후 시도)
  const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/```$/m, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`JSON 파싱 실패.\n응답 앞부분:\n${raw.slice(0, 300)}`);
  }
}

module.exports = { generatePost, STICKER_LIST };
