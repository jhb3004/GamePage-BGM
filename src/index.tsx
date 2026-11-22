import {
  PanelSection,
  PanelSectionRow,
  ModalRoot,
  ConfirmModal,
  showModal,
  SliderField,
  DropdownItem,
  ToggleField,
  ButtonItem,
  MenuItem,
  Navigation,
  staticClasses,
  useParams,
  findInReactTree,
  findInTree,
  findModuleByExport,
  findModuleDetailsByExport,
  fakeRenderComponent,
  afterPatch,
  beforePatch
} from "@decky/ui";

import {
  callable,
  definePlugin,
  routerHook,
} from "@decky/api";

import { useEffect, useRef, useState } from "react";
import { FaMusic } from "react-icons/fa";

type GameSettings = {
  music: string;
  volume: number;
  startOffset: number;
  playbackMode: "loop" | "once";
};

type Settings = {
  enabled: boolean;
  games: Record<string, GameSettings>;
};

const getSettings = callable<[], Settings>("get_settings");
const saveEnabled = callable<[enabled: boolean], boolean>("set_enabled");
const saveGameSettings = callable<
  [appId: string, settings: GameSettings],
  GameSettings
>("save_game_settings");
type MusicDirectoryEntry = {
  name: string;
  path: string;
  is_dir: boolean;
};

type MusicDirectory = {
  path: string;
  parent: string | null;
  entries: MusicDirectoryEntry[];
  error: string | null;
};

const listMusicDirectory = callable<
  [directory: string],
  MusicDirectory
>("list_music_directory");

const setGameMusic = callable<
  [appId: string, path: string],
  GameSettings
>("set_game_music");

const removeGameMusic = callable<[appId: string], boolean>("remove_game_music");

const getMusicArtwork = callable<
[path: string],
string | null
>("get_music_artwork");

function Content() {
  const [enabled, setEnabled] = useState(true);
  const [games, setGames] = useState<Record<string, GameSettings>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    getSettings()
      .then((settings) => {
        if (!mounted) return;

        setEnabled(settings.enabled);
        setGames(settings.games || {});
      })
      .catch((error) => {
        console.error("GamePage BGM: Could not load settings", error);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const onToggle = async (value: boolean) => {
    try {
      await saveEnabled(value);
      setEnabled(value);
    } catch (error) {
      console.error("GamePage BGM: Could not save setting", error);
    }
  };

  return (
    <PanelSection title="GamePage BGM">
      <PanelSectionRow>
        <ToggleField
          label="Enable GamePage BGM"
          description="Automatically play music on individual game pages."
          checked={enabled}
          onChange={onToggle}
        />
      </PanelSectionRow>

      <PanelSectionRow>
        <ButtonItem
          label="Test Game Settings Route"
          description="Temporarily open the Armored Core VI settings page."
          onClick={() => Navigation.Navigate("/gamepage-bgm/1888160")}
        />
      </PanelSectionRow>

      <PanelSectionRow>
        <div style={{ padding: "8px 0", opacity: 0.8 }}>
          Music only plays on individual game details pages.
          Home, Library and Store pages remain silent.
        </div>
      </PanelSectionRow>

      <PanelSection title="Game Music Assignments">
        {loading ? (
          <PanelSectionRow>
            <div>Loading settings...</div>
          </PanelSectionRow>
        ) : Object.keys(games).length === 0 ? (
          <PanelSectionRow>
            <div style={{ padding: "8px 0", opacity: 0.7 }}>
              No games configured yet.
            </div>
          </PanelSectionRow>
        ) : (
          Object.entries(games).map(([appId, game]) => (
            <PanelSectionRow key={appId}>
              <div style={{ padding: "8px 0" }}>
                <strong>Steam App ID: {appId}</strong>
                <div style={{ opacity: 0.7, fontSize: "12px" }}>
                  {game.music
                    ? game.music.split("/").pop()
                    : "No music selected"}
                </div>
              </div>
            </PanelSectionRow>
          ))
        )}
      </PanelSection>
    </PanelSection>
  );
}

const GAME_MENU_ITEM_KEY = "gamepage-bgm-change-music";

const contextMenuState: { appId: number | null } = { appId: null };

function extractAppId(...candidates: any[]): number | null {
  for (const candidate of candidates) {
    const value =
      candidate?.appid ??
      candidate?.app_id ??
      candidate?.unAppID ??
      candidate?.nAppID ??
      candidate?.id ??
      candidate;

    const parsed = Number.parseInt(String(value), 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function resolveLibraryContextMenu(): any {
  try {
    const module = findModuleByExport(
      (candidate: any) =>
        !!candidate?.toString?.().includes("().LibraryContextMenu"),
      1
    );

    if (!module || typeof module !== "object") return null;

    const sibling = Object.values(module).find(
      (value: any) =>
        typeof value === "function" &&
        !!value?.toString?.().includes("navigator:")
    );

    if (typeof sibling !== "function") return null;

    const component = fakeRenderComponent(sibling);
    return component?.type?.prototype ? component.type : null;
  } catch (error) {
    console.error("GamePage BGM: Could not resolve Library context menu.", error);
    return null;
  }
}

function extractAppIdFromTree(node: any): number | null {
  if (!node) return null;

  const candidate = extractAppId(
    node?.appid,
    node?.overview?.appid,
    node?._owner?.pendingProps?.overview?.appid,
    node?.props?.overview?.appid
  );

  if (candidate) return candidate;

  const children = node?.children ?? node?.props?.children;
  if (!children) return null;

  if (Array.isArray(children)) {
    for (const child of children) {
      const result = extractAppIdFromTree(child);
      if (result) return result;
    }
  } else {
    return extractAppIdFromTree(children);
  }

  return null;
}

function collectMenuChildArrays(
  root: any,
  arrays: any[][] = [],
  seen = new WeakSet<object>()
): any[][] {
  if (!root) return arrays;

  if (Array.isArray(root)) {
    arrays.push(root);
    root.forEach((child) => collectMenuChildArrays(child, arrays, seen));
    return arrays;
  }

  if (typeof root !== "object" || seen.has(root)) return arrays;
  seen.add(root);

  collectMenuChildArrays(root.props?.children, arrays, seen);
  collectMenuChildArrays(root.children, arrays, seen);
  return arrays;
}

function isGameContextMenu(items: any[]): boolean {
  if (!items?.length) return false;

  return !!findInReactTree(items, (node: any) => {
    const callback =
      typeof node?.props?.onSelected === "function"
        ? node.props.onSelected
        : typeof node?.onSelected === "function"
          ? node.onSelected
          : null;

    return !!callback?.toString?.().includes("launchSource");
  });
}

function isLibraryAppContextMenu(items: any[]): boolean {
  if (!items?.length) return false;

  return !!findInReactTree(items, (node: any) => {
    const callback =
      typeof node?.props?.onSelected === "function"
        ? node.props.onSelected
        : typeof node?.onSelected === "function"
          ? node.onSelected
          : null;

    if (!callback) return false;

    const source = callback.toString();
    return (
      source.includes("launchSource") ||
      source.includes("AppProperties") ||
      source.includes("ShowAppProperties") ||
      source.includes("InstallApp") ||
      source.includes("Download")
    );
  });
}

function deriveAppIdFromMenuItems(
  items: any[] | null,
  fallback: number | null
): number | null {
  if (!items?.length) return fallback;

  const owner = items.find(
    (entry) => entry?._owner?.pendingProps?.overview?.appid
  );

  const fromOwner = extractAppId(
    owner?._owner?.pendingProps?.overview?.appid
  );
  if (fromOwner) return fromOwner;

  const overviewNode = findInTree(
    items,
    (node: any) => node?.overview?.appid ?? node?.props?.overview?.appid,
    { walkable: ["props", "children", "_owner", "pendingProps"] }
  );

  const fromOverview = extractAppId(
    overviewNode?.overview?.appid,
    overviewNode?.props?.overview?.appid
  );
  if (fromOverview) return fromOverview;

  const appNode = findInTree(
    items,
    (node: any) =>
      node?.app?.appid ??
      node?.props?.app?.appid ??
      node?.appid ??
      node?.props?.appid ??
      node?.app_id ??
      node?.props?.app_id,
    { walkable: ["props", "children", "_owner", "pendingProps"] }
  );

  const fromApp = extractAppId(
    appNode?.app?.appid,
    appNode?.props?.app?.appid,
    appNode?.appid,
    appNode?.props?.appid,
    appNode?.app_id,
    appNode?.props?.app_id
  );

  return fromApp ?? fallback;
}

function insertGamePageBGMMenuItem(children: any, appId: number): void {
  const items = Array.isArray(children)
    ? children
    : Array.isArray(children?.props?.children)
      ? children.props.children
      : Array.isArray(children?.children)
        ? children.children
        : null;

  if (!items || !appId) return;

  const existing = items.findIndex(
    (entry: any) => entry?.key === GAME_MENU_ITEM_KEY
  );
  if (existing >= 0) items.splice(existing, 1);

  const propertiesIndex = items.findIndex((item: any) =>
    findInReactTree(
      item,
      (node: any) =>
        typeof node?.onSelected === "function" &&
        node.onSelected.toString().includes("AppProperties")
    )
  );

  const menuItem = (
    <MenuItem
      key={GAME_MENU_ITEM_KEY}
      onSelected={() => {
        Navigation.CloseSideMenus?.();
        Navigation.Navigate(`/gamepage-bgm/${appId}`);
      }}
    >
      Choose Background Music…
    </MenuItem>
  );

  if (propertiesIndex >= 0) {
    items.splice(propertiesIndex, 0, menuItem);
  } else {
    items.push(menuItem);
  }
}

function patchMenuItems(
  menuItems: any,
  fallbackAppId: number | null
): number | null {
  const candidates = collectMenuChildArrays(menuItems).filter(
    (entries) => entries.length > 0
  );

  if (!candidates.length) return null;

  const entries =
    candidates.find((candidate) => isGameContextMenu(candidate)) ??
    candidates.find((candidate) => isLibraryAppContextMenu(candidate)) ??
    (fallbackAppId
      ? candidates.find((candidate) => candidate.length > 1)
      : null) ??
    (fallbackAppId ? candidates[0] : null);

  if (!entries) return null;

  const appId = deriveAppIdFromMenuItems(entries, fallbackAppId);
  if (!appId) return null;

  insertGamePageBGMMenuItem(entries, appId);
  return appId;
}

function patchRenderedContextMenu(
  node: any,
  state: { appId: number | null }
): number | null {
  const menuItems = node?.props?.children?.[0] ?? node?.props?.children ?? node;
  const fallbackAppId = extractAppIdFromTree(node) ?? state.appId;
  const patched = patchMenuItems(menuItems, fallbackAppId);

  if (patched) state.appId = patched;
  return patched;
}

function patchContextMenuFocus() {
  const MenuComponent = resolveLibraryContextMenu();

  if (!MenuComponent?.prototype) {
    console.error("GamePage BGM: Library context-menu component not found.");
    return null;
  }

  const state = contextMenuState;
  const patches: { outer?: any; inner?: any; unmount?: any } = {};

  if (typeof MenuComponent.prototype.componentWillUnmount === "function") {
    patches.unmount = afterPatch(
      MenuComponent.prototype,
      "componentWillUnmount",
      () => {
        state.appId = null;
      }
    );
  }

  patches.outer = afterPatch(
    MenuComponent.prototype,
    "render",
    (_args: any[], component: any) => {
      let appId = extractAppId(
        component?._owner?.pendingProps?.overview?.appid
      );

      if (!appId) {
        const fallback = findInTree(
          component?.props?.children,
          (node: any) => node?.app?.appid,
          { walkable: ["props", "children"] }
        );
        appId = extractAppId(fallback?.app?.appid);
      }

      if (appId) state.appId = appId;

      if (!patches.inner) {
        patches.inner = afterPatch(
          component,
          "type",
          (_innerArgs: any[], rendered: any) => {
            const renderedType = rendered?.type;

            if (renderedType?.prototype?.render) {
              afterPatch(
                renderedType.prototype,
                "render",
                (_renderArgs: any[], result: any) => {
                  const items = result?.props?.children?.[0];
                  if (!Array.isArray(items) || !isGameContextMenu(items)) {
                    return result;
                  }

                  const resolvedAppId = deriveAppIdFromMenuItems(
                    items,
                    appId ?? state.appId
                  );

                  if (resolvedAppId) {
                    insertGamePageBGMMenuItem(items, resolvedAppId);
                    state.appId = resolvedAppId;
                  }

                  return result;
                }
              );
            } else {
              patchRenderedContextMenu(rendered, state);
            }

            if (renderedType?.prototype?.shouldComponentUpdate) {
              afterPatch(
                renderedType.prototype,
                "shouldComponentUpdate",
                ([nextProps]: any[], shouldUpdate: any) => {
                  const items = nextProps?.children;
                  if (!Array.isArray(items) || shouldUpdate !== true) {
                    return shouldUpdate;
                  }

                  const resolvedAppId = deriveAppIdFromMenuItems(
                    items,
                    appId ?? state.appId
                  );

                  if (resolvedAppId) {
                    insertGamePageBGMMenuItem(items, resolvedAppId);
                    state.appId = resolvedAppId;
                  }

                  return shouldUpdate;
                }
              );
            }

            return rendered;
          }
        );
      } else if (appId) {
        const patched = patchMenuItems(component?.props?.children, appId);
        if (patched) state.appId = patched;
      }

      return component;
    }
  );

  console.log("GamePage BGM: Library context-menu patch installed.");

  return () => {
    patches.outer?.unpatch();
    patches.inner?.unpatch();
    patches.unmount?.unpatch();
    state.appId = null;
  };
}

function patchSteamContextMenu() {
  try {
    const [module, _matchedExport, exportName] =
      findModuleDetailsByExport(
        (candidate: any) => {
          const source = candidate?.toString?.();
          return (
            typeof source === "string" &&
            source.includes("GetContextMenuManagerFromWindow(") &&
            source.includes(".CreateContextMenuInstance(")
          );
        },
        1
      );

    if (!module || !exportName || typeof module[exportName] !== "function") {
      console.error("GamePage BGM: Steam context-menu creation function not found.");
      return null;
    }

    const patch = beforePatch(
      module,
      exportName,
      (args: any[]) => {
        const patchedAppId = patchMenuItems(
          args?.[0],
          contextMenuState.appId
        );
        if (patchedAppId) contextMenuState.appId = patchedAppId;
      }
    );

    console.log("GamePage BGM: Steam context-menu patch installed.");

    return () => {
      patch?.unpatch();
      console.log("GamePage BGM: Steam context-menu patch removed.");
    };
  } catch (error) {
    console.error("GamePage BGM: Context-menu patch failed.", error);
    return null;
  }
}


type MusicBrowserModalProps = {
  onSelect: (path: string) => Promise<void>;
};

function MusicBrowserModal({ onSelect }: MusicBrowserModalProps) {
  const [directory, setDirectory] = useState<MusicDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectingPath, setSelectingPath] = useState("");

  const loadDirectory = async (path: string) => {
    setLoading(true);
    setError("");

    try {
      const result = await listMusicDirectory(path);

      if (result.error) {
        setDirectory(null);
        setError(result.error);
        return;
      }

      setDirectory(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDirectory("/home/deck/Music");
  }, []);

  const handleEntryClick = async (entry: MusicDirectoryEntry) => {
    if (entry.is_dir) {
      await loadDirectory(entry.path);
      return;
    }

    setSelectingPath(entry.path);
    setError("");

    try {
      await onSelect(entry.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSelectingPath("");
    }
  };

  return (
    <PanelSection title="Choose Background Music">
      <PanelSectionRow>
        <div style={{ padding: "8px 0", wordBreak: "break-all" }}>
          <strong>Location:</strong> {directory?.path || "/home/deck/Music"}
        </div>
      </PanelSectionRow>

      {directory?.parent && (
        <ButtonItem
          label=".."
          description="Go to parent folder"
          onClick={() => void loadDirectory(directory.parent!)}
          disabled={loading || Boolean(selectingPath)}
        />
      )}

      {loading ? (
        <PanelSectionRow>
          <div style={{ padding: "12px 0" }}>Loading folder...</div>
        </PanelSectionRow>
      ) : error && !directory ? (
        <>
          <PanelSectionRow>
            <div style={{ padding: "12px 0", color: "#ff6b6b" }}>
              {error}
            </div>
          </PanelSectionRow>
          <ButtonItem
            label="/home/deck"
            description="Browse your home folder instead"
            onClick={() => void loadDirectory("/home/deck")}
          />
        </>
      ) : (
        <>
          {error && (
            <PanelSectionRow>
              <div style={{ padding: "8px 0", color: "#ff6b6b" }}>
                {error}
              </div>
            </PanelSectionRow>
          )}

          {selectingPath && (
            <PanelSectionRow>
              <div style={{ padding: "8px 0" }}>
                Assigning selected music...
              </div>
            </PanelSectionRow>
          )}

          {directory?.entries.map((entry) => (
            <ButtonItem
              key={entry.path}
              label={entry.name}
              description={entry.is_dir ? "Folder" : "Audio file — select to use"}
              onClick={() => void handleEntryClick(entry)}
              disabled={loading || Boolean(selectingPath)}
            />
          ))}

          {directory?.entries.length === 0 && (
            <PanelSectionRow>
              <div style={{ padding: "12px 0" }}>
                No folders or supported audio files here.
              </div>
            </PanelSectionRow>
          )}
        </>
      )}
    </PanelSection>
  );
}

function GameSettingsPage() {
  const { appid } = useParams<{ appid: string }>();

  const [gameTitle, setGameTitle] = useState("");

  useEffect(() => {
    let attempts = 0;

    const updateGameTitle = () => {
      const appId = Number(appid);
      const title =
        window.appDetailsStore?.GetAppDetails(appId)?.strDisplayName ||
        window.appStore?.GetAppOverviewByAppID(appId)?.display_name;

      if (title) {
        setGameTitle(title);
        return true;
      }

      return false;
    };

    if (updateGameTitle()) return;

    const timer = window.setInterval(() => {
      attempts += 1;

      if (updateGameTitle() || attempts >= 20) {
        window.clearInterval(timer);
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [appid]);

  const [gameSettings, setGameSettings] = useState<GameSettings>({
    music: "",
    volume: 100,
    startOffset: 0,
    playbackMode: "loop"
  });

  const [artwork, setArtwork] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pickingMusic, setPickingMusic] = useState(false);
  const [pickerError, setPickerError] = useState("");

  const gameSettingsRef = useRef(gameSettings);
  gameSettingsRef.current = gameSettings;

  const settingsDirtyRef = useRef(false);

  useEffect(() => {
    let active = true;

    settingsDirtyRef.current = false;

    setLoading(true);
    setLoadError("");

    getSettings()
      .then((settings) => {
        if (!active) return;

        const savedSettings = settings.games?.[appid];

        setGameSettings(
          savedSettings
            ? { ...savedSettings }
            : {
                music: "",
                volume: 100,
                startOffset: 0,
                playbackMode: "loop"
              }
        );
      })
      .catch((error) => {
        console.error(
          "GamePage BGM: Could not load game settings.",
          error
        );

        if (active) {
          setLoadError("Could not load game settings.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;

      if (settingsDirtyRef.current) {
        const pendingSettings = { ...gameSettingsRef.current };
        settingsDirtyRef.current = false;

        saveGameSettings(appid, pendingSettings).catch((error) => {
          console.error(
            "GamePage BGM: Could not save pending game settings.",
            error
          );
        });
      }
    };
  }, [appid]);

  useEffect(() => {
    let active = true;

    if (loading || loadError || !gameSettings.music) {
      setArtwork(null);
      return;
    }

    setArtwork(null);

    getMusicArtwork(gameSettings.music)
    .then((result) => {
      if (active) {
        setArtwork(result);
      }
    })
    .catch((error) => {
      console.error(
        "GamePage BGM: Could not load album artwork.",
        error
      );

      if (active) {
        setArtwork(null);
      }
    });

    return () => {
      active = false;
    };
  }, [gameSettings.music, loading, loadError]);

  useEffect(() => {
    if (loading || loadError || !settingsDirtyRef.current) {
      return;
    }

    const timeout = setTimeout(async () => {
      if (!settingsDirtyRef.current) return;

      const settingsToSave = { ...gameSettingsRef.current };

      try {
        await saveGameSettings(appid, settingsToSave);

        if (
          JSON.stringify(gameSettingsRef.current) ===
          JSON.stringify(settingsToSave)
        ) {
          settingsDirtyRef.current = false;
        }
      } catch (error) {
        console.error(
          "GamePage BGM: Could not automatically save game settings.",
          error
        );
      }
    }, 600);

    return () => {
      clearTimeout(timeout);
    };
  }, [gameSettings, loading, loadError, appid]);

  const chooseMusic = () => {
    setPickerError("");
    setPickingMusic(true);

    let modalHandle: ReturnType<typeof showModal> | null = null;

    const closeBrowser = () => {
      setPickingMusic(false);
      modalHandle?.Close();
    };

    try {
      modalHandle = showModal(
        <ModalRoot onCancel={closeBrowser}>
          <MusicBrowserModal
            onSelect={async (path) => {
              try {
                const savedSettings = await setGameMusic(appid, path);

                settingsDirtyRef.current = false;
                setGameSettings(savedSettings);
                closeBrowser();
              } catch (error) {
                console.error(
                  "GamePage BGM: Could not assign selected music.",
                  error
                );

                setPickerError(
                  error instanceof Error ? error.message : String(error)
                );

                throw error;
              }
            }}
          />
        </ModalRoot>,
        undefined,
        {
          strTitle: "Choose Background Music",
          popupWidth: 900,
          popupHeight: 650,
          bNeverPopOut: true
        }
      );
    } catch (error) {
      console.error("GamePage BGM: Could not open music browser.", error);
      setPickerError("Could not open the music browser.");
      setPickingMusic(false);
    }
  };

  const confirmRemoveMusic = () => {
    let modalHandle: ReturnType<typeof showModal> | null = null;

    const closeConfirmation = () => {
      modalHandle?.Close();
    };

    modalHandle = showModal(
      <ConfirmModal
        strTitle="Remove Game Music?"
        strDescription="This will remove the assigned music file and reset this game's settings, including volume, start offset and playback mode, to their defaults. The original audio file will not be deleted."
        strOKButtonText="Remove Music"
        strCancelButtonText="Cancel"
        bDestructiveWarning={true}
        onCancel={closeConfirmation}
        onOK={async () => {
          settingsDirtyRef.current = false;
          closeConfirmation();

          try {
            await removeGameMusic(appid);

            const defaultSettings: GameSettings = {
              music: "",
              volume: 100,
              startOffset: 0,
              playbackMode: "loop"
            };

            gameSettingsRef.current = defaultSettings;
            setGameSettings(defaultSettings);
            setArtwork(null);
            setPickerError("");
          } catch (error) {
            settingsDirtyRef.current = true;
            setGameSettings((current) => ({ ...current }));
            console.error(
              "GamePage BGM: Could not remove game music.",
              error
            );

            setPickerError(
              "Could not remove game music and reset its settings."
            );
          }
        }}
      />,
      undefined,
      {
        bNeverPopOut: true
      }
    );
  };

  return (
    <PanelSection title={"\u00A0"}>
      <PanelSectionRow>
        <div style={{ padding: "8px 0", width: "100%" }}>
          <div style={{ fontSize: "24px", fontWeight: 600, paddingBottom: "8px" }}>
            {gameTitle || "Loading game title..."}
          </div>
          <strong>Steam App ID: {appid}</strong>
        </div>
      </PanelSectionRow>

      {loading ? (
        <PanelSectionRow>
          <div>Loading settings...</div>
        </PanelSectionRow>
      ) : loadError ? (
        <PanelSectionRow>
          <div>{loadError}</div>
        </PanelSectionRow>
      ) : (
        <PanelSectionRow>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 3.8fr)",
              gap: "20px",
              width: "100%",
              alignItems: "start"
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  background: "#101b30",
                  borderRadius: "8px",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                {artwork ? (
                  <img
                    src={artwork}
                    alt="Album artwork"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain"
                    }}
                  />
                ) : (
                  <div style={{ textAlign: "center", padding: "16px" }}>
                    <div style={{ fontSize: "48px" }}>♫</div>
                    <div>No artwork available</div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ marginBottom: "16px", overflowWrap: "anywhere" }}>
                <strong>Track</strong>
                <div>
                  {gameSettings.music
                    ? gameSettings.music.split("/").pop()
                    : "No music selected"}
                </div>

                <div style={{ marginTop: "8px" }}>
                  <strong>File location</strong>
                  <div style={{ overflowWrap: "anywhere" }}>
                    {gameSettings.music || "—"}
                  </div>
                </div>
              </div>

              <SliderField
                label="Volume"
                description="Adjust music volume:"
                value={gameSettings.volume}
                min={0}
                max={200}
                step={1}
                valueSuffix="%"
                showValue={true}
                disabled={loading || Boolean(loadError)}
                onChange={(value) => {
                  settingsDirtyRef.current = true;
                  setGameSettings((current) => ({
                    ...current,
                    volume: value
                  }));
                }}
              />

              <SliderField
                label="Start Offset"
                description="Choose where music starts from:"
                value={gameSettings.startOffset}
                min={0}
                max={300}
                step={1}
                valueSuffix="s"
                showValue={true}
                disabled={loading || Boolean(loadError)}
                onChange={(value) => {
                  settingsDirtyRef.current = true;
                  setGameSettings((current) => ({
                    ...current,
                    startOffset: value
                  }));
                }}
              />

              <DropdownItem
                label="Playback Mode"
                description="Choose playback behaviour:"
                rgOptions={[
                  { data: "loop", label: "Loop" },
                  { data: "once", label: "Play Once" }
                ]}
                selectedOption={gameSettings.playbackMode}
                disabled={loading || Boolean(loadError)}
                onChange={(option) => {
                  settingsDirtyRef.current = true;
                  setGameSettings((current) => ({
                    ...current,
                    playbackMode: option.data
                  }));
                }}
              />
              <ButtonItem
                label="Change Music File"
                description={
                  pickingMusic
                    ? "Opening file picker..."
                    : "Choose a different music file"
                }
                onClick={chooseMusic}
                disabled={pickingMusic}
              >
                Browse local files
              </ButtonItem>

              {gameSettings.music && (
                <ButtonItem
                  label="Remove Music"
                  description="Remove this game's music and reset its settings"
                  onClick={confirmRemoveMusic}
                  disabled={loading || Boolean(loadError)}
                >
                  Remove Music
                </ButtonItem>
              )}
            </div>
          </div>
        </PanelSectionRow>
      )}

      {pickerError && (
        <PanelSectionRow>
          <div style={{ padding: "8px 0", color: "#ff6b6b" }}>
            {pickerError}
          </div>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
}

const GAME_SETTINGS_ROUTE = "/gamepage-bgm/:appid";

export default definePlugin(() => {
  routerHook.addRoute(GAME_SETTINGS_ROUTE, GameSettingsPage);

  const contextMenuUnpatch = patchContextMenuFocus();
  const showContextMenuUnpatch = patchSteamContextMenu();

  console.log("GamePage BGM initialized");

  return {
    name: "GamePage BGM",
    titleView: (
      <div className={staticClasses.Title}>
        GamePage BGM
      </div>
    ),
    content: <Content />,
    icon: <FaMusic />,
    onDismount() {
      showContextMenuUnpatch?.();
      contextMenuUnpatch?.();
      contextMenuState.appId = null;
      routerHook.removeRoute(GAME_SETTINGS_ROUTE);
      console.log("GamePage BGM unloaded");
    }
  };
});
