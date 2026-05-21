import type * as Monaco from "monaco-editor";

let configured = false;
let monacoPromise: Promise<typeof Monaco> | undefined;
type CompletionSnippet = {
  label: string;
  kind: number;
  insertText: string;
  insertTextRules?: number;
  documentation: string;
};

export class WgslEditor {
  private monaco?: typeof Monaco;
  private editor?: Monaco.editor.IStandaloneCodeEditor;

  constructor(
    private readonly root: HTMLElement,
    private readonly onChange?: () => void,
  ) {
    void this.ensureEditor("");
  }

  setValue(value: string) {
    if (!this.monaco) {
      void this.ensureEditor(value);
      return;
    }
    if (!this.editor) {
      this.editor = this.monaco.editor.create(this.root, {
        value,
        language: "wgsl",
        theme: "vs-dark",
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 12,
        tabSize: 2,
        wordWrap: "on",
      });
      this.editor.onDidChangeModelContent(() => {
        this.onChange?.();
      });
      return;
    }
    if (this.editor.getValue() !== value) {
      this.editor.setValue(value);
    }
  }

  getValue() {
    return this.editor?.getValue() ?? "";
  }

  dispose() {
    this.editor?.dispose();
    this.editor = undefined;
  }

  private async ensureEditor(value: string) {
    this.monaco = await loadMonaco();
    configureWgsl(this.monaco);
    if (!this.editor) {
      this.setValue(value);
    }
  }
}

async function loadMonaco() {
  monacoPromise ??= import("monaco-editor");
  return monacoPromise;
}

function configureWgsl(monaco: typeof Monaco) {
  if (configured) {
    return;
  }
  configured = true;

  monaco.languages.register({ id: "wgsl" });
  monaco.languages.setMonarchTokensProvider("wgsl", {
    tokenizer: {
      root: [
        [/@[a-zA-Z_]\w*/, "tag"],
        [/\b(fn|var|let|return|struct|if|else|for|while|loop|break|continue)\b/, "keyword"],
        [/\b(vec[234]f|mat[234]x[234]f|f32|i32|u32|bool|array|texture_2d|sampler)\b/, "type"],
        [/\/\/.*$/, "comment"],
        [/[-+]?\d*\.?\d+/, "number"],
        [/"[^"]*"/, "string"],
      ],
    },
  });
  monaco.languages.registerCompletionItemProvider("wgsl", {
    provideCompletionItems(model, position) {
      const range = model.getWordUntilPosition(position);
      const replaceRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: range.startColumn,
        endColumn: range.endColumn,
      };
      return {
        suggestions: snippets(monaco).map((snippet) => ({
          ...snippet,
          range: replaceRange,
        })),
      };
    },
  });
}

function completionKind(monaco: typeof Monaco) {
  return monaco.languages.CompletionItemKind.Snippet;
}

function insertAsSnippet(monaco: typeof Monaco) {
  return monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
}

const snippets = (monaco: typeof Monaco): CompletionSnippet[] => [
  {
    label: "@vertex",
    kind: completionKind(monaco),
    insertText: ["@vertex", "fn vertexMain() -> @builtin(position) vec4f {", "  return vec4f(0.0);", "}"].join("\n"),
    insertTextRules: insertAsSnippet(monaco),
    documentation: "WGSL vertex entry point",
  },
  {
    label: "@fragment",
    kind: completionKind(monaco),
    insertText: ["@fragment", "fn fragmentMain() -> @location(0) vec4f {", "  return vec4f(1.0);", "}"].join("\n"),
    insertTextRules: insertAsSnippet(monaco),
    documentation: "WGSL fragment entry point",
  },
  {
    label: "@group binding",
    kind: completionKind(monaco),
    insertText: "@group(${1:0}) @binding(${2:0}) var<uniform> ${3:name}: ${4:Type};",
    insertTextRules: insertAsSnippet(monaco),
    documentation: "WGSL resource binding",
  },
  {
    label: "FrameUniforms",
    kind: completionKind(monaco),
    insertText: ["struct FrameUniforms {", "  viewProjection: mat4x4f,", "  reserved: mat4x4f,", "  resolutionTime: vec4f,", "};"].join("\n"),
    documentation: "Default frame uniforms",
  },
  {
    label: "ParamsUniforms",
    kind: completionKind(monaco),
    insertText: ["struct ParamsUniforms {", "  values: array<vec4f, 16>,", "};"].join("\n"),
    documentation: "Packed GUI params",
  },
  {
    label: "ObjectUniforms",
    kind: completionKind(monaco),
    insertText: ["struct ObjectUniforms {", "  model: mat4x4f,", "  modelViewProjection: mat4x4f,", "};"].join("\n"),
    documentation: "Default object uniforms",
  },
  {
    label: "MaterialUniforms",
    kind: completionKind(monaco),
    insertText: ["struct MaterialUniforms {", "  baseColor: vec4f,", "  metallicRoughness: vec4f,", "};"].join("\n"),
    documentation: "Default material uniforms",
  },
  {
    label: "fullscreen triangle",
    kind: completionKind(monaco),
    insertText: [
      "@vertex",
      "fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {",
      "  var positions = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));",
      "  return vec4f(positions[vertexIndex], 0.0, 1.0);",
      "}",
    ].join("\n"),
    documentation: "Fullscreen triangle vertex shader",
  },
];
