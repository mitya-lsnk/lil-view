import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import "./skins.css";
import "./dark.css";
import "./viewer.css";

import { ActionsMenu, type Action } from "./components/ActionsMenu";
import { Filmstrip } from "./components/Filmstrip";
import { GridView } from "./components/GridView";
import { InfoPanel } from "./components/InfoPanel";
import { SettingsScreen } from "./components/SettingsScreen";
import { Stage, type StageHandle } from "./components/Stage";
import { StageControls } from "./components/StageControls";
import { StatusBar } from "./components/StatusBar";
import { Toast } from "./components/Toast";
import { Toolbar } from "./components/Toolbar";

import { preload } from "./lib/limg";
import { usePrefs } from "./lib/settings";
import { useStrings } from "./lib/i18n";
import { hasTauri } from "./lib/tauri";
import {
  copyImage,
  copyPath,
  moveFile,
  openInApp,
  openPath,
  revealInFinder,
  saveAs,
  suiteApps,
  type SuiteApp,
  takePendingOpen,
  trashFile,
  type Folder,
} from "./lib/folder";
import { splitPath } from "./lib/format";

const IMAGE_FILTER = {
  name: "Изображения",
  extensions: [
    "jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "tif", "tiff",
    "bmp", "ico", "icns", "svg", "psd", "jp2", "dng", "cr2", "cr3", "nef", "arw",
    "orf", "raf", "rw2", "pef", "srw", "x3f",
  ],
};

export default function App() {
  const s = useStrings();
  const { prefs, set } = usePrefs();

  const [folder, setFolder] = useState<Folder | null>(null);
  const [index, setIndex] = useState(0);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);

  const [grid, setGrid] = useState(false);
  const [info, setInfo] = useState(false);
  const [settings, setSettings] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [chromeShown, setChromeShown] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const [gridCell, setGridCell] = useState(150);
  const [toast, setToast] = useState<{ msg: string; kind: "info" | "error" } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [suite, setSuite] = useState<SuiteApp[]>([]);

  const stageRef = useRef<StageHandle>(null);

  const entries = folder?.entries ?? [];
  const current = entries[index] ?? null;

  const say = useCallback((msg: string, kind: "info" | "error" = "info") => {
    setToast({ msg, kind });
  }, []);

  // Stable identity: an inline arrow here would be a new prop on every render,
  // and Stage keys its "new image" reset off callback identity.
  const onNaturalSize = useCallback((w: number, h: number) => setNatural({ w, h }), []);

  // ------------------------------------------------------------------ opening

  const load = useCallback(
    async (path: string, keepIndexOn?: string) => {
      try {
        const f = await openPath(path, prefs.sort, prefs.sortDesc);
        setFolder(f);
        // After a delete or a re-sort we want to land on a specific file rather
        // than on whatever ended up at the old numeric index.
        const wanted = keepIndexOn ? f.entries.findIndex((e) => e.path === keepIndexOn) : -1;
        setIndex(wanted >= 0 ? wanted : f.index);
        if (!f.entries.length) say(s.errors.empty, "error");
      } catch (e) {
        say(`${s.errors.open}: ${e}`, "error");
      }
    },
    [prefs.sort, prefs.sortDesc, s.errors.empty, s.errors.open, say],
  );

  const pickFile = useCallback(async () => {
    if (!hasTauri()) return;
    const picked = await openDialog({ multiple: false, directory: false, filters: [IMAGE_FILTER] });
    if (typeof picked === "string") void load(picked);
  }, [load]);

  // Files handed to us by Finder. The buffer is drained first because a cold
  // double-click delivers the path before React has mounted; the listener then
  // covers every later open while the app stays running.
  useEffect(() => {
    if (!hasTauri()) return;
    takePendingOpen()
      .then((paths) => {
        if (paths.length) void load(paths[0]);
      })
      .catch(() => {});
    const un = listen<string[]>("open-files", (e) => {
      if (e.payload.length) void load(e.payload[0]);
    });
    return () => {
      void un.then((f) => f());
    };
    // Intentionally mount-only: re-subscribing on every prefs change would drop
    // events in the gap between unlisten and listen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which sibling apps are installed. Looked up once at startup and again each
  // time the actions menu opens, so installing lil edit mid-session shows the
  // hand-off without a restart.
  useEffect(() => {
    if (!hasTauri()) return;
    suiteApps().then(setSuite).catch(() => setSuite([]));
  }, []);

  // Drag and drop onto the window.
  useEffect(() => {
    if (!hasTauri()) return;
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop" && e.payload.paths.length) void load(e.payload.paths[0]);
    });
    return () => {
      void un.then((f) => f());
    };
  }, [load]);

  // Re-sorting is a folder-level change, so reopen on the current file.
  useEffect(() => {
    if (folder && current) void load(current.path, current.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.sort, prefs.sortDesc]);

  // ----------------------------------------------------------------- paging

  const page = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const n = entries.length;
        if (!n) return i;
        const next = i + delta;
        if (next < 0) return prefs.loop ? n - 1 : 0;
        if (next >= n) return prefs.loop ? 0 : n - 1;
        return next;
      });
    },
    [entries.length, prefs.loop],
  );

  // Decode the neighbours ahead of time so arrow-key paging is instant.
  useEffect(() => {
    if (!entries.length) return;
    const around = [index - 2, index - 1, index + 1, index + 2]
      .filter((i) => i >= 0 && i < entries.length)
      .map((i) => entries[i].path);
    return preload(around);
  }, [entries, index]);

  // -------------------------------------------------------------- slideshow

  useEffect(() => {
    if (!slideshow || entries.length < 2) return;
    // A chained timeout, not an interval: a slow RAW decode must not let ticks
    // pile up and then fire in a burst.
    const t = setTimeout(() => {
      if (prefs.shuffle) {
        setIndex((i) => {
          if (entries.length < 2) return i;
          let n = i;
          while (n === i) n = Math.floor(Math.random() * entries.length);
          return n;
        });
      } else if (!prefs.loop && index === entries.length - 1) {
        setSlideshow(false);
      } else {
        page(1);
      }
    }, prefs.slideshowSec * 1000);
    return () => clearTimeout(t);
  }, [slideshow, index, entries.length, prefs.slideshowSec, prefs.shuffle, prefs.loop, page]);

  // ------------------------------------------------------------- fullscreen

  const toggleImmersive = useCallback(() => {
    const next = !immersive;
    if (!hasTauri()) {
      setImmersive(next);
      setChromeShown(false);
      return;
    }
    // Only dress the UI as fullscreen once the window says it is. Fire-and-forget
    // hid the chrome even when the call was refused — `setFullscreen` needs
    // `core:window:allow-set-fullscreen`, which the default capability set does
    // not include, so every attempt was silently rejected and the app just went
    // blank in place.
    getCurrentWindow()
      .setFullscreen(next)
      .then(
        () => {
          setImmersive(next);
          setChromeShown(false);
        },
        (e) => say(String(e), "error"),
      );
  }, [immersive, say]);

  // Reconcile with the window itself. macOS fullscreen is animated and can also
  // be driven from outside the app — the green button, ⌃⌘F, swiping to another
  // Space. If the CSS state and the window ever disagree, the window wins;
  // otherwise a fullscreen call that didn't take would leave the chrome hidden
  // over a normal window.
  useEffect(() => {
    if (!hasTauri()) return;
    const w = getCurrentWindow();
    const un = w.onResized(() => {
      w.isFullscreen()
        .then((fs) => {
          setImmersive(fs);
          if (!fs) setChromeShown(false);
        })
        .catch(() => {});
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // In fullscreen the chrome floats: any pointer movement brings it back, and it
  // fades once the pointer has been still for a moment. Revealing it only near
  // the window edges was too easy to miss — with the bars hidden and a dark
  // photo on screen, the app looked like it had simply stopped.
  useEffect(() => {
    if (!immersive) return;
    let idle: number | undefined;
    const onMove = () => {
      setChromeShown(true);
      window.clearTimeout(idle);
      idle = window.setTimeout(() => setChromeShown(false), 2200);
    };
    onMove();
    window.addEventListener("mousemove", onMove);
    return () => {
      window.clearTimeout(idle);
      window.removeEventListener("mousemove", onMove);
    };
  }, [immersive]);

  // ---------------------------------------------------------- file actions

  const doTrash = useCallback(async () => {
    if (!current || !hasTauri()) return;
    const ok = await confirm(s.actions.confirmTrash(current.name), { kind: "warning" });
    if (!ok) return;
    try {
      await trashFile(current.path);
      const gone = current;
      // Land on the next picture, or the previous one if we just removed the
      // last; reopening the folder keeps the list honest.
      const nextPath = entries[index + 1]?.path ?? entries[index - 1]?.path;
      await load(nextPath ?? folder!.dir, nextPath);
      say(s.actions.trashed(gone.name));
    } catch (e) {
      say(String(e), "error");
    }
  }, [current, entries, folder, index, load, s.actions, say]);

  const doMove = useCallback(async () => {
    if (!current || !hasTauri()) return;
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    try {
      await moveFile(current.path, dir);
      const moved = current;
      const nextPath = entries[index + 1]?.path ?? entries[index - 1]?.path;
      await load(nextPath ?? folder!.dir, nextPath);
      say(s.actions.moved(moved.name));
    } catch (e) {
      say(String(e), "error");
    }
  }, [current, entries, folder, index, load, s.actions, say]);

  const doSaveAs = useCallback(async () => {
    if (!current || !hasTauri()) return;
    const { name } = splitPath(current.path);
    const stem = name.replace(/\.[^.]+$/, "");
    const dest = await saveDialog({
      defaultPath: `${stem}.jpg`,
      filters: [{ name: "Image", extensions: ["jpg", "png", "tiff", "heic", "gif", "bmp"] }],
    });
    if (typeof dest !== "string") return;
    const ext = dest.slice(dest.lastIndexOf(".") + 1);
    try {
      await saveAs(current.path, dest, ext, 92);
      say(s.actions.saved(splitPath(dest).name));
    } catch (e) {
      say(String(e), "error");
    }
  }, [current, s.actions, say]);

  // ------------------------------------------------------------- keyboard

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never steal keys from a text field (the settings screen has several).
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const meta = e.metaKey || e.ctrlKey;

      if (meta) {
        switch (e.key.toLowerCase()) {
          case "o":
            e.preventDefault();
            void pickFile();
            return;
          case "i":
            e.preventDefault();
            setInfo((v) => !v);
            return;
          case "c":
            e.preventDefault();
            if (current) copyImage(current.path).then(() => say(s.actions.copied), (err) => say(String(err), "error"));
            return;
          case "r":
            e.preventDefault();
            if (current) void revealInFinder(current.path);
            return;
          case "s":
            e.preventDefault();
            void doSaveAs();
            return;
          case "backspace":
            e.preventDefault();
            void doTrash();
            return;
          default:
            return;
        }
      }

      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
          e.preventDefault();
          page(1);
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          page(-1);
          break;
        case "Home":
          setIndex(0);
          break;
        case "End":
          setIndex(Math.max(0, entries.length - 1));
          break;
        case "+":
        case "=":
          stageRef.current?.zoomIn();
          break;
        case "-":
          stageRef.current?.zoomOut();
          break;
        case "0":
          stageRef.current?.actual();
          break;
        case "1":
          stageRef.current?.fit();
          break;
        case "Escape":
          // One key, ordered by how trapped each state feels.
          if (settings) setSettings(false);
          else if (slideshow) setSlideshow(false);
          else if (immersive) toggleImmersive();
          else if (info) setInfo(false);
          else if (grid) setGrid(false);
          break;
        default:
          switch (e.key.toLowerCase()) {
            case "f":
              toggleImmersive();
              break;
            case "g":
              setGrid((v) => !v);
              break;
            case "t":
              set("filmstrip", !prefs.filmstrip);
              break;
            case "s":
              setSlideshow((v) => !v);
              break;
            case "r":
              stageRef.current?.rotate(e.shiftKey ? -1 : 1);
              break;
            case "delete":
              void doTrash();
              break;
          }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    current, doSaveAs, doTrash, entries.length, grid, immersive, info, page, pickFile,
    prefs.filmstrip, s.actions, say, set, settings, slideshow, toggleImmersive,
  ]);

  // Whichever copy of the sibling editor is installed — see SUITE in suite.rs
  // for why more than one identifier can match.
  const lilEdit = suite[0] ?? null;

  const sendToSuite = useCallback(() => {
    if (!current) return;
    if (!lilEdit) {
      say(s.actions.imageMissing, "error");
      return;
    }
    openInApp(lilEdit.id, current.path).catch((e) => say(String(e), "error"));
  }, [current, lilEdit, s.actions.imageMissing, say]);

  const actions: Action[] = useMemo(() => {
    if (!current) return [];
    const wrap = (fn: () => Promise<unknown>, done?: string) => () => {
      fn().then(
        () => done && say(done),
        (e) => say(String(e), "error"),
      );
    };
    // "Open in lil edit" is not repeated here — it has its own toolbar button.
    return [
      { label: s.actions.reveal, hint: "⌘R", run: wrap(() => revealInFinder(current.path)) },
      { label: s.actions.copyPath, run: wrap(() => copyPath(current.path), s.actions.copied) },
      { label: s.actions.copyImage, hint: "⌘C", run: wrap(() => copyImage(current.path), s.actions.copied) },
      { label: s.actions.saveAs, hint: "⌘S", run: () => void doSaveAs() },
      { label: s.actions.move, run: () => void doMove() },
      { label: s.actions.trash, hint: "⌘⌫", danger: true, run: () => void doTrash() },
    ];
  }, [current, doMove, doSaveAs, doTrash, s.actions, say]);

  // ---------------------------------------------------------------- render

  // The toolbar shows the *folder*, not the file.
  //
  // The file's name, its position in the folder, its size and its dimensions all
  // live in the status bar, which is the one place to look up facts about the
  // picture. Repeating the name in the toolbar taught nothing; the folder you
  // are paging through is context the status bar doesn't carry. The file name
  // goes where macOS expects a document name — the window title.
  const title = useMemo(() => {
    if (!folder) return s.app.name;
    const dir = folder.dir.replace(/\/+$/, "");
    return dir.slice(dir.lastIndexOf("/") + 1) || dir;
  }, [folder, s.app.name]);

  useEffect(() => {
    if (!hasTauri()) return;
    getCurrentWindow()
      .setTitle(current ? current.name : s.app.name)
      .catch(() => {});
  }, [current, s.app.name]);

  return (
    <div className={`app-shell ${immersive ? "immersive" : ""} ${chromeShown ? "chrome-shown" : ""}`}>
      <Toolbar
        hasImage={!!current}
        canPrev={entries.length > 1}
        canNext={entries.length > 1}
        filmstrip={prefs.filmstrip}
        grid={grid}
        info={info}
        slideshow={slideshow}
        title={title}
        onOpen={pickFile}
        onPrev={() => page(-1)}
        onNext={() => page(1)}
        onToggleFilmstrip={() => set("filmstrip", !prefs.filmstrip)}
        onToggleGrid={() => setGrid((v) => !v)}
        onToggleInfo={() => setInfo((v) => !v)}
        onToggleSlideshow={() => setSlideshow((v) => !v)}
        onFullscreen={toggleImmersive}
        suiteReady={!!lilEdit}
        onSendToSuite={sendToSuite}
        onMore={(x, y) => {
          setMenuAt({ x, y });
          if (hasTauri()) suiteApps().then(setSuite).catch(() => {});
        }}
        onSettings={() => setSettings(true)}
      />

      <div
        className="stage"
        onContextMenu={(e) => {
          if (!current) return;
          e.preventDefault();
          setMenuAt({ x: e.clientX, y: e.clientY });
          if (hasTauri()) suiteApps().then(setSuite).catch(() => {});
        }}
      >
        {current ? (
          <Stage
            ref={stageRef}
            path={current.path}
            reloadKey={reloadKey}
            zoomMode={prefs.zoom}
            wheelMode={prefs.wheel}
            onZoom={setZoom}
            onNaturalSize={onNaturalSize}
            onToggleImmersive={toggleImmersive}
          />
        ) : (
          <div className="stage-empty">
            <h1>{s.app.name}</h1>
            <p>{s.app.tagline}</p>
            <p>{s.app.dropHint}</p>
            <button className="tb-btn" onClick={pickFile}>
              <span className="tb-label">{s.app.openBtn}</span>
            </button>
            <p>
              {s.app.emptyKeys} <kbd>⌘O</kbd>
            </p>
          </div>
        )}

        {current && !grid && !settings && (
          <StageControls
            zoom={zoom}
            onZoomIn={() => stageRef.current?.zoomIn()}
            onZoomOut={() => stageRef.current?.zoomOut()}
            onToggleZoom={() => (zoom === 1 ? stageRef.current?.fit() : stageRef.current?.actual())}
            onRotate={(d) => stageRef.current?.rotate(d)}
          />
        )}

        {grid && entries.length > 0 && (
          <GridView
            entries={entries}
            index={index}
            cell={gridCell}
            onPick={(i, open) => {
              setIndex(i);
              if (open) setGrid(false);
            }}
          />
        )}

        {info && current && <InfoPanel path={current.path} />}

        {settings && (
          <SettingsScreen
            prefs={prefs}
            set={set}
            onBack={() => {
              setSettings(false);
              // Preferences can change how the current frame should be drawn.
              setReloadKey((k) => k + 1);
            }}
          />
        )}
      </div>

      <div className="filmstrip-slot">
        {prefs.filmstrip && !grid && entries.length > 0 && (
          <Filmstrip entries={entries} index={index} onPick={setIndex} />
        )}
      </div>

      {grid ? (
        <div className="status-bar">
          <span className="status-name">{folder?.dir}</span>
          <span className="sb-item">
            {entries.length} {s.status.of} {entries.length}
          </span>
          <input
            type="range"
            min={90}
            max={320}
            value={gridCell}
            onChange={(e) => setGridCell(Number(e.target.value))}
            style={{ width: 110 }}
          />
        </div>
      ) : (
        <StatusBar
          entry={current}
          index={index}
          total={entries.length}
          natural={natural}
          zoom={zoom}
        />
      )}

      {menuAt && actions.length > 0 && (
        <ActionsMenu x={menuAt.x} y={menuAt.y} actions={actions} onClose={() => setMenuAt(null)} />
      )}

      {toast && <Toast message={toast.msg} kind={toast.kind} onClose={() => setToast(null)} />}
    </div>
  );
}
