
import {
  PanelSection,
  PanelSectionRow,
  ToggleField,
  staticClasses
} from "@decky/ui";

import {
  callable,
  definePlugin
} from "@decky/api";

import { useEffect, useState } from "react";
import { FaMusic } from "react-icons/fa";

type Settings = {
  enabled: boolean;
  games: Record<string, string>;
};

const getSettings = callable<[], Settings>("get_settings");
const saveEnabled = callable<[enabled: boolean], boolean>("set_enabled");

function Content() {
  const [enabled, setEnabled] = useState(true);
  const [games, setGames] = useState<Record<string, string>>({});
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
          Object.entries(games).map(([appId, path]) => (
            <PanelSectionRow key={appId}>
              <div style={{ padding: "8px 0" }}>
                <strong>Steam App ID: {appId}</strong>
                <div style={{ opacity: 0.7, fontSize: "12px" }}>
                  {path.split("/").pop()}
                </div>
              </div>
            </PanelSectionRow>
          ))
        )}
      </PanelSection>
    </PanelSection>
  );
}

export default definePlugin(() => {
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
      console.log("GamePage BGM unloaded");
    }
  };
});
