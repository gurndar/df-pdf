// Overlays drawn on top of a rendered page canvas:
//  - a transparent text layer so text can be selected and copied
//  - clickable link areas for the page's link annotations
// Both are built only for pages on screen and removed with the page.
import { TextLayer } from "./vendor/pdf.min.mjs";

export async function buildTextLayer(page, viewport, parent) {
  const div = document.createElement("div");
  div.className = "textLayer";
  div.style.setProperty("--scale-factor", viewport.scale);
  parent.append(div);
  const layer = new TextLayer({ textContentSource: page.streamTextContent(), container: div, viewport });
  const done = layer.render().then(() => {
    // Lets a drag that leaves the last line keep selecting (as in pdf.js's viewer).
    const end = document.createElement("div");
    end.className = "endOfContent";
    div.append(end);
  });
  return { layer, done };
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const NAMED_ACTIONS = { NextPage: 1, PrevPage: -1 };

// `nav` = { goToDest(dest), goToPage(n), currentPage() }
export async function buildLinkLayer(page, viewport, parent, nav) {
  const annotations = await page.getAnnotations({ intent: "display" });
  const links = annotations.filter((a) => a.subtype === "Link");
  if (!links.length) return;

  const div = document.createElement("div");
  div.className = "linkLayer";
  for (const link of links) {
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(link.rect);
    const a = document.createElement("a");
    a.style.left = `${Math.min(x1, x2)}px`;
    a.style.top = `${Math.min(y1, y2)}px`;
    a.style.width = `${Math.abs(x2 - x1)}px`;
    a.style.height = `${Math.abs(y2 - y1)}px`;

    if (link.url) {
      let url;
      try {
        url = new URL(link.url);
      } catch {
        continue;
      }
      if (!SAFE_PROTOCOLS.has(url.protocol)) continue;
      a.href = url.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = url.href;
    } else if (link.dest) {
      a.href = "#";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        nav.goToDest(link.dest);
      });
    } else if (link.action in NAMED_ACTIONS || link.action === "FirstPage" || link.action === "LastPage") {
      a.href = "#";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (link.action === "FirstPage") nav.goToPage(1);
        else if (link.action === "LastPage") nav.goToPage(Infinity);
        else nav.goToPage(nav.currentPage() + NAMED_ACTIONS[link.action]);
      });
    } else {
      continue;
    }
    div.append(a);
  }
  parent.append(div);
}
