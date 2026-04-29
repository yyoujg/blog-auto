"""
블로그 본문 줄바꿈 포맷터
- 공백 제외 20자 기준으로 줄바꿈
- 문장 끝(마침표/느낌표/물음표)에 빈줄 추가
- 이미지 태그, 구조 정보, 해시태그 등은 건드리지 않음

사용법:
  python3 formatter.py 블로그파일.txt
  python3 formatter.py 블로그파일.txt --output 출력파일.txt
"""

import re
import sys

MAX_NS = 20  # 공백 제외 최대 글자 수


def ns_len(s):
    return sum(1 for c in s if c != ' ')


def should_skip(line):
    """포맷하면 안 되는 줄 판단"""
    stripped = line.strip()
    if not stripped:
        return True
    if stripped.startswith('[이미지:') or stripped.startswith('[동영상:') or stripped.startswith('[지도:'):
        return True
    if stripped.startswith('|') or stripped.startswith('#'):
        return True
    if stripped.startswith('-') or stripped.startswith('*') or stripped.startswith('✔') or stripped.startswith('→'):
        return True
    if stripped.startswith('■') or stripped.startswith('※') or stripped.startswith('📍') or stripped.startswith('🏨'):
        return True
    if stripped.startswith('✔') or stripped.startswith('✖') or stripped.startswith('△'):
        return True
    if re.search(r'\d{2}:\d{2}-\d{2}:\d{2}', stripped):
        return True
    if stripped.startswith('[비디오') or stripped.startswith('[썸네일') or stripped.startswith('옵션'):
        return True
    if stripped.startswith('- 파일명:') or stripped.startswith('- 제목:') or stripped.startswith('- 설명:'):
        return True
    if stripped.startswith('- 해시태그:') or stripped.startswith('- 축약'):
        return True
    if stripped.startswith('메인 1줄:') or stripped.startswith('메인 2줄:') or stripped.startswith('서브:'):
        return True
    if '/' in stripped and stripped.count('/') >= 2:
        return True
    if re.match(r'^제목:', stripped) or re.match(r'^\*\*', stripped):
        return True
    if stripped.startswith('---'):
        return True
    return False


def ends_sentence(line):
    """문장 종결 여부 (빈줄 추가 기준)"""
    stripped = line.rstrip()
    return stripped.endswith(('요.', '요!', '요?', '다.', '다!', '다?', '죠.', '죠?',
                               '네.', '네!', '고요.', '어요.', '아요.', '에요.', '이에요.',
                               '예요.', '겠어요.', '했어요.', '있어요.', '없어요.', '같아요.',
                               '같습니다.', '합니다.', '됩니다.', '입니다.', '니다.',
                               '가요.', '나요.', '세요.', '줘요.', '해요.'))


def wrap_line(text):
    """한 문장을 MAX_NS 기준으로 줄바꿈"""
    words = text.split(' ')
    lines = []
    current = ''
    for word in words:
        candidate = (current + ' ' + word).strip() if current else word
        if ns_len(candidate) <= MAX_NS:
            current = candidate
        else:
            if current:
                lines.append(current)
            # 단어 자체가 MAX_NS 초과면 그냥 통째로
            current = word
    if current:
        lines.append(current)
    return lines


def format_blog(text):
    input_lines = text.splitlines()
    output = []
    i = 0

    while i < len(input_lines):
        line = input_lines[i]

        if not line.strip():
            # 빈줄은 최대 1개만 연속 허용
            if output and output[-1] != '':
                output.append('')
            i += 1
            continue

        if should_skip(line):
            output.append(line)
            i += 1
            continue

        # 일반 서술 텍스트: 줄바꿈 적용
        wrapped = wrap_line(line.strip())
        for w in wrapped:
            output.append(w)

        # 문장 종결이면 빈줄 추가
        last = wrapped[-1] if wrapped else ''
        if ends_sentence(last):
            output.append('')

        i += 1

    # 마지막 연속 빈줄 정리
    while output and output[-1] == '':
        output.pop()

    return '\n'.join(output)


def main():
    if len(sys.argv) < 2:
        print("사용법: python3 formatter.py 입력파일.txt [--output 출력파일.txt]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = input_path  # 기본: 덮어쓰기

    if '--output' in sys.argv:
        idx = sys.argv.index('--output')
        if idx + 1 < len(sys.argv):
            output_path = sys.argv[idx + 1]

    with open(input_path, 'r', encoding='utf-8') as f:
        original = f.read()

    result = format_blog(original)

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(result)

    lines_in = len(original.splitlines())
    lines_out = len(result.splitlines())
    print(f"완료: {lines_in}줄 -> {lines_out}줄 ({output_path})")


if __name__ == '__main__':
    main()
