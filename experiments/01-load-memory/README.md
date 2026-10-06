# 실험 01 — 파일 전체 로딩 vs 범위(Range) 로딩 메모리 비교

## 배경
4GB RAM 크롬북(Poin2)에서 약 800MB·1081쪽 디지털 교과서 PDF를 Gallery 앱이나 Chrome으로
열면 더블클릭 직후 시스템 전체가 멈춤. 가설: 뷰어가 **파일 전체를 메모리에 올리기 때문**.

## 방법
- `gen.py`: 795MB, 1081쪽, 페이지마다 압축 불가능한 RGB 이미지(약 735KB)를 넣은 PDF 생성
- `measure.mjs`: pdf.js(Node)로 1·540·1081쪽을 열고 `getOperatorList`까지 수행(이미지 디코딩 포함), 최대 RSS 측정
  - `whole`: 파일 전체를 읽어 `getDocument({ data })`
  - `range`: `PDFDataRangeTransport`로 필요한 64KB 청크만 읽음 (`disableAutoFetch`, `disableStream`)

```sh
python3 gen.py 1081 big.pdf
npm i pdfjs-dist@4
node measure.mjs whole big.pdf
node measure.mjs range big.pdf
```

## 결과 (클라우드 컨테이너, Node 22, pdfjs-dist 4)

|                        | whole    | range   |
|------------------------|----------|---------|
| 최대 메모리 (VmHWM)     | 1,610MB  | 324MB   |
| (Node+pdf.js 기본 84MB 제외) | ~1,530MB | ~240MB  |
| 문서 열기 시간          | 5~10초   | ~1초    |
| 디스크 읽은 양          | 795MB    | 73MB    |

## 결론 / 한계
- 전체 로딩은 파일 크기의 약 2배를 메모리에 올림 → 4GB 기기에서 OOM·zram 스래싱과 일치
- 범위 로딩은 메모리가 파일 크기와 무관하게 "열린 페이지 수"에 비례
- 한계: 캔버스 렌더링 비용 미포함, 실제 교과서(JPEG 등) 아님, 크롬북보다 빠른 CPU
- range 모드에서 73MB를 읽은 이유: 평평한(flat) 페이지 트리에서 N쪽을 찾을 때 pdf.js가 앞쪽
  페이지 객체를 하나씩 확인하기 때문(요청 1090건 × 64KB). 메모리 영향은 없으나 I/O 최적화 여지 있음
