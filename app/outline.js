// Table of contents sidebar built from the PDF outline (bookmarks).
// Destinations are resolved only when an entry is clicked, so building the
// list never touches page data.

export async function loadOutline(doc) {
  return (await doc.getOutline()) || [];
}

// Resolve an outline destination to a 1-based page number.
// `getDoc` returns the current pdf.js document (it can be swapped on reopen;
// object references stay valid because it is the same file).
export async function resolveDest(getDoc, dest) {
  const doc = getDoc();
  const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit)) return null;
  const target = explicit[0];
  if (Number.isInteger(target)) return target + 1;
  if (target && typeof target === "object") return (await doc.getPageIndex(target)) + 1;
  return null;
}

export function renderOutline(list, items, onSelect, depth = 0) {
  for (const item of items) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toc-item";
    button.textContent = item.title || "—";
    button.title = item.title || "";
    button.style.paddingLeft = `${12 + depth * 14}px`;
    button.addEventListener("click", () => onSelect(item));

    if (item.items?.length) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "toc-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "▸";
      const children = document.createElement("ul");
      children.hidden = true;
      let built = false;
      toggle.addEventListener("click", () => {
        // Build nested levels lazily; big books can have thousands of entries.
        if (!built) {
          renderOutline(children, item.items, onSelect, depth + 1);
          built = true;
        }
        children.hidden = !children.hidden;
        toggle.textContent = children.hidden ? "▸" : "▾";
        toggle.setAttribute("aria-expanded", String(!children.hidden));
      });
      const row = document.createElement("div");
      row.className = "toc-row";
      row.append(button, toggle);
      li.append(row, children);
    } else {
      li.append(button);
    }
    list.append(li);
  }
}
