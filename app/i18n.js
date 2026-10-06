// Tiny i18n: English by default, Korean when the browser prefers it.
const strings = {
  en: {
    open: "Open PDF",
    contents: "Contents",
    noOutline: "This PDF has no table of contents.",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    zoomReset: "Fit width",
    page: "Page",
    emptyTitle: "Drop a PDF here or click <b>Open PDF</b>.",
    emptyHint: "Opens huge PDFs without loading the whole file into memory, so even 4GB Chromebooks don't freeze. Your file never leaves this device.",
    installHint: "Tip: install this app, then right-click any PDF in Files → Open with → this app.",
    cantOpen: "Can't open this file",
    resumed: (n) => `Resumed at page ${n}`,
  },
  ko: {
    open: "PDF 열기",
    contents: "목차",
    noOutline: "이 PDF에는 목차가 없어요.",
    zoomIn: "확대",
    zoomOut: "축소",
    zoomReset: "폭 맞춤",
    page: "페이지",
    emptyTitle: "PDF를 여기로 끌어다 놓거나 <b>PDF 열기</b>를 누르세요.",
    emptyHint: "파일을 통째로 메모리에 올리지 않아서, 큰 PDF도 4GB 크롬북에서 멈추지 않고 열려요. 파일은 이 기기 밖으로 나가지 않아요.",
    installHint: "팁: 이 앱을 설치한 뒤 파일 앱에서 PDF를 우클릭 → 연결 프로그램 → 이 앱을 고르세요.",
    cantOpen: "열 수 없어요",
    resumed: (n) => `${n}쪽부터 이어서 읽어요`,
  },
};

const lang = (navigator.languages || [navigator.language]).some((l) => l?.startsWith("ko")) ? "ko" : "en";
export const t = strings[lang];

export function applyStrings(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll("[data-i18n]")) el.innerHTML = t[el.dataset.i18n];
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    el.title = t[el.dataset.i18nTitle];
    el.setAttribute("aria-label", el.title);
  }
}
