# 갤러그 (Galaga)

순수 HTML / CSS / JavaScript(Canvas)로 만든 클래식 슈팅 게임입니다. 빌드 도구나 외부 라이브러리 없이 브라우저에서 바로 실행됩니다.

## 실행 방법

저장소를 받은 뒤 `index.html`을 브라우저로 열면 됩니다.

```bash
git clone https://github.com/<your-account>/tetris.git
cd tetris
open index.html   # macOS
```

> 더블클릭으로 열어도 동작합니다(외부 의존성·서버 불필요).

## 조작법

| 키 | 동작 |
|----|------|
| ← → | 좌우 이동 |
| Space | 발사 |
| P | 일시정지 / 재개 |

먼저 **시작 / 재시작** 버튼을 눌러 게임을 시작하세요.

## 기능

- 편대(formation) 비행 + 무작위 강하(dive) 공격을 하는 적
- 스테이지가 오를수록 적의 행 수·속도·공격 빈도 증가
- 점수/최고점수(localStorage 저장)/스테이지/목숨 표시
- 스크롤되는 별 배경, 일시정지, 게임 오버 및 재시작

## 라이선스

MIT
