export type CreateDocumentDialogOptions = {
  title: string;
  nameLabel: string;
  defaultName: string;
  existingIds: string[];
  idLabel?: string;
  extraFields?: DialogSelectField[];
};

export type DialogSelectField = {
  id: string;
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
};

export type CreateDocumentDialogResult = {
  id: string;
  name: string;
  extra: Record<string, string>;
};

export function showCreateDocumentDialog(options: CreateDocumentDialogOptions): Promise<CreateDocumentDialogResult | undefined> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "create-dialog-overlay";
    overlay.innerHTML = `
      <form class="create-dialog" method="dialog">
        <header>
          <strong>${escapeHtml(options.title)}</strong>
          <button type="button" data-action="cancel" aria-label="Close">Close</button>
        </header>
        <label>
          <span>${escapeHtml(options.nameLabel)}</span>
          <input name="name" type="text" required />
        </label>
        <details>
          <summary>Advanced id</summary>
          <label>
            <span>${escapeHtml(options.idLabel ?? "Id")}</span>
            <input name="id" type="text" pattern="[a-zA-Z0-9_-]+" required />
          </label>
        </details>
        <div class="create-dialog-extra"></div>
        <p class="create-dialog-status"></p>
        <footer>
          <button type="button" data-action="cancel">Cancel</button>
          <button type="submit">Create</button>
        </footer>
      </form>
    `;

    const form = overlay.querySelector<HTMLFormElement>("form")!;
    const nameInput = form.elements.namedItem("name") as HTMLInputElement;
    const idInput = form.elements.namedItem("id") as HTMLInputElement;
    const extraRoot = overlay.querySelector<HTMLElement>(".create-dialog-extra")!;
    const status = overlay.querySelector<HTMLElement>(".create-dialog-status")!;
    const extraInputs = new Map<string, HTMLSelectElement>();

    nameInput.value = options.defaultName;
    idInput.value = uniqueSafeId(slugify(options.defaultName), options.existingIds);

    for (const field of options.extraFields ?? []) {
      const label = document.createElement("label");
      label.innerHTML = `<span>${escapeHtml(field.label)}</span>`;
      const select = document.createElement("select");
      select.name = field.id;
      for (const option of field.options) {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        select.append(element);
      }
      select.value = field.value;
      extraInputs.set(field.id, select);
      label.append(select);
      extraRoot.append(label);
    }

    let idTouched = false;
    const finish = (result?: CreateDocumentDialogResult) => {
      overlay.remove();
      resolve(result);
    };

    nameInput.addEventListener("input", () => {
      if (!idTouched) {
        idInput.value = uniqueSafeId(slugify(nameInput.value), options.existingIds);
      }
    });
    idInput.addEventListener("input", () => {
      idTouched = true;
      idInput.value = sanitizeId(idInput.value);
    });
    overlay.addEventListener("click", (event) => {
      const target = event.target;
      if (target === overlay || (target instanceof HTMLElement && target.dataset.action === "cancel")) {
        finish();
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      const id = sanitizeId(idInput.value);
      if (!name) {
        status.textContent = "Name is required.";
        return;
      }
      if (!id) {
        status.textContent = "Id is required.";
        return;
      }
      if (options.existingIds.includes(id)) {
        status.textContent = `Id already exists: ${id}`;
        return;
      }
      finish({
        id,
        name,
        extra: Object.fromEntries([...extraInputs].map(([key, input]) => [key, input.value])),
      });
    });

    document.body.append(overlay);
    nameInput.focus();
    nameInput.select();
  });
}

export function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "untitled";
}

export function sanitizeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function uniqueSafeId(base: string, existing: string[]) {
  const safeBase = sanitizeId(base) || "untitled";
  let id = safeBase;
  let index = 2;
  while (existing.includes(id)) {
    id = `${safeBase}-${index}`;
    index += 1;
  }
  return id;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character] ?? character;
  });
}
