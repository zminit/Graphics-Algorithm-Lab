export type LogLevel = "info" | "warn" | "error";

type LogEntry = {
  id: number;
  level: LogLevel;
  message: string;
  time: Date;
  repeat: number;
};

export class RuntimeLogger {
  private entries: LogEntry[] = [];
  private nextId = 1;
  private expanded = false;
  private renderFrame = 0;
  private readonly storageKey = "games-platform.log-expanded";

  constructor(
    private readonly panel: HTMLElement,
    private readonly toggle: HTMLButtonElement,
    private readonly count: HTMLElement,
    private readonly summary: HTMLElement,
    private readonly list: HTMLElement,
    private readonly body: HTMLElement,
    private readonly clearButton: HTMLButtonElement,
  ) {
    this.expanded = localStorage.getItem(this.storageKey) === "true";
    this.toggle.addEventListener("click", () => this.setExpanded(!this.expanded));
    this.clearButton.addEventListener("click", () => this.clear());
    this.setExpanded(this.expanded);
    this.render();
  }

  info(message: string) {
    this.add("info", message);
  }

  warn(message: string) {
    this.add("warn", message);
  }

  error(message: string) {
    this.add("error", message);
  }

  add(level: LogLevel, message: string) {
    const normalized = normalizeMessage(message);
    const last = this.entries.at(-1);
    if (last && last.level === level && last.message === normalized) {
      last.repeat += 1;
      last.time = new Date();
      this.scheduleRender();
      return;
    }

    this.entries.push({
      id: this.nextId,
      level,
      message: normalized,
      time: new Date(),
      repeat: 1,
    });
    this.nextId += 1;

    if (this.entries.length > 300) {
      this.entries = this.entries.slice(-300);
    }

    this.scheduleRender();
  }

  clear() {
    this.entries = [];
    this.scheduleRender();
  }

  private setExpanded(expanded: boolean) {
    this.expanded = expanded;
    this.body.hidden = !expanded;
    this.panel.dataset.expanded = String(expanded);
    this.toggle.setAttribute("aria-expanded", String(expanded));
    localStorage.setItem(this.storageKey, String(expanded));
  }

  private render() {
    this.renderFrame = 0;
    this.count.textContent = String(this.entries.length);
    const last = this.entries.at(-1);
    this.summary.textContent = last ? `${last.level.toUpperCase()} · ${last.message}` : "No logs yet.";
    this.list.replaceChildren(...this.entries.map((entry) => this.createLogRow(entry)));
    this.list.scrollTop = this.list.scrollHeight;
  }

  private createLogRow(entry: LogEntry) {
    const row = document.createElement("div");
    row.className = "log-entry";
    row.dataset.level = entry.level;

    const meta = document.createElement("span");
    meta.className = "log-meta";
    meta.textContent = `${entry.time.toLocaleTimeString()} ${entry.level.toUpperCase()}${
      entry.repeat > 1 ? ` x${entry.repeat}` : ""
    }`;

    const message = document.createElement("pre");
    message.textContent = entry.message;

    row.append(meta, message);
    return row;
  }

  private scheduleRender() {
    if (this.renderFrame) {
      return;
    }

    this.renderFrame = requestAnimationFrame(() => this.render());
  }
}

function normalizeMessage(message: string) {
  return message.trim() || "(empty log message)";
}
