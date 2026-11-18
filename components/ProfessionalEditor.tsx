"use client";

import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Download, LoaderCircle, RefreshCw, Save, Upload } from "lucide-react";
import type { Plan } from '@/lib/plan';
import { planToPascal } from '@/lib/plan-to-pascal';

/** Pascal scenes are intentionally stored independently of the lightweight plan. */
type PascalScene = {
  nodes: Record<string, unknown>;
  rootNodeIds: string[];
  collections?: Record<string, unknown>;
  materials?: Record<string, unknown>;
  installedPlugins?: string[];
};

type EditorHostProps = {
  projectId: string;
  projectName?: string;
  locale?: string;
  layoutVersion?: "v1" | "v2";
  actionMenuPlacement?: "top" | "bottom";
  disablePostFx?: boolean;
  loadingSlot?: ReactNode;
  onLoad: () => Promise<PascalScene | null>;
  onSave: (scene: PascalScene) => Promise<void>;
  onLoaderChange?: (visible: boolean) => void;
};

type PascalRuntime = {
  Editor: ComponentType<EditorHostProps>;
  snapshot: () => PascalScene;
  fromPlan: (plan: Plan) => PascalScene;
};

const STORAGE_KEY = "roomcraft:professional-scene:v1";
const BACKUP_PREFIX = "roomcraft:professional-backup:";
const PROJECT_ID = "roomcraft-professional-local";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
let runtimePromise: Promise<PascalRuntime> | undefined;

/** No Pascal modules run during SSR, and the full built-in registry loads once. */
function loadRuntime(): Promise<PascalRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      // Browserify-based PDF streams require globals. Initialize browser versions
      // before loading Pascal; the Vite compat plugin scopes resolution to client.
      if (!("global" in globalThis)) Object.defineProperty(globalThis, "global", { value: globalThis, writable: true, configurable: true });
      // Browser-only asset base for dependencies that carry Node-style path initialization.
      if (!("__dirname" in globalThis)) Object.defineProperty(globalThis, "__dirname", { value: "/", writable: true, configurable: true });
      const [{ Buffer }, browserProcess] = await Promise.all([import("buffer/"), import("process/browser")]);
      if (!("Buffer" in globalThis)) Object.defineProperty(globalThis, "Buffer", { value: Buffer, writable: true, configurable: true });
      if (!("process" in globalThis)) Object.defineProperty(globalThis, "process", { value: browserProcess.default, writable: true, configurable: true });
      const [core, editor, viewer, nodes, locales] = await Promise.all([
        import("@pascal-app/core"),
        import("@pascal-app/editor"),
        import("@pascal-app/viewer"),
        import("@pascal-app/nodes"),
        import("@pascal-app/editor/locales"),
      ]);
      locales.registerBundledLocales();
      core.setLocale("zh-CN");
      viewer.configureViewer({ assetsBaseUrl: "https://editor.pascal.app" });
      await core.loadPlugin(nodes.builtinPlugin);
      return {
        Editor: editor.Editor as ComponentType<EditorHostProps>,
        snapshot: () => core.getSceneDocument() as PascalScene,
        fromPlan: (plan: Plan) => planToPascal(plan, core),
      };
    })().catch((error: unknown) => {
      console.error("Professional editor initialization failed", error);
      runtimePromise = undefined;
      throw error;
    });
  }
  return runtimePromise;
}

function parseScene(value: unknown): PascalScene {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("文件不是有效的 Pascal 场景。");
  }
  const scene = value as Partial<PascalScene>;
  if (
    !scene.nodes || typeof scene.nodes !== "object" || Array.isArray(scene.nodes) ||
    !Array.isArray(scene.rootNodeIds) || scene.rootNodeIds.length === 0 ||
    !scene.rootNodeIds.every((id) => typeof id === "string" && id in scene.nodes!)
  ) {
    throw new Error("场景缺少构件或根节点。请导入专业编辑器导出的 JSON 文件。");
  }
  if (Object.keys(scene.nodes).length > 100_000) {
    throw new Error("场景构件过多，请拆分项目后导入。");
  }
  return scene as PascalScene;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "专业编辑器加载失败，请重试。";
}

function LoadingEditor() {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", background: "#f2f0eb", color: "#716b62" }}>
      <div style={{ display: "grid", justifyItems: "center", gap: 12 }}>
        <LoaderCircle size={24} className="animate-spin" aria-hidden="true" />
        <span style={{ fontSize: 13 }}>正在加载专业建模引擎…</span>
      </div>
    </div>
  );
}

class EditorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Professional editor render failed", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return <Failure message={this.state.error} onRetry={this.props.onRetry} />;
    }
    return this.props.children;
  }
}

function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 28, background: "#f6f3ed" }} role="alert">
      <div style={{ maxWidth: 420 }}>
        <h3 style={{ fontSize: 17, marginBottom: 10 }}>专业编辑器暂时无法打开</h3>
        <p style={{ fontSize: 13, lineHeight: 1.8, color: "#766f65", overflowWrap: "anywhere" }}>{message}</p>
        <p style={{ fontSize: 12, lineHeight: 1.8, color: "#766f65", marginTop: 10 }}>
          请使用开启硬件加速的新版 Chrome 或 Edge。你仍可返回平面与三维工作台继续编辑。
        </p>
        <button type="button" onClick={onRetry} style={{ marginTop: 16, padding: "9px 15px", borderRadius: 8, border: "1px solid #cfc9bf", background: "#fff", display: "flex", gap: 7, alignItems: "center" }}>
          <RefreshCw size={14} />重新加载
        </button>
      </div>
    </div>
  );
}

export default function ProfessionalEditor({ plan }: { plan: Plan }) {
  const [runtime, setRuntime] = useState<PascalRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [gpuNote, setGpuNote] = useState("");
  const [saveStatus, setSaveStatus] = useState("自动保存在本机");
  const [revision, setRevision] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [sceneReady, setSceneReady] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const activeRevision = useRef(0);
  const importingPlan = useRef(false);
  const [backupAvailable, setBackupAvailable] = useState(false);

  function latestBackupKey() {
    return Object.keys(window.localStorage).filter(key => key.startsWith(BACKUP_PREFIX)).sort().at(-1);
  }
  useEffect(() => { try { setBackupAvailable(Boolean(latestBackupKey())); } catch { /* Optional storage. */ } }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void (async () => {
      if (!("gpu" in navigator)) {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2");
        if (!gl) throw new Error("当前浏览器无法创建 WebGPU 或 WebGL2 图形上下文。");
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        if (!cancelled) setGpuNote("当前使用兼容图形模式，部分光照效果会简化。");
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const loaded = await Promise.race([
          loadRuntime(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("专业引擎加载超过 45 秒，请检查网络后重新加载。主工作台仍可正常使用。")), 45_000);
          }),
        ]);
        if (!cancelled) setRuntime(loaded);
      } finally { if (timeout) clearTimeout(timeout); }
    })().catch((reason: unknown) => {
      if (!cancelled) setError(messageOf(reason));
    });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  const loadScene = useCallback(async (): Promise<PascalScene | null> => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null; // Pascal creates a real default site/building/level.
    try { return parseScene(JSON.parse(raw)); }
    catch { throw new Error("本机保存的专业场景无法读取。为保护已有数据，未创建空场景覆盖它；请先导入备份文件。"); }
  }, []);

  const persistScene = useCallback(async (scene: PascalScene): Promise<void> => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
      setSaveStatus(`已保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
    } catch {
      setSaveStatus("本机保存失败，请导出备份");
      throw new Error("浏览器存储不可用或空间不足，请导出专业场景备份。");
    }
  }, []);

  // A departing editor flushes autosave. Ignore its old snapshot during a JSON import.
  const saveScene = useCallback(async (scene: PascalScene): Promise<void> => {
    if (activeRevision.current !== revision) return;
    await persistScene(scene);
  }, [persistScene, revision]);

  const manualSave = async () => {
    if (!runtime || !sceneReady) return;
    try { await saveScene(runtime.snapshot()); setNotice("专业场景已保存。"); }
    catch (reason) { setNotice(messageOf(reason)); }
  };

  const replaceWithBackedUpScene = async (scene: PascalScene, message: string) => {
    if (!runtime || !sceneReady || importingPlan.current) return;
    importingPlan.current = true;
    try {
      // Keep the live snapshot, including unsaved edits, before replacing it.
      const backup = JSON.stringify(runtime.snapshot());
      const backupKey = `${BACKUP_PREFIX}${Date.now()}-${crypto.randomUUID()}`;
      window.localStorage.setItem(backupKey, backup);
      setBackupAvailable(true);
      const next = activeRevision.current + 1;
      activeRevision.current = next;
      try { await persistScene(scene); }
      catch (reason) { activeRevision.current = revision; throw reason; }
      setSceneReady(false); setRevision(next); setNotice(message);
    } catch (reason) { setNotice(messageOf(reason)); }
    finally { importingPlan.current = false; }
  };

  const importPlan = async () => {
    if (!runtime || !sceneReady) return;
    try {
      const converted = runtime.fromPlan(plan);
      await replaceWithBackedUpScene(converted, '已导入当前户型的墙体、门窗和房间；旧专业场景已备份。家具、材质与水电尚未转换，两边不会自动同步。');
    } catch (reason) { setNotice(messageOf(reason)); }
  };

  const restoreBackup = async () => {
    try {
      const key = latestBackupKey();
      if (!key) { setNotice('没有找到专业场景备份。'); return; }
      const raw = window.localStorage.getItem(key);
      if (!raw) throw new Error('备份无法读取。');
      await replaceWithBackedUpScene(parseScene(JSON.parse(raw)), '已恢复上一次备份，恢复前的场景也已备份。');
    } catch (reason) { setNotice(messageOf(reason)); }
  };

  const exportScene = () => {
    if (!runtime || !sceneReady) return;
    const blob = new Blob([JSON.stringify(runtime.snapshot(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `筑境-专业场景-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importScene = async (file: File | undefined) => {
    if (!file || importingPlan.current) return;
    importingPlan.current = true;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("场景文件超过 25 MB，请拆分后导入。");
      const scene = parseScene(JSON.parse(await file.text()));
      // File recovery must also work when the engine or the saved scene cannot
      // load. Keep the exact prior bytes in that case; never overwrite the only
      // copy of the user's work, even if it is malformed.
      const previous = runtime && sceneReady
        ? JSON.stringify(runtime.snapshot())
        : window.localStorage.getItem(STORAGE_KEY);
      if (previous !== null) {
        window.localStorage.setItem(`${BACKUP_PREFIX}${Date.now()}-${crypto.randomUUID()}`, previous);
        setBackupAvailable(true);
      }
      const nextRevision = activeRevision.current + 1;
      activeRevision.current = nextRevision;
      try { await persistScene(scene); }
      catch (reason) { activeRevision.current = revision; throw reason; }
      setSceneReady(false);
      setRevision(nextRevision);
      setNotice(previous === null
        ? "专业场景已导入。主工作台户型保持不变。"
        : "专业场景已导入，原专业场景已备份。主工作台户型保持不变。");
    } catch (reason) { setNotice(messageOf(reason)); }
    finally {
      importingPlan.current = false;
      if (importInput.current) importInput.current.value = "";
    }
  };

  const retry = () => {
    setRuntime(null);
    setSceneReady(false);
    activeRevision.current += 1;
    setLoadAttempt((value) => value + 1);
    setRevision(activeRevision.current);
  };

  const buttonStyle = { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 9px", fontSize: 11, border: "1px solid #ded8cd", borderRadius: 6, background: "#fffdf9", cursor: "pointer" } as const;
  const Editor = runtime?.Editor;
  // Keep Pascal's compositor enabled below: disabling post FX paints the sky
  // again in its WebGL overlay pass, hiding the walls. Quality stays automatic.

  return (
    <section aria-label="专业空间建模" style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 520, overflow: "hidden", background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "10px 14px", borderBottom: "1px solid #e5dfd5", background: "#faf8f3", flexShrink: 0 }}>
        <div>
          <strong style={{ fontSize: 12, fontWeight: 600 }}>专业建模 · Pascal</strong>
          <p style={{ fontSize: 10, color: "#827a6e", marginTop: 3 }}>支持导入当前户型；专业场景独立保存，不会自动同步</p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#827a6e", marginRight: 6 }} aria-live="polite">{saveStatus}</span>
          <button type="button" style={buttonStyle} onClick={() => void importPlan()} disabled={!runtime || !sceneReady}>导入当前户型</button>
          <button type="button" style={buttonStyle} onClick={() => void restoreBackup()} disabled={!runtime || !sceneReady || !backupAvailable}>恢复备份</button>
          <button type="button" style={buttonStyle} onClick={() => importInput.current?.click()}><Upload size={12} />导入</button>
          <button type="button" style={buttonStyle} onClick={exportScene} disabled={!runtime || !sceneReady}><Download size={12} />导出</button>
          <button type="button" style={buttonStyle} onClick={() => void manualSave()} disabled={!runtime || !sceneReady}><Save size={12} />保存</button>
          <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importScene(event.target.files?.[0])} />
        </div>
      </div>
      {(notice || gpuNote) && <div style={{ padding: "6px 14px", background: "#f5eddc", fontSize: 11, color: "#775c34", flexShrink: 0 }} role="status">{notice || gpuNote}</div>}
      <div style={{ flex: 1, position: "relative", minHeight: 0, isolation: "isolate", overflow: "hidden" }}>
        {error ? <Failure message={error} onRetry={retry} /> : Editor ? (
          <EditorBoundary key={revision} onRetry={retry}>
            <div style={{ position: "absolute", inset: 0 }}>
              <Editor
                projectId={PROJECT_ID}
                projectName="筑境 · 专业场景"
                locale="zh-CN"
                layoutVersion="v2"
                actionMenuPlacement="top"
                disablePostFx={false}
                onLoad={loadScene}
                onSave={saveScene}
                onLoaderChange={(visible) => setSceneReady(!visible)}
                loadingSlot={<LoadingEditor />}
              />
            </div>
          </EditorBoundary>
        ) : <LoadingEditor />}
      </div>
    </section>
  );
}
