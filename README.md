# Chromebook PDF Reader

4GB RAM 크롬북에서도 수백 MB짜리 PDF(예: 1000쪽 넘는 디지털 교과서)를 멈추지 않고 여는 가벼운 PDF 리더.

## 왜 필요한가
Gallery 앱과 Chrome 내장 뷰어는 큰 PDF를 열 때 파일 전체를 메모리에 올림.
800MB 파일이면 1GB 이상을 한꺼번에 쓰게 되고, 4GB 크롬북은 그 자리에서 멈춤.
→ [experiments/01-load-memory](experiments/01-load-memory/README.md)

## 어떻게 가볍게 만드나
- **범위 읽기**: `File.slice()`로 pdf.js가 요청한 64KB 조각만 디스크에서 읽음 (`app/file-range-transport.js`)
- **가상 스크롤**: 화면에 보이는 페이지 ±1쪽만 DOM·캔버스를 가짐 (`app/viewer.js`)
- **렌더링 제한**: 한 번에 한 페이지만 그리고, 스크롤 중에는 그리지 않음
- **캔버스 상한**: 페이지당 최대 4M 픽셀(16MB), 화면을 벗어나면 즉시 해제
- **이미지 축소**: 큰 내장 이미지는 워커에서 줄여서 디코딩 (`canvasMaxAreaInBytes`)

## 실행
```sh
npm install      # pdf.js를 app/vendor로 복사
npm start        # http://localhost:8080
```
설치 없이 정적 파일(`app/`)만 있으면 동작함.

## 벤치마크
실제 Chromium에서 열고 Chromium 전체 프로세스의 PSS를 측정:
```sh
python3 experiments/01-load-memory/gen.py 1081 big.pdf   # 795MB 테스트 PDF
npm run bench -- big.pdf range whole
```

795MB·1081쪽, 1366×768 화면 (브라우저 자체 사용량 276MB 포함):

| 단계 | range (이 리더) | whole (일반 뷰어 방식) |
|---|---|---|
| 열기 + 1쪽 | 3.0초 / 최대 499MB | 4.0초 / 최대 1,095MB |
| 540쪽 이동 | 0.1초 / 466MB | 0.1초 / 1,114MB |
| 1081쪽 이동 | 0.1초 / 465MB | 0.1초 / 1,129MB |
| 빠른 스크롤 4초 | 523MB | 1,173MB |
| 천천히 40쪽 | 551MB | 1,208MB |

## 알려진 한계
- **읽은 조각이 해제되지 않음**: pdf.js의 `ChunkedStream`은 파일 크기만큼 버퍼를 예약하고
  (`new Uint8Array(length)`) 받은 조각을 계속 보관함. 처음 열 때는 가볍지만, 책 전체를 넘겨보면
  최대 파일 크기까지 메모리가 늘 수 있음.
- 모든 페이지가 1쪽과 같은 크기라고 가정하고 배치함 (다른 크기의 페이지는 칸 안에 맞춤)
- 아직 검색, 목차, 텍스트 선택, 확대 기능 없음
