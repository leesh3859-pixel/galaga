# 테트리스 (Tetris)

순수 HTML / CSS / JavaScript(Canvas)로 만든 클래식 테트리스 게임입니다. 빌드 도구나 외부 라이브러리 없이 브라우저에서 바로 실행됩니다.

## 실행 방법

저장소를 받은 뒤 `index.html`을 브라우저로 열면 됩니다.

```bash
git clone https://github.com/<your-account>/tetris.git
cd tetris
open index.html   # macOS
```

## 조작법

| 키 | 동작 |
|----|------|
| ← → | 좌우 이동 |
| ↑ | 회전 |
| ↓ | 소프트 드롭 |
| Space | 하드 드롭 |
| P | 일시정지 / 재개 |

## 기능

- 7가지 테트로미노(I, J, L, O, S, T, Z)와 색상
- 라인 클리어 및 점수 시스템(레벨에 따른 가속)
- NEXT 미리보기, 고스트(낙하 예상 위치) 표시
- 레벨/라인/점수 표시, 일시정지, 게임 오버

## 라이선스

MIT
