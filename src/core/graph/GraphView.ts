import type { GraphNodeInfo, GraphViewModel } from "./GraphTypes";

type PositionedNode = GraphNodeInfo & {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GraphViewOptions = {
  onTogglePass?: (passName: string, enabled: boolean) => void;
};

export class GraphView {
  private selectedNodeId = "";
  private readonly root: HTMLElement;
  private readonly graphRoot: HTMLElement;
  private readonly inspectorRoot: HTMLElement;
  private model?: GraphViewModel;

  constructor(parent: HTMLElement, title = "Graph View", private readonly options: GraphViewOptions = {}) {
    this.root = document.createElement("section");
    this.root.className = "graph-view";

    const header = document.createElement("div");
    header.className = "gui-header";
    header.innerHTML = `<p class="panel-label">${title}</p>`;

    this.graphRoot = document.createElement("div");
    this.graphRoot.className = "graph-canvas";

    this.inspectorRoot = document.createElement("div");
    this.inspectorRoot.className = "graph-inspector";

    this.root.append(header, this.graphRoot, this.inspectorRoot);
    parent.append(this.root);
  }

  setModel(model: GraphViewModel) {
    this.model = model;
    if (!this.selectedNodeId || !model.nodes.some((node) => node.id === this.selectedNodeId)) {
      this.selectedNodeId = model.nodes[0]?.id ?? "";
    }
    this.render();
  }

  private render() {
    if (!this.model) {
      return;
    }

    const nodes = layoutNodes(this.model);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const svg = createSvg("svg");
    svg.setAttribute("class", "graph-edges");
    svg.setAttribute("viewBox", "0 0 760 360");
    svg.setAttribute("preserveAspectRatio", "none");

    for (const edge of this.model.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) {
        continue;
      }
      const path = createSvg("path");
      const startX = from.x + from.width;
      const startY = from.y + from.height * 0.5;
      const endX = to.x;
      const endY = to.y + to.height * 0.5;
      const midX = (startX + endX) * 0.5;
      path.setAttribute("d", `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`);
      path.setAttribute("class", "graph-edge");
      svg.append(path);
    }

    const nodeLayer = document.createElement("div");
    nodeLayer.className = "graph-nodes";

    for (const node of nodes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `graph-node graph-node-${node.kind}`;
      if (node.id === this.selectedNodeId) {
        button.dataset.selected = "true";
      }
      button.style.left = `${(node.x / 760) * 100}%`;
      button.style.top = `${(node.y / 360) * 100}%`;
      button.style.width = `${(node.width / 760) * 100}%`;
      button.style.height = `${(node.height / 360) * 100}%`;
      button.innerHTML = `<span>${node.title}</span><small>${node.subtitle}</small>`;
      button.addEventListener("click", () => {
        this.selectedNodeId = node.id;
        this.render();
      });
      nodeLayer.append(button);
    }

    this.graphRoot.replaceChildren(svg, nodeLayer);
    this.renderInspector();
  }

  private renderInspector() {
    const node = this.model?.nodes.find((entry) => entry.id === this.selectedNodeId);
    if (!node) {
      this.inspectorRoot.replaceChildren();
      return;
    }

    const title = document.createElement("h3");
    title.textContent = node.title;
    const subtitle = document.createElement("p");
    subtitle.textContent = node.subtitle;
    const actions = document.createElement("div");
    actions.className = "graph-inspector-actions";
    if (node.kind === "pass") {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = node.enabled === false ? "Enable Pass" : "Disable Pass";
      toggle.addEventListener("click", () => {
        this.options.onTogglePass?.(node.title, node.enabled === false);
      });
      actions.append(toggle);
    }
    const list = document.createElement("dl");
    for (const [key, value] of node.details) {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = value;
      list.append(dt, dd);
    }
    this.inspectorRoot.replaceChildren(title, subtitle, actions, list);
  }
}

function layoutNodes(model: GraphViewModel): PositionedNode[] {
  const resources = model.nodes.filter((node) => node.kind === "resource");
  const passes = model.nodes.filter((node) => node.kind === "pass");
  const outputs = model.nodes.filter((node) => node.kind === "output");
  return [
    ...positionColumn(resources, 28, 34),
    ...positionColumn(passes, 292, 34),
    ...positionColumn(outputs, 604, 132),
  ];
}

function positionColumn(nodes: GraphNodeInfo[], x: number, firstY: number): PositionedNode[] {
  const height = 64;
  const gap = 18;
  return nodes.map((node, index) => ({
    ...node,
    x,
    y: firstY + index * (height + gap),
    width: 132,
    height,
  }));
}

function createSvg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}
